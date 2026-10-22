/** Called only by the auth adapter's createUser; existing profiles are left intact. */
export function nativeInitialUserData<T extends { image?: string | null }>(
  env: Record<string, string | undefined>,
  user: T,
  avatarUrls: readonly string[],
  random = Math.random,
): T {
  if (
    env.SYNTARA_APP_ENV !== 'staging' ||
    env.SYNTARA_NATIVE_ACCESS_POLICY !== 'google-test' ||
    avatarUrls.length === 0
  )
    return user;
  return { ...user, image: avatarUrls[Math.floor(random() * avatarUrls.length)] };
}
