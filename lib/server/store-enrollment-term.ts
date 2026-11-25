import { currentAcademicPeriod } from './teacher-classroom-period';

const TERM_LABELS = { winter: '冬季', summer: '夏季', fall: '秋季' } as const;
const TERM_ORDER = { winter: 0, summer: 1, fall: 2 } as const;
export const storeEnrollmentTerm = (date: Date) => {
  const { academicYear: year, academicTerm: term } = currentAcademicPeriod(date);
  return {
    key: `${year}-${term}`,
    label: `${year} ${TERM_LABELS[term]}`,
    sort: year * 10 + TERM_ORDER[term],
  };
};
/** 学生都从商城加入：直接加入（store）或老师批准（approval）。 */
export const STORE_SOURCES = ['store', 'approval'];
export function currentStoreEnrollmentWindow(now: Date) {
  const startMonth = Math.floor(now.getMonth() / 4) * 4;
  return {
    label: storeEnrollmentTerm(now).label,
    start: new Date(now.getFullYear(), startMonth, 1),
    end: new Date(now.getFullYear(), startMonth + 4, 1),
  };
}
