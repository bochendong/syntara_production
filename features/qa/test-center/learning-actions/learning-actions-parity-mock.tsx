'use client';

import {
  LearnLearningActionCards,
  MiniLectureInviteCard,
  PlanActionCard,
} from '@/components/learn/learn-page-client';
import type { MiniLecturePrompt } from '@/features/learn-core/client-mini-lecture';
import type { PracticePlan } from '@/lib/learning/course-learner-state';
import type { LearningAction } from '@/lib/types/chat';

const lecturePrompt = {
  id: 'qa-lecture',
  title: '换元积分的判断与应用',
  question: '什么时候应该使用换元法？',
  answer: '先寻找复合函数结构，再检查内层函数的导数是否同时出现。',
  courseName: 'Calculus II',
  createdAt: 0,
} satisfies MiniLecturePrompt;

const plan = {
  id: 'qa-plan',
  courseId: 'qa-course',
  title: '换元积分巩固练习',
  mode: 'practice',
  problemIds: ['qa-problem-1', 'qa-problem-2'],
  questions: [
    { problemId: 'qa-problem-1', title: '识别换元结构', reason: '先确认内外函数关系' },
    { problemId: 'qa-problem-2', title: '完成定积分换元', reason: '练习同步替换上下限' },
  ],
  targetConcepts: ['换元法', '复合函数', '定积分'],
  estimatedMinutes: 12,
  difficultyMix: { easy: 1, medium: 1, hard: 0 },
  evidence: {
    gaps: [],
    items: [],
  },
} as unknown as PracticePlan;

const learningActions = [
  {
    id: 'qa-action-1',
    kind: 'memory.propose_write',
    label: '记录本次学习状态',
    summary: '已经能识别换元结构，下一步练习同步替换积分上下限。',
    status: 'pending',
    confirmation: 'required',
    payload: {
      knowledgePoint: '换元积分',
      masteredSignal: '能够识别内外函数关系',
      nextTeachingMove: '练习定积分上下限同步替换',
    },
    evidence: [],
  },
] as unknown as LearningAction[];

export function LearningActionsParityMock() {
  return (
    <main className="min-h-screen bg-[#f5f5f5] p-6 text-slate-950">
      <div className="mx-auto grid max-w-[620px] gap-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-3 text-xs font-semibold text-slate-500">课堂讲解</p>
          <MiniLectureInviteCard
            prompt={lecturePrompt}
            generating={false}
            onGenerate={() => undefined}
            onOpen={() => undefined}
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-3 text-xs font-semibold text-slate-500">练习计划</p>
          <PlanActionCard
            plan={plan}
            problemsState={{
              courseId: 'qa-course',
              status: 'ready',
              error: null,
              usingCachedData: false,
            }}
            onStart={() => undefined}
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-3 text-xs font-semibold text-slate-500">学习动作</p>
          <LearnLearningActionCards
            actions={learningActions}
            onConfirm={() => undefined}
            onCancel={() => undefined}
          />
        </section>
      </div>
    </main>
  );
}
