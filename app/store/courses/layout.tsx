import type { ReactNode } from 'react';
import { StoreRuntime } from '@/components/courses/store-runtime';

export default function CourseStoreLayout({ children }: { children: ReactNode }) {
  return (
    <StoreRuntime staging={process.env.SYNTARA_APP_ENV === 'staging'}>{children}</StoreRuntime>
  );
}
