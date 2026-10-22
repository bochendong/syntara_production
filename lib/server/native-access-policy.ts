export type NativeAccessPolicy = 'activation' | 'google-test' | 'speedup' | 'invalid';

type PolicyEnvironment = Record<string, string | undefined>;

export function resolveNativeAccessPolicy(env: PolicyEnvironment): NativeAccessPolicy {
  const policy = env.SYNTARA_NATIVE_ACCESS_POLICY?.trim() || 'activation';
  if (policy === 'google-test') {
    return env.SYNTARA_APP_ENV === 'staging' ? policy : 'invalid';
  }
  return policy === 'activation' || policy === 'speedup' ? policy : 'invalid';
}

export type NativeAccessUser = {
  id: string;
  role: string;
  isActive: boolean;
  nativeAppActivatedAt: Date | null;
  accounts: Array<{ provider: string; expires_at: number | null }>;
};

export type NativeAccessDecision =
  | 'allowed'
  | 'inactive'
  | 'google_required'
  | 'speedup_required'
  | 'activation_required'
  | 'misconfigured';

export function nativeAccessDecision(
  policy: NativeAccessPolicy,
  user: NativeAccessUser,
  now = Date.now(),
): NativeAccessDecision {
  if (policy === 'invalid') return 'misconfigured';
  if (!user.isActive) return 'inactive';
  if (policy === 'google-test') {
    return user.accounts.some((account) => account.provider === 'google')
      ? 'allowed'
      : 'google_required';
  }
  if (policy === 'speedup') {
    const account = user.accounts.find((entry) => entry.provider === 'speedup');
    return account &&
      account.expires_at !== null &&
      account.expires_at * 1_000 > now &&
      (user.role === 'TEACHER' || user.role === 'STUDENT')
      ? 'allowed'
      : 'speedup_required';
  }
  return user.role === 'ADMIN' || user.nativeAppActivatedAt ? 'allowed' : 'activation_required';
}

/** Google identity is accepted only after the provider verified the email. */
export function canSignInToGoogleTest(input: {
  provider?: string;
  verifiedEmail: unknown;
  email?: string | null;
  isActive?: boolean;
  databaseConfigured: boolean;
}): boolean {
  return (
    input.databaseConfigured &&
    input.provider === 'google' &&
    input.verifiedEmail === true &&
    Boolean(input.email?.trim()) &&
    input.isActive !== false
  );
}
