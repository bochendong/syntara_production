import type { SceneOutline } from '@/lib/types/generation';

type WorkedExampleConfig = NonNullable<SceneOutline['workedExampleConfig']>;

export function getWorkedExampleLabels(
  language: 'zh-CN' | 'en-US',
  role: WorkedExampleConfig['role'],
): Record<string, string> {
  const roleLabels =
    language === 'zh-CN'
      ? {
          problem_statement: '题目展示',
          givens_and_goal: '已知与目标',
          constraints: '约束条件',
          solution_plan: '解题思路',
          walkthrough: '分步讲解',
          pitfalls: '易错点',
          summary: '总结收束',
        }
      : {
          problem_statement: 'Problem Statement',
          givens_and_goal: 'Givens and Goal',
          constraints: 'Constraints',
          solution_plan: 'Solution Plan',
          walkthrough: 'Step-by-Step Walkthrough',
          pitfalls: 'Common Pitfalls',
          summary: 'Summary',
        };

  return language === 'zh-CN'
    ? {
        stage: roleLabels[role],
        question: '题目',
        givens: '已知',
        asks: '所求',
        constraints: '约束',
        plan: '思路',
        steps: '步骤',
        pitfalls: '易错点',
        answer: '结论',
        reminder: '题目提醒',
        keyIdea: '关键点',
        correction: '提醒',
        part: '第',
        visual: '图示',
        referenceVisual: '参考图',
        generatedVisual: 'AI 图示',
      }
    : {
        stage: roleLabels[role],
        question: 'Question',
        givens: 'Given',
        asks: 'Find',
        constraints: 'Constraints',
        plan: 'Plan',
        steps: 'Steps',
        pitfalls: 'Pitfalls',
        answer: 'Answer',
        reminder: 'Problem Reminder',
        keyIdea: 'Key Idea',
        correction: 'Watch Out',
        part: 'Part',
        visual: 'Visual',
        referenceVisual: 'Reference Visual',
        generatedVisual: 'AI Visual',
      };
}
