/** A milestone counts distinct newly passed questions in this practice session. */
export const PRACTICE_MILESTONE_SIZE = 5;

export function createPracticeMilestones() {
  const passedIds = new Set<string>();
  return {
    record(problemId: string, previousStatus: string | undefined, status: string) {
      if (status !== 'passed' || previousStatus === 'passed' || passedIds.has(problemId))
        return null;
      passedIds.add(problemId);
      return passedIds.size % PRACTICE_MILESTONE_SIZE === 0 ? passedIds.size : null;
    },
  };
}
