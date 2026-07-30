export type NativePlatformApiAuthMode = 'authenticated' | 'shared-test' | 'bearer';

export const SHARED_NATIVE_PLATFORM_PRINCIPAL = Object.freeze({
  userId: 'native-shared-test',
  keyId: 'native-shared-test',
});

export function resolveNativePlatformApiAuthMode(
  configured: string | undefined,
): NativePlatformApiAuthMode {
  const normalized = configured?.trim().toLowerCase();
  if (!normalized || normalized === 'authenticated') return 'authenticated';
  if (normalized === 'shared-test') return 'shared-test';
  return 'bearer';
}

export function nativePlatformApiAuthMode(): NativePlatformApiAuthMode {
  return resolveNativePlatformApiAuthMode(process.env.SYNTARA_NATIVE_API_AUTH_MODE);
}
