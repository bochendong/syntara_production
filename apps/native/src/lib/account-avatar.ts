/** Resolve account catalog images to assets bundled by Vite, including absolute API URLs. */
export function resolveAccountAvatar(
  image: string | null | undefined,
  catalog: readonly { id: string; url: string }[],
  assetForId: (id: string) => string | null,
): string | null {
  if (!image) return null;
  try {
    const pathname = new URL(image, 'https://syntara.invalid').pathname;
    const avatar = catalog.find((entry) => entry.url === pathname);
    return avatar ? assetForId(avatar.id) || image : image;
  } catch {
    return image;
  }
}
