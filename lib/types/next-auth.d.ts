import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user?: DefaultSession['user'] & {
      id: string;
      role?: 'USER' | 'TEACHER' | 'ADMIN';
      isActive?: boolean;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'USER' | 'TEACHER' | 'ADMIN';
    isActive?: boolean;
  }
}
