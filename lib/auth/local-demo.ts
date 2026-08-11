const LOCAL_DEMO_USER_ID_PREFIX = 'local-demo-';

export function isLocalDemoUserId(userId: string | null | undefined): boolean {
  return (
    process.env.NODE_ENV !== 'production' && Boolean(userId?.startsWith(LOCAL_DEMO_USER_ID_PREFIX))
  );
}
