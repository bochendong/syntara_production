import { z } from 'zod';

const authority = Symbol('course-scoped-reviewed-problem-import');
const grantSchema = z
  .object({
    grantId: z.string().trim().min(1).max(128),
    userId: z.string().trim().min(1).max(200),
    courseId: z.string().trim().min(1).max(200),
    capability: z.enum(['append-reviewed-problems', 'append-reviewed-course-materials']),
    keyId: z.string().trim().min(1).max(200).optional(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type CourseProblemImportGrant = Readonly<
  z.infer<typeof grantSchema> & {
    [authority]: true;
    kind: 'course-import-grant';
    dataOwnerId: string;
    scopeCourseId: string;
    principalKeyId?: string;
  }
>;

/** Default disabled. Managed server configuration only; never a client-supplied grant. */
export function resolveCourseProblemImportGrant(args: {
  userId: string;
  courseId: string;
  dataOwnerId: string;
  keyId?: string;
  purpose?: 'questions' | 'notes';
  requireWildcard?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: number;
}): CourseProblemImportGrant | null {
  const raw = (args.env ?? process.env).SYNTARA_COURSE_PROBLEM_IMPORT_GRANTS;
  if (!raw?.trim() || raw.length > 100_000) return null;
  try {
    const parsed = z.array(grantSchema).max(500).safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      new Set(parsed.data.map((grant) => grant.grantId)).size !== parsed.data.length
    )
      return null;
    const matches = parsed.data.filter(
      (grant) =>
        grant.userId === args.userId &&
        (grant.courseId === args.courseId || grant.courseId === '*') &&
        (!args.requireWildcard || grant.courseId === '*') &&
        (!grant.keyId || grant.keyId === args.keyId) &&
        (args.purpose !== 'notes' || grant.capability === 'append-reviewed-course-materials') &&
        Date.parse(grant.expiresAt) > (args.now ?? Date.now()),
    );
    if (matches.length !== 1) return null;
    return Object.freeze({
      ...matches[0],
      [authority]: true as const,
      kind: 'course-import-grant' as const,
      scopeCourseId: matches[0].courseId,
      courseId: args.courseId,
      dataOwnerId: args.dataOwnerId,
      principalKeyId: args.keyId,
    });
  } catch {
    return null;
  }
}

export function assertCourseProblemImportGrant(
  context: CourseProblemImportGrant,
  courseId: string,
  dataOwnerId: string,
) {
  if (
    context?.[authority] !== true ||
    context.courseId !== courseId ||
    context.dataOwnerId !== dataOwnerId ||
    Date.parse(context.expiresAt) <= Date.now()
  )
    throw new Error('The course import grant is absent, expired or does not match this course.');
}

export function courseProblemImportGrantAudit(context: CourseProblemImportGrant) {
  return {
    kind: context.kind,
    userId: context.userId,
    dataOwnerId: context.dataOwnerId,
    grantId: context.grantId,
    capability: context.capability,
    courseId: context.courseId,
    scopeCourseId: context.scopeCourseId,
    ...(context.principalKeyId ? { keyId: context.principalKeyId } : {}),
    expiresAt: context.expiresAt,
  };
}
