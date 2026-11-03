import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageCircleQuestion, Search } from 'lucide-react';
import { nativeAccountAvatarUrl } from '../assets';
import {
  getManagedCourseStudent,
  getManagedCourseStudents,
  type ManagedCourseStudent,
  type ManagedCourseStudents,
} from '../data/platform-api-client';
import { StudentProblemAttempts } from './StudentAttemptReview';
import { GlassSkeletonRows } from './GlassLoadMore';
import { PhoneEmpty } from './PhonePages';

type Student = ManagedCourseStudents['terms'][number]['students'][number];
/** 「3 分钟前」「昨天」「10/28」 */
function ago(value: string | null) {
  if (!value) return '';
  const time = new Date(value).getTime();
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
const dateText = (value: string) =>
  new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

/**
 * 课程管理里的「学生」：左边按加入学期分组的学生，右边选中学生的资料和学情。
 * 学情（最近做题、最近提问、正确率）只有机构课程有；私有课程只显示基本信息。
 */
export function CourseStudentsView({ courseId }: { courseId: string }) {
  const [list, setList] = useState<{ data?: ManagedCourseStudents; error?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  useEffect(() => {
    let active = true;
    getManagedCourseStudents(courseId)
      .then((data) => active && setList({ data }))
      .catch(
        (cause) =>
          active && setList({ error: cause instanceof Error ? cause.message : '读取失败' }),
      );
    return () => {
      active = false;
    };
  }, [courseId]);
  const splitRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const split = splitRef.current;
    if (!split) return;
    const fit = () => {
      const top = split.getBoundingClientRect().top;
      split.style.setProperty('--ccm-fill', `${Math.max(420, window.innerHeight - top - 16)}px`);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [list]);
  const terms = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (list?.data?.terms ?? [])
      .map((group) => ({
        ...group,
        students: needle
          ? group.students.filter((student) =>
              `${student.name ?? ''} ${student.email ?? ''}`.toLowerCase().includes(needle),
            )
          : group.students,
      }))
      .filter((group) => group.students.length);
  }, [list?.data, query]);
  const all = terms.flatMap((group) => group.students);
  const selected = all.find((student) => student.userId === selectedId) ?? all[0] ?? null;

  if (!list) return <GlassSkeletonRows rows={5} height={56} />;
  if (list.error) return <p className="phone-page-error">{list.error}</p>;
  const data = list.data!;
  if (!data.total)
    return <PhoneEmpty title="还没有学生加入" hint="学生从商城获取这门课后，会出现在这里。" />;
  return (
    <div ref={splitRef} className={`ccm-split csv${showDetail ? ' is-detail' : ''}`}>
      <aside className="ccm-side" aria-label="学生列表">
        <label className="phone-search ccm-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            aria-label="搜索学生"
            placeholder={`搜索 ${data.total} 个学生`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {!terms.length ? <p className="ccm-side-empty">没有匹配的学生</p> : null}
        <div className="ccm-list">
          {terms.map((group) => (
            <div key={group.key} className="ccm-group">
              <p className="ccm-group-name csv-term-name">
                {group.label}
                <span>{group.students.length}</span>
              </p>
              {group.students.map((student) => (
                <button
                  key={student.userId}
                  type="button"
                  className="ccm-row"
                  aria-current={selected?.userId === student.userId ? 'true' : undefined}
                  onClick={() => {
                    setSelectedId(student.userId);
                    setShowDetail(true);
                  }}
                >
                  <img
                    className="csv-avatar"
                    src={nativeAccountAvatarUrl(null, student.image)}
                    alt=""
                  />
                  <span className="ccm-row-copy">
                    <strong>{student.name || student.email || '未命名学生'}</strong>
                    <small>
                      {data.insights && student.lastActiveAt
                        ? `${ago(student.lastActiveAt)}活跃`
                        : `${dateText(student.joinedAt)} 加入`}
                    </small>
                  </span>
                  <ChevronRight className="ccm-row-chevron" size={15} aria-hidden />
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <section className="ccm-detail" aria-label="学生详情">
        {selected ? (
          <StudentDetail
            key={selected.userId}
            courseId={courseId}
            student={selected}
            onBack={() => setShowDetail(false)}
          />
        ) : null}
      </section>
    </div>
  );
}

function StudentDetail({
  courseId,
  student,
  onBack,
}: {
  courseId: string;
  student: Student;
  onBack: () => void;
}) {
  const [state, setState] = useState<{ data?: ManagedCourseStudent; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    getManagedCourseStudent(courseId, student.userId)
      .then((data) => active && setState({ data }))
      .catch(
        (cause) =>
          active && setState({ error: cause instanceof Error ? cause.message : '读取失败' }),
      );
    return () => {
      active = false;
    };
  }, [courseId, student.userId]);
  const detail = state?.data;
  const insights = detail?.insights;
  return (
    <>
      <header className="ccm-detail-head csv-head">
        <button
          type="button"
          className="ccm-detail-back"
          aria-label="返回学生列表"
          onClick={onBack}
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        <img className="csv-head-avatar" src={nativeAccountAvatarUrl(null, student.image)} alt="" />
        <div className="csv-head-copy">
          <h2>{student.name || '未命名学生'}</h2>
          <span>
            {[student.email, `${dateText(student.joinedAt)} 加入`].filter(Boolean).join(' · ')}
          </span>
        </div>
        <span className={`csv-method is-${student.method}`}>
          {student.method === 'approval' ? '老师同意加入' : '直接加入'}
        </span>
      </header>
      <div className="ccm-detail-body csv-body">
        {!state ? <GlassSkeletonRows rows={4} height={64} /> : null}
        {state?.error ? <p className="phone-page-error">{state.error}</p> : null}
        {detail?.student.answers.length ? (
          <dl className="csv-answers">
            {detail.student.answers.map((answer) => (
              <div key={answer.id}>
                <dt>{answer.label}</dt>
                <dd>{answer.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {detail && !insights ? (
          <p className="ccp-muted csv-private">私有课程不显示学生的做题和提问。</p>
        ) : null}
        {insights ? (
          <>
            <div className="csv-stats">
              <div>
                <small>做过的题</small>
                <strong>
                  {insights.attempted}
                  <em>道</em>
                </strong>
                <span>共提交 {insights.attemptCount} 次</span>
              </div>
              <div>
                <small>正确率</small>
                <strong>
                  {insights.accuracy === null ? '–' : Math.round(insights.accuracy * 100)}
                  {insights.accuracy === null ? null : <em>%</em>}
                </strong>
                <span className="csv-tube" aria-hidden>
                  <i style={{ width: `${Math.round((insights.accuracy ?? 0) * 100)}%` }} />
                </span>
              </div>
              <div>
                <small>最近活跃</small>
                <strong className="is-text">{ago(insights.lastActiveAt) || '还没有'}</strong>
                <span>通过 {insights.passed} 道</span>
              </div>
            </div>
            <div className="csv-columns">
              <section className="csv-card" aria-label="最近做题">
                <h3>最近做题</h3>
                {!insights.problems.length ? <p className="ccp-muted">还没有做过题。</p> : null}
                <ul className="csv-attempts">
                  {insights.problems.map((problem) => (
                    <StudentProblemAttempts
                      key={problem.id}
                      courseId={courseId}
                      studentId={student.userId}
                      problem={problem}
                      ago={ago}
                    />
                  ))}
                </ul>
              </section>
              <section className="csv-card" aria-label="最近提问">
                <h3>最近提问</h3>
                {!insights.questions.length ? (
                  <p className="ccp-muted">还没有在这门课里提问。</p>
                ) : null}
                <ul className="csv-questions">
                  {insights.questions.map((question) => (
                    <li key={question.id}>
                      <MessageCircleQuestion size={16} aria-hidden />
                      <div>
                        <p>{question.text}</p>
                        <small>
                          {question.conversationTitle} · {ago(question.createdAt)}
                        </small>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
