import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { z } from 'zod';
import { createHandler } from './handler.mjs';
import { PrismaClient, Prisma } from '@prisma/client';

const PROJECT = '8cddd1ea-24e1-49a9-8d27-dce86069dc8b';
const ENVIRONMENT = '6697de1f-eb0d-4a6f-8709-cfe477a29f11';
const SERVICE = 'ce8c8ac4-adfe-4fa3-a6c4-34dafa2bd883';
if (
  process.env.RAILWAY_PROJECT_ID !== PROJECT ||
  process.env.RAILWAY_ENVIRONMENT_ID !== ENVIRONMENT ||
  process.env.RAILWAY_SERVICE_ID !== SERVICE
)
  throw Error('Refusing non-staging Railway environment');
if (
  !process.env.DATABASE_URL ||
  !process.env.SYNTARA_STAGING_ADMIN_TOKEN ||
  !process.env.SYNTARA_STAGING_TUNNEL_PORT
)
  throw Error('Start this server using staging-admin/start.mjs');
const url = new URL(process.env.DATABASE_URL);
url.hostname = '127.0.0.1';
url.port = process.env.SYNTARA_STAGING_TUNNEL_PORT;
process.env.DATABASE_URL = url.toString();
const db = new PrismaClient();
const jiti = createJiti(fileURLToPath(import.meta.url), {
  interopDefault: true,
  alias: { '@': process.cwd() },
});
const problems = jiti('../../lib/server/notebook-problems/service.ts');
const notebooks = jiti('../../lib/server/repositories/notebook-repository.ts');
const { notebookProblemImportDraftSchema } = jiti('../../lib/problem-bank/schema.ts');
const { syncUnlinkedCourseKnowledgeProjection } = jiti(
  '../../lib/server/unlinked-course-knowledge-projection.ts',
);
const token = Buffer.from(process.env.SYNTARA_STAGING_ADMIN_TOKEN);
const run = createHandler({
  db,
  Prisma,
  problems,
  notebooks,
  notebookProblemImportDraftSchema,
  syncUnlinkedCourseKnowledgeProjection,
  token,
});
const server = http.createServer((req, res) => {
  run(req, res).catch((e) => {
    const json = (response, status, data) => {
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(data));
    };
    if (e instanceof z.ZodError)
      return json(res, 400, { error: 'Invalid input', details: e.flatten() });
    const status = e.status || 500;
    if (status === 500)
      console.error('Staging admin operation failed:', e.code || e.name || 'Error');
    return json(res, status, {
      error: status === 500 ? 'Operation failed; consult local logs' : e.message,
    });
  });
});
server.listen(8766, '127.0.0.1', () =>
  console.log('Staging course API listening on http://127.0.0.1:8766'),
);
process.on('SIGTERM', () => server.close(() => db.$disconnect().finally(() => process.exit())));
