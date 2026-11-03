#!/usr/bin/env python3
"""Run cases.json against the test server and save raw answers (one JSON per case)."""
import json, os, sys, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(__file__))
import syntara_course_ai as s

out_dir = sys.argv[1]
modes = sys.argv[2].split(',') if len(sys.argv) > 2 else ['real']
only = sys.argv[3].split(',') if len(sys.argv) > 3 else None
cases = json.load(open(os.path.join(os.path.dirname(__file__), 'cases.json')))
os.makedirs(out_dir, exist_ok=True)
jobs = []
for course, items in cases.items():
    for c in items:
        if only and c['id'] not in only: continue
        for m in modes:
            jobs.append((course, c, m))

def run(job):
    course, c, m = job
    path = os.path.join(out_dir, f"{c['id']}-{m}.json")
    if os.path.exists(path): return path
    for attempt in range(2):
        try:
            r = s.ask(course, c['q'], progress=m)
            r.update(case=c, mode=m)
            json.dump(r, open(path, 'w'), ensure_ascii=False, indent=2)
            return path
        except Exception as e:
            err = str(e)
    json.dump({'case': c, 'mode': m, 'error': err}, open(path, 'w'), ensure_ascii=False)
    return path

with cf.ThreadPoolExecutor(4) as ex:
    for p in ex.map(run, jobs): print('done', p, flush=True)
