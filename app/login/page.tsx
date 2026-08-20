import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: '学生登录 · Syntara',
};

export default function LoginPage() {
  redirect('/speedup/signed-out?role=student');
}
