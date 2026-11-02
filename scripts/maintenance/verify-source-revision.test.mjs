import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
const { readBuildRevision } = await createJiti(import.meta.url).import(
  '../../lib/version/source-revision.ts',
);
test('source exports retain their own revision without Git or inherited deployment metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'syntara-revision-'));
  try {
    assert.equal(readBuildRevision(root, 'previous-github-revision'), 'previous-github-revision');
    assert.equal(readBuildRevision(root, ''), null);
    const revision = 'c05554521d5c4cb064b087a75c03456ddf1d6815';
    writeFileSync(join(root, 'source-revision.json'), JSON.stringify({ revision }));
    assert.equal(readBuildRevision(root, 'previous-github-revision'), revision);
    writeFileSync(join(root, 'source-revision.json'), '{}');
    assert.throws(() => readBuildRevision(root, 'previous-github-revision'), /Invalid/);
    writeFileSync(join(root, 'source-revision.json'), '{');
    assert.throws(() => readBuildRevision(root, 'previous-github-revision'), SyntaxError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
