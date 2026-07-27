import { motion } from 'motion/react';
import { CheckCircle2, Flame, Gift, Heart, ShieldCheck, Sparkles, WandSparkles, XCircle } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { cn } from '@/lib/utils';
import type { QuizQuestion } from '@/lib/types/stage';
import type { GamificationEventResponse } from '@/lib/types/gamification';
import {
  LEARNING_CARD_DEFINITIONS,
  MENTOR_LEARNING_CARD_PRIORITY,
  type LearningCardDefinition,
  type LearningCardId,
  type LearningRunState,
  type LearningRunSummary,
} from '@/lib/learning/quiz-roguelike';
import type { Live2DPresenterModelId } from '@/lib/live2d/presenter-models';
import { LIVE2D_PRESENTER_MODELS } from '@/lib/live2d/presenter-models';
import { LIVE2D_PRESENTER_PERSONAS } from '@/lib/live2d/presenter-personas';
import { TalkingAvatarOverlay } from '@/components/canvas/talking-avatar-overlay';
import type { QuestionResult } from './quiz-view-utils';
import { isObjectiveQuestion, isTextQuestion } from './quiz-view-utils';

type Phase = 'not_started' | 'answering' | 'grading' | 'reviewing';

export function ScoreBanner({
  score,
  total,
  results,
}: {
  score: number;
  total: number;
  results: QuestionResult[];
}) {
  const { t } = useI18n();
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const correctCount = results.filter((r) => r.status === 'correct').length;
  const incorrectCount = results.filter((r) => r.status === 'incorrect').length;
  const color = pct >= 80 ? 'emerald' : pct >= 60 ? 'amber' : 'red';
  const colorMap = {
    emerald: {
      bg: 'from-emerald-500 to-teal-500',
      shadow: 'shadow-emerald-200/50 dark:shadow-emerald-900/50',
      text: t('quiz.excellent'),
    },
    amber: {
      bg: 'from-amber-500 to-yellow-500',
      shadow: 'shadow-amber-200/50 dark:shadow-amber-900/50',
      text: t('quiz.keepGoing'),
    },
    red: {
      bg: 'from-red-500 to-rose-500',
      shadow: 'shadow-red-200/50 dark:shadow-red-900/50',
      text: t('quiz.needsReview'),
    },
  };
  const c = colorMap[color];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn('rounded-2xl p-6 bg-gradient-to-r text-white shadow-lg', c.bg, c.shadow)}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/80 text-sm font-medium">{c.text}</p>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-black">{score}</span>
            <span className="text-white/60 text-lg">/ {total}</span>
          </div>
          <div className="flex gap-3 mt-3 text-xs">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {correctCount} {t('quiz.correct')}
            </span>
            <span className="flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" /> {incorrectCount} {t('quiz.incorrect')}
            </span>
          </div>
        </div>
        <div className="relative w-20 h-20">
          <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="6"
            />
            <motion.circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="white"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 34}`}
              initial={{ strokeDashoffset: 2 * Math.PI * 34 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 34 * (1 - pct / 100) }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-lg font-black">{pct}%</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function GamificationRewardBanner({ reward }: { reward: GamificationEventResponse | null }) {
  if (!reward || (!reward.rewardedPurchaseCredits && !reward.rewardedAffinity)) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-amber-200/70 bg-gradient-to-r from-amber-50 via-white to-rose-50 p-4 dark:border-amber-500/20 dark:from-amber-950/20 dark:via-slate-900 dark:to-rose-950/20"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-4 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {reward.characterName} 把这次进度帮你记下来了
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {reward.rewardedPurchaseCredits > 0
              ? `+${reward.rewardedPurchaseCredits} 购买积分`
              : '已记录'}
            {reward.rewardedAffinity > 0 ? ` · +${reward.rewardedAffinity} 亲密度` : ''}
          </p>
        </div>
        <div className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-amber-700 shadow-sm dark:bg-slate-900/80 dark:text-amber-200">
          Lv{reward.affinityLevel}
        </div>
      </div>
    </motion.div>
  );
}

function learningCardRarityClass(rarity: LearningCardDefinition['rarity']): string {
  switch (rarity) {
    case 'rare':
      return 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100';
    case 'advanced':
      return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-400/25 dark:bg-fuchsia-400/10 dark:text-fuchsia-100';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-100';
  }
}

function getCompanionStatusLine(args: {
  modelId: Live2DPresenterModelId;
  phase: Phase;
  answeredCount: number;
  totalCount: number;
  currentQuestion?: QuizQuestion;
  run: LearningRunState | null;
  summary?: LearningRunSummary | null;
}): string {
  const persona = LIVE2D_PRESENTER_PERSONAS[args.modelId];
  if (args.summary) {
    return `这局答对 ${args.summary.correctCount} 题，最高连胜 ${args.summary.longestStreak}。解析看完后，我们再把下一关接上。`;
  }
  if (args.phase === 'not_started') return '准备好了就开始这一关，我会在旁边帮你盯住节奏。';
  if (args.phase === 'grading') return '我正在帮你整理这轮答案，先别急着切走。';
  if (args.phase === 'reviewing') return '结果已经出来了，先看错因，再决定要不要重试。';
  if (args.run?.usedCards.length) {
    const lastCard = args.run.usedCards[args.run.usedCards.length - 1];
    const card = lastCard ? LEARNING_CARD_DEFINITIONS[lastCard] : null;
    if (card) return card.teacherLine;
  }
  if (args.currentQuestion) {
    return `第 ${Math.min(args.answeredCount + 1, args.totalCount)} 题我在旁边看着。先稳住题干，再动手。`;
  }
  return persona.bondLine;
}

export function LearningCompanionPanel({
  run,
  currentQuestion,
  summary,
  modelId,
  phase,
  answeredCount,
  totalCount,
  onUseCard,
  fullHeight = false,
}: {
  run: LearningRunState | null;
  currentQuestion?: QuizQuestion;
  summary?: LearningRunSummary | null;
  modelId: Live2DPresenterModelId;
  phase: Phase;
  answeredCount: number;
  totalCount: number;
  onUseCard: (cardId: LearningCardId) => void;
  fullHeight?: boolean;
}) {
  const model = LIVE2D_PRESENTER_MODELS[modelId];
  const persona = LIVE2D_PRESENTER_PERSONAS[modelId];
  const priorityCards = MENTOR_LEARNING_CARD_PRIORITY[modelId]
    .slice(0, 4)
    .map((cardId) => LEARNING_CARD_DEFINITIONS[cardId])
    .filter(Boolean);
  const usableCards = run?.hand.filter((cardId) => !run.usedCards.includes(cardId)) ?? [];
  const usedCards = run?.hand.filter((cardId) => run.usedCards.includes(cardId)) ?? [];
  const companionLine = getCompanionStatusLine({
    modelId,
    phase,
    answeredCount,
    totalCount,
    currentQuestion,
    run,
    summary,
  });
  return (
    <aside
      className={cn(
        'flex h-full min-h-[560px] flex-col overflow-hidden border border-rose-100/80 bg-white/90 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/85 lg:min-h-0',
        fullHeight ? 'rounded-none border-y-0 border-r-0' : 'rounded-3xl',
      )}
    >
      <div className="relative h-64 shrink-0 overflow-hidden border-b border-rose-100 bg-[radial-gradient(circle_at_50%_20%,rgba(251,207,232,0.72),transparent_45%),linear-gradient(180deg,#fff7fb,#eff6ff)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_50%_20%,rgba(244,114,182,0.2),transparent_45%),linear-gradient(180deg,#0f172a,#020617)]">
        <div className="absolute left-4 top-4 z-10 rounded-full border border-white/70 bg-white/80 px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm backdrop-blur dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100">
          {model.badgeLabel} · 导师陪伴
        </div>
        <TalkingAvatarOverlay
          speaking={phase === 'grading'}
          speechText={companionLine}
          cadence={phase === 'answering' ? 'active' : phase === 'grading' ? 'fallback' : 'pause'}
          layout="card"
          cardFraming="half"
          modelIdOverride={modelId}
          showBadge={false}
          showStatusDot={false}
          className="absolute inset-x-0 bottom-0 h-full"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="rounded-2xl border border-rose-100 bg-rose-50/80 p-3 text-sm leading-6 text-rose-900 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-100">
          <div className="mb-1 flex items-center gap-2 text-xs font-black opacity-70">
            <Heart className="h-3.5 w-3.5" />
            导师提示
          </div>
          {companionLine}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/5">
            <p className="text-[11px] font-black text-slate-500 dark:text-slate-400">本局进度</p>
            <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">
              {answeredCount}/{totalCount}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/5">
            <p className="text-[11px] font-black text-slate-500 dark:text-slate-400">
              {summary ? '结算倍率' : '豁免次数'}
            </p>
            <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">
              {summary ? `x${summary.finalMultiplier}` : run ? run.mistakeShield : 0}
            </p>
          </div>
        </div>

        {summary ? (
          <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
            <Gift className="h-3.5 w-3.5" />
            预览奖励 {summary.rewardPreview}
          </div>
        ) : null}

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-black text-slate-500 dark:text-slate-400">
              <WandSparkles className="h-3.5 w-3.5" />
              导师卡组
            </p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-slate-400">
              {persona.personalityTags[2] ?? '陪伴型'}
            </span>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {priorityCards.map((card) => (
              <span
                key={card.id}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-bold',
                  learningCardRarityClass(card.rarity),
                )}
              >
                {card.name}
              </span>
            ))}
          </div>
          <div className="grid gap-2">
            {usableCards.map((cardId) => {
              const card = LEARNING_CARD_DEFINITIONS[cardId];
              const disabled =
                !currentQuestion ||
                (card.effect === 'eliminateOption' && !isObjectiveQuestion(currentQuestion)) ||
                (card.effect === 'rubricPeek' && !isTextQuestion(currentQuestion));
              return (
                <button
                  key={cardId}
                  type="button"
                  disabled={disabled || phase !== 'answering'}
                  onClick={() => onUseCard(cardId)}
                  title={card.description}
                  className={cn(
                    'rounded-2xl border p-3 text-left text-xs transition-all',
                    disabled || phase !== 'answering'
                      ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
                      : 'border-rose-200 bg-white text-slate-700 shadow-sm hover:-translate-y-0.5 hover:border-rose-300 hover:text-rose-700 dark:border-rose-500/20 dark:bg-slate-950 dark:text-slate-200 dark:hover:text-rose-200',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-black">{card.name}</span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-bold',
                        learningCardRarityClass(card.rarity),
                      )}
                    >
                      {card.rarity}
                    </span>
                  </span>
                  <span className="mt-1 block leading-5 opacity-75">{card.description}</span>
                </button>
              );
            })}
            {usableCards.length === 0 ? (
              <span className="rounded-2xl border border-dashed border-slate-200 px-3 py-3 text-xs leading-5 text-slate-400 dark:border-slate-700">
                本局手牌已用完，先靠自己打完这一关。
              </span>
            ) : null}
          </div>
        </div>

        {usedCards.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-black text-slate-500 dark:text-slate-400">已使用</p>
            <div className="flex flex-wrap gap-1.5">
              {usedCards.map((cardId) => {
                const card = LEARNING_CARD_DEFINITIONS[cardId];
                return (
                  <span
                    key={cardId}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
                  >
                    {card.name}
                  </span>
                );
              })}
            </div>
          </div>
        ) : null}

        {!run ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-xs leading-5 text-slate-500 dark:border-white/10 dark:text-slate-400">
            开始答题后，这里会显示本局手牌、导师提示和临时遗物效果。
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function LearningAssistPanels({
  question,
  run,
}: {
  question: QuizQuestion;
  run: LearningRunState | null;
}) {
  if (!run) return null;
  const hint = run.hints[question.id];
  const rubric = run.rubricPeeks[question.id];
  if (!hint && !rubric) return null;
  return (
    <div className="space-y-2">
      {hint ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/20 dark:bg-rose-950/20 dark:text-rose-100">
          <span className="font-semibold">撒娇提示：</span>
          {hint}
        </div>
      ) : null}
      {rubric ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-500/20 dark:bg-sky-950/20 dark:text-sky-100">
          <span className="font-semibold">偷看一眼：</span>
          {rubric}
        </div>
      ) : null}
    </div>
  );
}

export function LearningRunSummaryBanner({
  summary,
  unlockedCards,
}: {
  summary: LearningRunSummary | null;
  unlockedCards: LearningCardDefinition[];
}) {
  if (!summary) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-rose-200/70 bg-gradient-to-r from-rose-50 via-white to-sky-50 p-4 dark:border-rose-500/20 dark:from-rose-950/20 dark:via-slate-900 dark:to-sky-950/20"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-slate-950">
          <Flame className="h-3.5 w-3.5 text-orange-300" />
          最终倍率 x{summary.finalMultiplier}
        </div>
        <div className="flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-100">
          <ShieldCheck className="h-3.5 w-3.5" />
          豁免 {summary.forgivenMistakes} 次
        </div>
        <div className="flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-100">
          <Gift className="h-3.5 w-3.5" />
          局内奖励预览 {summary.rewardPreview}
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
        这局的临时卡牌已经结算啦；局外解锁会保留到你的卡池里，下一局能抽到更强的牌。
      </p>
      {unlockedCards.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {unlockedCards.map((card) => (
            <span
              key={card.id}
              className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1 text-xs font-semibold text-fuchsia-700 dark:border-fuchsia-400/20 dark:bg-fuchsia-400/10 dark:text-fuchsia-100"
            >
              新解锁：{card.name}
            </span>
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}
