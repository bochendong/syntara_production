import { notFound } from 'next/navigation';
import { NativeTestLogin } from './test-login';

export const dynamic = 'force-dynamic';

export default async function NativeTestPage({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  if (process.env.SYNTARA_APP_ENV !== 'staging') notFound();
  const as = (await searchParams).as === 'teacher' ? 'teacher' : 'student';
  return <NativeTestLogin initialAs={as} />;
}
