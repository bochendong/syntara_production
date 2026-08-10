import { createHash } from 'node:crypto';
import type { Agent } from 'node:http';
import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GitHubProvider from 'next-auth/providers/github';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { isDatabaseAvailable, getOptionalPrisma } from '@/lib/server/prisma-safe';
import { verifyPassword } from '@/lib/server/password-hash';

function oauthHttpOptions() {
  const proxyUrl = process.env.HTTPS_PROXY?.trim() || process.env.HTTP_PROXY?.trim();
  return {
    timeout: 15_000,
    ...(proxyUrl ? { agent: createMergeSafeProxyAgent(proxyUrl) } : {}),
  };
}

function createMergeSafeProxyAgent(proxyUrl: string): Agent {
  const proxyAgent = new HttpsProxyAgent(proxyUrl);

  // NextAuth recursively merges provider options and would turn a normal Agent
  // instance into a plain object, stripping prototype methods such as getName.
  // A callable Proxy survives that merge and forwards the complete Agent API,
  // including protocol metadata required to establish the TLS tunnel.
  return new Proxy(() => undefined, {
    get(_target, property) {
      const value = Reflect.get(proxyAgent, property, proxyAgent);
      return typeof value === 'function' ? value.bind(proxyAgent) : value;
    },
    set(_target, property, value) {
      return Reflect.set(proxyAgent, property, value, proxyAgent);
    },
  }) as unknown as Agent;
}

function resolveAuthSecret() {
  const configured = process.env.NEXTAUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') return undefined;

  const localSeed =
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.GITHUB_CLIENT_SECRET?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!localSeed) return undefined;

  return createHash('sha256').update(`syntara-local-nextauth:${localSeed}`).digest('hex');
}

function buildProviders() {
  const providers = [];

  const prisma = getOptionalPrisma();
  if (prisma) {
    providers.push(
      CredentialsProvider({
        id: 'teacher-credentials',
        name: 'Teacher account',
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials) {
          const email = credentials?.email?.trim().toLowerCase() || '';
          const password = credentials?.password || '';
          if (!email || !password) return null;
          const user = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              email: true,
              name: true,
              image: true,
              role: true,
              isActive: true,
              passwordHash: true,
            },
          });
          if (
            !user?.isActive ||
            (user.role !== 'TEACHER' && user.role !== 'ADMIN') ||
            !user.passwordHash ||
            !(await verifyPassword(password, user.passwordHash))
          ) {
            return null;
          }
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
            isActive: user.isActive,
          };
        },
      }),
    );
    providers.push(
      CredentialsProvider({
        id: 'student-credentials',
        name: 'Student account',
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials) {
          const email = credentials?.email?.trim().toLowerCase() || '';
          const password = credentials?.password || '';
          if (!email || !password) return null;
          const user = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              email: true,
              name: true,
              image: true,
              role: true,
              isActive: true,
              passwordHash: true,
            },
          });
          if (
            !user?.isActive ||
            (user.role !== 'STUDENT' && user.role !== 'USER') ||
            !user.passwordHash ||
            !(await verifyPassword(password, user.passwordHash))
          ) {
            return null;
          }
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role,
            isActive: user.isActive,
          };
        },
      }),
    );
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (googleClientId && googleClientSecret) {
    providers.push(
      GoogleProvider({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        // Avoid an extra OpenID discovery request before every sign-in. This is
        // especially important for local development behind an HTTP proxy.
        wellKnown: undefined,
        issuer: 'https://accounts.google.com',
        authorization: {
          url: 'https://accounts.google.com/o/oauth2/v2/auth',
          params: { scope: 'openid email profile' },
        },
        token: 'https://oauth2.googleapis.com/token',
        userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
        jwks_endpoint: 'https://www.googleapis.com/oauth2/v3/certs',
        httpOptions: oauthHttpOptions(),
      }),
    );
  }

  const githubClientId = process.env.GITHUB_CLIENT_ID?.trim();
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (githubClientId && githubClientSecret) {
    providers.push(
      GitHubProvider({
        clientId: githubClientId,
        clientSecret: githubClientSecret,
        httpOptions: oauthHttpOptions(),
      }),
    );
  }

  return providers;
}

const prismaClient = getOptionalPrisma();

export const authOptions: NextAuthOptions = {
  ...(isDatabaseAvailable() && prismaClient ? { adapter: PrismaAdapter(prismaClient) } : {}),
  secret: resolveAuthSecret(),
  providers: buildProviders(),
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async signIn({ user }) {
      const accountUser = user as { role?: string; isActive?: boolean };
      return (
        accountUser.isActive !== false &&
        (accountUser.role === 'USER' ||
          accountUser.role === 'STUDENT' ||
          accountUser.role === 'TEACHER' ||
          accountUser.role === 'ADMIN')
      );
    },
    async jwt({ token, user }) {
      if (user) {
        const accountUser = user as { role?: string; isActive?: boolean };
        token.role =
          accountUser.role === 'ADMIN' ||
          accountUser.role === 'TEACHER' ||
          accountUser.role === 'STUDENT'
            ? accountUser.role
            : 'USER';
        token.isActive = accountUser.isActive !== false;
        return token;
      }
      if (token.authSource === 'speedup') {
        token.isActive = true;
        return token;
      }
      if (token.sub && prismaClient) {
        try {
          const current = await prismaClient.user.findUnique({
            where: { id: token.sub },
            select: { role: true, isActive: true },
          });
          token.role = current?.role || 'USER';
          token.isActive = current?.isActive === true;
        } catch {
          token.isActive = false;
        }
      }
      return token;
    },
    async session({ session, user, token }) {
      if (session.user) {
        if (user) {
          session.user.id = user.id;
          session.user.role =
            (user as { role?: 'USER' | 'STUDENT' | 'TEACHER' | 'ADMIN' }).role || 'USER';
          session.user.isActive = (user as { isActive?: boolean }).isActive !== false;
        } else if (token?.sub) {
          session.user.id = token.sub;
          session.user.role =
            token.role === 'TEACHER' || token.role === 'ADMIN' || token.role === 'STUDENT'
              ? token.role
              : 'USER';
          session.user.isActive = token.isActive !== false;
        }
      }
      return session;
    },
  },
};

export async function requireServerSession() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || session.user.isActive === false) {
      return null;
    }
    return session;
  } catch (e) {
    // 数据库不可用时 NextAuth + PrismaAdapter 可能抛错；交给 x-user-id 等降级路径
    console.error('[auth] getServerSession failed', e);
    return null;
  }
}
