import { notFound } from 'next/navigation';
import AdminMockClient from './admin-mock-client';

export default function AdminMockPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <AdminMockClient />;
}
