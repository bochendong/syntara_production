/** Offline runtime checks: real general-chat routes and AI prompt, in-memory adapters only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
const root = new URL('../../', import.meta.url);
const require = createRequire(import.meta.url);
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const next = url(
  `export class NextResponse extends Response { static json(data,init={}) {return new NextResponse(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json'}});} }`,
);
const auth = url(
  `import {NextResponse} from '${next}'; export const publicApiRequestId=()=> 'fixture'; export const requireNativePlatformApi=async request=>request.headers.has('fixture-user')?{userId:request.headers.get('fixture-user')}:NextResponse.json({error:'Unauthorized'},{status:401});`,
);
const database = url(`
export const conversations=new Map(), messages=new Map(); let counter=0;
const matches=(row,where)=>Object.entries(where).every(([k,v])=>row[k]===v);
export const prisma={
conversation:{
 async findMany({where}){return [...conversations.values()].filter(row=>matches(row,where)).sort((a,b)=>b.updatedAt-a.updatedAt);},
 async findFirst({where}){return [...conversations.values()].find(row=>matches(row,where))||null;},
 async create({data}){const now=new Date();const row={...data,id:'chat-'+(++counter),createdAt:now,updatedAt:now};conversations.set(row.id,row);return row;},
 async update({where,data}){const row=[...conversations.values()].find(row=>matches(row,where));if(!row)throw new Error('Not found');Object.assign(row,data);return row;},
 async deleteMany({where}){for(const [id,row] of conversations)if(matches(row,where)){conversations.delete(id);for(const [mid,m]of messages)if(m.conversationId===id)messages.delete(mid);}return {count:1};}
},message:{
 async upsert({where,create,update}){const row=messages.get(where.id);if(row&&!matches(row,where))throw new Error('Conflicting id');if(row)Object.assign(row,update);else messages.set(create.id,{...create,createdAt:new Date()});},
 async findMany({where}){return [...messages.values()].filter(row=>matches(row,where)).sort((a,b)=>b.createdAt-a.createdAt);}
},async $transaction(fn){return fn(prisma);}};
`);
const safe = url(
  `import {NextResponse} from '${next}';export const safeRoute=async fn=>{try{return await fn();}catch{return NextResponse.json({error:'Failed'},{status:500});}};`,
);
async function load(file, replacements) {
  let source = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: fileURLToPath(new URL(file, root)),
  }).outputText;
  for (const [from, to] of Object.entries(replacements))
    source = source.replaceAll(`'${from}'`, `'${to}'`);
  return import(url(source));
}
const { GET, POST, DELETE } = await load('app/api/native/v2/general-conversations/route.ts', {
  'next/server': next,
  zod: pathToFileURL(require.resolve('zod')).href,
  '@/lib/server/prisma': database,
  '@/lib/server/json-error-response': safe,
  '@/lib/server/public-api': auth,
});
const db = await import(database);
function request(method, user, body, id) {
  const req = new Request(
    'http://fixture.invalid/api/native/v2/general-conversations' + (id ? `?id=${id}` : ''),
    {
      method,
      headers: { ...(user ? { 'fixture-user': user } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  req.nextUrl = new URL(req.url);
  return req;
}
assert.equal((await GET(request('GET'))).status, 401);
const created = await POST(request('POST', 'alice', { title: '不属于课程的对话' }));
assert.equal(created.status, 201);
const { conversation } = await created.json();
assert.equal(db.conversations.get(conversation.id).courseId, null);
assert.equal(db.conversations.get(conversation.id).notebookId, null);
const message = { id: crypto.randomUUID(), role: 'user', text: '还没有课程，也可以聊天吗？' };
for (let i = 0; i < 2; i++)
  assert.equal(
    (await POST(request('POST', 'alice', { conversationId: conversation.id, message }))).status,
    200,
  );
assert.equal(db.messages.size, 1, 'message retries must not duplicate history');
assert.equal((await GET(request('GET', 'bob', null, conversation.id))).status, 404);
assert.equal(
  (await POST(request('POST', 'bob', { conversationId: conversation.id, message }))).status,
  404,
);
await DELETE(request('DELETE', 'bob', null, conversation.id));
assert.ok(db.conversations.has(conversation.id), 'another account cannot delete history');
const forbidden = await POST(
  request('POST', 'alice', { courseId: 'course-1', title: 'wrong scope' }),
);
assert.equal(forbidden.status, 400);
db.conversations.set('course-chat', {
  ...db.conversations.get(conversation.id),
  id: 'course-chat',
  courseId: 'course-1',
});
assert.deepEqual(
  (await (await GET(request('GET', 'alice'))).json()).conversations.map((row) => row.id),
  [conversation.id],
);
const history = await (await GET(request('GET', 'alice', null, conversation.id))).json();
assert.equal(history.messages[0].text, message.text);
assert.equal(
  (await POST(request('POST', 'alice', { conversationId: 'course-chat', message }))).status,
  404,
);
const other = await (await POST(request('POST', 'alice', { title: '另一条普通聊天' }))).json();
assert.equal(
  (await POST(request('POST', 'alice', { conversationId: other.conversation.id, message }))).status,
  500,
  'an id from another chat must not be reassigned',
);
assert.equal(db.messages.get(message.id).conversationId, conversation.id);
const { nativeChatRequestSchema } = await load('features/native-ai/server/schema.ts', {
  zod: pathToFileURL(require.resolve('zod')).href,
});
const { buildNativeChatSystemPrompt } = await load('features/native-ai/server/prompt.ts', {});
const general = nativeChatRequestSchema.parse({
  scope: 'general',
  requestId: 'fixture',
  surface: 'desktop',
  course: { id: 'ignored-course', name: '不要采用的课程' },
  messages: [{ role: 'user', text: '帮我讲一堂课' }],
  context: {
    notes: [
      {
        id: 'private',
        notebook: 'private-notebook',
        title: 'private',
        content: 'PRIVATE_COURSE_CONTENT',
      },
    ],
  },
});
const prompt = buildNativeChatSystemPrompt(general);
assert.match(prompt, /普通聊天/);
assert.doesNotMatch(prompt, /PRIVATE_COURSE_CONTENT|不要采用的课程/);
const course = nativeChatRequestSchema.parse({ ...general, scope: undefined });
assert.equal(course.scope, 'course');
const ai = url(`export const stepCountIs=()=>4;`);
const llm = url(
  `export const calls=[];export async function streamLLM(options){calls.push(options);return {fullStream:(async function*(){yield {type:'text-delta',text:'可以直接聊天。'};})(),totalUsage:Promise.resolve({})};}`,
);
const tools = url(
  `export const calls=[];export function createNativeChatTools(input){calls.push(input);return {};}export const latestQuestion=input=>input.messages.at(-1).text;`,
);
const { runNativeChat } = await load('features/native-ai/server/run-chat.ts', {
  ai,
  '@/lib/ai/llm': llm,
  '@/lib/server/resolve-model': url(
    `export const resolveModelFromHeaders=async()=>({model:{},providerId:'fixture',modelString:'fixture'});`,
  ),
  './attachments': url(
    `export const readNativeChatFiles=async()=>[];export const fileTextBlock=()=>'';`,
  ),
  './prompt': url(`export const buildNativeChatSystemPrompt=()=> 'fixture';`),
  './tools': tools,
});
const stream = await runNativeChat(new Request('http://fixture.invalid'), general);
const output = await new Response(stream).text();
assert.match(output, /可以直接聊天/);
assert.equal(
  (await import(llm)).calls[0].tools,
  undefined,
  'ordinary chat must not get course tools',
);
assert.equal((await import(tools)).calls.length, 0);
const done = JSON.parse(
  output
    .split('\n\n')
    .find((block) => block.startsWith('event: done'))
    .split('data: ')[1],
);
assert.deepEqual(done.assistantMessage.metadata.evidence, []);
assert.deepEqual(done.assistantMessage.metadata.learningActions, []);
assert.equal(done.assistantMessage.metadata.lectureSuggested, undefined);
console.log(
  'PASS: zero-course chat, account isolation, no course archive, idempotent history, context isolation and course-tool suppression.',
);
