import { z } from 'zod';

export const COURSE_ANSWER_CONTRACT_VERSION = 1 as const;

export const courseAnswerContractEvidenceSchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceTitle: z.string().min(1),
  sectionTitle: z.string().min(1),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
});

export const courseAnswerContractCheckSchema = z.object({
  id: z.string().regex(/^csc(?:108|148)\.[a-z0-9_.]+$/),
  category: z.enum([
    'function_contract',
    'docstring',
    'testing',
    'representation_invariant',
    'bst_representation',
    'bst_ordering',
    'bst_algorithm',
    'runtime',
    'visible_override',
  ]),
  severity: z.enum(['error', 'warning']),
  appliesTo: z.array(z.enum(['generation', 'code_review', 'grading'])).min(1),
  rule: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  overridePolicy: z.string().min(1).optional(),
});

export const courseAnswerContractSchema = z.object({
  version: z.literal(COURSE_ANSWER_CONTRACT_VERSION),
  id: z.string().min(1),
  courseCode: z.enum(['CSC108', 'CSC148']),
  title: z.string().min(1),
  checks: z.array(courseAnswerContractCheckSchema).min(1),
  evidence: z.array(courseAnswerContractEvidenceSchema).min(1),
});

export type CourseAnswerContract = z.infer<typeof courseAnswerContractSchema>;
export type CourseAnswerContractCheck = z.infer<typeof courseAnswerContractCheckSchema>;

export const courseAnswerContractTeachingMemorySchema = z.object({
  knowledgePoint: z.string().min(1),
  stuckPoint: z.string().min(1),
  cause: z.string().min(1),
  nextTeachingMove: z.string().min(1),
});

export type CourseAnswerContractTeachingMemory = z.infer<
  typeof courseAnswerContractTeachingMemorySchema
>;

const CSC108_CONTRACT = courseAnswerContractSchema.parse({
  version: COURSE_ANSWER_CONTRACT_VERSION,
  id: 'course-answer-contract.csc108.v1',
  courseCode: 'CSC108',
  title: 'CSC108 Python function, docstring, and test contract',
  evidence: [
    {
      id: 'csc108.control.docstring-recipe',
      sourcePath: 'queue/CSC108/02_Control.docx',
      sourceTitle: 'CSC108 Control lecture notes',
      sectionTitle: 'Function header, type contract, docstring, examples, and tests',
    },
    {
      id: 'csc108.importer.docstring-normalization',
      sourcePath: 'scripts/maintenance/import-csc108-word-markdown-notebooks.mjs',
      sourceTitle: 'CSC108 notebook importer',
      sectionTitle: 'Normalized function-design recipe',
      lineStart: 242,
      lineEnd: 312,
    },
    {
      id: 'csc108.final-exam.no-doctest',
      sourcePath: 'queue/CSC108/12_FinalExam_2025_Questions.md',
      sourceTitle: 'CSC108 2025 final exam questions',
      sectionTitle: 'Complete-function answer requirements',
      lineStart: 774,
      lineEnd: 776,
    },
  ],
  checks: [
    {
      id: 'csc108.function.header.type_contract',
      category: 'function_contract',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'A complete CSC108 function uses meaningful parameter names, parameter type annotations, and a return annotation; an explicitly supplied function header is preserved exactly.',
      evidenceRefs: ['csc108.control.docstring-recipe'],
      overridePolicy:
        'An exact header visibly supplied by the problem or starter code overrides the default header shape.',
    },
    {
      id: 'csc108.function.docstring.present',
      category: 'docstring',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'Every complete CSC108 function has a substantive triple-quoted docstring as the first statement in its body.',
      evidenceRefs: ['csc108.control.docstring-recipe', 'csc108.importer.docstring-normalization'],
    },
    {
      id: 'csc108.function.docstring.description',
      category: 'docstring',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'The docstring begins with a meaningful description of what the function does, before any examples.',
      evidenceRefs: ['csc108.control.docstring-recipe', 'csc108.importer.docstring-normalization'],
    },
    {
      id: 'csc108.function.docstring.parameters',
      category: 'docstring',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'The description explicitly names every non-self parameter.',
      evidenceRefs: ['csc108.control.docstring-recipe'],
    },
    {
      id: 'csc108.function.docstring.return_value',
      category: 'docstring',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'The description says what value the function returns or produces.',
      evidenceRefs: ['csc108.control.docstring-recipe'],
    },
    {
      id: 'csc108.function.docstring.examples',
      category: 'docstring',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'Unless the visible problem forbids doctests, a newly designed function docstring includes at least two useful doctest examples.',
      evidenceRefs: ['csc108.control.docstring-recipe', 'csc108.importer.docstring-normalization'],
      overridePolicy:
        'A visible instruction such as "Do not include doctests" disables this default and activates csc108.function.doctest.forbidden_by_prompt.',
    },
    {
      id: 'csc108.function.tests.corner_cases',
      category: 'testing',
      severity: 'warning',
      appliesTo: ['generation', 'code_review'],
      rule: 'When tests are requested, include normal examples plus relevant boundary or corner cases.',
      evidenceRefs: ['csc108.control.docstring-recipe', 'csc108.importer.docstring-normalization'],
    },
    {
      id: 'csc108.function.doctest.forbidden_by_prompt',
      category: 'visible_override',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'If the visible problem says not to include doctests, the submitted function must contain no >>> examples.',
      evidenceRefs: ['csc108.final-exam.no-doctest'],
      overridePolicy: 'This visible problem rule overrides csc108.function.docstring.examples.',
    },
  ],
});

const CSC148_CONTRACT = courseAnswerContractSchema.parse({
  version: COURSE_ANSWER_CONTRACT_VERSION,
  id: 'course-answer-contract.csc148.v1',
  courseCode: 'CSC148',
  title: 'CSC148 representation invariant and BinarySearchTree contract',
  evidence: [
    {
      id: 'csc148.oop.ri-definition',
      sourcePath: 'queue/CSC148/3_OOP.md',
      sourceTitle: 'CSC148 OOP lecture notes',
      sectionTitle: 'Representation invariants',
      lineStart: 575,
      lineEnd: 608,
    },
    {
      id: 'csc148.oop.ri-method-boundary',
      sourcePath: 'queue/CSC148/3_OOP.md',
      sourceTitle: 'CSC148 OOP lecture notes',
      sectionTitle: 'Establishing and preserving representation invariants',
      lineStart: 615,
      lineEnd: 636,
    },
    {
      id: 'csc148.oop.ri-heading',
      sourcePath: 'queue/CSC148/3_OOP.md',
      sourceTitle: 'CSC148 OOP lecture notes',
      sectionTitle: 'python_ta representation-invariant heading',
      lineStart: 746,
      lineEnd: 751,
    },
    {
      id: 'csc148.trees.bst-ordering',
      sourcePath: 'queue/CSC148/8_trees.md',
      sourceTitle: 'CSC148 Trees lecture notes',
      sectionTitle: 'Binary search tree property and duplicates',
      lineStart: 725,
      lineEnd: 743,
    },
    {
      id: 'csc148.trees.bst-representation',
      sourcePath: 'queue/CSC148/8_trees.md',
      sourceTitle: 'CSC148 Trees lecture notes',
      sectionTitle: 'BinarySearchTree representation',
      lineStart: 771,
      lineEnd: 795,
    },
    {
      id: 'csc148.trees.bst-search',
      sourcePath: 'queue/CSC148/8_trees.md',
      sourceTitle: 'CSC148 Trees lecture notes',
      sectionTitle: 'Binary search tree search',
      lineStart: 827,
      lineEnd: 868,
    },
    {
      id: 'csc148.trees.bst-delete',
      sourcePath: 'queue/CSC148/8_trees.md',
      sourceTitle: 'CSC148 Trees lecture notes',
      sectionTitle: 'Binary search tree deletion cases',
      lineStart: 878,
      lineEnd: 990,
    },
    {
      id: 'csc148.trees.bst-inorder',
      sourcePath: 'queue/CSC148/8_trees.md',
      sourceTitle: 'CSC148 Trees lecture notes',
      sectionTitle: 'Inorder traversal',
      lineStart: 1159,
      lineEnd: 1201,
    },
    {
      id: 'csc148.trees.bst-runtime',
      sourcePath: 'queue/CSC148/8_trees.md',
      sourceTitle: 'CSC148 Trees lecture notes',
      sectionTitle: 'BST runtime by height',
      lineStart: 1290,
      lineEnd: 1355,
    },
  ],
  checks: [
    {
      id: 'csc148.ri.heading.exact',
      category: 'representation_invariant',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'A course-style class docstring spells the heading exactly as "Representation Invariants:" with that capitalization, pluralization, and colon.',
      evidenceRefs: ['csc148.oop.ri-heading'],
      overridePolicy:
        'A visibly supplied alternate representation or starter contract remains authoritative.',
    },
    {
      id: 'csc148.ri.initializer.establishes',
      category: 'representation_invariant',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: '__init__ establishes every declared representation invariant.',
      evidenceRefs: ['csc148.oop.ri-definition', 'csc148.oop.ri-method-boundary'],
    },
    {
      id: 'csc148.ri.method_exit.restores',
      category: 'representation_invariant',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'Every public method may assume the representation invariants on entry and must restore them before returning.',
      evidenceRefs: ['csc148.oop.ri-method-boundary'],
    },
    {
      id: 'csc148.review.ri.proactive_evaluation',
      category: 'representation_invariant',
      severity: 'error',
      appliesTo: ['code_review'],
      rule: 'A CSC148 class review explicitly evaluates the declared Representation Invariants and whether __init__ and each mutating method establish or restore them, even when the learner did not ask about RI.',
      evidenceRefs: ['csc148.oop.ri-definition', 'csc148.oop.ri-method-boundary'],
    },
    {
      id: 'csc148.bst.representation.empty_triplet',
      category: 'bst_representation',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'In the course BinarySearchTree representation, an empty tree has _root, _left, and _right all equal to None.',
      evidenceRefs: ['csc148.trees.bst-representation'],
      overridePolicy:
        'A visibly supplied Node-based or other representation overrides this default representation only.',
    },
    {
      id: 'csc148.bst.representation.nonempty_children',
      category: 'bst_representation',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'In a non-empty course BinarySearchTree, _left and _right are BinarySearchTree objects, possibly empty; they are not None.',
      evidenceRefs: ['csc148.trees.bst-representation'],
      overridePolicy:
        'A visibly supplied Node-based or other representation overrides this default representation only.',
    },
    {
      id: 'csc148.bst.ordering.inclusive',
      category: 'bst_ordering',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'Every left-subtree value is <= the root and every right-subtree value is >= the root. Duplicates are allowed in either subtree.',
      evidenceRefs: ['csc148.trees.bst-ordering'],
      overridePolicy:
        'A visible problem may select a consistent duplicate-routing convention, but the course default must not silently forbid duplicates.',
    },
    {
      id: 'csc148.bst.search.single_branch',
      category: 'bst_algorithm',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'BST search compares with the root and recursively searches only the one subtree selected by the ordering invariant.',
      evidenceRefs: ['csc148.trees.bst-search'],
    },
    {
      id: 'csc148.review.bst.proactive_evaluation',
      category: 'bst_algorithm',
      severity: 'error',
      appliesTo: ['code_review'],
      rule: 'A CSC148 BST review explicitly states which course representation and inclusive ordering invariant were checked, and verifies that each search/insert/delete method follows the corresponding course recipe even when the learner did not mention BST rules.',
      evidenceRefs: [
        'csc148.trees.bst-ordering',
        'csc148.trees.bst-representation',
        'csc148.trees.bst-search',
        'csc148.trees.bst-delete',
      ],
    },
    {
      id: 'csc148.bst.insert.no_subtree_overwrite',
      category: 'bst_algorithm',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'Insertion recurses into an existing child BinarySearchTree; it must not overwrite a non-empty child subtree with a new one-node tree.',
      evidenceRefs: ['csc148.trees.bst-representation', 'csc148.trees.bst-search'],
    },
    {
      id: 'csc148.bst.delete.cases',
      category: 'bst_algorithm',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'Deletion distinguishes empty, leaf, one-child, and two-child cases and preserves the chosen representation.',
      evidenceRefs: ['csc148.trees.bst-delete'],
    },
    {
      id: 'csc148.bst.traversal.inorder',
      category: 'bst_algorithm',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'An inorder traversal of a BST yields values in nondecreasing sorted order.',
      evidenceRefs: ['csc148.trees.bst-inorder', 'csc148.trees.bst-ordering'],
    },
    {
      id: 'csc148.bst.runtime.height',
      category: 'runtime',
      severity: 'error',
      appliesTo: ['generation', 'code_review', 'grading'],
      rule: 'Search, insert, and delete are O(h): O(log n) when balanced and O(n) for a maximally skewed tree.',
      evidenceRefs: ['csc148.trees.bst-runtime'],
    },
  ],
});

/**
 * A compact teaching-state projection for course-contract failures.
 *
 * The full lecture/source remains in the knowledge-base layer. These entries
 * contain only the stable rule that changes the next teaching action, so a
 * learner-memory write never becomes a copy of the source or submission.
 */
export const COURSE_ANSWER_CONTRACT_TEACHING_MEMORY = {
  'csc108.function.header.type_contract': {
    knowledgePoint: 'CSC108 function header and type contract',
    stuckPoint:
      'The submitted function header does not yet preserve the required parameter and return-type contract.',
    cause:
      'The implementation was treated as the whole answer before the teacher-supplied function contract was checked.',
    nextTeachingMove:
      'First compare the submitted header with the starter header, then repair only missing annotations without renaming parameters.',
  },
  'csc108.function.docstring.present': {
    knowledgePoint: 'CSC108 teacher-style function docstring',
    stuckPoint:
      'The submitted function is missing the substantive first-statement docstring required by the course recipe.',
    cause:
      'The function body was checked for output behaviour but the header-and-docstring contract was skipped.',
    nextTeachingMove:
      'Before reviewing the algorithm, have the learner write a purpose sentence and two doctest examples directly below the exact header.',
  },
  'csc108.function.docstring.description': {
    knowledgePoint: 'CSC108 teacher-style function docstring',
    stuckPoint:
      'The docstring does not yet state the function behaviour in a substantive purpose description.',
    cause:
      'A placeholder or implementation summary was used instead of a reader-facing input/output contract.',
    nextTeachingMove:
      'Ask the learner to describe what is returned using the parameter names, without narrating implementation steps.',
  },
  'csc108.function.docstring.parameters': {
    knowledgePoint: 'CSC108 teacher-style function docstring',
    stuckPoint: 'The docstring description does not identify every non-self parameter.',
    cause:
      'The purpose statement was written without checking it against the exact function header.',
    nextTeachingMove:
      'Underline each parameter in the header and account for each one in the purpose sentence.',
  },
  'csc108.function.docstring.return_value': {
    knowledgePoint: 'CSC108 teacher-style function docstring',
    stuckPoint: 'The docstring does not state what value the function returns or produces.',
    cause:
      'The description focuses on the operation or implementation instead of the observable result.',
    nextTeachingMove:
      'Rewrite the first sentence as a Return/Produce statement and compare it with the return annotation.',
  },
  'csc108.function.docstring.examples': {
    knowledgePoint: 'CSC108 teacher-style function docstring',
    stuckPoint:
      'The docstring does not yet contain enough useful doctest examples for the course function-design recipe.',
    cause:
      'The examples step was skipped after the purpose statement or replaced by informal prose.',
    nextTeachingMove:
      'Add one ordinary doctest and one boundary-case doctest, unless the visible problem explicitly forbids doctests.',
  },
  'csc108.function.doctest.forbidden_by_prompt': {
    knowledgePoint: 'CSC108 visible problem override',
    stuckPoint: 'The submission includes doctests even though the visible problem forbids them.',
    cause:
      'The default course recipe was applied without checking the current problem-specific override.',
    nextTeachingMove:
      'Remove the doctests for this problem and explicitly identify the visible instruction that overrides the default recipe.',
  },
  'csc148.ri.heading.exact': {
    knowledgePoint: 'CSC148 Representation Invariants',
    stuckPoint:
      'The class contract does not use the exact course heading "Representation Invariants:".',
    cause:
      'The class was implemented before its course-style representation contract was written down.',
    nextTeachingMove:
      'Write the exact RI heading in the class docstring, list each property of valid instance attributes, then re-check __init__ and mutators.',
  },
  'csc148.ri.initializer.establishes': {
    knowledgePoint: 'CSC148 Representation Invariants',
    stuckPoint: '__init__ does not establish every declared representation invariant.',
    cause:
      'The initializer assignments were not checked against the class docstring one invariant at a time.',
    nextTeachingMove:
      'Trace each __init__ branch and mark where every RI becomes true before object construction completes.',
  },
  'csc148.ri.method_exit.restores': {
    knowledgePoint: 'CSC148 Representation Invariants',
    stuckPoint: 'A public method can return without restoring every representation invariant.',
    cause:
      'The method was checked locally without treating each RI as an entry assumption and exit obligation.',
    nextTeachingMove:
      'Trace the mutating method branch by branch and verify every RI immediately before each return.',
  },
  'csc148.bst.representation.empty_triplet': {
    knowledgePoint: 'CSC148 BinarySearchTree representation invariant',
    stuckPoint: 'The empty BST representation does not set _root, _left, and _right all to None.',
    cause:
      'The course recursive-object representation was replaced by a generic tree representation.',
    nextTeachingMove:
      'Build an empty-tree state table for _root/_left/_right, then compare every initializer branch with it.',
  },
  'csc148.bst.representation.nonempty_children': {
    knowledgePoint: 'CSC148 BinarySearchTree representation invariant',
    stuckPoint:
      'A non-empty BST does not represent both children as BinarySearchTree objects, possibly empty.',
    cause:
      'None was used for a child of a non-empty tree instead of the course recursive BST object.',
    nextTeachingMove:
      'Contrast None with BinarySearchTree(None), then trace a one-node tree before implementing other methods.',
  },
  'csc148.bst.ordering.inclusive': {
    knowledgePoint: 'CSC148 BinarySearchTree ordering invariant',
    stuckPoint:
      'The BST ordering rule is strict or incomplete instead of left <= root <= right with duplicates allowed in either subtree.',
    cause: 'A generic strict-BST convention was substituted for the course definition.',
    nextTeachingMove:
      'Test the RI on a root with an equal-valued child on each side, then restate the inclusive ordering rule.',
  },
  'csc148.bst.search.single_branch': {
    knowledgePoint: 'CSC148 BinarySearchTree search recipe',
    stuckPoint:
      'The search treats the BST like a general binary tree instead of using the ordering invariant to choose one subtree.',
    cause: 'The comparison with _root was not used as the routing rule for the recursive call.',
    nextTeachingMove:
      'Trace empty, equal, smaller, and larger cases and require exactly one recursive branch after the root comparison.',
  },
  'csc148.bst.insert.no_subtree_overwrite': {
    knowledgePoint: 'CSC148 BinarySearchTree insertion recipe',
    stuckPoint: 'Insertion overwrites an existing child subtree instead of recursing into it.',
    cause:
      'The child attribute was treated as an optional node slot rather than an existing BinarySearchTree object.',
    nextTeachingMove:
      'Trace insertion into a non-empty child and replace child assignment with a recursive child.insert call.',
  },
  'csc148.bst.delete.cases': {
    knowledgePoint: 'CSC148 BinarySearchTree deletion recipe',
    stuckPoint: 'Deletion does not preserve the course representation across all structural cases.',
    cause: 'The empty, leaf, one-child, and two-child cases were not separated before mutation.',
    nextTeachingMove:
      'Make a four-row case table and verify the representation and ordering RI after each case.',
  },
  'csc148.bst.traversal.inorder': {
    knowledgePoint: 'CSC148 BinarySearchTree inorder traversal',
    stuckPoint: 'The traversal order does not guarantee nondecreasing BST output.',
    cause: 'The recursive results were combined without using left-root-right order.',
    nextTeachingMove:
      'Trace a three-node BST and label the left result, root contribution, and right result before combining.',
  },
  'csc148.bst.runtime.height': {
    knowledgePoint: 'CSC148 BinarySearchTree runtime',
    stuckPoint: 'BST runtime is not expressed in terms of tree height and shape.',
    cause: 'The operation was assumed to be logarithmic without considering a skewed tree.',
    nextTeachingMove:
      'Compare the recursive path length in a balanced tree and a maximally skewed tree, then state O(h).',
  },
} as const satisfies Record<string, CourseAnswerContractTeachingMemory>;

export const COURSE_ANSWER_CONTRACT_REGISTRY = {
  CSC108: CSC108_CONTRACT,
  CSC148: CSC148_CONTRACT,
} as const satisfies Record<string, CourseAnswerContract>;

export type SupportedCourseAnswerContractCode = keyof typeof COURSE_ANSWER_CONTRACT_REGISTRY;

export function normalizeCourseAnswerContractCode(
  value: string | null | undefined,
): SupportedCourseAnswerContractCode | null {
  if (!value) return null;
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.includes('CSC108')) return 'CSC108';
  if (compact.includes('CSC148')) return 'CSC148';
  return null;
}

export function resolveCourseAnswerContract(args: {
  courseCode?: string | null;
  courseName?: string | null;
  courseId?: string | null;
  notebookId?: string | null;
  notebookName?: string | null;
}): CourseAnswerContract | null {
  const values = [
    args.courseCode,
    args.courseName,
    args.courseId,
    args.notebookId,
    args.notebookName,
  ];
  for (const value of values) {
    const code = normalizeCourseAnswerContractCode(value);
    if (code) return COURSE_ANSWER_CONTRACT_REGISTRY[code];
  }
  return null;
}

export function getCourseAnswerContract(
  courseCode: string | null | undefined,
): CourseAnswerContract | null {
  const normalized = normalizeCourseAnswerContractCode(courseCode);
  return normalized ? COURSE_ANSWER_CONTRACT_REGISTRY[normalized] : null;
}

export function renderCourseAnswerContractPrompt(contract: CourseAnswerContract): string {
  const evidenceById = new Map(contract.evidence.map((item) => [item.id, item]));
  const lines = [
    `<course_answer_contract id="${contract.id}" version="${contract.version}">`,
    `course: ${contract.courseCode}`,
    'authority:',
    '- Apply these stable checks proactively for code generation, code review, and grading.',
    '- A rule visibly stated in the current problem or supplied starter code overrides only the conflicting default; say which visible rule you followed.',
    'learner_memory_extraction:',
    '- When student-authored code directly fails a mapped check, diagnose the learner state using knowledgePoint, masteredSignal, stuckPoint, cause, and nextTeachingMove.',
    '- masteredSignal remains null unless the student message itself contains direct positive evidence.',
    '- evidenceFromMessage contains only short literal excerpts from the student submission. Never copy the full submission or course source into learner memory.',
    '- Course source text remains authoritative in the knowledge-base layer; learner memory stores only the compact teaching action below.',
    'checks:',
  ];

  for (const check of contract.checks) {
    lines.push(`- [${check.id}] ${check.rule}`);
    if (check.overridePolicy) lines.push(`  override: ${check.overridePolicy}`);
    const sources = check.evidenceRefs
      .map((id) => {
        const evidence = evidenceById.get(id);
        if (!evidence) return id;
        const lines =
          evidence.lineStart && evidence.lineEnd
            ? `:${evidence.lineStart}-${evidence.lineEnd}`
            : '';
        return `${id} (${evidence.sourcePath}${lines})`;
      })
      .join('; ');
    lines.push(`  evidence: ${sources}`);
    const teachingMemory = (
      COURSE_ANSWER_CONTRACT_TEACHING_MEMORY as Record<
        string,
        CourseAnswerContractTeachingMemory | undefined
      >
    )[check.id];
    if (teachingMemory) {
      lines.push(
        `  teaching_memory: knowledgePoint=${teachingMemory.knowledgePoint}; derive stuckPoint/cause/nextTeachingMove from this failed check and short literal student-code evidence.`,
      );
    }
  }

  lines.push('</course_answer_contract>');
  return lines.join('\n');
}

type PythonFunction = {
  name: string;
  header: string;
  parameters: Array<{ name: string; hasAnnotation: boolean }>;
  hasReturnAnnotation: boolean;
  body: string;
  docstring: string | null;
};

function splitPythonParameters(value: string): string[] {
  const parameters: string[] = [];
  let current = '';
  let depth = 0;
  for (const character of value) {
    if ('([{'.includes(character)) depth += 1;
    if (')]}'.includes(character)) depth = Math.max(0, depth - 1);
    if (character === ',' && depth === 0) {
      parameters.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim()) parameters.push(current);
  return parameters;
}

function parsePythonParameters(value: string): PythonFunction['parameters'] {
  return splitPythonParameters(value)
    .map((parameter) => parameter.trim())
    .filter(Boolean)
    .map((parameter) => {
      const withoutPrefix = parameter.replace(/^[*/]+/, '');
      const name = withoutPrefix.split(/[:=]/, 1)[0]?.trim() || '';
      return {
        name,
        hasAnnotation: withoutPrefix.includes(':'),
      };
    })
    .filter(({ name }) => Boolean(name) && name !== 'self' && name !== 'cls');
}

function leadingWhitespaceLength(value: string): number {
  return value.match(/^[ \t]*/)?.[0].replace(/\t/g, '    ').length || 0;
}

function extractLeadingPythonDocstring(bodyLines: string[]): string | null {
  let firstIndex = 0;
  while (
    firstIndex < bodyLines.length &&
    (!bodyLines[firstIndex]?.trim() || bodyLines[firstIndex]?.trim().startsWith('#'))
  ) {
    firstIndex += 1;
  }
  const first = bodyLines[firstIndex] || '';
  const opening = first.match(/^\s*("""|''')/);
  if (!opening) return null;
  const quote = opening[1];
  const content: string[] = [];
  const afterOpening = first.slice((opening.index || 0) + opening[0].length);
  const sameLineClose = afterOpening.indexOf(quote);
  if (sameLineClose >= 0) return afterOpening.slice(0, sameLineClose).trim();
  content.push(afterOpening);
  for (let index = firstIndex + 1; index < bodyLines.length; index += 1) {
    const line = bodyLines[index] || '';
    const closingIndex = line.indexOf(quote);
    if (closingIndex >= 0) {
      content.push(line.slice(0, closingIndex));
      return content.join('\n').trim();
    }
    content.push(line);
  }
  return null;
}

function extractPythonFunctions(code: string): PythonFunction[] {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const functions: PythonFunction[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    const match = line.match(
      /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\((.*)\)\s*(?:->\s*([^:]+))?\s*:\s*$/,
    );
    if (!match) continue;
    const baseIndent = leadingWhitespaceLength(match[1] || '');
    let end = index + 1;
    while (end < lines.length) {
      const nextLine = lines[end] || '';
      if (
        nextLine.trim() &&
        leadingWhitespaceLength(nextLine) <= baseIndent &&
        !nextLine.trimStart().startsWith('#')
      ) {
        break;
      }
      end += 1;
    }
    const bodyLines = lines.slice(index + 1, end);
    functions.push({
      name: match[2],
      header: line.trim(),
      parameters: parsePythonParameters(match[3] || ''),
      hasReturnAnnotation: Boolean(match[4]?.trim()),
      body: bodyLines.join('\n'),
      docstring: extractLeadingPythonDocstring(bodyLines),
    });
  }
  return functions;
}

function extractPythonCode(text: string): string {
  const fenced = [...text.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/gi)]
    .map((match) => match[1]?.trim() || '')
    .filter(Boolean);
  if (fenced.length > 0) return fenced.join('\n\n');
  return /\b(?:def|class)\s+[A-Za-z_]\w*/.test(text) ? text : '';
}

function extractVisibleStarterCode(message: string): string {
  const marker = message.match(/(?:起始代码|starter\s+code|provided\s+code|given\s+code)[:：]\s*/i);
  if (marker && typeof marker.index === 'number') {
    return extractPythonCode(message.slice(marker.index + marker[0].length));
  }
  const describesProvidedRepresentation =
    /(?:provided|given|starter|题目给定|给出的|辅助定义|已有(?:的)?表示)/i.test(message);
  const code = extractPythonCode(message);
  return describesProvidedRepresentation ? code : '';
}

function isCodeReviewIntent(message: string): boolean {
  return /review|check(?:\s+my)?|grade|assignment|submit|can\s+i\s+submit|feedback|look\s+at\s+(?:my|this)|检查|审查|批改|作业|能交|提交|哪里错|是否正确|正确吗|对不对|有(?:没有)?问题|帮我看|看看/i.test(
    message,
  );
}

function isCodeGenerationIntent(message: string): boolean {
  return /implement(?:ation)?|write|generate|complete(?:\s+the)?\s+(?:code|function|class)|实现|编写|写出|生成|完整(?:代码|函数|类)|补全/i.test(
    message,
  );
}

export type CourseAnswerContractTask = 'generation' | 'code_review' | 'grading' | 'not_applicable';

/**
 * Classify turns that need the course answer gate even when the student did not
 * use an explicit "write/review" verb. This is deliberately course-contract
 * oriented rather than a general programming-intent classifier.
 */
export function inferCourseAnswerContractTask(message: string): CourseAnswerContractTask {
  if (isCodeReviewIntent(message)) return 'code_review';
  if (isCodeGenerationIntent(message)) return 'generation';

  const hasCourseProgrammingSignal =
    /```(?:python|py)?|\b[A-Za-z_]\w*\.py\b|\bdef\s+[A-Za-z_]\w*\s*\(|\bclass\s+[A-Za-z_]\w*|\bPython\b|\bdocstrings?\b|\bBinarySearchTree\b|\bBST\b|binary\s+search\s+tree|Representation Invariants?|\brepresentation\s+invariants?\b|(?:^|[^A-Za-z])RI(?:[^A-Za-z]|$)|二叉搜索树|表示不变量|文档字符串|函数|代码/i.test(
      message,
    );
  return hasCourseProgrammingSignal ? 'generation' : 'not_applicable';
}

function looksLikeSubmittedPythonCode(text: string): boolean {
  return (
    /```(?:python|py)?\s*\n/i.test(text) ||
    /(?:^|\n)\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(/m.test(text) ||
    /(?:^|\n)\s*class\s+[A-Za-z_]\w*/m.test(text)
  );
}

function isContextDependentCourseContractFollowUp(message: string): boolean {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 120) return false;
  return (
    /(?:这|那|它|上述|刚才|前面|上一步|这里|那里|this|that|it|above|previous)/i.test(normalized) ||
    /^(?:为什么|怎么了|继续|继续检查|继续讲|然后呢|再看一下|再检查一下|再解释一下|详细一点|why|continue|go on|check again|explain more)[?？!！。.]*$/i.test(
      normalized,
    )
  );
}

export function inferCourseAnswerContractConversationTask(
  userMessages: string[],
): CourseAnswerContractTask {
  const texts = userMessages.map((text) => text.trim()).filter(Boolean);
  const latest = texts.at(-1) || '';
  const latestTask = inferCourseAnswerContractTask(latest);
  if (latestTask !== 'not_applicable' || !isContextDependentCourseContractFollowUp(latest)) {
    return latestTask;
  }

  for (const prior of texts.slice(-4, -1).reverse()) {
    if (looksLikeSubmittedPythonCode(prior) || isCodeReviewIntent(prior)) return 'code_review';
    const priorTask = inferCourseAnswerContractTask(prior);
    if (priorTask !== 'not_applicable') return priorTask;
    if (!isContextDependentCourseContractFollowUp(prior)) break;
  }
  return 'not_applicable';
}

function hasVisibleAssignmentRequirements(message: string): boolean {
  return (
    Boolean(extractVisibleStarterCode(message)) ||
    /(?:assignment|starter|provided|given|require(?:ment|d)?|must|should|constraint|作业|题目|起始代码|给定代码|要求|必须|不得|只能)/i.test(
      message,
    )
  );
}

export function resolveCourseAnswerContractReviewText(
  userMessages: string[],
  task: CourseAnswerContractTask,
): string {
  const texts = userMessages.map((text) => text.trim()).filter(Boolean);
  const latest = texts.at(-1) || '';
  if (task !== 'code_review' || looksLikeSubmittedPythonCode(latest)) return latest;

  const priorSubmissionIndex = texts
    .slice(0, -1)
    .map((text, index) => ({ text, index }))
    .reverse()
    .find((item) => looksLikeSubmittedPythonCode(item.text))?.index;
  if (priorSubmissionIndex === undefined) return latest;
  const priorSubmission = texts[priorSubmissionIndex];
  if (!priorSubmission) return latest;
  const adjacentRequirements = texts[priorSubmissionIndex - 1];
  return [
    adjacentRequirements && hasVisibleAssignmentRequirements(adjacentRequirements)
      ? `Visible assignment requirements:\n${adjacentRequirements}`
      : '',
    priorSubmission,
    'Follow-up review request:',
    latest,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function visiblePromptForbidsDoctests(message: string): boolean {
  return /do\s+not\s+include\s+doctests?|without\s+doctests?|no\s+doctests?|不要(?:包含|写|提供)?\s*doctests?|不(?:需要|要)\s*doctests?|禁止\s*doctests?/i.test(
    message,
  );
}

function isPlaceholderDocstring(docstring: string | null): boolean {
  if (!docstring) return true;
  const compact = docstring.replace(/\s+/g, ' ').trim();
  return (
    compact.length < 18 ||
    /^(?:todo|pass|helper|function|method|description|docstring(?:\s+omitted)?)\.?$/i.test(compact)
  );
}

function docstringDescription(docstring: string): string {
  return docstring.split(/^\s*>>>\s/m, 1)[0]?.trim() || '';
}

function hasReturnDescription(description: string): boolean {
  return /\b(?:return|returns|produce|produces|whether|true|false)\b|返回|产生|得到|是否/u.test(
    description,
  );
}

function hasExactRepresentationInvariantHeading(text: string): boolean {
  return /^\s*Representation Invariants:\s*$/m.test(text);
}

function hasInclusiveBstOrdering(text: string): boolean {
  const left =
    /(?:_left|left(?:\s+subtree)?)[^\n]{0,120}(?:<=|less\s+than\s+or\s+equal|at\s+most|小于等于|不大于)/i.test(
      text,
    );
  const right =
    /(?:_right|right(?:\s+subtree)?)[^\n]{0,120}(?:>=|greater\s+than\s+or\s+equal|at\s+least|大于等于|不小于)/i.test(
      text,
    );
  return left && right;
}

function hasStrictBstOrderingClaim(text: string): boolean {
  const strictEnglish =
    /(?:every|all)[^\n]*(?:_left|left\s+subtree)[^\n]*(?:\s<\s|strictly\s+less|smaller\s+than)[^\n]*(?:_root|root)/i.test(
      text,
    ) &&
    /(?:every|all)[^\n]*(?:_right|right\s+subtree)[^\n]*(?:\s>\s|strictly\s+greater|larger\s+than)[^\n]*(?:_root|root)/i.test(
      text,
    );
  const strictChinese =
    /左(?:子树|侧)[^\n]*(?:严格)?小于[^\n]*根/.test(text) &&
    /右(?:子树|侧)[^\n]*(?:严格)?大于[^\n]*根/.test(text);
  return strictEnglish || strictChinese || /left\s*<\s*root\s*<\s*right/i.test(text);
}

function explicitBstRepresentationVariant(message: string): boolean {
  const starter = extractVisibleStarterCode(message);
  if (!starter) return false;
  return (
    /\bclass\s+(?:Node|BSTNode|TreeNode)\b/.test(starter) ||
    /\bself\.(?:root|value|item|key)\b/.test(starter) ||
    /(?:left|right)\s*:\s*(?:Optional|[A-Za-z_]\w*\s*\|\s*None)/.test(starter)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstPythonClassName(code: string): string | null {
  return code.match(/\bclass\s+([A-Za-z_]\w*)/)?.[1] || null;
}

function looksLikeCourseBstCode(code: string): boolean {
  if (!firstPythonClassName(code)) return false;
  const hasCourseFields =
    /\bself\._root\b/.test(code) && /\bself\._left\b/.test(code) && /\bself\._right\b/.test(code);
  if (!hasCourseFields) return false;
  const functions = extractPythonFunctions(code);
  const hasBstMethod = functions.some(
    (fn) =>
      fn.name === 'insert' ||
      fn.name === 'delete' ||
      fn.name === 'remove' ||
      fn.name === 'inorder' ||
      isBstSearchMethod(fn.name),
  );
  const hasOrderingBranch =
    /(?:item|value|target|key)\s*(?:<=|>=|<|>)\s*self\._root/.test(code) ||
    /self\._root\s*(?:<=|>=|<|>)\s*(?:item|value|target|key)/.test(code);
  return hasBstMethod && (hasOrderingBranch || hasInclusiveBstOrdering(code));
}

function initializesEmptyChildWithClass(
  code: string,
  field: '_left' | '_right',
  className: string | null,
): boolean {
  if (!className) return false;
  return new RegExp(
    `self\\.${field}\\s*=\\s*${escapeRegExp(className)}\\s*\\(\\s*None\\s*\\)`,
  ).test(code);
}

function methodBodyHasInsertOverwrite(code: string): boolean {
  const insert = extractPythonFunctions(code).find((fn) => fn.name === 'insert');
  if (!insert) return false;
  const className = firstPythonClassName(code);
  const constructor = className ? escapeRegExp(className) : '[A-Za-z_]\\w*';
  const overwritesLeft = new RegExp(`self\\._left\\s*=\\s*${constructor}\\s*\\(`).test(insert.body);
  const overwritesRight = new RegExp(`self\\._right\\s*=\\s*${constructor}\\s*\\(`).test(
    insert.body,
  );
  const recursesLeft = /self\._left\.insert\s*\(/.test(insert.body);
  const recursesRight = /self\._right\.insert\s*\(/.test(insert.body);
  return (overwritesLeft && !recursesLeft) || (overwritesRight && !recursesRight);
}

export type CourseAnswerContractValidationFailure = {
  checkId: string;
  message: string;
  evidenceRefs: string[];
  /**
   * Short literal excerpts from student-authored code that triggered the
   * failure. These are suitable as learner-memory evidence; course-source text
   * and the assistant draft never belong here.
   */
  studentEvidence: string[];
};

export type CourseAnswerContractValidationResult = {
  matched: boolean;
  courseCode?: SupportedCourseAnswerContractCode;
  contractId?: string;
  version?: typeof COURSE_ANSWER_CONTRACT_VERSION;
  task?: CourseAnswerContractTask;
  representationProfile?: 'course_default' | 'visible_problem_override' | 'not_applicable';
  failures: CourseAnswerContractValidationFailure[];
};

export type CourseAnswerContractMemorySignal = {
  contractId: string;
  courseCode: SupportedCourseAnswerContractCode;
  knowledgePoint: string;
  masteredSignal: null;
  stuckPoint: string;
  cause: string;
  nextTeachingMove: string;
  confidence: 'high';
  evidenceFromMessage: string[];
  contractCheckIds: string[];
};

function checkFailure(
  contract: CourseAnswerContract,
  checkId: string,
  message: string,
  studentEvidence: string[] = [],
): CourseAnswerContractValidationFailure {
  const check = contract.checks.find((candidate) => candidate.id === checkId);
  return {
    checkId,
    message,
    evidenceRefs: check?.evidenceRefs || [],
    studentEvidence: studentEvidence
      .map((excerpt) => excerpt.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 4),
  };
}

function firstMatchingLine(text: string, pattern: RegExp): string | null {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => Boolean(line) && pattern.test(line)) || null
  );
}

function functionEvidence(fn: PythonFunction): string[] {
  return [fn.header].filter(Boolean);
}

function docstringEvidence(fn: PythonFunction): string[] {
  const firstLine = fn.docstring
    ?.split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return [firstLine || fn.header].filter(Boolean);
}

function isBstSearchMethod(name: string): boolean {
  return /^(?:__contains__|contains|search|find|lookup|has|find_item)$/i.test(name);
}

function bstSearchUsesGeneralTreeBranching(fn: PythonFunction): boolean {
  if (!isBstSearchMethod(fn.name)) return false;
  return fn.body.split('\n').some((line) => {
    const compactLine = line.replace(/\s+/g, ' ').trim();
    return (
      /self\._left/.test(compactLine) &&
      /self\._right/.test(compactLine) &&
      /\b(?:or|and)\b/.test(compactLine)
    );
  });
}

function hasBstReviewLanguage(text: string): boolean {
  const representation =
    /Representation Invariants?:|表示不变量|empty\s+BST|non-empty\s+BST|_root[\s\S]{0,120}_left[\s\S]{0,120}_right/i.test(
      text,
    );
  const ordering =
    /(?:<=|>=|duplicates?|重复值|小于等于|大于等于)|(?:ordering|排序|有序)[\s\S]{0,80}(?:invariant|不变量)/i.test(
      text,
    );
  return representation && ordering;
}

function hasRiReviewLanguage(text: string): boolean {
  return (
    /Representation Invariants?:|表示不变量|(?:^|[^A-Za-z])RI(?:[^A-Za-z]|$)/i.test(text) &&
    /establish|restore|preserve|maintain|satisf(?:y|ies)|建立|恢复|保持|维护|满足/i.test(text)
  );
}

function hasClassOrMutationCode(code: string): boolean {
  if (!/\bclass\s+[A-Za-z_]\w*/.test(code)) return false;
  return extractPythonFunctions(code).some(
    (fn) =>
      fn.name === '__init__' ||
      /^(?:insert|delete|remove|add|append|pop|push|enqueue|dequeue|set_|update)/i.test(fn.name) ||
      /\bself\.[A-Za-z_]\w*\s*=/.test(fn.body),
  );
}

function validateCsc108(args: {
  contract: CourseAnswerContract;
  message: string;
  answerText: string;
  answerCode: string;
  task: 'generation' | 'code_review' | 'grading';
}): CourseAnswerContractValidationFailure[] {
  const { contract, message, answerText, answerCode, task } = args;
  const failures: CourseAnswerContractValidationFailure[] = [];
  const starterFunctions = extractPythonFunctions(extractVisibleStarterCode(message));
  const answerFunctions = extractPythonFunctions(answerCode || extractPythonCode(answerText));
  const submittedFunctions =
    task === 'code_review' ? extractPythonFunctions(extractPythonCode(message)) : [];
  const noDoctests = visiblePromptForbidsDoctests(message);

  for (const fn of answerFunctions) {
    const starter = starterFunctions.find((candidate) => candidate.name === fn.name);
    const starterOwnsDocstring = Boolean(
      starter?.docstring && !isPlaceholderDocstring(starter.docstring),
    );
    if (
      !starter &&
      (fn.parameters.some((parameter) => !parameter.hasAnnotation) || !fn.hasReturnAnnotation)
    ) {
      failures.push(
        checkFailure(
          contract,
          'csc108.function.header.type_contract',
          `${fn.name}: add parameter type annotations and a return annotation, or preserve the exact visible starter header.`,
          functionEvidence(fn),
        ),
      );
    }
    if (!fn.docstring) {
      failures.push(
        checkFailure(
          contract,
          'csc108.function.docstring.present',
          `${fn.name}: add a substantive triple-quoted docstring as the first statement in the function body.`,
          functionEvidence(fn),
        ),
      );
      continue;
    }
    if (starterOwnsDocstring) continue;
    const description = docstringDescription(fn.docstring);
    if (isPlaceholderDocstring(fn.docstring) || description.length < 18) {
      failures.push(
        checkFailure(
          contract,
          'csc108.function.docstring.description',
          `${fn.name}: describe the function's behaviour before its doctest examples.`,
          docstringEvidence(fn),
        ),
      );
    }
    const missingParameters = fn.parameters
      .map((parameter) => parameter.name)
      .filter(
        (name) =>
          !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(description),
      );
    if (missingParameters.length > 0) {
      failures.push(
        checkFailure(
          contract,
          'csc108.function.docstring.parameters',
          `${fn.name}: name every parameter in the docstring description; missing ${missingParameters.join(', ')}.`,
          docstringEvidence(fn),
        ),
      );
    }
    if (!hasReturnDescription(description)) {
      failures.push(
        checkFailure(
          contract,
          'csc108.function.docstring.return_value',
          `${fn.name}: state what value the function returns or produces.`,
          docstringEvidence(fn),
        ),
      );
    }
    const doctestCount = (fn.docstring.match(/^\s*>>>\s/gm) || []).length;
    if (noDoctests && doctestCount > 0) {
      failures.push(
        checkFailure(
          contract,
          'csc108.function.doctest.forbidden_by_prompt',
          `${fn.name}: the visible problem says "Do not include doctests"; remove all >>> examples.`,
          docstringEvidence(fn),
        ),
      );
    } else if (!noDoctests && doctestCount < 2) {
      failures.push(
        checkFailure(
          contract,
          'csc108.function.docstring.examples',
          `${fn.name}: include at least two useful doctest examples unless the visible problem forbids them.`,
          docstringEvidence(fn),
        ),
      );
    }
  }

  if (task === 'code_review' && submittedFunctions.length > 0) {
    const reviewMentionsDocstring = /docstring|文档字符串/i.test(answerText);
    for (const fn of submittedFunctions) {
      if (!fn.docstring && !reviewMentionsDocstring) {
        failures.push(
          checkFailure(
            contract,
            'csc108.function.docstring.present',
            `${fn.name}: proactively point out that the submitted CSC108 function is missing a substantive first-statement docstring.`,
            functionEvidence(fn),
          ),
        );
      }
      if (
        fn.docstring &&
        isPlaceholderDocstring(fn.docstring) &&
        !/(?:docstring|文档字符串)[\s\S]{0,100}(?:substantive|purpose|description|placeholder|too short|用途|功能|描述|占位|过短)/i.test(
          answerText,
        )
      ) {
        failures.push(
          checkFailure(
            contract,
            'csc108.function.docstring.description',
            `${fn.name}: proactively explain that its placeholder docstring needs a substantive purpose description.`,
            docstringEvidence(fn),
          ),
        );
      }
      if (fn.docstring && !isPlaceholderDocstring(fn.docstring)) {
        const description = docstringDescription(fn.docstring);
        if (
          description.length < 18 &&
          !/(?:docstring|文档字符串)[\s\S]{0,100}(?:purpose|description|too short|用途|功能|描述|过短)/i.test(
            answerText,
          )
        ) {
          failures.push(
            checkFailure(
              contract,
              'csc108.function.docstring.description',
              `${fn.name}: proactively explain that its docstring needs a meaningful behaviour description before examples.`,
              docstringEvidence(fn),
            ),
          );
        }
        const missingParameter = fn.parameters.some(
          ({ name }) =>
            !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(description),
        );
        if (
          missingParameter &&
          !/(?:docstring|文档字符串)[\s\S]{0,100}(?:parameter|参数)/i.test(answerText)
        ) {
          failures.push(
            checkFailure(
              contract,
              'csc108.function.docstring.parameters',
              `${fn.name}: proactively explain that its docstring description must name every parameter.`,
              docstringEvidence(fn),
            ),
          );
        }
        if (
          !hasReturnDescription(description) &&
          !/(?:docstring|文档字符串)[\s\S]{0,100}(?:return|返回)/i.test(answerText)
        ) {
          failures.push(
            checkFailure(
              contract,
              'csc108.function.docstring.return_value',
              `${fn.name}: proactively explain that its docstring must describe the returned value.`,
              docstringEvidence(fn),
            ),
          );
        }
        const doctestCount = (fn.docstring.match(/^\s*>>>\s/gm) || []).length;
        if (
          noDoctests &&
          doctestCount > 0 &&
          !/(?:remove|forbid|must not|do not include|删除|移除|禁止|不要)[\s\S]{0,80}doctest/i.test(
            answerText,
          )
        ) {
          failures.push(
            checkFailure(
              contract,
              'csc108.function.doctest.forbidden_by_prompt',
              `${fn.name}: proactively point out that the visible problem forbids its doctest examples.`,
              docstringEvidence(fn),
            ),
          );
        } else if (
          !noDoctests &&
          doctestCount < 2 &&
          !/(?:docstring|文档字符串)[\s\S]{0,100}(?:doctest|examples?|示例)/i.test(answerText)
        ) {
          failures.push(
            checkFailure(
              contract,
              'csc108.function.docstring.examples',
              `${fn.name}: proactively point out that the CSC108 docstring needs useful doctest examples.`,
              docstringEvidence(fn),
            ),
          );
        }
      }
    }
  }

  return failures;
}

function validateCsc148(args: {
  contract: CourseAnswerContract;
  message: string;
  answerText: string;
  answerCode: string;
  task: 'generation' | 'code_review' | 'grading';
  representationOverride: boolean;
}): CourseAnswerContractValidationFailure[] {
  const { contract, message, answerText, answerCode, task, representationOverride } = args;
  const failures: CourseAnswerContractValidationFailure[] = [];
  const submittedCode = task === 'code_review' ? extractPythonCode(message) : '';
  const answerSource = answerCode || extractPythonCode(answerText);
  const combinedQuestionAndAnswer = `${message}\n${answerText}`;
  const isBst =
    /BinarySearchTree|\bBST\b|binary\s+search\s+tree|二叉搜索树/i.test(combinedQuestionAndAnswer) ||
    looksLikeCourseBstCode(submittedCode) ||
    looksLikeCourseBstCode(answerSource);
  const submittedClassName = firstPythonClassName(submittedCode);
  const answerClassName = firstPythonClassName(answerSource);
  const answerDefinesClass = /\bclass\s+[A-Za-z_]\w*/.test(answerSource);
  const submittedClassEvidence = firstMatchingLine(submittedCode, /^class\s+[A-Za-z_]\w*/);
  const gradedClassEvidence =
    task === 'grading' ? firstMatchingLine(answerSource, /^class\s+[A-Za-z_]\w*/) : null;
  const requestsCompleteClass =
    /complete\s+(?:BinarySearchTree|BST|class)|write\s+(?:a\s+)?(?:BinarySearchTree|BST)|完整\s*(?:的)?\s*(?:BinarySearchTree|BST|类)|实现\s*(?:完整)?\s*(?:的)?\s*(?:BinarySearchTree|BST|类)/i.test(
      message,
    );

  if ((answerDefinesClass || requestsCompleteClass) && answerSource && !representationOverride) {
    if (!hasExactRepresentationInvariantHeading(answerSource)) {
      failures.push(
        checkFailure(
          contract,
          'csc148.ri.heading.exact',
          'Use the exact class-docstring heading "Representation Invariants:" and list the invariants below it.',
          gradedClassEvidence ? [gradedClassEvidence] : [],
        ),
      );
    }
  }

  if (task === 'code_review' && submittedCode && !representationOverride) {
    if (
      /\bclass\s+[A-Za-z_]\w*/.test(submittedCode) &&
      !hasExactRepresentationInvariantHeading(submittedCode) &&
      !answerText.includes('Representation Invariants:')
    ) {
      failures.push(
        checkFailure(
          contract,
          'csc148.ri.heading.exact',
          'Proactively identify the missing CSC148 class-docstring heading and spell it exactly "Representation Invariants:".',
          submittedClassEvidence ? [submittedClassEvidence] : [],
        ),
      );
    }
    if (hasClassOrMutationCode(submittedCode) && !hasRiReviewLanguage(answerText)) {
      failures.push(
        checkFailure(
          contract,
          'csc148.review.ri.proactive_evaluation',
          'Proactively evaluate the submitted class Representation Invariants: state whether __init__ establishes them and whether each mutating method restores them before return.',
        ),
      );
    }
  }

  if (!isBst || representationOverride) return failures;

  if (task === 'code_review' && submittedCode && !hasBstReviewLanguage(answerText)) {
    failures.push(
      checkFailure(
        contract,
        'csc148.review.bst.proactive_evaluation',
        'Proactively name the CSC148 BST representation and inclusive ordering invariant, then say whether the submitted method follows the corresponding one-branch or mutation recipe.',
      ),
    );
  }

  const submittedHasBstInitializer =
    isBst &&
    Boolean(submittedClassName) &&
    extractPythonFunctions(submittedCode).some((fn) => fn.name === '__init__');
  if (task === 'code_review' && submittedHasBstInitializer) {
    const submittedHasEmptyTriplet =
      /self\._root\s*=\s*None/.test(submittedCode) &&
      /self\._left\s*=\s*None/.test(submittedCode) &&
      /self\._right\s*=\s*None/.test(submittedCode);
    if (
      !submittedHasEmptyTriplet &&
      !/_root[\s\S]{0,180}_left[\s\S]{0,180}_right[\s\S]{0,180}None|all\s+(?:three|3)[\s\S]{0,80}None|三个[\s\S]{0,80}None/i.test(
        answerText,
      )
    ) {
      failures.push(
        checkFailure(
          contract,
          'csc148.bst.representation.empty_triplet',
          'Proactively identify that the course empty BST must set _root, _left, and _right all to None.',
          submittedClassEvidence ? [submittedClassEvidence] : [],
        ),
      );
    }
    const submittedHasNonemptyChildren =
      initializesEmptyChildWithClass(submittedCode, '_left', submittedClassName) &&
      initializesEmptyChildWithClass(submittedCode, '_right', submittedClassName);
    const submittedConstructor = submittedClassName
      ? escapeRegExp(submittedClassName)
      : 'BinarySearchTree';
    if (
      !submittedHasNonemptyChildren &&
      !new RegExp(
        `(?:BinarySearchTree|${submittedConstructor})\\s*\\(\\s*None\\s*\\)[\\s\\S]{0,160}(?:_left|_right|children?|子树)|(?:_left|_right|children?|子树)[\\s\\S]{0,160}(?:BinarySearchTree|${submittedConstructor})\\s*\\(\\s*None\\s*\\)`,
        'i',
      ).test(answerText)
    ) {
      failures.push(
        checkFailure(
          contract,
          'csc148.bst.representation.nonempty_children',
          'Proactively identify that each child of a non-empty course BST is a BinarySearchTree(None) object, not None.',
          submittedClassEvidence ? [submittedClassEvidence] : [],
        ),
      );
    }
  }

  const answerDeclaresBstInvariant =
    answerDefinesClass ||
    /Representation Invariants:|Every item in self\._left|left\s+subtree[^\n]*(?:root|_root)|左(?:子树|侧)[^\n]*根/i.test(
      answerSource,
    );
  if (
    answerSource &&
    answerDeclaresBstInvariant &&
    (hasStrictBstOrderingClaim(answerSource) || !hasInclusiveBstOrdering(answerSource))
  ) {
    failures.push(
      checkFailure(
        contract,
        'csc148.bst.ordering.inclusive',
        'State the course BST invariant exactly: every left value is <= the root, every right value is >= the root, and duplicates are allowed in either subtree.',
        task === 'grading'
          ? [
              firstMatchingLine(
                answerSource,
                /(?:self\._left|left\s+subtree|左(?:子树|侧)).*(?:<|小于)/i,
              ) || '',
            ]
          : [],
      ),
    );
  }

  const answerHasBstInitializer =
    isBst &&
    Boolean(answerClassName) &&
    extractPythonFunctions(answerSource).some((fn) => fn.name === '__init__');
  if (answerSource && (requestsCompleteClass || answerHasBstInitializer)) {
    const hasEmptyTriplet =
      /self\._root\s*=\s*None/.test(answerSource) &&
      /self\._left\s*=\s*None/.test(answerSource) &&
      /self\._right\s*=\s*None/.test(answerSource);
    if (!hasEmptyTriplet) {
      failures.push(
        checkFailure(
          contract,
          'csc148.bst.representation.empty_triplet',
          'For the course representation, make an empty BST set _root, _left, and _right all to None.',
          gradedClassEvidence ? [gradedClassEvidence] : [],
        ),
      );
    }
    const hasNonemptyChildren =
      initializesEmptyChildWithClass(answerSource, '_left', answerClassName) &&
      initializesEmptyChildWithClass(answerSource, '_right', answerClassName);
    if (!hasNonemptyChildren) {
      failures.push(
        checkFailure(
          contract,
          'csc148.bst.representation.nonempty_children',
          'For a non-empty course BST, initialize _left and _right as BinarySearchTree(None), not None.',
          gradedClassEvidence ? [gradedClassEvidence] : [],
        ),
      );
    }
  }

  if (answerSource && methodBodyHasInsertOverwrite(answerSource)) {
    const overwriteEvidence = firstMatchingLine(
      answerSource,
      /self\._(?:left|right)\s*=\s*[A-Za-z_]\w*\s*\(/,
    );
    failures.push(
      checkFailure(
        contract,
        'csc148.bst.insert.no_subtree_overwrite',
        'Do not replace an existing child subtree during insert; recursively call self._left.insert(item) or self._right.insert(item).',
        task === 'grading' && overwriteEvidence ? [overwriteEvidence] : [],
      ),
    );
  }
  if (task === 'code_review' && submittedCode && methodBodyHasInsertOverwrite(submittedCode)) {
    const diagnosesOverwrite =
      /overwrite|replace(?:s|d)?\s+(?:an\s+)?existing\s+(?:child\s+)?subtree|覆盖|替换已有(?:的)?(?:子树|节点)/i.test(
        answerText,
      );
    const correctedRecursion =
      !answerSource ||
      (/self\._left\.insert\s*\(/.test(answerSource) &&
        /self\._right\.insert\s*\(/.test(answerSource));
    if (!diagnosesOverwrite || !correctedRecursion) {
      const overwriteEvidence = firstMatchingLine(
        submittedCode,
        /self\._(?:left|right)\s*=\s*[A-Za-z_]\w*\s*\(/,
      );
      failures.push(
        checkFailure(
          contract,
          'csc148.bst.insert.no_subtree_overwrite',
          'Proactively diagnose that the submitted insert overwrites an existing subtree, and if you show corrected code recurse into the existing child BST.',
          overwriteEvidence ? [overwriteEvidence] : [],
        ),
      );
    }
  }

  const answerSearchFunctions = extractPythonFunctions(answerSource).filter((fn) =>
    isBstSearchMethod(fn.name),
  );
  for (const fn of answerSearchFunctions) {
    if (!bstSearchUsesGeneralTreeBranching(fn)) continue;
    failures.push(
      checkFailure(
        contract,
        'csc148.bst.search.single_branch',
        `${fn.name}: compare with _root and recurse into only the left or right subtree selected by the BST ordering invariant.`,
        task === 'grading'
          ? [
              firstMatchingLine(
                fn.body,
                /self\._left.*\b(?:or|and)\b.*self\._right|self\._right.*\b(?:or|and)\b.*self\._left/,
              ) || fn.header,
            ]
          : [],
      ),
    );
  }
  if (task === 'code_review' && submittedCode) {
    for (const fn of extractPythonFunctions(submittedCode).filter((candidate) =>
      isBstSearchMethod(candidate.name),
    )) {
      if (!bstSearchUsesGeneralTreeBranching(fn)) continue;
      const answerDiagnosesSingleBranch =
        /(?:only|exactly|只|仅)[\s\S]{0,60}(?:one|1|一个|一边|一棵)[\s\S]{0,60}(?:subtree|branch|子树|分支)|(?:ordering|BST|排序|有序)[\s\S]{0,80}(?:choose|route|select|选择|决定)[\s\S]{0,50}(?:left|right|左|右)/i.test(
          answerText,
        );
      if (answerDiagnosesSingleBranch) continue;
      const branchingEvidence =
        firstMatchingLine(
          fn.body,
          /self\._left.*\b(?:or|and)\b.*self\._right|self\._right.*\b(?:or|and)\b.*self\._left/,
        ) || fn.header;
      failures.push(
        checkFailure(
          contract,
          'csc148.bst.search.single_branch',
          `${fn.name}: proactively explain that this searches both sides like a general tree; CSC148 BST search must use the root comparison to choose exactly one subtree.`,
          [branchingEvidence],
        ),
      );
    }
  }

  if (
    task === 'code_review' &&
    submittedCode &&
    hasStrictBstOrderingClaim(submittedCode) &&
    !/(?:<=|>=|duplicates?|重复值|小于等于|大于等于)/i.test(answerText)
  ) {
    failures.push(
      checkFailure(
        contract,
        'csc148.bst.ordering.inclusive',
        'Proactively correct the submitted strict BST invariant: CSC148 permits duplicates, so use <= on the left and >= on the right.',
        [
          firstMatchingLine(
            submittedCode,
            /(?:self\._left|left\s+subtree|左(?:子树|侧)).*(?:<|小于)/i,
          ) ||
            submittedClassEvidence ||
            '',
        ],
      ),
    );
  }

  return failures;
}

export function validateCourseAnswerContract(args: {
  courseCode?: string | null;
  courseName?: string | null;
  courseId?: string | null;
  notebookId?: string | null;
  notebookName?: string | null;
  message: string;
  answerText: string;
  answerCode?: string;
  taskHint?: CourseAnswerContractTask;
}): CourseAnswerContractValidationResult {
  const contract = resolveCourseAnswerContract(args);
  if (!contract) return { matched: false, failures: [] };

  const task = args.taskHint ?? inferCourseAnswerContractTask(args.message);
  if (task === 'not_applicable') {
    return {
      matched: true,
      courseCode: contract.courseCode,
      contractId: contract.id,
      version: contract.version,
      task,
      representationProfile: 'not_applicable',
      failures: [],
    };
  }

  const representationOverride =
    contract.courseCode === 'CSC148' && explicitBstRepresentationVariant(args.message);
  const failures =
    contract.courseCode === 'CSC108'
      ? validateCsc108({
          contract,
          message: args.message,
          answerText: args.answerText,
          answerCode: args.answerCode || '',
          task,
        })
      : validateCsc148({
          contract,
          message: args.message,
          answerText: args.answerText,
          answerCode: args.answerCode || '',
          task,
          representationOverride,
        });

  const uniqueFailures = [
    ...new Map(failures.map((failure) => [failure.checkId, failure])).values(),
  ];
  return {
    matched: true,
    courseCode: contract.courseCode,
    contractId: contract.id,
    version: contract.version,
    task,
    representationProfile: representationOverride ? 'visible_problem_override' : 'course_default',
    failures: uniqueFailures,
  };
}

/**
 * Convert direct course-contract failures in student-authored code into the
 * compact learner-state shape used by the memory write path.
 *
 * Generation failures and assistant-only review omissions intentionally return
 * null: neither is evidence about learner mastery. The caller still passes the
 * result through the ordinary learner-memory evidence and promotion gates.
 */
export function buildCourseAnswerContractMemorySignal(
  result: CourseAnswerContractValidationResult,
): CourseAnswerContractMemorySignal | null {
  if (
    !result.matched ||
    !result.contractId ||
    !result.courseCode ||
    (result.task !== 'code_review' && result.task !== 'grading')
  ) {
    return null;
  }

  const mapped = result.failures
    .map((failure) => {
      const teachingMemory = (
        COURSE_ANSWER_CONTRACT_TEACHING_MEMORY as Record<
          string,
          CourseAnswerContractTeachingMemory | undefined
        >
      )[failure.checkId];
      return teachingMemory && failure.studentEvidence.length > 0
        ? { failure, teachingMemory }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        failure: CourseAnswerContractValidationFailure;
        teachingMemory: CourseAnswerContractTeachingMemory;
      } => Boolean(item),
    );
  if (mapped.length === 0) return null;

  const primary = mapped[0]!;
  const sameKnowledgePoint = mapped.filter(
    (item) => item.teachingMemory.knowledgePoint === primary.teachingMemory.knowledgePoint,
  );
  const compactUnique = (values: string[], maxItems: number, maxChars: number): string =>
    [...new Set(values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean))]
      .slice(0, maxItems)
      .join(' ')
      .slice(0, maxChars)
      .trim();

  return {
    contractId: result.contractId,
    courseCode: result.courseCode,
    knowledgePoint: primary.teachingMemory.knowledgePoint,
    masteredSignal: null,
    stuckPoint: compactUnique(
      sameKnowledgePoint.map((item) => item.teachingMemory.stuckPoint),
      3,
      1_000,
    ),
    cause: compactUnique(
      sameKnowledgePoint.map((item) => item.teachingMemory.cause),
      2,
      1_000,
    ),
    nextTeachingMove: compactUnique(
      sameKnowledgePoint.map((item) => item.teachingMemory.nextTeachingMove),
      2,
      1_000,
    ),
    confidence: 'high',
    evidenceFromMessage: [
      ...new Set(
        sameKnowledgePoint
          .flatMap((item) => item.failure.studentEvidence)
          .map((excerpt) => excerpt.replace(/\s+/g, ' ').trim())
          .filter(Boolean),
      ),
    ]
      .slice(0, 6)
      .map((excerpt) => excerpt.slice(0, 320)),
    contractCheckIds: sameKnowledgePoint.map((item) => item.failure.checkId),
  };
}

export function formatCourseAnswerContractValidationFailures(
  result: CourseAnswerContractValidationResult,
): string[] {
  return result.failures.map(
    (failure) =>
      `${failure.checkId}; ${failure.message}; evidence=${failure.evidenceRefs.join(',')}`,
  );
}
