/** Every account starts with a random marble from the catalog, never the OAuth photo. */
export function pickMarbleAvatar(
  avatarUrls: readonly string[],
  random = Math.random,
): string | null {
  if (avatarUrls.length === 0) return null;
  return avatarUrls[Math.min(avatarUrls.length - 1, Math.floor(random() * avatarUrls.length))];
}

/** Catalog URLs may come back absolute (native API base) or with a query string. */
export function isMarbleAvatarImage(
  image: string | null | undefined,
  avatarUrls: readonly string[],
): boolean {
  if (!image) return false;
  try {
    return avatarUrls.includes(new URL(image, 'https://syntara.invalid').pathname);
  } catch {
    return false;
  }
}

/** Called only by the auth adapter's createUser; existing profiles are left intact. */
export function nativeInitialUserData<T extends { image?: string | null }>(
  user: T,
  avatarUrls: readonly string[],
  random = Math.random,
): T {
  const image = pickMarbleAvatar(avatarUrls, random);
  return image ? { ...user, image } : user;
}
