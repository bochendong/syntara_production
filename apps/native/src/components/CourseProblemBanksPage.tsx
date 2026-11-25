import { useEffect, useState, type CSSProperties } from 'react';
import { loadBankStats, type BankStats } from '../data/problem-bank-stats';
import { ChevronRight } from 'lucide-react';
import { profileThemeForAvatar, resolveNativeCourseAvatar } from '../assets';
import type { LocalCourseSummary } from '../domain/models';
import { readPlatformCourseMeta } from '../lib/platform-course-meta';
import { PhoneEmpty, PhonePage } from './PhonePages';
import './teach-page.css';
import './course-problem-banks.css';

export function CourseProblemBanksPage({
  courses,
  onOpenCourse,
  onBack,
}: {
  courses: LocalCourseSummary[];
  onOpenCourse: (id: string) => void;
  onBack: () => void;
}) {
  const meta = readPlatformCourseMeta();
  const [results, setResults] = useState<Record<string, BankStats | null>>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => setRetry((value) => value + 1);
    window.addEventListener('syntara:problem-progress', refresh);
    void Promise.all(
      courses.map(async ({ id }) => {
        const stats = await loadBankStats(id).catch(() => null);
        return [id, stats] as const;
      }),
    ).then((entries) => {
      if (active) setResults(Object.fromEntries(entries));
    });
    return () => {
      active = false;
      window.removeEventListener('syntara:problem-progress', refresh);
    };
  }, [courses, retry]);
  const stats = courses.map((course) => results[course.id]);
  const total = stats.every((s): s is BankStats => Boolean(s))
    ? stats.reduce(
        (sum, s) => ({ total: sum.total + s.total, attempted: sum.attempted + s.attempted }),
        { total: 0, attempted: 0 },
      )
    : null;
  return (
    <PhonePage title="题库" overlay largeTitle onBack={onBack}>
      <div className="tp-page">
        <header className="phone-large-head tp-head tp-teaching-head">
          <h1>题库</h1>
        </header>
        <div className="tp-courses-heading">
          <h2>我的课程</h2>
          <span className="bank-course-summary">
            {courses.length} 门课程
            {total && ` · 共 ${total.total} 道题 · 已刷 ${total.attempted} 道`}
            {stats.includes(null) && (
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                重试统计
              </button>
            )}
          </span>
        </div>
        {courses.length ? (
          <div className="tp-course-grid">
            {courses.map((course) => {
              const counts = results[course.id];
              const avatar = resolveNativeCourseAvatar(
                course.id,
                course.courseCode,
                meta[course.id]?.avatarUrl,
              );
              const scene = profileThemeForAvatar(avatar)?.backgroundUrl;
              return (
                <article
                  key={course.id}
                  className={`tp-course-card bank-course-card${scene ? ' has-course-scene' : ''}`}
                  style={
                    scene
                      ? ({ '--tp-card-scene': `url(${JSON.stringify(scene)})` } as CSSProperties)
                      : undefined
                  }
                >
                  <div className="tp-course-card-head">
                    <img className="tp-course-marble" src={avatar} alt="" />
                    <strong>{course.name}</strong>
                  </div>
                  <div className="bank-course-footer">
                    <span className="bank-course-counts" id={`bank-count-${course.id}`}>
                      {counts ? (
                        <>
                          <span>
                            共 <b>{counts.total}</b> 道题
                          </span>
                          <span>
                            已刷 <b>{counts.attempted}</b> 道
                          </span>
                        </>
                      ) : counts === null ? (
                        '统计暂不可用'
                      ) : (
                        '正在读取题数…'
                      )}
                    </span>
                    <button
                      type="button"
                      className="tp-course-card-open bank-course-open"
                      onClick={() => onOpenCourse(course.id)}
                      aria-label={`进入 ${course.name} 题库`}
                      aria-describedby={`bank-count-${course.id}`}
                    >
                      进入题库
                      <ChevronRight size={16} aria-hidden />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <PhoneEmpty title="暂无课程" hint="添加课程后，可以在这里打开题库。" />
        )}
      </div>
    </PhonePage>
  );
}
