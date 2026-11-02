import type { Metadata } from 'next';
import { TeacherClassroomHomeClient } from '@/components/teacher/classroom/teacher-classroom-home-client';

export const metadata: Metadata = { title: '班级与上课 · Syntara' };

export default function TeacherClassroomPage() {
  return <TeacherClassroomHomeClient />;
}
