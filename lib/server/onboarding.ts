import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';

import {
  ONBOARDING_STEPS,
  type OnboardingState,
  type OnboardingStep,
} from '@/lib/onboarding/spotlight';

export { ONBOARDING_STEPS, type OnboardingState, type OnboardingStep };

type OnboardingStatus = OnboardingState['status'];

type StoredOnboarding = {
  status: OnboardingStatus;
  marks: Partial<Record<OnboardingStep, string>>;
  startedAt?: string;
  finishedAt?: string;
};

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value);
}

function readStored(value: Prisma.JsonValue | null): StoredOnboarding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== 'active' && status !== 'done' && status !== 'skipped') return null;
  const marks: StoredOnboarding['marks'] = {};
  if (record.marks && typeof record.marks === 'object' && !Array.isArray(record.marks)) {
    for (const [step, at] of Object.entries(record.marks as Record<string, unknown>)) {
      if (isOnboardingStep(step) && typeof at === 'string') marks[step] = at;
    }
  }
  return {
    status,
    marks,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
    finishedAt: typeof record.finishedAt === 'string' ? record.finishedAt : undefined,
  };
}

/** 能从账号数据看出来的步骤：自己建过课、往自己的课里放过资料、聊过天。 */
async function derivedSteps(prisma: PrismaClient, userId: string): Promise<Set<OnboardingStep>> {
  const [course, notebook, source, chat] = await Promise.all([
    prisma.course.findFirst({ where: { ownerId: userId }, select: { id: true } }),
    prisma.notebook.findFirst({
      where: { ownerId: userId, courseId: { not: null } },
      select: { id: true },
    }),
    prisma.courseSource.findFirst({ where: { ownerId: userId }, select: { id: true } }),
    prisma.courseConversation.findFirst({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true },
    }),
  ]);
  const steps = new Set<OnboardingStep>();
  if (course) steps.add('course');
  if (notebook || source) steps.add('materials');
  if (chat) steps.add('ask');
  return steps;
}

function toState(stored: StoredOnboarding, derived: Set<OnboardingStep>): OnboardingState {
  const completed = ONBOARDING_STEPS.filter((step) => stored.marks[step] || derived.has(step));
  const next =
    stored.status === 'active'
      ? (ONBOARDING_STEPS.find((step) => !completed.includes(step)) ?? null)
      : null;
  return {
    status: next ? stored.status : stored.status === 'skipped' ? 'skipped' : 'done',
    completed,
    next,
  };
}

/**
 * 第一次读取时决定要不要引导：账号里还没有自己的课、也没聊过天，就是新用户。
 * 老用户直接记为 done，以后不会再弹。
 */
export async function getOnboardingState(
  prisma: PrismaClient,
  userId: string,
): Promise<OnboardingState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboarding: true },
  });
  if (!user) return { status: 'done', completed: [], next: null };
  const derived = await derivedSteps(prisma, userId);
  let stored = readStored(user.onboarding);
  if (!stored) {
    const fresh = !derived.has('course') && !derived.has('ask');
    stored = fresh
      ? { status: 'active', marks: {}, startedAt: new Date().toISOString() }
      : { status: 'done', marks: {}, finishedAt: new Date().toISOString() };
    await prisma.user.update({
      where: { id: userId },
      data: { onboarding: stored as unknown as Prisma.InputJsonValue },
    });
  }
  return toState(stored, derived);
}

export type OnboardingAction =
  | { action: 'complete'; step: OnboardingStep }
  | { action: 'skip' }
  | { action: 'restart' };

export async function updateOnboarding(
  prisma: PrismaClient,
  userId: string,
  input: OnboardingAction,
): Promise<OnboardingState> {
  const current = await getOnboardingState(prisma, userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboarding: true },
  });
  const stored = readStored(user?.onboarding ?? null) ?? { status: current.status, marks: {} };
  const now = new Date().toISOString();
  if (input.action === 'skip') {
    if (stored.status === 'active') {
      stored.status = 'skipped';
      stored.finishedAt = now;
    }
  } else if (input.action === 'restart') {
    stored.status = 'active';
    stored.marks = {};
    stored.startedAt = now;
    delete stored.finishedAt;
  } else if (!stored.marks[input.step]) {
    stored.marks[input.step] = now;
  }
  const derived = await derivedSteps(prisma, userId);
  const state = toState(stored, derived);
  if (stored.status === 'active' && !state.next) {
    stored.status = 'done';
    stored.finishedAt = now;
  }
  await prisma.user.update({
    where: { id: userId },
    data: { onboarding: stored as unknown as Prisma.InputJsonValue },
  });
  return toState(stored, derived);
}
