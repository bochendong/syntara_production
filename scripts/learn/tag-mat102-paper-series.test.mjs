import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COURSE_ID,
  applyPaperTags,
  digest,
  paperSource,
  planPaperTags,
} from './tag-mat102-paper-series.mjs';

function fixtures() {
  const rows = [];
  const add = (exam, paper, slot, revised = false) => {
    rows.push({
      id: `${exam}-${paper}-${slot}-${revised}`,
      courseId: COURSE_ID,
      title: 'Preserved title',
      status: 'published',
      publicContentJson: { stem: 'Preserved statement' },
      gradingJson: { referenceProof: 'Private preserved answer' },
      updatedAt: new Date('2026-10-28T12:00:00Z'),
      tags: ['existing-topic', 'existing-source'],
      sourceMeta: {
        sourceFile: `/private/MAT102_${exam}_模拟卷_${paper}_题目版${revised ? '_真题优先修订版' : ''}.pdf`,
        exam: `MAT102 ${exam}`,
        mockPaper: paper,
        sourceItem: slot,
      },
    });
  };
  for (const exam of ['TT1', 'TT2'])
    for (const paper of exam === 'TT1' ? 'ABCDEFGH' : 'ABCDEFGHIJ') {
      for (let n = 1; n <= 10; n++) add(exam, paper, `MC${n}`);
      for (let n = 1; n <= 4; n++) add(exam, paper, `LA${n}`);
      if (exam === 'TT2') for (const slot of ['MC1', 'LA1']) add(exam, paper, slot, true);
    }
  rows.push({
    id: 'final-question',
    courseId: COURSE_ID,
    title: 'TT2 title alone is not evidence',
    updatedAt: new Date('2026-10-28T12:00:00Z'),
    tags: ['群'],
    sourceMeta: { sourceFile: 'Final_review.pdf' },
  });
  return rows;
}

function fakeDatabase(initial) {
  const state = { rows: structuredClone(initial), version: 1 };
  return {
    state,
    async $transaction(run) {
      const draft = structuredClone(state);
      const tx = {
        course: {
          findUnique: async () => ({ id: COURSE_ID, ownerId: 'system:speedup-store-staging' }),
          update: async () => draft.version++,
        },
        notebookProblem: {
          findMany: async () => draft.rows,
          updateMany: async ({ where, data }) => {
            const row = draft.rows.find(
              (r) =>
                r.id === where.id &&
                r.courseId === where.courseId &&
                r.updatedAt.getTime() === where.updatedAt.getTime() &&
                digest(r.tags) === digest(where.tags.equals),
            );
            if (!row) return { count: 0 };
            row.tags = data.tags;
            row.updatedAt = new Date('2026-10-28T13:00:00Z');
            return { count: 1 };
          },
        },
      };
      const result = await run(tx);
      Object.assign(state, draft);
      return result;
    },
  };
}

test('each paper selects fourteen slots and current TT2 replaces only revised slots', () => {
  const rows = fixtures();
  const plan = planPaperTags(rows);
  assert.equal(plan.items.length, 272);
  assert.equal(plan.unchangedNonMockQuestions, 1);
  assert.equal(Object.keys(plan.counts).length, 28);
  assert.ok(Object.values(plan.counts).every((n) => n === 14));
  const label = (id) => plan.items.find((x) => x.id === id).labels;
  assert.deepEqual(label('TT1-A-MC1-false'), ['TT1模拟A卷']);
  assert.deepEqual(label('TT2-A-MC1-false'), ['TT2原版模拟A卷']);
  assert.deepEqual(label('TT2-A-MC1-true'), ['TT2模拟A卷']);
  assert.deepEqual(label('TT2-A-MC2-false'), ['TT2模拟A卷', 'TT2原版模拟A卷']);
  assert.ok(plan.items.every((x) => x.beforeTags.every((tag) => x.afterTags.includes(tag))));
});

test('incomplete papers and conflicting/duplicate source slots are rejected', () => {
  assert.throws(() => planPaperTags(fixtures().slice(1)), /complete/);
  const rows = fixtures();
  rows[0].sourceMeta.mockPaper = 'B';
  assert.throws(() => planPaperTags(rows), /Conflicting/);
  const duplicates = fixtures();
  duplicates.push({ ...duplicates.find((r) => r.id === 'TT2-A-MC1-true'), id: 'duplicate' });
  assert.throws(() => planPaperTags(duplicates), /Duplicate/);
  assert.equal(paperSource(fixtures().at(-1)), null);
  assert.throws(() => planPaperTags([{ ...fixtures()[0], courseId: 'other' }]), /Wrong course/);
});

test('atomic tags-only application preserves other fields, nonmocks and supports replay', async () => {
  const rows = fixtures();
  const db = fakeDatabase(rows);
  const plan = planPaperTags(rows);
  const result = await applyPaperTags(db, plan, () => {});
  assert.equal(result.updated, 272);
  assert.equal(db.state.version, 2);
  for (const before of rows) {
    const after = db.state.rows.find((r) => r.id === before.id);
    const { tags: _beforeTags, updatedAt: _beforeTime, ...beforeContent } = before;
    const { tags: _afterTags, updatedAt: _afterTime, ...afterContent } = after;
    assert.deepEqual(afterContent, beforeContent);
  }
  assert.deepEqual(db.state.rows.at(-1), rows.at(-1));
  assert.equal((await applyPaperTags(db, plan, () => {})).updated, 0);
  assert.equal(db.state.version, 2);
  // The current student search includes tags, and the labels deliberately do not overlap.
  const hits = db.state.rows.filter((r) => r.tags.join(' ').includes('TT2模拟A卷'));
  assert.equal(hits.length, 14);
});

test('authorization, stale versions, tampered tags and content edits fail without partial writes', async () => {
  const rows = fixtures();
  const plan = planPaperTags(rows);
  const denied = fakeDatabase(rows);
  await assert.rejects(
    applyPaperTags(denied, plan, () => {
      throw new Error('denied');
    }),
    /denied/,
  );
  assert.equal(denied.state.version, 1);
  for (const edit of [
    (r) => {
      r.updatedAt = new Date('2026-10-28T12:30:00Z');
    },
    (r) => {
      r.tags.push('concurrent-topic');
    },
    (r) => {
      r.publicContentJson.stem = 'concurrent edit';
    },
  ]) {
    const db = fakeDatabase(rows);
    edit(db.state.rows[20]);
    const before = structuredClone(db.state);
    await assert.rejects(applyPaperTags(db, plan, () => {}));
    assert.deepEqual(db.state, before);
  }
  const forged = structuredClone(plan);
  forged.items[0].afterTags = ['answer-leak'];
  const { payloadHash: _, ...data } = forged;
  forged.payloadHash = digest(data);
  await assert.rejects(
    applyPaperTags(fakeDatabase(rows), forged, () => {}),
    /tag plan/,
  );
});
