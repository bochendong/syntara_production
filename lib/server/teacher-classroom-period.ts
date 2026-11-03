export function currentAcademicPeriod(now = new Date()): {
  academicYear: number;
  academicTerm: 'winter' | 'summer' | 'fall';
} {
  const month = now.getMonth() + 1;
  return {
    academicYear: now.getFullYear(),
    academicTerm: month <= 4 ? 'winter' : month <= 8 ? 'summer' : 'fall',
  };
}
