type NativePlatformTokenProvider = () => Promise<string | undefined>;

let tokenProvider: NativePlatformTokenProvider = async () => undefined;

export function registerNativePlatformTokenProvider(provider: NativePlatformTokenProvider) {
  tokenProvider = provider;
}

export async function resolveNativePlatformToken(): Promise<string | undefined> {
  return tokenProvider();
}
