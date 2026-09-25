import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Download,
  FileText,
  ListChecks,
  MessageSquare,
  MessagesSquare,
  ShieldCheck,
} from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { AdminNotebookPagePreview } from '@/components/admin/admin-notebook-page-preview';
import { CourseProblemBankView } from '@/components/problem-bank/course-problem-bank-view';
import type { AdminCourseProblemBankSnapshot } from '@/components/problem-bank/use-course-problem-bank-controller';
import type { NotebookProblemClientRecord } from '@/lib/utils/notebook-problem-api';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

export const dynamic = 'force-dynamic';

type Tab = 'overview' | 'notebooks' | 'files' | 'problems' | 'forum' | 'chat';
type Db = NonNullable<ReturnType<typeof getOptionalPrisma>>;

const tabs = [
  { id: 'overview', label: '概览', icon: BookOpen },
  { id: 'notebooks', label: '笔记本', icon: FileText },
  { id: 'files', label: '上传文件', icon: FileText },
  { id: 'problems', label: '题库', icon: ListChecks },
  { id: 'forum', label: '论坛', icon: MessagesSquare },
  { id: 'chat', label: '聊天记录', icon: MessageSquare },
] as const;

const panelClass =
  'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950';
const itemClass =
  'block rounded-xl border border-slate-200 px-4 py-3 text-sm transition hover:border-sky-300 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-500 dark:border-slate-800 dark:hover:bg-slate-900';

function href(courseId: string, tab: Tab, page = 1, item?: string, section?: string) {
  const params = new URLSearchParams({ tab });
  if (page > 1) params.set('page', String(page));
  if (item) params.set('item', item);
  if (section) params.set('section', section);
  return `/admin/courses/${encodeURIComponent(courseId)}?${params}`;
}

function date(value: Date | null | undefined) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(value) : '—';
}

function Pagination({
  courseId,
  tab,
  page,
  total,
}: {
  courseId: string;
  tab: Tab;
  page: number;
  total: number;
}) {
  const last = Math.max(1, Math.ceil(total / 20));
  if (last === 1) return null;
  return (
    <div className="mt-5 flex items-center justify-end gap-3 text-sm">
      {page > 1 ? (
        <Link className="text-sky-700 hover:underline" href={href(courseId, tab, page - 1)}>
          上一页
        </Link>
      ) : null}
      <span className="text-slate-500">
        {page} / {last}
      </span>
      {page < last ? (
        <Link className="text-sky-700 hover:underline" href={href(courseId, tab, page + 1)}>
          下一页
        </Link>
      ) : null}
    </div>
  );
}

function JsonContent({ value }: { value: unknown }) {
  if (typeof value === 'string') return <MessageResponse>{value}</MessageResponse>;
  if (!value || typeof value !== 'object') return <p className="text-slate-500">暂无内容</p>;
  const fields = Array.isArray(value)
    ? value.map((entry, index) => [String(index + 1), entry] as const)
    : Object.entries(value);
  return (
    <div className="space-y-4">
      {fields.map(([key, entry]) => (
        <div key={key} className="min-w-0">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {key}
          </div>
          {typeof entry === 'string' ? (
            <div className="break-words text-sm leading-7">
              <MessageResponse>{entry}</MessageResponse>
            </div>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
              {JSON.stringify(entry, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

async function NotebookTab({
  db,
  courseId,
  page,
  itemId,
  sectionId,
}: {
  db: Db;
  courseId: string;
  page: number;
  itemId?: string;
  sectionId?: string;
}) {
  const where = { courseId };
  const [total, rows] = await Promise.all([
    db.notebook.count({ where }),
    db.notebook.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * 20,
      take: 20,
      select: {
        id: true,
        name: true,
        description: true,
        notebookKind: true,
        removedAt: true,
        updatedAt: true,
        _count: { select: { markdownSections: true, pages: true } },
      },
    }),
  ]);
  const selected = itemId
    ? await db.notebook.findFirst({
        where: { id: itemId, courseId },
        select: { id: true, name: true, description: true, notebookKind: true },
      })
    : null;
  const sections =
    selected?.notebookKind === 'markdown'
      ? await db.markdownNotebookSection.findMany({
          where: { notebookId: selected.id },
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true },
          take: 200,
        })
      : [];
  const pages =
    selected?.notebookKind !== 'markdown' && selected
      ? await db.notebookPage.findMany({
          where: { notebookId: selected.id },
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true, coverImagePath: true },
          take: 200,
        })
      : [];
  const activeId = sectionId || sections[0]?.id || pages[0]?.id;
  const markdown =
    selected?.notebookKind === 'markdown' && activeId
      ? await db.markdownNotebookSection.findFirst({
          where: { id: activeId, notebookId: selected.id },
          select: { title: true, markdown: true },
        })
      : null;
  const pageContent =
    selected && selected.notebookKind !== 'markdown' && activeId
      ? await db.notebookPage.findFirst({
          where: { id: activeId, notebookId: selected.id },
          select: { title: true, content: { select: { content: true } } },
        })
      : null;
  return (
    <>
      <h2 className="text-lg font-semibold">
        笔记本 <span className="text-sm font-normal text-slate-500">{total} 个</span>
      </h2>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.7fr)]">
        <div className="space-y-2">
          {rows.length ? (
            rows.map((row) => (
              <Link
                key={row.id}
                href={href(courseId, 'notebooks', page, row.id)}
                className={itemClass}
                aria-current={itemId === row.id ? 'true' : undefined}
              >
                <strong className="block">{row.name}</strong>
                <span className="mt-1 block text-xs text-slate-500">
                  {row.notebookKind === 'markdown'
                    ? `${row._count.markdownSections} 节`
                    : `${row._count.pages} 页`}
                  {row.removedAt ? ' · 已移除' : ''} · {date(row.updatedAt)}
                </span>
              </Link>
            ))
          ) : (
            <p className="text-sm text-slate-500">暂无笔记本</p>
          )}
          <Pagination courseId={courseId} tab="notebooks" page={page} total={total} />
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          {selected ? (
            <>
              <h3 className="text-base font-semibold">{selected.name}</h3>
              {selected.description ? (
                <p className="mt-1 text-sm text-slate-500">{selected.description}</p>
              ) : null}
              <div className="my-4 flex flex-wrap gap-2">
                {(selected.notebookKind === 'markdown' ? sections : pages).map((entry) => (
                  <Link
                    key={entry.id}
                    href={href(courseId, 'notebooks', page, selected.id, entry.id)}
                    className={`rounded-lg border px-3 py-1.5 text-xs ${activeId === entry.id ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-200'}`}
                  >
                    {entry.order + 1}. {entry.title}
                  </Link>
                ))}
              </div>
              {markdown ? (
                <article className="prose prose-slate max-w-none text-sm dark:prose-invert">
                  <MessageResponse>{markdown.markdown}</MessageResponse>
                </article>
              ) : null}
              {pageContent ? (
                <div className="space-y-2">
                  <h4 className="font-medium">{pageContent.title}</h4>
                  <AdminNotebookPagePreview content={pageContent.content?.content} />
                </div>
              ) : null}
              {!markdown && !pageContent ? (
                <p className="text-sm text-slate-500">这个笔记本还没有页面内容。</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-slate-500">点击左侧笔记本查看内容。</p>
          )}
        </div>
      </div>
    </>
  );
}

async function FileTab({
  db,
  courseId,
  page,
  itemId,
}: {
  db: Db;
  courseId: string;
  page: number;
  itemId?: string;
}) {
  const where = { courseId };
  const [total, rows] = await Promise.all([
    db.courseSource.count({ where }),
    db.courseSource.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * 20,
      take: 20,
      select: {
        id: true,
        title: true,
        kind: true,
        fileMime: true,
        fileSize: true,
        removedAt: true,
        updatedAt: true,
      },
    }),
  ]);
  const selected = itemId
    ? await db.courseSource.findFirst({
        where: { id: itemId, courseId },
        select: {
          id: true,
          title: true,
          fileMime: true,
          fileData: true,
          extractedText: true,
          removedAt: true,
        },
      })
    : null;
  const fileHref = selected
    ? `/api/admin/courses/${encodeURIComponent(courseId)}/sources/${encodeURIComponent(selected.id)}/file`
    : '';
  const inlineFile =
    selected?.fileMime === 'application/pdf' ||
    selected?.fileMime?.startsWith('image/png') ||
    selected?.fileMime?.startsWith('image/jpeg') ||
    selected?.fileMime?.startsWith('image/webp');
  return (
    <>
      <h2 className="text-lg font-semibold">
        上传文件 <span className="text-sm font-normal text-slate-500">{total} 个</span>
      </h2>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.7fr)]">
        <div className="space-y-2">
          {rows.length ? (
            rows.map((row) => (
              <Link
                key={row.id}
                href={href(courseId, 'files', page, row.id)}
                className={itemClass}
                aria-current={itemId === row.id ? 'true' : undefined}
              >
                <strong className="block break-words">{row.title}</strong>
                <span className="mt-1 block text-xs text-slate-500">
                  {row.fileMime || row.kind} · {Math.ceil(row.fileSize / 1024)} KB
                  {row.removedAt ? ' · 已移除' : ''}
                </span>
              </Link>
            ))
          ) : (
            <p className="text-sm text-slate-500">暂无上传文件</p>
          )}
          <Pagination courseId={courseId} tab="files" page={page} total={total} />
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          {selected ? (
            <>
              <h3 className="font-semibold">{selected.title}</h3>
              {selected.removedAt ? (
                <p className="mt-1 text-xs text-amber-700">已移除，保留供管理员查看</p>
              ) : null}
              {selected.fileData && inlineFile ? (
                <div className="mt-4">
                  {selected.fileMime === 'application/pdf' ? (
                    <iframe
                      title={selected.title}
                      src={fileHref}
                      className="h-[65vh] w-full rounded-lg border"
                    />
                  ) : (
                    <img
                      src={fileHref}
                      alt={selected.title}
                      className="max-h-[65vh] max-w-full rounded-lg object-contain"
                    />
                  )}
                </div>
              ) : null}
              {selected.extractedText ? (
                <div className="mt-5">
                  <h4 className="mb-2 text-sm font-semibold">提取的文字</h4>
                  <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-sm leading-6 dark:bg-slate-900">
                    {selected.extractedText}
                  </pre>
                </div>
              ) : null}
              {!selected.extractedText && !selected.fileData ? (
                <p className="mt-4 text-sm text-slate-500">没有可预览的文件内容。</p>
              ) : null}
              {selected.fileData && !inlineFile ? (
                <p className="mt-4 text-sm text-slate-500">这个文件格式无法在页面中预览。</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-slate-500">点击左侧文件查看内容。</p>
          )}
        </div>
      </div>
    </>
  );
}

async function ProblemTab({
  db,
  course,
}: {
  db: Db;
  course: {
    id: string;
    name: string;
    courseCode: string | null;
    academicYear: number | null;
    academicTerm: 'winter' | 'summer' | 'fall' | null;
  };
}) {
  const [rows, chapters] = await Promise.all([
    db.notebookProblem.findMany({
      where: { OR: [{ courseId: course.id }, { notebook: { courseId: course.id } }] },
      orderBy: [{ order: 'asc' }, { id: 'asc' }],
      include: {
        notebook: { select: { name: true } },
        chapter: { select: { name: true } },
        secret: { select: { secretJudgeJson: true } },
      },
    }),
    db.courseProblemChapter.findMany({
      where: { courseId: course.id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { problems: true } } },
    }),
  ]);
  const snapshot: AdminCourseProblemBankSnapshot = {
    courseName: course.name,
    courseCode: course.courseCode || undefined,
    courseAcademicYear: course.academicYear || undefined,
    courseAcademicTerm: course.academicTerm || undefined,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      name: chapter.name,
      description: chapter.description || '',
      position: chapter.position,
      problemCount: chapter._count.problems,
    })),
    problems: rows.map(
      (row): NotebookProblemClientRecord => ({
        id: row.id,
        courseId: row.courseId,
        notebookId: row.notebookId,
        notebookName: row.notebook?.name || undefined,
        chapterId: row.chapterId,
        chapterName: row.chapter?.name || undefined,
        title: row.title,
        type: row.type,
        status: row.status,
        source: row.source,
        order: row.order,
        problemNumber: row.problemNumber,
        points: row.points,
        tags: row.tags,
        difficulty: row.difficulty,
        publicContent:
          row.publicContentJson as unknown as NotebookProblemClientRecord['publicContent'],
        grading: row.gradingJson as unknown as NotebookProblemClientRecord['grading'],
        sourceMeta: (row.sourceMeta || {}) as NotebookProblemClientRecord['sourceMeta'],
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
        ...(row.secret
          ? {
              secretJudge: row.secret.secretJudgeJson as unknown as NonNullable<
                NotebookProblemClientRecord['secretJudge']
              >,
            }
          : {}),
      }),
    ),
  };
  return (
    <div className="h-[min(78vh,900px)] min-h-[560px]">
      <CourseProblemBankView
        courseId={course.id}
        adminReadOnly
        adminSnapshot={snapshot}
        showCourseTitle={false}
        showCourseNavigation={false}
        showChromeBackground={false}
      />
    </div>
  );
}

async function ForumTab({
  db,
  courseId,
  page,
  itemId,
}: {
  db: Db;
  courseId: string;
  page: number;
  itemId?: string;
}) {
  const where = { courseId };
  const [total, rows] = await Promise.all([
    db.courseForumPost.count({ where }),
    db.courseForumPost.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * 20,
      take: 20,
      select: { id: true, title: true, updatedAt: true, author: { select: { name: true } } },
    }),
  ]);
  const selected = itemId
    ? await db.courseForumPost.findFirst({
        where: { id: itemId, courseId },
        select: {
          title: true,
          bodyMarkdown: true,
          author: { select: { name: true } },
          answers: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, bodyMarkdown: true, author: { select: { name: true } } },
          },
          comments: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, body: true, author: { select: { name: true } } },
          },
        },
      })
    : null;
  return (
    <>
      <h2 className="text-lg font-semibold">
        论坛 <span className="text-sm font-normal text-slate-500">{total} 帖</span>
      </h2>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.7fr)]">
        <div className="space-y-2">
          {rows.length ? (
            rows.map((row) => (
              <Link
                key={row.id}
                href={href(courseId, 'forum', page, row.id)}
                className={itemClass}
                aria-current={itemId === row.id ? 'true' : undefined}
              >
                <strong className="block">{row.title}</strong>
                <span className="mt-1 block text-xs text-slate-500">
                  {row.author.name || '用户'} · {date(row.updatedAt)}
                </span>
              </Link>
            ))
          ) : (
            <p className="text-sm text-slate-500">暂无帖子</p>
          )}
          <Pagination courseId={courseId} tab="forum" page={page} total={total} />
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          {selected ? (
            <>
              <h3 className="text-base font-semibold">{selected.title}</h3>
              <p className="mt-1 text-xs text-slate-500">{selected.author.name || '用户'}</p>
              <div className="mt-4 text-sm leading-7">
                <MessageResponse>{selected.bodyMarkdown}</MessageResponse>
              </div>
              {selected.answers.map((answer) => (
                <div key={answer.id} className="mt-5 border-t pt-4">
                  <p className="mb-2 text-xs font-medium text-slate-500">
                    回答 · {answer.author.name || '用户'}
                  </p>
                  <MessageResponse>{answer.bodyMarkdown}</MessageResponse>
                </div>
              ))}
              {selected.comments.map((comment) => (
                <div key={comment.id} className="mt-4 border-t pt-3">
                  <p className="text-xs font-medium text-slate-500">
                    评论 · {comment.author.name || '用户'}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
                </div>
              ))}
            </>
          ) : (
            <p className="text-sm text-slate-500">点击左侧帖子查看内容。</p>
          )}
        </div>
      </div>
    </>
  );
}

async function ChatTab({
  db,
  courseId,
  ownerId,
  page,
  itemId,
}: {
  db: Db;
  courseId: string;
  ownerId: string;
  page: number;
  itemId?: string;
}) {
  const where = { courseId, ownerId, deletedAt: null };
  const [total, rows] = await Promise.all([
    db.courseConversation.count({ where }),
    db.courseConversation.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * 20,
      take: 20,
      select: {
        id: true,
        title: true,
        messageCount: true,
        updatedAt: true,
        owner: { select: { name: true } },
      },
    }),
  ]);
  const selected = itemId
    ? await db.courseConversation.findFirst({
        where: { id: itemId, courseId, ownerId, deletedAt: null },
        select: {
          title: true,
          messages: {
            where: { deletedAt: null },
            orderBy: { sequence: 'asc' },
            take: 200,
            select: { id: true, role: true, plainText: true, content: true },
          },
        },
      })
    : null;
  return (
    <>
      <h2 className="text-lg font-semibold">
        聊天记录 <span className="text-sm font-normal text-slate-500">{total} 个会话</span>
      </h2>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.7fr)]">
        <div className="space-y-2">
          {rows.length ? (
            rows.map((row) => (
              <Link
                key={row.id}
                href={href(courseId, 'chat', page, row.id)}
                className={itemClass}
                aria-current={itemId === row.id ? 'true' : undefined}
              >
                <strong className="block">{row.title}</strong>
                <span className="mt-1 block text-xs text-slate-500">
                  {row.owner.name || '用户'} · {row.messageCount} 条 · {date(row.updatedAt)}
                </span>
              </Link>
            ))
          ) : (
            <p className="text-sm text-slate-500">暂无聊天记录</p>
          )}
          <Pagination courseId={courseId} tab="chat" page={page} total={total} />
        </div>
        <div className="min-w-0 space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          {selected ? (
            <>
              <h3 className="font-semibold">{selected.title}</h3>
              {selected.messages.map((message) => (
                <div key={message.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900">
                  <p className="mb-2 text-xs font-medium text-slate-500">
                    {message.role || '消息'}
                  </p>
                  {message.plainText ? (
                    <MessageResponse>{message.plainText}</MessageResponse>
                  ) : (
                    <JsonContent value={message.content} />
                  )}
                </div>
              ))}
            </>
          ) : (
            <p className="text-sm text-slate-500">点击左侧会话查看记录。</p>
          )}
        </div>
      </div>
    </>
  );
}

export default async function AdminCourseReadOnlyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; page?: string; item?: string; section?: string }>;
}) {
  const admin = await requireAdmin();
  if ('response' in admin) redirect('/admin?section=courses');
  const db = getOptionalPrisma();
  if (!db) return <p className="p-8">数据库不可用，暂时无法查看课程。</p>;
  const { id } = await params;
  const query = await searchParams;
  const tab: Tab = tabs.some((entry) => entry.id === query.tab) ? (query.tab as Tab) : 'overview';
  const requestedPage = Number(query.page || 1);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const course = await db.course.findUnique({
    where: { id },
    select: {
      id: true,
      ownerId: true,
      name: true,
      courseCode: true,
      description: true,
      academicYear: true,
      academicTerm: true,
      university: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { name: true, email: true } },
      _count: {
        select: {
          notebooks: true,
          courseSources: true,
          problems: true,
          forumPosts: true,
          enrollments: true,
        },
      },
    },
  });
  if (!course) notFound();
  const teacherConversationCount =
    tab === 'overview'
      ? await db.courseConversation.count({
          where: { courseId: id, ownerId: course.ownerId, deletedAt: null },
        })
      : 0;
  const hardRules =
    tab === 'overview'
      ? await db.courseHardRule.findMany({
          where: { courseId: id },
          orderBy: { position: 'asc' },
          select: { id: true, content: true },
        })
      : [];
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/admin?section=courses"
            className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-sky-700 dark:text-slate-300"
          >
            <ArrowLeft className="size-4" />
            返回课程管理
          </Link>
          <div className="flex items-center gap-2">
            <a
              href={`/api/admin/courses/${encodeURIComponent(id)}/export`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
            >
              <Download className="size-4" />
              下载课程资料
            </a>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800">
              <ShieldCheck className="size-3.5" />
              管理员只读查看
            </span>
          </div>
        </div>
        <header className={panelClass}>
          <p className="text-xs font-medium text-slate-500">
            {course.courseCode || '课程'}
            {course.academicYear ? ` · ${course.academicYear} ${course.academicTerm || ''}` : ''}
          </p>
          <h1 className="mt-1 text-2xl font-bold">{course.name}</h1>
          <p className="mt-2 text-sm text-slate-500">
            老师：{course.owner.name || course.owner.email || '未知'}
            {course.university ? ` · ${course.university}` : ''}
          </p>
          {course.description ? (
            <p className="mt-3 whitespace-pre-wrap text-sm">{course.description}</p>
          ) : null}
        </header>
        <nav
          aria-label="只读课程导航"
          className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
        >
          {tabs.map(({ id: tabId, label, icon: Icon }) => (
            <Link
              key={tabId}
              href={href(id, tabId)}
              aria-current={tab === tabId ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${tab === tabId ? 'bg-sky-50 font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-200' : 'text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <section className={panelClass}>
          {tab === 'overview' ? (
            <>
              <h2 className="text-lg font-semibold">课程概览</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ['笔记本', course._count.notebooks, 'notebooks'],
                    ['上传文件', course._count.courseSources, 'files'],
                    ['题目', course._count.problems, 'problems'],
                    ['论坛帖子', course._count.forumPosts, 'forum'],
                    ['老师聊天会话', teacherConversationCount, 'chat'],
                    ['报名学生', course._count.enrollments, null],
                  ] as const
                ).map(([label, count, target]) =>
                  target ? (
                    <Link key={label} href={href(id, target)} className={itemClass}>
                      <span className="text-sm text-slate-500">{label}</span>
                      <strong className="mt-2 block text-2xl">{count}</strong>
                    </Link>
                  ) : (
                    <div key={label} className={itemClass}>
                      <span className="text-sm text-slate-500">{label}</span>
                      <strong className="mt-2 block text-2xl">{count}</strong>
                    </div>
                  ),
                )}
              </div>
              {hardRules.length ? (
                <div className="mt-6">
                  <h3 className="font-semibold">课程规则</h3>
                  <div className="mt-2 space-y-2">
                    {hardRules.map((rule) => (
                      <p
                        key={rule.id}
                        className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900"
                      >
                        {rule.content}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="mt-5 text-xs text-slate-500">
                创建于 {date(course.createdAt)} · 更新于 {date(course.updatedAt)}
              </p>
            </>
          ) : null}
          {tab === 'notebooks' ? (
            <NotebookTab
              db={db}
              courseId={id}
              page={page}
              itemId={query.item}
              sectionId={query.section}
            />
          ) : null}
          {tab === 'files' ? (
            <FileTab db={db} courseId={id} page={page} itemId={query.item} />
          ) : null}
          {tab === 'problems' ? <ProblemTab db={db} course={course} /> : null}
          {tab === 'forum' ? (
            <ForumTab db={db} courseId={id} page={page} itemId={query.item} />
          ) : null}
          {tab === 'chat' ? (
            <ChatTab
              db={db}
              courseId={id}
              ownerId={course.ownerId}
              page={page}
              itemId={query.item}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}
