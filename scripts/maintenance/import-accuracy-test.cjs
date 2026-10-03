/**
 * Offline accuracy test for the course problem-bank import.
 *
 * Runs the same extraction + finalizeImportedDrafts path as
 * app/api/teacher/courses/[courseId]/sources/[sourceId]/process/route.ts on local source
 * files, then compares the result with a manually repaired snapshot. It never writes to
 * the database: DATABASE_URL is removed before any app module loads, so the OpenAI key
 * comes from OPENAI_API_KEY in .env.local and usage is not recorded.
 *
 * Usage:
 *   node scripts/maintenance/import-accuracy-test.cjs                # all cases
 *   node scripts/maintenance/import-accuracy-test.cjs comm190-mt2    # one case
 *   node scripts/maintenance/import-accuracy-test.cjs --first-pass  # no answer recheck
 * Output: .data/import-accuracy/<timestamp>/<case>/{drafts.json,figures/,compare.json}
 */
/* eslint-disable @typescript-eslint/no-require-imports -- This CommonJS runner loads TypeScript via jiti. */
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..', '..');
const { createRequire } = require('node:module');
const { loadEnvConfig } = createRequire(require.resolve('next/package.json'))('@next/env');
loadEnvConfig(root, true);
delete process.env.DATABASE_URL;
delete process.env.DIRECT_URL;
const { createJiti } = require('jiti');
const jiti = createJiti(__filename, { alias: { '@': root }, jsx: true, interopDefault: true });

const DATA = path.join(root, '.data');
const CASES = [
  {
    id: 'comm190-mt2',
    file: 'kid-course-audit/comm190/sources/cmu4niwy1003jl3047gma3col.bin',
    fileName: 'COMM190 Past Midterm II.pdf',
    truth: 'kid-course-audit/comm190/db-after.json',
    sourceId: 'cmu4niwy1003jl3047gma3col',
  },
  {
    id: 'chem233-ps02',
    file: 'maggie-course-audit/chem233/sources/cmu3kmf900013i6049hjr3wn9.bin',
    fileName: 'PS 02 - Bonding Resonance Aromaticity.pdf',
    truth: 'maggie-course-audit/chem233/db-after-render-fixes.json',
    sourceId: 'cmu3kmf900013i6049hjr3wn9',
  },
  {
    id: 'eco101-tut10',
    file: 'chenchan-course-audit/UTM-ECO101WA/sources/ECO101_TUT10_Answers.pdf',
    fileName: 'ECO101_TUT10_Answers.pdf',
    truth: 'chenchan-course-audit/UTM-ECO101WA/db-after-delete.json',
    sourceId: 'cmu8sawrq0009le04zb34f31x',
  },
  {
    id: 'eco101-ps1-solutions',
    file: 'chenchan-course-audit/UTM-ECO101WA/sources/ECO 101 PS1 Solutions.pdf',
    fileName: 'ECO 101 PS1 Solutions.pdf',
    truth: null,
    sourceId: null,
    expectSolutionOnly: true,
  },
];

function rows(file) {
  const data = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
  return Array.isArray(data) ? data : data.problems;
}

function stemOf(content) {
  return String(content?.stem || content?.stemTemplate || '');
}

function words(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/\$[^$]*\$/g, ' ')
      .replace(/[^a-z0-9一-鿿]+/g, ' ')
      .split(' ')
      .filter((word) => word.length > 2),
  );
}

function jaccard(a, b) {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.max(1, a.size + b.size - shared);
}

function norm(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s$`'"“”.,，。;:()\\{}]/g, '');
}

function correctLabels(content, grading) {
  if (grading?.type !== 'choice' || content?.type !== 'choice') return null;
  const ids = new Set(grading.correctOptionIds || []);
  return content.options
    .filter((option) => ids.has(option.id))
    .map((option) => norm(option.label))
    .sort()
    .join('|');
}

function compare(drafts, truthRows) {
  const truth = truthRows.map((row) => ({
    row,
    words: words(stemOf(row.publicContentJson) + ' ' + row.title),
    images: (row.publicContentJson.assets?.images || []).length,
  }));
  const used = new Set();
  const pairs = [];
  drafts.forEach((draft, index) => {
    const w = words(stemOf(draft.publicContent) + ' ' + draft.title);
    let best = -1;
    let bestScore = 0;
    truth.forEach((item, truthIndex) => {
      if (used.has(truthIndex)) return;
      const score = jaccard(w, item.words);
      if (score > bestScore) {
        best = truthIndex;
        bestScore = score;
      }
    });
    if (best >= 0 && bestScore >= 0.2) {
      used.add(best);
      pairs.push({ draftIndex: index, truthIndex: best, score: Number(bestScore.toFixed(2)) });
    }
  });

  const perProblem = pairs.map(({ draftIndex, truthIndex, score }) => {
    const draft = drafts[draftIndex];
    const t = truth[truthIndex];
    const draftLabels = correctLabels(draft.publicContent, draft.grading);
    const truthLabels = correctLabels(t.row.publicContentJson, t.row.gradingJson);
    const review = draft.sourceMeta?.importReview || {};
    return {
      truthNumber: t.row.problemNumber,
      draftTitle: draft.title,
      match: score,
      truthImages: t.images,
      draftImages: (draft.publicContent.assets?.images || []).length,
      truthType: t.row.type,
      draftType: draft.type,
      choiceAnswerAgrees:
        draftLabels !== null && truthLabels !== null ? draftLabels === truthLabels : null,
      review: review.status,
      answerCheck: review.answerCheck,
      issues: (review.issues || []).map((issue) => issue.code),
    };
  });
  const needImage = perProblem.filter((item) => item.truthImages > 0);
  const choice = perProblem.filter((item) => item.choiceAnswerAgrees !== null);
  return {
    truthCount: truthRows.length,
    draftCount: drafts.length,
    matched: pairs.length,
    unmatchedTruth: truth
      .filter((_, index) => !used.has(index))
      .map((item) => item.row.problemNumber),
    figureRecall: `${needImage.filter((item) => item.draftImages > 0).length}/${needImage.length}`,
    extraFigures: perProblem.filter((item) => item.truthImages === 0 && item.draftImages > 0)
      .length,
    typeAgreement: `${perProblem.filter((item) => item.truthType === item.draftType).length}/${perProblem.length}`,
    choiceAnswerAgreement: `${choice.filter((item) => item.choiceAnswerAgrees).length}/${choice.length}`,
    perProblem,
  };
}

async function main() {
  const firstPass = process.argv.includes('--first-pass');
  const only = process.argv
    .slice(2)
    .find(
      (arg, index, args) =>
        !arg.startsWith('--') && args[index - 1] !== '--cache' && args[index - 1] !== '--out',
    );
  const outFlag = process.argv.indexOf('--out');
  const stamp =
    outFlag > 0 ? process.argv[outFlag + 1] : new Date().toISOString().replace(/[:.]/g, '-');
  const outRoot = path.join(DATA, 'import-accuracy', stamp);
  fs.mkdirSync(outRoot, { recursive: true });

  // --cache <dir>: memoize OpenAI uploads and model calls on disk so an interrupted run
  // (for example a sandbox with a short command time limit) resumes where it stopped.
  const cacheFlag = process.argv.indexOf('--cache');
  const cacheDir = cacheFlag > 0 ? path.resolve(process.argv[cacheFlag + 1]) : null;
  if (cacheDir) {
    fs.mkdirSync(cacheDir, { recursive: true });
    const crypto = require('node:crypto');
    const keyOf = (value) =>
      crypto
        .createHash('sha256')
        .update(
          JSON.stringify(value, (_key, item) =>
            item && item.type === 'Buffer' && Array.isArray(item.data)
              ? crypto.createHash('sha256').update(Buffer.from(item.data)).digest('hex')
              : item instanceof Uint8Array
                ? crypto.createHash('sha256').update(item).digest('hex')
                : item,
          ),
        )
        .digest('hex');
    const llm = await jiti.import('@/lib/ai/llm');
    const originalCallLLM = llm.callLLM;
    llm.callLLM = async (params, source, ...rest) => {
      const { model, ...request } = params;
      const file = path.join(
        cacheDir,
        `llm-${keyOf({ model: model?.modelId, request, source })}.json`,
      );
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
      const result = await originalCallLLM(params, source, ...rest);
      const stored = { text: result.text, usage: result.usage ?? {} };
      fs.writeFileSync(file, JSON.stringify(stored));
      return stored;
    };
    const uploads = await jiti.import('@/lib/server/openai-user-files');
    const originalUpload = uploads.uploadOpenAIUserFile;
    uploads.uploadOpenAIUserFile = async (args) => {
      const file = path.join(cacheDir, `upload-${keyOf(args.buffer)}.txt`);
      if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
      const fileId = await originalUpload(args);
      fs.writeFileSync(file, fileId);
      return fileId;
    };
  }

  const { withRequestContext } = await jiti.import('@/lib/server/request-context');
  const { getSystemLLMRuntimeConfig } = await jiti.import('@/lib/server/system-llm-config');
  const { getServerOpenAIResponsesModel } = await jiti.import('@/lib/ai/server-model');
  const { uploadOpenAIUserFile } = await jiti.import('@/lib/server/openai-user-files');
  const { llmExtractProblemDraftsFromOpenAIFile, finalizeImportedDrafts } = await jiti.import(
    '@/lib/server/notebook-problems/import',
  );

  const runtime = await getSystemLLMRuntimeConfig();
  if (!runtime.apiKey) throw new Error('OPENAI_API_KEY is not set in .env.local');
  const { model } = getServerOpenAIResponsesModel({
    providerId: 'openai',
    providerType: 'openai',
    modelId: runtime.modelId,
    apiKey: runtime.apiKey,
    baseUrl: runtime.baseUrl,
    requiresApiKey: true,
  });
  console.log(`model=${runtime.modelId} source=${runtime.source} out=${outRoot}`);

  const summary = [];
  for (const testCase of CASES.filter((item) => !only || item.id === only)) {
    const started = Date.now();
    const outDir = path.join(outRoot, testCase.id);
    fs.mkdirSync(path.join(outDir, 'figures'), { recursive: true });
    console.log(`\n=== ${testCase.id} (${testCase.fileName})`);
    try {
      const result = await withRequestContext(
        { skipCreditCharge: true, route: '/api/platform-tests/import-accuracy' },
        async () => {
          const buffer = fs.readFileSync(path.join(DATA, testCase.file));
          const fileId = await uploadOpenAIUserFile({
            buffer,
            fileName: testCase.fileName,
            mimeType: 'application/pdf',
          });
          const extracted = await llmExtractProblemDraftsFromOpenAIFile({
            fileId,
            fileName: testCase.fileName,
            mimeType: 'application/pdf',
            source: 'pdf',
            model,
            language: 'zh-CN',
            sourcePdfBuffer: buffer,
          });
          console.log(`  extracted ${extracted.drafts.length} drafts`);
          console.log(
            `  coverage ${JSON.stringify(extracted.coverage && { checked: extracted.coverage.checked, printed: extracted.coverage.printed.length, missing: extracted.coverage.missing.map((l) => l.label), merged: extracted.coverage.merged })}`,
          );
          fs.writeFileSync(
            path.join(outDir, 'first-pass.json'),
            JSON.stringify(extracted, null, 2),
          );
          const finalized = await finalizeImportedDrafts({
            drafts: extracted.drafts,
            source: { buffer, mimeType: 'application/pdf' },
            model,
            language: 'zh-CN',
            verifyAnswers: !firstPass,
          });
          return { extracted, finalized };
        },
      );

      // Write figures as files and keep drafts.json readable.
      const drafts = result.finalized.drafts.map((draft, index) => {
        const images = (draft.publicContent.assets?.images || []).map((image, imageIndex) => {
          const match = image.src.match(/^data:([^;]+);base64,(.+)$/);
          const file = `p${String(index + 1).padStart(2, '0')}-${imageIndex + 1}.webp`;
          if (match)
            fs.writeFileSync(path.join(outDir, 'figures', file), Buffer.from(match[2], 'base64'));
          return { ...image, src: `figures/${file}` };
        });
        return images.length
          ? { ...draft, publicContent: { ...draft.publicContent, assets: { images } } }
          : draft;
      });
      fs.writeFileSync(path.join(outDir, 'drafts.json'), JSON.stringify(drafts, null, 2));
      fs.writeFileSync(
        path.join(outDir, 'report.json'),
        JSON.stringify(
          { report: result.finalized.report, skipped: result.finalized.skipped },
          null,
          2,
        ),
      );
      let comparison = null;
      if (testCase.truth) {
        const truthRows = rows(testCase.truth).filter(
          (row) => (row.sourceMeta || {}).courseSourceId === testCase.sourceId,
        );
        comparison = compare(result.finalized.drafts, truthRows);
        fs.writeFileSync(path.join(outDir, 'compare.json'), JSON.stringify(comparison, null, 2));
      }
      const line = {
        case: testCase.id,
        seconds: Math.round((Date.now() - started) / 1000),
        report: result.finalized.report,
        skipped: result.finalized.skipped.length,
        expectSolutionOnly: Boolean(testCase.expectSolutionOnly),
        firstPass,
        comparison: comparison && { ...comparison, perProblem: undefined },
      };
      summary.push(line);
      console.log(JSON.stringify(line, null, 2));
    } catch (error) {
      const message = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
      console.error(`  FAILED: ${message}`);
      summary.push({ case: testCase.id, error: message.slice(0, 2000) });
    }
  }
  fs.writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nDone. Summary: ${path.join(outRoot, 'summary.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
