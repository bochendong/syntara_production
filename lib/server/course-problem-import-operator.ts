/** Server-only authority for an explicitly requested Railway staging maintenance operation. */
const operatorAuthority = Symbol('staging-course-problem-import');

const STAGING = {
  projectId: '8cddd1ea-24e1-49a9-8d27-dce86069dc8b',
  environmentId: '6697de1f-eb0d-4a6f-8709-cfe477a29f11',
  serviceId: 'fd6afb05-6491-451a-b577-abf15fdc0047',
  serviceName: 'native-api-staging',
  databaseHost: 'staging-postgres.railway.internal',
} as const;

export type StagingProblemImportOperator = Readonly<{
  [operatorAuthority]: true;
  kind: 'railway-staging-maintenance';
  courseId: string;
  expectedDataOwnerId: string;
  operator: string;
  deploymentId: string;
}>;

export function createStagingProblemImportOperator(args: {
  courseId: string;
  expectedDataOwnerId: string;
  env?: NodeJS.ProcessEnv;
}): StagingProblemImportOperator {
  const env = args.env ?? process.env;
  let databaseHost = '';
  try {
    const url = new URL(env.DATABASE_URL || '');
    if (['postgres:', 'postgresql:'].includes(url.protocol)) databaseHost = url.hostname;
  } catch {
    // Never include an injected connection string in errors or receipts.
  }
  if (
    env.RAILWAY_PROJECT_ID !== STAGING.projectId ||
    env.RAILWAY_ENVIRONMENT_ID !== STAGING.environmentId ||
    env.RAILWAY_ENVIRONMENT_NAME !== 'staging' ||
    env.RAILWAY_SERVICE_ID !== STAGING.serviceId ||
    env.RAILWAY_SERVICE_NAME !== STAGING.serviceName ||
    !env.RAILWAY_DEPLOYMENT_ID?.trim() ||
    databaseHost !== STAGING.databaseHost ||
    !args.courseId.trim() ||
    !args.expectedDataOwnerId.trim()
  ) {
    throw new Error(
      'An explicitly selected Railway staging API maintenance environment is required.',
    );
  }
  return Object.freeze({
    [operatorAuthority]: true as const,
    kind: 'railway-staging-maintenance' as const,
    courseId: args.courseId,
    expectedDataOwnerId: args.expectedDataOwnerId,
    operator: `railway:${STAGING.projectId}/${STAGING.environmentId}/${STAGING.serviceId}`,
    deploymentId: env.RAILWAY_DEPLOYMENT_ID,
  });
}

export function assertStagingProblemImportOperator(
  context: StagingProblemImportOperator,
  courseId: string,
  dataOwnerId: string,
) {
  if (
    context?.[operatorAuthority] !== true ||
    context.courseId !== courseId ||
    context.expectedDataOwnerId !== dataOwnerId
  ) {
    throw new Error('The maintenance authority does not match this course and its data owner.');
  }
}

export function problemImportOperatorAudit(context: StagingProblemImportOperator) {
  return {
    kind: context.kind,
    operator: context.operator,
    deploymentId: context.deploymentId,
    dataOwnerId: context.expectedDataOwnerId,
  };
}
