export type BankComparisonGroup = 'chapters' | 'sets' | 'exam' | 'mock';

export type ComparisonMetric = {
  me: number | null;
  median: number | null;
  lower: number | null;
  upper: number | null;
};

export interface BankComparison {
  group: BankComparisonGroup;
  scope: 'store-term';
  peerCount: number;
  termLabel: string;
  enrollmentCount: number;
  coverage: ComparisonMetric;
  firstTry: ComparisonMetric;
  topics: { name: string; firstTry: ComparisonMetric }[];
}
