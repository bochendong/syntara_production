import assert from 'node:assert/strict';
import {
  accessibleChatCourses,
  selectChatCourse,
} from '../../apps/native/src/lib/native-launch.ts';

const courses = [
  { id: 'a', updatedAt: 10 },
  { id: 'b', updatedAt: 20 },
];
for (const browserPreview of [true, false]) {
  const emptyAccount = accessibleChatCourses(courses, [], browserPreview);
  assert.deepEqual(emptyAccount, [], 'Empty account must hide all cached courses at every width');
  assert.equal(
    selectChatCourse(emptyAccount, { courseId: 'a', conversationId: 'stale-chat' }),
    null,
  );
  assert.deepEqual(accessibleChatCourses(courses, ['b'], browserPreview), [courses[1]]);
  assert.deepEqual(accessibleChatCourses(courses, ['removed'], browserPreview), []);
}
assert.deepEqual(accessibleChatCourses(courses, null, false), []);
assert.deepEqual(accessibleChatCourses(courses, null, true), courses);
assert.equal(selectChatCourse(courses, { courseId: 'a', conversationId: 'saved-chat' })?.id, 'a');
assert.equal(
  selectChatCourse(courses, { courseId: 'removed', conversationId: 'old-chat' })?.id,
  'b',
);
assert.equal(selectChatCourse(courses, null)?.id, 'b');
assert.equal(selectChatCourse([], { courseId: 'a', conversationId: null }), null);
assert.deepEqual(
  courses.map((course) => course.id),
  ['a', 'b'],
);
console.log(
  'Native chat launch: membership-scoped cache, empty account at every width, last accessible course, latest fallback and immutable selection passed.',
);
