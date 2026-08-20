import { redirect } from 'next/navigation';

export default function RegisterPage() {
  redirect('/speedup/signed-out?role=student');
}
