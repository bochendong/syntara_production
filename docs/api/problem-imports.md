# Problem import API

Claude Code and other command-line clients can upload an original PDF to `POST /api/v1/problem-imports`. The endpoint runs the same OpenAI file extraction and source-figure pipeline used by the teacher upload flow, and returns drafts with their reference answers. Independent answer verification is disabled by default.

## Configure access

Set these variables on the Syntara server, then start or restart it with `pnpm dev`:

```dotenv
OPENAI_API_KEY=<server OpenAI key>
SYNTARA_PUBLIC_API_KEY=<random private Syntara token>
SYNTARA_PUBLIC_API_USER_ID=<existing Syntara user ID>
```

With no database configured, a local user identifier can be used instead. With a database, use an existing user: generation follows the existing usage and credit accounting. The server chooses its configured OpenAI model. Clients use the Syntara token, and do not need the OpenAI key.

## Call from Claude Code

Give Claude Code this file and the command below. Set the token in its shell environment:

```bash
export SYNTARA_PUBLIC_API_KEY='<same Syntara token>'
node scripts/problem-import.mjs \
  --file /absolute/path/to/questions.pdf \
  --out /absolute/path/to/result.json \
  --url http://localhost:3000 \
  --language en-US
```

The client needs Node.js 22 and no additional packages. `SYNTARA_API_BASE_URL` can supply the base URL instead of `--url`. It waits up to ten minutes for the synchronous response. Hosting and reverse-proxy timeouts still apply; the route declares a 300-second duration, so start with a small document.

The equivalent HTTP request is:

```bash
curl --fail-with-body --max-time 600 \
  -H "Authorization: Bearer $SYNTARA_PUBLIC_API_KEY" \
  -F 'file=@/absolute/path/to/questions.pdf;type=application/pdf' \
  -F 'language=en-US' \
  -F 'verify_answers=false' \
  http://localhost:3000/api/v1/problem-imports \
  -o result.json
```

## Request and response

Send `multipart/form-data` with exactly one non-empty `file` (PDF, at most 20 MiB). `language` accepts `zh-CN` (default) or `en-US`. `verify_answers` accepts `false` (default) or `true`; the CLI enables it with `--verify-answers`.

Success returns `{ "success": true, "request_id": "...", "data": { ... } }`. The `data` object contains:

- `first_pass`: extracted drafts before figure attachment and final quality checks. Each draft includes `publicContent`, `grading`, `sourceMeta`, and `validationErrors`.
- `problems`: drafts after source figures have been attached. Images are data URLs in `publicContent.assets.images[].src`; save or render these to inspect the actual crops.
- `skipped`: solution-only items excluded during finalization.
- `quality_report`: deterministic content and figure diagnostics. With verification disabled, `answerCheck` is `not_run`; a `passed` status does not certify correctness.
- `usage`: aggregate extraction, figure processing, and optional verification usage.
- `model`, `source.openai_file_id`, `verify_answers`, `id`, and `created_at`: generation metadata.

`storage: "none"` means no course or notebook problems are saved in Syntara. The original file is uploaded to OpenAI and its file ID is returned. Reference answers are included, so use this endpoint for authoring and inspection.

Failures use `{ "success": false, "request_id": "...", "error": { "code": "...", "message": "..." } }`: 401 for invalid credentials, 400 for invalid fields, 413 for oversized input, 415 for unsupported content, and 502 for generation failures. Repeating a request starts another generation and may incur another charge.

## Initial source test

On October 2, 2026, four original PDFs were tested with the locally configured `gpt-5.6-luna`, with independent verification disabled. COMM190 generated 17 bundles from 50 original numbered questions; CHEM233 generated 13 drafts; ECO101 Tutorial 10 generated 10 drafts; the solution-only ECO101 PS1 file correctly produced no drafts. Manual inspection found merged independent questions, missing shared conditions, wrong answers, and malformed math delimiters. These results do not support claiming that all generated problems are usable.

That run also exposed missing Node canvas configuration in source-figure rendering, resulting in zero attached images. The canvas configuration was corrected while adding this endpoint, and long figure identifiers were replaced with short identifiers that the locator can copy exactly. A subsequent CHEM233 smoke test successfully attached the clean formal-charge structure and table; the crop was visually inspected.

The CLI was tested against a local Next.js HTTP server: an ECO101 Tutorial 10 upload returned HTTP 200 and saved 9 drafts with verification disabled. Its generated crops were rejected or unlocated, and the producer-surplus/profit subquestion was omitted in this rerun, so this remains evidence of an operable interface rather than reliable extraction quality. Missing credentials, malformed uploads, invalid options, and oversized PDFs were also rejected with the documented statuses. TypeScript and the changed files' lint and format checks passed; full-repository checks have unrelated existing failures.

The saved results are under `.data/import-accuracy/2026-10-02T20-18-30-036Z/`, including `first-pass.json` per source, `manual-audit.json`, `api-result.json`, and `api-validation.json`. Automatic word-overlap comparisons are approximate and are not an accuracy score.

## Extraction changes after the initial test

The first runs' drafts had no `scaffoldIndex`, which means the outline pass failed and the single-pass fallback produced bundled questions. Changes:

- The outline response is sanitized field by field before strict validation, so one over-long `visualRef` or fractional point value no longer rejects the whole outline. Its output budget was raised from 10k to 24k tokens, and an unparseable outline is retried once with a compact request before any fallback.
- Printed question numbers are read from the PDF text layer and given to the outline pass. If the outline misses numbers or merges several into one item, it is regenerated once and the better-covering outline is kept. `quality_report.coverage` reports `printedQuestionCount`, `missingQuestions`, and `mergedItems`; scanned PDFs without a text layer report `checked: false`.
- Fallback drafts are marked `sourceMeta.extractionPath = "single_pass_fallback"` and carry a review issue.
- Each transcription batch receives the relevant `sharedContexts` and must copy complete givens into every split-out problem. The batch writes its derivation in `grading.analysis` before the answer fields, and verifies claims such as equivalence or feasibility by substitution. Batch size is 6.

These changes have passed type, lint, and offline checks (text-layer numbering finds 50, 19, and 3 printed questions in the COMM190, CHEM233, and ECO101 test PDFs). They still need a real API rerun.

## Rerun results (2026-10-02, gpt-5.6-luna, verification off)

Run with `scripts/maintenance/import-accuracy-test.cjs <case> --first-pass --cache <dir> --out <name>`; results are in `.data/import-accuracy/rerun12-*`.

| Source | Printed questions | Drafts | Missing / merged | Figures attached | Needs review |
|---|---|---|---|---|---|
| COMM190 Past Midterm II | 50 | 58 (Q30, Q38 split into subparts) | 0 / 0 | 38 | 3 |
| CHEM233 PS02 | 19 | 31 | 0 / 0 | 30 | 7 |
| ECO101 TUT10 Answers | 3 (10 subparts) | 10 | 0 / 0 | 4 | 3 |

COMM190 answers were compared item by item with the repaired course: 45 of 58 match. Mismatches: Q14, Q17, Q22, Q25, Q29, Q46, Q48 (true/false that depend on reading a graph or a course convention), Q30d–e (Excel formulas `=C14-E14`, `=D15-$H$7*F15` written as `=C14`, `=D15`), Q38b (binding-constraint count 6 vs 12), Q41, Q45, Q50. Graph-reading answers changed between runs, so they are the least reliable. CHEM233 Q16–Q18, which were previously merged into an invented bundle, are now separate and correct. ECO101 numeric answers match; the solution graph on page 2 is withheld instead of being shown as a premise.

Fixes made during these runs: subparts may be separate items (`1a`, `1b`) while different printed numbers may not merge; outline labels such as `2a-1` are parsed as one question; draft normalization accepts list-shaped `analysis` and rubric items keyed `criterion` instead of replacing the stem with the title; prompts follow the source language detected from the PDF text layer; spreadsheet formulas are fill-blank, not code; multi-answer choices become `selectionMode: "multiple"`; rubric weights are rescaled to 100; model notes that do not block answering go to `sourceMeta.notes`; figure checks distinguish handwriting and worked solutions from printed givens, confirm rejections with a second check, never substitute a lookalike for a withheld solution figure, and reuse a shared figure only from an adjacent page; malformed math gets one formatting-only repair whose wording is verified unchanged.

Remaining limits: without independent verification about one answer in five on the COMM190 exam disagrees with the repaired course, concentrated in graph reading, Excel formulas, and sensitivity-report conventions. A choice question with more than 12 options (CHEM233 Q11) still fails the schema. These results do not certify that all problems are usable.
