import { listSpeedupCoursesForUser } from '@/lib/server/speedup-sso';
import {
  nativeAccessDecision,
  resolveNativeAccessPolicy,
  type NativeAccessDecision,
  type NativeAccessUser,
} from '@/lib/server/native-access-policy';

export const NATIVE_ACCESS_SELECT = {
  id: true,
  role: true,
  isActive: true,
  nativeAppActivatedAt: true,
  accounts: { select: { provider: true, expires_at: true } },
} as const;

const speedupChecks = new Map<string, { expires: number; allowed: Promise<boolean> }>();

/** Used when issuing, refreshing and accepting device tokens. */
export async function nativeUserAccess(user: NativeAccessUser): Promise<NativeAccessDecision> {
  const policy = resolveNativeAccessPolicy(process.env);
  const decision = nativeAccessDecision(policy, user);
  if (decision !== 'allowed' || policy !== 'speedup') return decision;

  const now = Date.now();
  for (const [id, check] of speedupChecks) if (check.expires <= now) speedupChecks.delete(id);
  let check = speedupChecks.get(user.id);
  if (!check) {
    if (speedupChecks.size >= 1_000) speedupChecks.delete(speedupChecks.keys().next().value!);
    const role = user.role === 'TEACHER' ? 'TEACHER' : 'STUDENT';
    check = {
      expires: now + 20_000,
      allowed: listSpeedupCoursesForUser(user.id, role)
        .then((courses) => courses.length > 0)
        .catch(() => false),
    };
    speedupChecks.set(user.id, check);
  }
  return (await check.allowed) ? 'allowed' : 'speedup_required';
}
