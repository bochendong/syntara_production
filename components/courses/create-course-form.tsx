'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoursePurpose, CourseRecord } from '@/lib/utils/database';
import { createCourse, updateCourse } from '@/lib/utils/course-storage';
import { useAuthStore } from '@/lib/store/auth';
import { markCourseOwnedByUser } from '@/lib/utils/course-ownership';
import {
  COURSE_AVATAR_PRESET_URLS,
  pickRandomCourseAvatarUrl,
  resolveCourseAvatarDisplayUrl,
} from '@/lib/constants/course-avatars';
import { creditsFromPriceCents, priceCentsFromCredits } from '@/lib/utils/credits';
import { ChevronLeft, ChevronRight, Dices } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** 课程头像选图区：每页 3 行 × 7 列 */
const COURSE_AVATAR_GRID_COLS = 7;
const COURSE_AVATAR_GRID_ROWS = 3;
const COURSE_AVATAR_PAGE_SIZE = COURSE_AVATAR_GRID_COLS * COURSE_AVATAR_GRID_ROWS;

export function parseTags(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 非「教什么知识点」：学习阶段、人群、场景、形式与目标。
 */
export const COURSE_META_TAGS: string[] = [
  '入门',
  '零基础',
  '进阶',
  '期末冲刺',
  '考研备考',
  '考证',
  '自学',
  '在职学习',
  '转行',
  '兴趣向',
  '工作应用',
  '科研向',
  '短期突击',
  '长线系统',
  '重理论',
  '重实战',
  '刷题',
  '做项目',
  '读论文',
  '毕设季',
  '面试准备',
  '组会预读',
  '复盘巩固',
  '语言考试',
];

/** 学科 / 技能方向（知识点类） */
export const COURSE_TOPIC_TAGS: string[] = [
  '算法',
  '数据结构',
  '操作系统',
  '计算机网络',
  '数据库',
  'Python',
  'Java',
  'C++',
  '前端',
  '后端',
  '机器学习',
  '深度学习',
  '数据分析',
  '编程入门',
  '网络安全',
  '大语言模型',
  '计算机视觉',
  'NLP',
  '高等数学',
  '线性代数',
  '概率统计',
  '物理学',
  '化学',
  '生物学',
  '考研',
  '期末考试',
  '面试',
  '英语',
  '日语',
  '论文写作',
  '科研方法',
  '经济学',
  '金融学',
  '心理学',
  '法学',
  '历史学',
  '项目管理',
  '产品设计',
  '笔记整理',
  '临床医学',
  '艺术设计',
  '建筑',
];

/** 元信息 + 知识点（去重）；供外部或将来复用，输入区不再做联想下拉。 */
export const COMMON_COURSE_TAGS: string[] = Array.from(
  new Set([...COURSE_META_TAGS, ...COURSE_TOPIC_TAGS]),
);

function tagsBeforeLastComma(raw: string): string[] {
  const last = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('，'));
  const head = last === -1 ? '' : raw.slice(0, last + 1);
  return parseTags(head);
}

function applyTagSuggestion(prev: string, suggestion: string): string {
  const completed = tagsBeforeLastComma(prev);
  if (completed.includes(suggestion)) return prev;
  const next = [...completed, suggestion];
  return `${next.join(', ')}, `;
}

export const PURPOSE_OPTIONS: { value: CoursePurpose; label: string }[] = [
  { value: 'research', label: '科研' },
  { value: 'university', label: '大学课程' },
  { value: 'daily', label: '日常使用' },
];

const PURPOSE_OPTION_DESCRIPTIONS: Record<CoursePurpose, string> = {
  research: '默认你已掌握相关前置，可直接进入专题；偏论文、实验与科研语境。默认不带题库。',
  university:
    '更关注知识点是否吃透，讲解更细，并带题库。不默认你已会前置，会按课补上必要基础。可填学校、课号，便于和校内修课对应。',
  daily: '语气更轻松、好读。默认不带题库。适合自学、兴趣与日常轻量使用，不强调论文或正课排课感。',
};

const CREATE_STEPS = [
  { id: 'basic', label: '基本信息' },
  { id: 'purpose', label: '用途与语言' },
  { id: 'tags', label: 'Tag' },
  { id: 'avatar', label: '头像' },
] as const;

export function CreateCourseForm({
  onSuccess,
  className,
  editCourse,
}: {
  onSuccess: (courseId: string, course: CourseRecord) => void | Promise<void>;
  className?: string;
  /** 传入时为编辑模式，提交后更新该课程 */
  editCourse?: CourseRecord;
}) {
  const userId = useAuthStore((s) => s.userId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState<'zh-CN' | 'en-US'>('zh-CN');
  const [tagsRaw, setTagsRaw] = useState('');
  const [purpose, setPurpose] = useState<CoursePurpose>('daily');
  const [university, setUniversity] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [coursePrice, setCoursePrice] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [avatarPage, setAvatarPage] = useState(0);
  const publishLockedByPurchase = Boolean(editCourse?.sourceCourseId);
  const isCreateStepper = !editCourse;

  useEffect(() => {
    if (!editCourse) return;
    setName(editCourse.name);
    setDescription(editCourse.description ?? '');
    setLanguage(editCourse.language);
    setTagsRaw(editCourse.tags.join(', '));
    setPurpose(editCourse.purpose);
    setUniversity(editCourse.university ?? '');
    setCourseCode(editCourse.courseCode ?? '');
    setAvatarUrl(editCourse.avatarUrl ?? '');
    setCoursePrice(String(creditsFromPriceCents(editCourse.coursePriceCents ?? 0)));
    setError(null);
  }, [editCourse]);

  const courseAvatarPageCount = Math.max(
    1,
    Math.ceil(COURSE_AVATAR_PRESET_URLS.length / COURSE_AVATAR_PAGE_SIZE),
  );

  useEffect(() => {
    setAvatarPage(0);
  }, [editCourse?.id]);

  const tagInputRef = useRef<HTMLInputElement>(null);
  const existingTagSet = useMemo(() => new Set(parseTags(tagsRaw)), [tagsRaw]);
  const quickMetaTags = useMemo(
    () => COURSE_META_TAGS.filter((t) => !existingTagSet.has(t)).slice(0, 12),
    [existingTagSet],
  );
  const quickTopicTags = useMemo(
    () => COURSE_TOPIC_TAGS.filter((t) => !existingTagSet.has(t)).slice(0, 12),
    [existingTagSet],
  );

  const avatarUrlsOnPage = useMemo(() => {
    const start = avatarPage * COURSE_AVATAR_PAGE_SIZE;
    return COURSE_AVATAR_PRESET_URLS.slice(start, start + COURSE_AVATAR_PAGE_SIZE);
  }, [avatarPage]);

  const pickTag = useCallback((tag: string) => {
    setTagsRaw((p) => applyTagSuggestion(p, tag));
    queueMicrotask(() => tagInputRef.current?.focus());
  }, []);

  const applyRandomCourseAvatar = useCallback(() => {
    const url = pickRandomCourseAvatarUrl();
    setAvatarUrl(url);
    const idx = COURSE_AVATAR_PRESET_URLS.indexOf(url);
    if (idx >= 0) {
      setAvatarPage(Math.floor(idx / COURSE_AVATAR_PAGE_SIZE));
    }
  }, []);

  const goBack = () => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const goNext = () => {
    setError(null);
    if (step === 0 && !name.trim()) {
      setError('请填写课程名称');
      return;
    }
    if (step === 2) setAvatarPage(0);
    setStep((s) => Math.min(CREATE_STEPS.length - 1, s + 1));
  };

  const coursePriceCents = priceCentsFromCredits(
    Math.max(0, Number.parseInt(coursePrice || '0', 10) || 0),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('请填写课程名称');
      return;
    }
    if (!editCourse && !avatarUrl.trim()) {
      setError('请选择课程头像');
      setStep(3);
      return;
    }
    setSubmitting(true);
    try {
      if (editCourse) {
        const course = await updateCourse(editCourse.id, {
          name: trimmedName,
          description: description.trim(),
          language,
          tags: parseTags(tagsRaw),
          purpose,
          university: purpose === 'university' ? university : undefined,
          courseCode: purpose === 'university' ? courseCode : undefined,
          avatarUrl,
          coursePriceCents,
        });
        await onSuccess(course.id, course);
      } else {
        const course = await createCourse({
          name: trimmedName,
          description: description.trim(),
          language,
          tags: parseTags(tagsRaw),
          purpose,
          university: purpose === 'university' ? university : undefined,
          courseCode: purpose === 'university' ? courseCode : undefined,
          avatarUrl,
          coursePriceCents,
        });
        if (userId) markCourseOwnedByUser(userId, course.id);
        await onSuccess(course.id, course);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : editCourse ? '保存失败' : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-violet-500/0 transition-[box-shadow,border-color] focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 dark:border-white/15 dark:bg-white/5 dark:text-white';

  const fieldsStepBasic = (
    <div className="space-y-5">
      <div>
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          课程名称 <span className="text-red-500">*</span>
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="例如：算法设计"
          maxLength={120}
        />
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">课程描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className={cn(inputClass, 'resize-none')}
          placeholder="简要说明这门课学什么、面向谁…"
          maxLength={2000}
        />
        <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-600 dark:text-slate-300">参与生成：</span>
          上面填写的<strong className="font-medium">课程名称</strong>
          会作为这门课的固定标识，随课程上下文一起交给生成流程，用于概括「教什么」、命名与区分各笔记本。
          <strong className="font-medium">课程描述</strong>
          会作为课程级说明写入同一上下文，帮助在生成笔记本大纲、知识点切分与讲师/智能体人设时，对齐范围、难度与表述；与后面选择的「用途」、语言等共同影响提示，而不是仅做展示。
        </p>
      </div>
    </div>
  );

  const fieldsStepPurpose = (
    <div className="space-y-5">
      <div>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">用途</span>
        <div className="mt-2 flex flex-wrap gap-2">
          {PURPOSE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPurpose(opt.value)}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-sm transition-colors',
                purpose === opt.value
                  ? 'border-violet-500 bg-violet-500/10 text-violet-800 dark:text-violet-200'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/5',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-2 rounded-xl border border-slate-200/90 bg-slate-50/70 px-3 py-2.5 text-xs leading-relaxed text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400">
          {PURPOSE_OPTIONS.map((opt) => (
            <p key={opt.value}>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {opt.label}：
              </span>
              {PURPOSE_OPTION_DESCRIPTIONS[opt.value]}
            </p>
          ))}
        </div>
      </div>
      <div>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">语言</span>
        <div className="mt-2 flex gap-2">
          {(
            [
              { v: 'zh-CN' as const, l: '中文' },
              { v: 'en-US' as const, l: 'English' },
            ] as const
          ).map(({ v, l }) => (
            <button
              key={v}
              type="button"
              onClick={() => setLanguage(v)}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-sm transition-colors',
                language === v
                  ? 'border-violet-500 bg-violet-500/10 text-violet-800 dark:text-violet-200'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/5',
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {purpose === 'university' && (
        <div className="space-y-4 rounded-xl border border-dashed border-slate-200 p-4 dark:border-white/15">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              学校 / 大学
            </label>
            <input
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
              className={inputClass}
              placeholder="选填"
              maxLength={120}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">课号</label>
            <input
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              className={inputClass}
              placeholder="选填，例如 CSC373"
              maxLength={40}
            />
          </div>
        </div>
      )}
    </div>
  );

  const fieldsStepTags = (
    <div className="space-y-0">
      <label
        className="text-sm font-medium text-slate-700 dark:text-slate-200"
        htmlFor="course-tags-input"
      >
        Tag
      </label>
      <input
        ref={tagInputRef}
        id="course-tags-input"
        type="text"
        autoComplete="off"
        value={tagsRaw}
        onChange={(e) => setTagsRaw(e.target.value)}
        className={inputClass}
        placeholder="可混用：阶段（入门）、场景（在职）、方向（Python）等，逗号分隔"
      />
      {quickMetaTags.length > 0 ? (
        <div className="mt-2">
          <p className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            阶段与场景
          </p>
          <div className="flex flex-wrap gap-1.5">
            {quickMetaTags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => pickTag(t)}
                className="rounded-lg border border-slate-200/90 bg-slate-50/80 px-2 py-0.5 text-[11px] text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-50/80 hover:text-violet-900 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:border-violet-500/40 dark:hover:bg-violet-950/40 dark:hover:text-violet-200"
              >
                + {t}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {quickTopicTags.length > 0 ? (
        <div className="mt-2">
          <p className="mb-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            内容与方向
          </p>
          <div className="flex flex-wrap gap-1.5">
            {quickTopicTags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => pickTag(t)}
                className="rounded-lg border border-slate-200/90 bg-slate-50/80 px-2 py-0.5 text-[11px] text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-50/80 hover:text-violet-900 dark:border-white/15 dark:bg-white/5 dark:text-slate-300 dark:hover:border-violet-500/40 dark:hover:bg-violet-950/40 dark:hover:text-violet-200"
              >
                + {t}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  const showCreateAvatarEmpty = isCreateStepper && !avatarUrl.trim();
  const fieldsStepAvatar = (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-white/15 dark:bg-white/[0.04]">
      <div className="flex items-center gap-3">
        {showCreateAvatarEmpty ? (
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 text-sm font-medium text-slate-400 dark:border-white/20 dark:bg-white/5 dark:text-slate-500"
            aria-hidden
          >
            ···
          </div>
        ) : (
          <img
            src={resolveCourseAvatarDisplayUrl(editCourse?.id, avatarUrl)}
            alt=""
            className="size-14 rounded-2xl border border-slate-200/80 bg-white object-cover shadow-sm dark:border-white/15 dark:bg-slate-900"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">课程头像</p>
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {showCreateAvatarEmpty
              ? '请从下方点选一张头像后再创建课程。'
              : '课程卡片、课程主页和课程总控都会使用这张头像。'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 px-2.5 text-xs"
          onClick={applyRandomCourseAvatar}
        >
          <Dices className="size-3.5" aria-hidden />
          随机
        </Button>
      </div>
      {courseAvatarPageCount > 1 ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            第 {avatarPage + 1} / {courseAvatarPageCount} 页
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              disabled={avatarPage <= 0}
              onClick={() => setAvatarPage((p) => Math.max(0, p - 1))}
              aria-label="上一页头像"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2"
              disabled={avatarPage >= courseAvatarPageCount - 1}
              onClick={() => setAvatarPage((p) => Math.min(courseAvatarPageCount - 1, p + 1))}
              aria-label="下一页头像"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
      <div className="grid w-full grid-cols-7 gap-2" aria-label="课程头像池">
        {avatarUrlsOnPage.map((url) => {
          const active = avatarUrl === url;
          return (
            <button
              key={url}
              type="button"
              onClick={() => setAvatarUrl(url)}
              className={cn(
                'overflow-hidden rounded-2xl border-2 bg-white transition-all dark:bg-slate-900',
                active
                  ? 'border-violet-500 ring-2 ring-violet-200 dark:ring-violet-500/30'
                  : 'border-transparent hover:border-slate-200 dark:hover:border-white/15',
              )}
              aria-label="选择课程头像"
            >
              <img src={url} alt="" className="aspect-square w-full object-cover" />
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <form
      onSubmit={handleSubmit}
      className={cn('space-y-5', className)}
      aria-label={isCreateStepper ? '分步创建课程' : '编辑课程'}
    >
      {isCreateStepper ? (
        <>
          <nav aria-label="创建步骤" className="pb-1">
            <ol className="grid grid-cols-4 gap-1 sm:gap-2">
              {CREATE_STEPS.map((meta, i) => {
                const done = i < step;
                const current = i === step;
                return (
                  <li key={meta.id} className="flex min-w-0 flex-col items-center text-center">
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        current && 'bg-slate-900 text-white dark:bg-white dark:text-slate-900',
                        !current && done && 'bg-violet-500/20 text-violet-800 dark:text-violet-200',
                        !current &&
                          !done &&
                          'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400',
                      )}
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    <span
                      className={cn(
                        'mt-1 line-clamp-2 text-[10px] font-medium leading-tight sm:text-xs',
                        current ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {meta.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>

          {step === 0 ? fieldsStepBasic : null}
          {step === 1 ? fieldsStepPurpose : null}
          {step === 2 ? fieldsStepTags : null}
          {step === 3 ? fieldsStepAvatar : null}
        </>
      ) : (
        <>
          {fieldsStepBasic}
          {fieldsStepTags}
          {fieldsStepPurpose}
          {fieldsStepAvatar}
        </>
      )}

      {editCourse ? (
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">课程价格</label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              value={coursePrice}
              onChange={(e) => setCoursePrice(e.target.value.replace(/[^\d]/g, ''))}
              disabled={publishLockedByPurchase}
              className={inputClass}
              placeholder="0"
              inputMode="numeric"
            />
            <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">积分</span>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            设为 0 表示免费。现在按 100 credits = 1 USD 换算，所以 500 credits 就是 5 美元。
            课程价格用于整门课购买；发布课程会连带发布其下笔记本。
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {isCreateStepper ? (
        <div
          className={cn(
            'flex flex-col gap-2 min-[400px]:flex-row min-[400px]:items-stretch',
            step === 0 ? 'min-[400px]:justify-end' : 'min-[400px]:justify-between',
          )}
        >
          {step > 0 ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full min-[400px]:w-auto min-[400px]:min-w-[6.5rem]"
              onClick={goBack}
            >
              上一步
            </Button>
          ) : null}
          {step < 3 ? (
            <Button
              type="button"
              className="h-11 w-full min-[400px]:w-auto min-[400px]:min-w-[6.5rem] min-[400px]:shrink-0"
              onClick={goNext}
            >
              下一步
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={submitting || !avatarUrl.trim()}
              className="h-11 w-full min-[400px]:ml-auto min-[400px]:min-w-[7.5rem] min-[400px]:flex-1"
            >
              {submitting ? '创建中…' : '创建课程'}
            </Button>
          )}
        </div>
      ) : (
        <Button
          type="submit"
          disabled={submitting}
          className="h-11 w-full rounded-xl bg-slate-900 text-white hover:opacity-90 dark:bg-white dark:text-slate-900"
        >
          {submitting ? '保存中…' : '保存更改'}
        </Button>
      )}
    </form>
  );
}
