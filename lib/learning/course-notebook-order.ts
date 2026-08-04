export type CourseNotebookOrderItem = {
  id: string;
  name: string;
  createdAt: number;
  learningOrder?: number;
};

function normalizedLearningOrder(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function notebookNameOrder(notebook: Pick<CourseNotebookOrderItem, 'id' | 'name'>): number {
  for (const candidate of [notebook.name, notebook.id]) {
    const match = candidate.match(/(?:^|[-_\s])0?(\d{1,2})(?:\s*[-–—_:]|[-_\s]|$)/);
    if (match) return Number(match[1]);
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Teacher-defined order wins. Older courses without an explicit order keep the
 * existing filename/creation-time fallback until a teacher saves their order.
 */
export function orderCourseNotebooks<T extends CourseNotebookOrderItem>(notebooks: T[]): T[] {
  return notebooks.slice().sort((left, right) => {
    const explicitLeft = normalizedLearningOrder(left.learningOrder);
    const explicitRight = normalizedLearningOrder(right.learningOrder);
    if (explicitLeft !== null || explicitRight !== null) {
      if (explicitLeft === null) return 1;
      if (explicitRight === null) return -1;
      if (explicitLeft !== explicitRight) return explicitLeft - explicitRight;
    }

    const inferredLeft = notebookNameOrder(left);
    const inferredRight = notebookNameOrder(right);
    if (inferredLeft !== inferredRight) return inferredLeft - inferredRight;
    return left.createdAt - right.createdAt || left.name.localeCompare(right.name);
  });
}
