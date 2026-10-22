/** A private starter course lets a new Google tester open the current chat-first App. */
export function nativeStagingCourseForUser(
  env: Record<string, string | undefined>,
  userId: string,
) {
  if (
    env.SYNTARA_APP_ENV !== 'staging' ||
    env.SYNTARA_NATIVE_ACCESS_POLICY !== 'google-test' ||
    !userId
  )
    return null;
  return {
    id: `native-staging-${userId}`,
    ownerId: userId,
    name: 'Syntara 测试课程',
    courseCode: 'TEST101',
    description: '测试环境的独立课程，可在这里测试对话、资料和学习功能。',
    language: 'zh-CN',
    tags: ['staging'],
    purpose: 'daily' as const,
    listedInCourseStore: false,
  };
}
