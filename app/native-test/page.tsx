import { notFound } from 'next/navigation';
import { NativeTestLogin } from './test-login';

export const dynamic = 'force-dynamic';

export default function NativeTestPage() {
  if (process.env.SYNTARA_APP_ENV !== 'staging') notFound();
  return <NativeTestLogin />;
}
