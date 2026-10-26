/** Existing administrator policy, shared by web and authenticated native commands. */
export type AdminPolicyIdentity = { userId: string; email?: string | null };

export function isAllowlistedAdminIdentity(
  identity: AdminPolicyIdentity,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const emails = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const ids = (env.ADMIN_USER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const email = identity.email?.trim().toLowerCase();
  return Boolean((email && emails.includes(email)) || ids.includes(identity.userId));
}

export function isAuthorizedAdminIdentity(
  identity: AdminPolicyIdentity,
  dbRole: string | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  return dbRole === 'ADMIN' || isAllowlistedAdminIdentity(identity, env);
}
