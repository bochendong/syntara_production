#!/usr/bin/env python3
"""Ask a Syntara course's chat AI from the command line (or as an MCP stdio server).

It reproduces what the native app sends to POST /api/native/v2/chat:
the same note retrieval as apps/native/src/ai/context.ts (keyword scoring over
notebooks inside learning progress), the course header, and (desktop/tablet)
the problem list. So answers match what a student sees in the App.

Usage:
  syntara_course_ai.py login                        # device login, prints approve URL
  syntara_course_ai.py courses
  syntara_course_ai.py ask --course CPSC110 "什么是 HtDF?" [--progress all|real|N]
        [--surface desktop|tablet|phone] [--strength low|medium|high] [--json]
        [--run]                                     # --run: also run each ```racket block on the judge
  syntara_course_ai.py run-racket file.rkt [--problem ID --target public]
  syntara_course_ai.py mcp                          # MCP server over stdio (tools: list_courses, ask_course, run_racket)

Auth is stored in $SYNTARA_AUTH (default ~/.syntara-course-ai.json).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from datetime import date

BASE = os.environ.get('SYNTARA_BASE', 'https://native-api-staging-staging-95a1.up.railway.app')
AUTH_FILE = os.environ.get('SYNTARA_AUTH', os.path.expanduser('~/.syntara-course-ai.json'))
CACHE_DIR = os.environ.get('SYNTARA_CACHE', os.path.expanduser('~/.cache/syntara-course-ai'))

# Same constants as apps/native/src/ai/context.ts
MAX_NOTES = 6
MAX_NOTE_CHARS = 5000
MAX_NOTES_TOTAL_CHARS = 20_000
CHUNK_CHARS = 2400
MAX_SEARCHED_NOTEBOOKS = 30
STOP_TERMS = {'什么', '怎么', '为什', '么是', '一下', '这个', '那个', '可以', '如何', '是不', '不是',
              'the', 'and', 'what', 'how', 'why'}


# ---------------------------------------------------------------- http/auth
def _req(method, path, body=None, token=None, headers=None, raw=False, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    h = {'content-type': 'application/json'}
    if token:
        h['authorization'] = f'Bearer {token}'
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'{method} {path} -> {e.code}: {e.read().decode()[:500]}') from None
    return resp if raw else json.loads(resp.read().decode())


def _load_auth():
    try:
        with open(AUTH_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        raise SystemExit('Not logged in. Run: syntara_course_ai.py login')


def _save_auth(data):
    with open(AUTH_FILE, 'w') as f:
        json.dump(data, f)
    os.chmod(AUTH_FILE, 0o600)


def token():
    a = _load_auth()
    exp = a.get('accessTokenExpiresAt') or ''
    if exp and exp[:19] > time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(time.time() + 120)):
        return a['accessToken']
    d = _req('POST', '/api/native/v1/auth/refresh', {'refreshToken': a['refreshToken']})['data']
    a.update(d)
    _save_auth(a)
    return a['accessToken']


def login():
    d = _req('POST', '/api/native/v1/auth/device/start',
             {'deviceId': f'course-ai-cli-{uuid.uuid4().hex[:8]}', 'deviceName': 'Course AI CLI'})['data']
    print('Open and approve:', d['verificationUriComplete'], file=sys.stderr)
    for _ in range(d['expiresInSeconds'] // d['intervalSeconds']):
        time.sleep(d['intervalSeconds'])
        try:
            r = _req('POST', '/api/native/v1/auth/device/token', {'deviceCode': d['deviceCode']})['data']
        except RuntimeError as e:
            raise SystemExit(str(e))
        if r.get('accessToken'):
            _save_auth(r)
            print('Logged in as', r['user']['email'], file=sys.stderr)
            return
    raise SystemExit('Device code expired.')


def api(path):
    return _req('GET', path, token=token())['data']


# ---------------------------------------------------------------- course data
def courses():
    d = api('/api/native/v1/courses')
    return d['courses'] if isinstance(d, dict) else d


def find_course(query):
    q = query.lower().replace(' ', '')
    for c in courses():
        hay = f"{c['id']} {c['name']} {c.get('courseCode') or ''}".lower().replace(' ', '')
        if q in hay:
            return c
    raise SystemExit(f'No course matches {query!r}')


def notebook_archive(nb):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{nb['id'].replace(':', '_')}-{nb['updatedAt']}.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    data = api(f"/api/native/v1/notebooks?id={urllib.request.quote(nb['id'])}")
    with open(path, 'w') as f:
        json.dump(data, f)
    return data


def normalized(s):
    return unicodedata.normalize('NFKC', s).lower()


def readable_text(value, out=None, depth=0):
    out = [] if out is None else out
    if depth > 8 or len(out) > 400:
        return out
    if isinstance(value, str):
        t = value.strip()
        if t and not re.match(r'^(data:|blob:|https?://|/)', t) and not re.match(r'^[\w-]{16,}$', t):
            out.append(t)
    elif isinstance(value, list):
        for v in value:
            readable_text(v, out, depth + 1)
    elif isinstance(value, dict):
        for k, v in value.items():
            if re.match(r'^(id|src|url|style|color|className|type|width|height|x|y)$', k, re.I):
                continue
            readable_text(v, out, depth + 1)
    return out


def without_inline_images(md):
    md = re.sub(r'!\[([^\]]*)\]\(data:[^)]*\)', lambda m: f'[图：{m.group(1)}]' if m.group(1) else '[图]', md)
    md = re.sub(r'<img[^>]+src=["\']data:[^"\']*["\'][^>]*>', '[图]', md, flags=re.I)
    return re.sub(r'data:[a-z]+/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{100,}', '[图]', md, flags=re.I)


def chunks_of(doc):
    nb = doc['notebook']
    if doc.get('markdownSections'):
        secs = [(s['id'], s['title'], s['markdown']) for s in sorted(doc['markdownSections'], key=lambda s: s['order'])]
    else:
        secs = [(p['id'], p['title'], '\n'.join(readable_text(p.get('content'))))
                for p in sorted(doc.get('notebookPages', []), key=lambda p: p['order'])]
    out = []
    for sid, title, text in secs:
        text = without_inline_images(text or '').strip() if NEW_CONTEXT else (text or '').strip()
        if not text:
            continue
        parts = [text[i:i + CHUNK_CHARS] for i in range(0, len(text), CHUNK_CHARS)]
        for i, content in enumerate(parts):
            out.append({'id': sid + (f'#{i + 1}' if len(parts) > 1 else ''), 'notebookId': nb['id'],
                        'notebook': nb['name'], 'title': title or nb['name'], 'content': content,
                        'haystack': normalized(f'{title}\n{content}')})
    return out


def search_terms(text):
    v = normalized(text)
    terms = []
    for w in re.findall(r'[a-z][a-z0-9_+-]{2,}|\d+(?:\.\d+)?', v):
        if w not in terms:
            terms.append(w)
    for run in re.findall(r'[一-鿿]{2,}', v):
        for i in range(len(run) - 1):
            if run[i:i + 2] not in terms:
                terms.append(run[i:i + 2])
    return terms[:60]


def score(chunk, primary, secondary):
    total = 0
    for t in primary:
        if t not in STOP_TERMS and t in chunk['haystack']:
            total += 4 if len(t) > 2 else 3
    for t in secondary:
        if t not in STOP_TERMS and t in chunk['haystack']:
            total += 1
    return total


# Mirror of apps/native/src/ai/problem-focus.ts (set SYNTARA_OLD_CONTEXT=1 to mimic the App before 2026-11-03).
NEW_CONTEXT = not os.environ.get('SYNTARA_OLD_CONTEXT')
CN = dict(zip('一二三四五六七八九', range(1, 10)))


def _cn(v):
    if v.isdigit():
        return int(v)
    if v == '十':
        return 10
    if v.startswith('十'):
        return 10 + CN.get(v[1], 0)
    if v.endswith('十'):
        return CN.get(v[0], 0) * 10
    return CN.get(v, 0)


def exam_key(t):
    t = unicodedata.normalize('NFKC', t).lower()
    t = re.sub(r'第\s*([0-9一二三四五六七八九十]+)\s*(?:题|問|问|道)', lambda m: f' p{_cn(m.group(1))} ', t)
    t = re.sub(r'\b(?:q|question|problem)\s*(\d+)', r' p\1 ', t)
    t = re.sub(r'midterm|期中考试|期中', 'mt', t)
    t = re.sub(r'期末考试|期末|final exam', 'final', t)
    t = t.replace('winter', 'w').replace('summer', 's')
    return re.sub(r'\s+', '', t)


def _idents(title):
    tail = title.split('·')[-1]
    return [w.lower() for w in re.findall(r'[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+[?!]?|[a-z]{4,}[?!]', tail, re.I)]


def _exam(title):
    head, _, tail = title.partition('·')
    sitting = exam_key(head)
    nums = [f'p{n}' for m in re.findall(r'p(\d+(?:-\d+)*)', exam_key(tail)) for n in m.split('-')]
    return (sitting, nums) if sitting and nums else None


def focused_problem(problems, question, earlier=''):
    for text in (question, earlier):
        if not text.strip():
            continue
        key, lower, ranked = exam_key(text), text.lower(), []
        for p in problems:
            if p.get('status') == 'archived':
                continue
            v = 10 if any(w in lower for w in _idents(p['title'])) else 0
            ex = _exam(p['title'])
            if ex and ex[0] in key:
                v += 3
                rest = key.split(ex[0], 1)[1]
                if any(re.search(n + r'(?!\d)', rest) for n in ex[1]):
                    v += 6
            if v >= 9:
                ranked.append((v, p))
        ranked.sort(key=lambda x: -x[0])
        if ranked and (len(ranked) == 1 or ranked[0][0] > ranked[1][0]):
            return ranked[0][1]
        if ranked:
            return None
    return None


def focused_problem_text(p):
    c = p.get('publicContent') or {}
    st = lambda v: v.strip() if isinstance(v, str) else ''
    lst = lambda v: v if isinstance(v, list) else []
    rows = [' | '.join(st(x) for x in (r.get('cells') or {}).values() if st(x)) for r in lst(c.get('rows'))]
    opts = [f"{st(o.get('id'))}. {st(o.get('label')) or st(o.get('text'))}" for o in lst(c.get('options'))]
    parts = [f"({pt.get('label', '')}) {st((pt.get('content') or {}).get('stem')) or st((pt.get('content') or {}).get('prompt'))}" for pt in lst(c.get('parts'))]
    cons = [st(x) for x in lst(c.get('constraints')) if st(x)]
    samples = [f"{st(x.get('input'))} → {st(x.get('output'))}" for x in lst(c.get('sampleIO'))]
    out = '\n\n'.join(x for x in [
        f"标题：{p['title']}（id={p['id']}）",
        '题面：\n' + (st(c.get('stem')) or st(c.get('stemTemplate')) or p['title']),
        '要判断的陈述：\n' + '\n'.join('- ' + r for r in rows if r) if any(rows) else '',
        '选项：\n' + '\n'.join(opts) if opts else '',
        '小问：\n' + '\n'.join(parts) if parts else '',
        '起始代码：\n```\n' + st(c.get('starterCode')) + '\n```' if st(c.get('starterCode')) else '',
        '要求：\n' + '\n'.join('- ' + x for x in cons) if cons else '',
        '样例：\n' + '\n'.join(samples) if samples else '',
    ] if x)
    return out[:9000] + ('\n…（后面省略）' if len(out) > 9000 else '')


def readable_notebooks(notebooks, progress_mode, learning_progress):
    # Simplified groupNotebookTranslations: courses here have no translations.
    if progress_mode == 'all':
        n = len(notebooks)
    elif progress_mode == 'real':
        lp = learning_progress or {}
        if lp.get('kind') == 'completed_all':
            n = len(notebooks)
        elif lp.get('kind') == 'notebook':
            ids = [nb['id'] for nb in notebooks]
            n = ids.index(lp['notebookId']) + 1 if lp.get('notebookId') in ids else 0
        else:
            n = 0
    else:
        n = int(progress_mode)
    return notebooks[:n]


def build_context(course_data, problems, messages, surface, progress_mode):
    notebooks = course_data['notebooks']
    readable = readable_notebooks(notebooks, progress_mode, course_data.get('learningProgress'))
    unset = NEW_CONTEXT and not readable
    searched = (notebooks if unset else readable)[-MAX_SEARCHED_NOTEBOOKS:]
    chunks = [c for nb in searched for c in chunks_of(notebook_archive(nb))]
    question = messages[-1]['text']
    earlier = '\n'.join(m['text'][:600] for m in messages[-5:-1])
    primary, secondary = search_terms(question), search_terms(earlier)
    scored = sorted(((c, score(c, primary, secondary)) for c in chunks), key=lambda x: -x[1])
    picked = [c for c, v in scored if v >= 3]
    fallback = False
    if not picked:
        fallback = True
        cur = searched[-1]['id'] if searched else None
        picked = [c for c in chunks if c['notebookId'] == cur][:2]
    notes, budget = [], MAX_NOTES_TOTAL_CHARS
    for c in picked:
        if len(notes) >= MAX_NOTES or budget <= 0:
            break
        content = c['content'][:min(MAX_NOTE_CHARS, budget)]
        budget -= len(content)
        notes.append({k: c[k] for k in ('id', 'notebookId', 'notebook', 'title')} | {'content': content})
    ctx = {'today': date.today().isoformat(),
           'progress': {'completedNotebooks': len(readable), 'totalNotebooks': len(notebooks),
                        'currentNotebook': readable[-1]['name'] if readable else None,
                        **({'unset': True} if unset else {})},
           'notes': notes, 'memories': [], 'calendar': [], 'attempts': [], 'problems': []}
    if surface != 'phone':
        if NEW_CONTEXT:
            focus = focused_problem(problems, question, earlier)
            if focus:
                ctx['focusProblem'] = {'id': focus['id'], 'title': focus['title'][:300], 'text': focused_problem_text(focus)}
        terms = primary + secondary
        live = [p for p in problems if p.get('status') != 'archived']
        live.sort(key=lambda p: -sum(t in normalized(p['title'] + ' ' + ' '.join(p.get('tags', []))) for t in terms))
        ctx['problems'] = [{'id': p['id'], 'title': p['title'][:300], 'type': p.get('type'),
                            'difficulty': p.get('difficulty'), 'tags': p.get('tags', [])[:12],
                            'excerpt': json.dumps(p.get('publicContent'), ensure_ascii=False)[:600],
                            'status': None} for p in live[:40]]
    debug = {'focusProblem': ctx.get('focusProblem', {}).get('title'), 'progressUnset': bool(unset),
             'readableNotebooks': len(readable), 'chunksSearched': len(chunks), 'fallback': fallback,
             'scores': [(c['notebook'], c['title'], v) for c, v in scored[:8]]}
    return ctx, debug


def ask(course_query, question, history=None, surface='desktop', progress='real', strength=None, model=None):
    course = find_course(course_query)
    cd = api(f"/api/native/v1/course-data?courseId={course['id']}")
    problems = []
    if surface != 'phone':
        problems = api(f"/api/native/v1/problems?courseId={course['id']}").get('problems') or []
    messages = list(history or []) + [{'role': 'user', 'text': question}]
    ctx, debug = build_context(cd, problems, messages, surface, progress)
    body = {'requestId': f'eval-{uuid.uuid4()}', 'surface': surface, 'scope': 'course',
            'course': {'id': course['id'], 'name': course['name'], 'code': course.get('courseCode'),
                       'description': (course.get('description') or '')[:4000],
                       'language': course.get('language') or 'zh-CN'},
            'messages': messages, 'images': [], 'files': [], 'context': ctx}
    headers = {}
    if strength:
        headers['x-response-strength'] = strength
    if model:
        headers['x-model'] = model
    resp = _req('POST', '/api/native/v2/chat', body, token=token(), headers=headers, raw=True, timeout=200)
    text, done, error, event = '', None, None, None
    for line in resp:
        line = line.decode().rstrip('\n')
        if line.startswith('event: '):
            event = line[7:]
        elif line.startswith('data: '):
            data = json.loads(line[6:])
            if event == 'text_delta':
                text += data.get('delta', '')
            elif event == 'done':
                done = data
            elif event == 'error':
                error = data
    meta = (done or {}).get('assistantMessage', {}).get('metadata', {})
    return {'course': course['name'], 'question': question, 'answer': text, 'error': error,
            'model': meta.get('model'), 'notesSent': [f"{n['notebook']} · {n['title']} ({n['id']})" for n in ctx['notes']],
            'retrieval': debug, 'learningActions': meta.get('learningActions'),
            'problemSelection': meta.get('problemSelection')}


def run_racket(code, course='CPSC110', problem_id=None, target='code'):
    """Run Racket code on the test server's judge (target=code: whole file; public: problem's public tests).

    Uses mode=run, which the server does not record for a course owner."""
    c = find_course(course)
    if not problem_id:
        probs = api(f"/api/native/v1/problems?courseId={c['id']}").get('problems') or []
        problem_id = next(p['id'] for p in probs if p.get('type') == 'code' and
                          (p.get('publicContent') or {}).get('language') == 'racket')
    body = {'courseId': c['id'], 'problemId': problem_id, 'attemptId': uuid.uuid4().hex[:16],
            'code': code if 'spd/tags' in code else '(require spd/tags)\n' + code,
            'mode': 'run', 'target': target}
    return _req('POST', '/api/native/v1/problem-code', body, token=token(), timeout=150)['data']


def racket_blocks(answer):
    return re.findall(r'```racket\n(.*?)```', answer or '', re.S)


# ---------------------------------------------------------------- MCP stdio
MCP_TOOLS = [
    {'name': 'list_courses', 'description': 'List Syntara test-server courses visible to the logged-in account.',
     'inputSchema': {'type': 'object', 'properties': {}}},
    {'name': 'ask_course', 'description': "Ask a course's chat AI a question, exactly as the native app would.",
     'inputSchema': {'type': 'object', 'required': ['course', 'question'], 'properties': {
         'course': {'type': 'string', 'description': 'course id, name or code, e.g. CPSC110'},
         'question': {'type': 'string'},
         'history': {'type': 'array', 'items': {'type': 'object'}, 'description': '[{role,text}] earlier turns'},
         'surface': {'type': 'string', 'enum': ['phone', 'tablet', 'desktop']},
         'progress': {'type': 'string', 'description': "'real' (account's learning progress), 'all', or a number"},
         'strength': {'type': 'string', 'enum': ['low', 'medium', 'high']}}}},
    {'name': 'run_racket', 'description': "Run Racket (BSL/ISL + spd tags) on the test server's judge; returns errors/test results.",
     'inputSchema': {'type': 'object', 'required': ['code'], 'properties': {
         'code': {'type': 'string'}, 'problemId': {'type': 'string', 'description': 'optional; with target=public runs that problem\'s public tests'},
         'target': {'type': 'string', 'enum': ['code', 'public']}}}},
]


def mcp():
    for line in sys.stdin:
        msg = json.loads(line)
        mid, method, params = msg.get('id'), msg.get('method'), msg.get('params') or {}
        if mid is None:
            continue
        try:
            if method == 'initialize':
                result = {'protocolVersion': params.get('protocolVersion', '2025-06-18'),
                          'capabilities': {'tools': {}}, 'serverInfo': {'name': 'syntara-course-ai', 'version': '0.1'}}
            elif method == 'tools/list':
                result = {'tools': MCP_TOOLS}
            elif method == 'tools/call':
                a = params.get('arguments') or {}
                if params['name'] == 'list_courses':
                    out = courses()
                elif params['name'] == 'run_racket':
                    out = run_racket(a['code'], problem_id=a.get('problemId'), target=a.get('target', 'code'))
                else:
                    out = ask(a['course'], a['question'], a.get('history'), a.get('surface', 'desktop'),
                              a.get('progress', 'real'), a.get('strength'))
                result = {'content': [{'type': 'text', 'text': json.dumps(out, ensure_ascii=False, indent=2)}]}
            else:
                result = {}
            reply = {'jsonrpc': '2.0', 'id': mid, 'result': result}
        except Exception as e:  # noqa: BLE001
            reply = {'jsonrpc': '2.0', 'id': mid, 'error': {'code': -32000, 'message': str(e)}}
        print(json.dumps(reply, ensure_ascii=False), flush=True)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='cmd', required=True)
    sub.add_parser('login')
    sub.add_parser('courses')
    sub.add_parser('mcp')
    a = sub.add_parser('ask')
    a.add_argument('--course', required=True)
    a.add_argument('--surface', default='desktop')
    a.add_argument('--progress', default='real')
    a.add_argument('--strength')
    a.add_argument('--model')
    a.add_argument('--json', action='store_true')
    a.add_argument('--run', action='store_true', help='also run each ```racket block on the judge')
    a.add_argument('question')
    rr = sub.add_parser('run-racket')
    rr.add_argument('file')
    rr.add_argument('--problem')
    rr.add_argument('--target', default='code')
    args = p.parse_args()
    if args.cmd == 'login':
        login()
    elif args.cmd == 'courses':
        for c in courses():
            print(f"{c['id']}  {c['name']}  ({c.get('courseCode')})")
    elif args.cmd == 'mcp':
        mcp()
    elif args.cmd == 'run-racket':
        print(json.dumps(run_racket(open(args.file).read(), problem_id=args.problem, target=args.target),
                         ensure_ascii=False, indent=2))
    else:
        r = ask(args.course, args.question, None, args.surface, args.progress, args.strength, args.model)
        if args.run:
            r['racketRuns'] = []
            for block in racket_blocks(r['answer']):
                d = run_racket(block.replace('#lang racket', ''))
                res = d.get('result') or {}
                r['racketRuns'].append({'status': d.get('status'), 'error': res.get('error'), 'stdout': res.get('stdout')})
        if args.json:
            print(json.dumps(r, ensure_ascii=False, indent=2))
        else:
            print(f"[{r['course']}] model={r['model']} notes={len(r['notesSent'])} fallback={r['retrieval']['fallback']}")
            for n in r['notesSent']:
                print('  -', n)
            print('\n' + (r['answer'] or json.dumps(r['error'], ensure_ascii=False)))
            for i, run in enumerate(r.get('racketRuns') or []):
                print(f"\n[racket block {i + 1}] {run['status']}: {(run['error'] or run['stdout'] or '').strip()[:300]}")


if __name__ == '__main__':
    main()
