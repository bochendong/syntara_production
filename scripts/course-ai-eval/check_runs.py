#!/usr/bin/env python3
"""Automatic checks over a run directory: Racket recipe tags + judge run; Python docstring style."""
import glob, json, os, re, sys
import syntara_course_ai as s

FORBID = re.compile(r'#lang racket|\(for[/\s*]|\(let\*?\s|\(set!|\(begin\s|\(when\s|\(unless\s|printf|displayln')

def racket_checks(ans, judge=True):
    blocks = s.racket_blocks(ans)
    code = '\n'.join(blocks)
    out = {}
    designs = re.findall(r'\(@htdf ', code)
    if designs:
        out['signature'] = '(@signature' in code
        defines = re.findall(r'^\(define \(([^\s)]+)', code, re.M)
        out['stub_commented'] = re.search(r';\s*\(define \(', code) is not None and len(defines) == len(set(defines))
        out['check_expect'] = code.count('(check-expect') >= 2
        out['template_origin'] = '(@template-origin' in code
    elif re.search(r'^\(define \(', code, re.M):
        out['htdf_tag'] = False
    if '(@htdd' in code or 'is one of' in code:
        out['dd_rules'] = '(@dd-template-rules' in code
    out['in_scope'] = not FORBID.search(code)
    if judge and code.strip():
        errs = []
        for b in blocks:
            if not re.search(r'\(define|\(check-expect', b): continue
            d = s.run_racket(b.replace('#lang racket', ''))
            if d.get('status') == 'error':
                errs.append(((d.get('result') or {}).get('error') or '')[-160:])
        out['runs'] = not errs
        if errs: out['run_errors'] = errs
    return out

def python_checks(ans):
    blocks = re.findall(r'```python\n(.*?)```', ans or '', re.S)
    code = '\n'.join(blocks)
    defs = re.findall(r'def \w+\(.*?\).*?:\n((?:[ \t]+.*\n?)*)', code)
    if not defs: return {}
    out = {'annotated': all('->' in l for l in re.findall(r'^\s*def .*$', code, re.M))}
    docs = re.findall(r'def [^\n]*\n\s+"""(.*?)"""', code, re.S)
    out['docstring_every_def'] = len(docs) == len(re.findall(r'^\s*def ', code, re.M))
    out['doctest_2plus'] = bool(docs) and all(d.count('>>>') >= 2 for d in docs)
    out['no_args_returns'] = not re.search(r'Args:|Returns:|:param', code)
    return out

run = sys.argv[1]
rows = []
for f in sorted([p for p in glob.glob(os.path.join(run, '*.json')) if not p.endswith('checks.json')]):
    r = json.load(open(f))
    ans = r.get('answer') or ''
    cid = r['case']['id']
    chk = racket_checks(ans, judge='--no-judge' not in sys.argv) if cid.startswith('c') else python_checks(ans)
    passed = all(v for k, v in chk.items() if k != 'run_errors') if chk else None
    rows.append({'file': os.path.basename(f), 'notes': len(r.get('notesSent') or []), 'checks': chk, 'pass': passed,
                 'jiayou': ans.rstrip().endswith('加油吧') or '加油吧' in ans[-30:]})
json.dump(rows, open(os.path.join(run, 'checks.json'), 'w'), ensure_ascii=False, indent=1)
for row in rows:
    print(row['file'], 'PASS' if row['pass'] else ('-' if row['pass'] is None else 'FAIL'), {k: v for k, v in row['checks'].items() if v is not True}, '加油吧' if row['jiayou'] else '')
