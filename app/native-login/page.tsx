import { NativeLoginPageClient } from './native-login-page-client';

type NativeLoginPageProps = {
  searchParams: Promise<{ user_code?: string | string[] }>;
};

function normalizeUserCode(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const compact = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : '';
}

export default async function NativeLoginPage({ searchParams }: NativeLoginPageProps) {
  const query = await searchParams;
  return (
    <NativeLoginPageClient
      userCode={normalizeUserCode(query.user_code)}
      providers={{
        google: Boolean(
          process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
        ),
        github: Boolean(
          process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim(),
        ),
      }}
    />
  );
}
