import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    authSource?: 'local-demo';
  }

  interface Session {
    user?: DefaultSession['user'] & {
      id: string;
      role?: 'USER' | 'STUDENT' | 'TEACHER' | 'ADMIN';
      isActive?: boolean;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'USER' | 'STUDENT' | 'TEACHER' | 'ADMIN';
    isActive?: boolean;
    authSource?: 'speedup' | 'local-demo';
  }
}
