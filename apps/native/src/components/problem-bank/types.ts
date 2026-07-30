export type NotebookProblemImageAsset = {
  id: string;
  src: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
  mimeType?: string;
};

export type CodeStatementKind =
  | 'overview'
  | 'requirements'
  | 'interface'
  | 'invariants'
  | 'examples'
  | 'constraints'
  | 'notes';

export type CodeStatementSection = {
  id: string;
  kind?: CodeStatementKind;
  title: string;
  body?: string;
  items?: string[];
  code?: string;
  codeLanguage?: string;
  language?: string;
};

export type CodeSampleIO = {
  input: string;
  output: string;
  explanation?: string;
};

export type CodePublicTest = {
  id: string;
  expression: string;
  expected: string;
  description?: string;
};

export type NotebookProblemPublicContent =
  | {
      type: 'short_answer' | 'proof' | 'calculation' | 'choice' | 'fill_blank';
      stem?: string;
      stemTemplate?: string;
      explanation?: string;
      assets?: { images?: NotebookProblemImageAsset[] };
      options?: Array<{ id: string; label: string }>;
      blanks?: Array<{ id: string; placeholder?: string }>;
      selectionMode?: 'single' | 'multiple';
    }
  | {
      type: 'code';
      stem: string;
      language?: 'python' | string;
      starterCode?: string;
      functionSignature?: string;
      constraints: string[];
      publicTests: CodePublicTest[];
      sampleIO: CodeSampleIO[];
      statementSections?: CodeStatementSection[];
      starterCodeDescription?: string;
      explanation?: string;
      assets?: { images?: NotebookProblemImageAsset[] };
    };
