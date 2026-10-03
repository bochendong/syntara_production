import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const root = process.cwd();
const req = createRequire(root + '/package.json');
const ts = req('typescript');
const ai = req('ai');
const { createOpenAI } = req('@ai-sdk/openai');
function load(path, mocks, extra = '') {
  const source = fs.readFileSync(root + '/' + path, 'utf8') + extra;
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  vm.runInNewContext(code, {
    module: compiledModule,
    exports: compiledModule.exports,
    require: (id) => (id in mocks ? mocks[id] : req(id)),
    Buffer,
    URL,
    Headers,
    Request,
    Response,
    console,
    setTimeout,
    process,
  });
  return compiledModule.exports;
}
(async () => {
  let currentUser = 'owner';
  const helper = load('lib/server/notebook-original-file.ts', {
    ai,
    '@/lib/server/auth': {
      requireServerSession: async () => (currentUser ? { user: { id: currentUser } } : null),
    },
    '@/lib/server/openai-upload-capability': {
      verifyOpenAIFileCapability: ({ token, userId }) =>
        token === 'valid' && userId === 'owner'
          ? { fileId: 'file-scan', fileName: 'scan.pdf', mimeType: 'application/pdf' }
          : null,
    },
  });
  let captured;
  const model = createOpenAI({
    apiKey: 'test-only',
    fetch: async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ error: { message: 'intentional transport capture' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    },
  }).responses('gpt-4o-mini');
  for (const [mime, expected] of [
    ['application/pdf', 'input_file'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'input_file'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'input_file'],
    ['text/markdown', 'input_file'],
    ['text/plain', 'input_file'],
    ['image/png', 'input_image'],
  ]) {
    captured = null;
    await ai
      .generateText({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Read this original.' },
              helper.notebookOriginalFilePart({
                fileId: 'file-original',
                fileName: 'source',
                mimeType: mime,
              }),
            ],
          },
        ],
        maxRetries: 0,
      })
      .catch(() => {});
    assert.equal(captured.input[0].content[1].type, expected);
    assert.equal(captured.input[0].content[1].file_id, 'file-original');
  }
  const headers = (token) => ({
    headers: new Headers(token ? { 'x-notebook-source-token': token } : {}),
  });
  assert.equal(await helper.withNotebookOriginalFile(model, headers()), model);
  await assert.rejects(helper.withNotebookOriginalFile(model, headers('bad')));
  currentUser = 'other';
  await assert.rejects(helper.withNotebookOriginalFile(model, headers('valid')));
  currentUser = null;
  await assert.rejects(helper.withNotebookOriginalFile(model, headers('valid')));
  currentUser = 'owner';
  const wrapped = await helper.withNotebookOriginalFile(model, headers('valid'));
  await ai
    .generateText({ model: wrapped, prompt: 'Generate from scanned pages.', maxRetries: 0 })
    .catch(() => {});
  assert.equal(captured.input[0].content[1].file_id, 'file-scan');
  await wrapped
    .doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Plan from original pages.' }] }],
    })
    .catch(() => {});
  assert.equal(captured.input[0].content[1].file_id, 'file-scan');
  console.log(
    'PASS: PDF/DOCX/PPTX/Markdown/TXT/image transport, middleware attachment, authentication and ownership rejection.',
  );

  let parsed = 0,
    uploaded = 0,
    generated;
  const updates = [];
  const source = {
    id: 'source',
    title: 'scan.pdf',
    fileMime: 'application/pdf',
    fileData: Buffer.from('%PDF scan with no text layer'),
    extractedText: '',
    sourceCategory: 'school_teacher_notes',
    openaiFileId: null,
    metadataJson: {},
  };
  const prisma = {
    course: { findFirst: async () => ({ id: 'course', name: 'MAT135', courseCode: 'MAT135' }) },
    courseSource: {
      findFirst: async () => source,
      update: async (data) => {
        updates.push(data);
        return data;
      },
    },
    agentTask: { update: async (data) => data },
  };
  const route = load(
    'app/api/teacher/courses/[courseId]/sources/[sourceId]/process/route.ts',
    {
      '@/lib/server/ai-failure-log': { withAiFailureAudit: (fn) => fn },
      'next/server': { after: () => {}, NextResponse: { json: (value) => value } },
      '@/lib/pdf/pdf-providers': {
        parsePDF: async () => {
          parsed++;
          throw new Error('must not parse');
        },
      },
      '@/lib/server/prisma': { prisma },
      '@/lib/server/request-context': {},
      '@/lib/server/json-error-response': {},
      '@/lib/server/prisma-json': { toPrismaJson: (value) => value },
      '@/lib/server/teacher-auth': {},
      '@/lib/server/teacher-course-notebook-generation': {
        generateTeacherCourseNotebook: async (args) => {
          generated = args;
        },
      },
      '@/lib/server/external-course-access': {},
      '@/lib/uploads/course-source-policy': {
        courseSourceFileKind: () => 'pdf',
        normalizedCourseSourceMimeType: () => 'application/pdf',
      },
      '@/lib/server/extract-course-source-image-text': {},
      '@/lib/server/system-llm-config': {},
      '@/lib/ai/server-model': {},
      '@/lib/server/office-source-pdf': {},
      '@/features/problems/server/import': {},
      '@/features/problems/server/service': {},
      '@/lib/server/openai-user-files': {
        uploadOpenAIUserFile: async (args) => {
          assert.equal(args.buffer.toString(), source.fileData.toString());
          uploaded++;
          return 'file-original-scan';
        },
      },
    },
    '\nexport { runSourceProcessing };',
  );
  const args = {
    ownerId: 'owner',
    courseId: 'course',
    sourceId: 'source',
    notebookId: 'notebook',
    taskId: 'task',
  };
  await route.runSourceProcessing(args);
  assert.equal(parsed, 0);
  assert.equal(uploaded, 1);
  assert.equal(generated.sourceFileId, 'file-original-scan');
  assert.equal(generated.sourceText, undefined);
  assert.equal(updates.at(-1).data.ingestStatus, 'ready');
  source.openaiFileId = 'file-original-scan';
  source.fileData = null;
  await route.runSourceProcessing(args);
  assert.equal(uploaded, 1);
  assert.equal(generated.sourceFileId, 'file-original-scan');
  console.log(
    'PASS: textless PDF generation bypasses unpdf, persists uploaded ID, and reuses an existing original file ID.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
