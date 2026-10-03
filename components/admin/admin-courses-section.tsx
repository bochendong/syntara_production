'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from '@/lib/notifications/client-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { resolveCourseAvatarDisplayUrl } from '@/lib/constants/course-avatars';
import { backendJson } from '@/lib/utils/backend-api';
import { cn } from '@/lib/utils';

type AdminCourseRow = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  purpose: string;
  university: string | null;
  courseCode: string | null;
  academicYear: number | null;
  academicTerm: AcademicTerm | null;
  avatarUrl: string | null;
  listedInCourseStore: boolean;
  coursePriceCents: number;
  storePublishedAt: string | null;
  sourceCourseId: string | null;
  notebookCount: number;
  sceneCount: number;
  problemCount: number;
  speechReadyCount: number;
  speechTotalCount: number;
  createdAt: string;
  updatedAt: string;
  owner: {
    id: string;
    email: string | null;
    name: string | null;
  };
  counts: {
    notebooks: number;
    notebookPages: number;
    markdownSections: number;
    problems: number;
    enrollments: number;
    sourcePurchases: number;
    reviews: number;
    conversations: number;
    studyMemories: number;
  };
  usage: {
    studentCount: number;
    studentTokens: number;
    teacherTokens: number;
  };
};

type AcademicTerm = 'winter' | 'summer' | 'fall';

const COURSE_PAGE_SIZE = 15;

const ACADEMIC_TERM_LABEL: Record<AcademicTerm, string> = {
  winter: 'Winter',
  summer: 'Summer',
  fall: 'Fall',
};

type SemesterOption = {
  academicYear: number;
  academicTerm: AcademicTerm;
};

type AdminCoursesResponse = {
  success: true;
  totalCount: number;
  semesters: SemesterOption[];
  courses: AdminCourseRow[];
};

type DeleteCourseResponse = {
  success: true;
  deletedCourse: {
    id: string;
    name: string;
    owner: {
      id: string;
      email: string | null;
      name: string | null;
    };
  };
};

function ownerLabel(course: AdminCourseRow) {
  return course.owner.email || course.owner.name || course.owner.id;
}

function semesterLabel(course: AdminCourseRow) {
  if (!course.academicYear || !course.academicTerm) return null;
  return `${course.academicYear} ${ACADEMIC_TERM_LABEL[course.academicTerm]}`;
}

function semesterOptionValue(semester: SemesterOption) {
  return `${semester.academicYear}:${semester.academicTerm}`;
}

function currentSemesterOption(date = new Date()): SemesterOption {
  const month = date.getMonth() + 1;
  return {
    academicYear: date.getFullYear(),
    academicTerm: month <= 4 ? 'winter' : month <= 8 ? 'summer' : 'fall',
  };
}

function currentSemesterValue(date = new Date()) {
  return semesterOptionValue(currentSemesterOption(date));
}

function formatUsage(tokens: number) {
  return `${Math.round(tokens).toLocaleString('zh-CN')} tokens`;
}

export function AdminCoursesSection() {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [semester, setSemester] = useState(currentSemesterValue);
  const [semesters, setSemesters] = useState<SemesterOption[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<AdminCourseRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [courseToDelete, setCourseToDelete] = useState<AdminCourseRow | null>(null);
  const [confirmCourseName, setConfirmCourseName] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);

  const pageCount = Math.max(1, Math.ceil(totalCount / COURSE_PAGE_SIZE));
  const currentSemester = currentSemesterValue();
  const semesterChoices = semesters.some((item) => semesterOptionValue(item) === currentSemester)
    ? semesters
    : [currentSemesterOption(), ...semesters];

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      take: String(COURSE_PAGE_SIZE),
      skip: String((page - 1) * COURSE_PAGE_SIZE),
    });
    const normalizedQuery = appliedQuery.trim();
    if (normalizedQuery) params.set('query', normalizedQuery);
    const [academicYear, academicTerm] = semester.split(':');
    if (academicYear && academicTerm) {
      params.set('academicYear', academicYear);
      params.set('academicTerm', academicTerm);
    }

    try {
      const response = await backendJson<AdminCoursesResponse>(
        `/api/admin/courses?${params.toString()}`,
      );
      setCourses(response.courses);
      setTotalCount(response.totalCount);
      setSemesters(response.semesters);
    } catch (loadError) {
      setCourses([]);
      setTotalCount(0);
      setSemesters([]);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, page, semester]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses, refreshTick]);

  const handleSearch = () => {
    setPage(1);
    setAppliedQuery(query.trim());
  };

  const openDeleteDialog = (course: AdminCourseRow) => {
    setCourseToDelete(course);
    setConfirmCourseName('');
  };

  const handleDelete = async () => {
    const course = courseToDelete;
    if (!course) return;

    if (confirmCourseName.trim() !== course.name) {
      toast.error('课程名不匹配，已取消删除');
      return;
    }

    setDeletingId(course.id);
    try {
      const response = await backendJson<DeleteCourseResponse>(
        `/api/admin/courses/${encodeURIComponent(course.id)}`,
        {
          method: 'DELETE',
        },
      );
      const nextTotal = Math.max(0, totalCount - 1);
      const nextPageCount = Math.max(1, Math.ceil(nextTotal / COURSE_PAGE_SIZE));
      setTotalCount(nextTotal);
      setCourseToDelete(null);
      if (page > nextPageCount) {
        setPage(nextPageCount);
      } else {
        setRefreshTick((current) => current + 1);
      }
      setConfirmCourseName('');
      toast.success(`已删除课程：${response.deletedCourse.name}`);
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              aria-label="学期"
              value={semester}
              onChange={(event) => {
                setPage(1);
                setSemester(event.target.value);
              }}
              className="h-9 shrink-0 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">全部学期</option>
              {semesterChoices.map((item) => (
                <option key={semesterOptionValue(item)} value={semesterOptionValue(item)}>
                  {item.academicYear} {ACADEMIC_TERM_LABEL[item.academicTerm]}
                </option>
              ))}
            </select>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSearch();
                }}
                placeholder="搜索课程名、课程代码、学校、owner 邮箱"
                className="pl-9"
              />
            </div>
            <Button type="button" variant="outline" onClick={handleSearch}>
              <Search className="mr-1 h-4 w-4" />
              搜索
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRefreshTick((current) => current + 1)}
              disabled={loading}
            >
              <RefreshCw className={cn('mr-1 h-4 w-4', loading ? 'animate-spin' : '')} />
              刷新
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>读取失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="overflow-hidden rounded-lg border bg-background/80">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">课程</th>
                    <th className="px-4 py-3 font-medium">内容</th>
                    <th className="px-4 py-3 font-medium">学生与用量</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                        正在读取课程...
                      </td>
                    </tr>
                  ) : courses.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                        没有找到课程
                      </td>
                    </tr>
                  ) : (
                    courses.map((course) => (
                      <tr key={course.id} className="border-b last:border-0">
                        <td className="max-w-[420px] px-4 py-4 align-top">
                          <div className="flex items-center gap-3">
                            <img
                              src={resolveCourseAvatarDisplayUrl(course.id, course.avatarUrl)}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-lg border object-cover"
                            />
                            <div className="min-w-0">
                              <a
                                href={`/api/admin/courses/${encodeURIComponent(course.id)}/preview`}
                                className="block truncate rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2"
                              >
                                {course.name}
                              </a>
                              {course.sourceCourseId ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge variant="outline">克隆课程</Badge>
                                </div>
                              ) : null}
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                {ownerLabel(course)}
                              </p>
                              {semesterLabel(course) ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {semesterLabel(course)}
                                </p>
                              ) : null}
                              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                                {course.id}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <span>笔记 {course.counts.notebooks}</span>
                            <span>页面 {course.counts.notebookPages}</span>
                            <span>题目 {course.counts.problems}</span>
                            <span>报名 {course.counts.enrollments}</span>
                            <span>购买 {course.counts.sourcePurchases}</span>
                            <span>记忆 {course.counts.studyMemories}</span>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-xs">
                          <div className="space-y-1">
                            <div>
                              学生{' '}
                              <span className="font-medium tabular-nums">
                                {course.usage.studentCount}
                              </span>
                            </div>
                            <div>
                              学生用量{' '}
                              <span className="font-medium tabular-nums">
                                {formatUsage(course.usage.studentTokens)}
                              </span>
                            </div>
                            <div>
                              老师用量{' '}
                              <span className="font-medium tabular-nums">
                                {formatUsage(course.usage.teacherTokens)}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right align-top">
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" size="icon-sm" asChild>
                              <a
                                href={`/api/admin/courses/${encodeURIComponent(course.id)}/export`}
                                aria-label="下载资料"
                                title="下载资料"
                              >
                                <Download />
                              </a>
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon-sm"
                              aria-label="删除"
                              title="删除"
                              onClick={() => openDeleteDialog(course)}
                              disabled={deletingId === course.id}
                            >
                              {deletingId === course.id ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <Trash2 />
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              第 {Math.min(page, pageCount)} / {pageCount} 页
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                上一页
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading || page >= pageCount}
                onClick={() => setPage((current) => current + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(courseToDelete)}
        onOpenChange={(open) => {
          if (open) return;
          if (deletingId) return;
          setCourseToDelete(null);
          setConfirmCourseName('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除课程？</AlertDialogTitle>
            <AlertDialogDescription>
              管理员删除会移除课程记录、报名、购买记录、题库和课程记忆，并让关联笔记脱离课程。这个操作不能撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>

          {courseToDelete ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                <div className="font-medium text-foreground">{courseToDelete.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Owner: {ownerLabel(courseToDelete)}
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {courseToDelete.id}
                </div>
              </div>
              <div className="space-y-2">
                <label htmlFor="admin-course-delete-confirm" className="text-sm font-medium">
                  输入完整课程名确认删除
                </label>
                <Input
                  id="admin-course-delete-confirm"
                  value={confirmCourseName}
                  onChange={(event) => setConfirmCourseName(event.target.value)}
                  placeholder={courseToDelete.name}
                  autoFocus
                />
              </div>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={
                !courseToDelete ||
                confirmCourseName.trim() !== courseToDelete.name ||
                Boolean(deletingId)
              }
            >
              {deletingId ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-4 w-4" />
              )}
              确认删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
