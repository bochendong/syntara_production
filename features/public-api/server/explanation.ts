import type { LanguageModel } from 'ai';
import { callLLM } from '@/lib/ai/llm';

export type PublicExplanationInput = {
  kind: 'concept' | 'problem';
  topic: string;
  courseName?: string;
  language: 'zh-CN' | 'en-US';
  sourceNotes: Array<{ title: string; content: string; sourceRef?: string }>;
  /** Photos of the problem or the learner's work; sent to the model as image parts. */
  images?: Array<{ dataBase64: string; mimeType: string }>;
};

function explanationPrompt(input: PublicExplanationInput): string {
  const sourceBoundary = input.sourceNotes.length
    ? [
        'Use the attached note excerpts first. Mark source-backed claims with [source: <title or sourceRef>].',
        'If the notes are insufficient, explicitly label additional material as general knowledge.',
        ...input.sourceNotes.map(
          (note, index) =>
            `SOURCE ${index + 1}: ${note.title}${note.sourceRef ? ` (${note.sourceRef})` : ''}\n${note.content}`,
        ),
      ].join('\n\n')
    : 'No course notes were supplied. Use general knowledge only and state that no course notes were used.';
  const task =
    input.kind === 'concept'
      ? [
          'Explain the concept as a self-contained lesson.',
          'Start with the learning target and an intuitive model.',
          'Give the exact definition, conditions, and boundaries.',
          'Walk through one checkable example.',
          'Correct at least one common misconception.',
          'End with one lightweight self-check question.',
        ]
      : [
          'Explain the problem completely.',
          'Restate the knowns, target, and easily missed constraints.',
          'Explain the method-selection signal and why the method applies.',
          'Show the solution step by step with the purpose and basis of each step.',
          'Give the final conclusion, a checking method, and common wrong approaches.',
        ];

  const imageNote = input.images?.length
    ? `The learner attached ${input.images.length} image(s) of the problem or their own work. Read them carefully, restate the relevant problem text (with formulas in LaTeX) before explaining, and say so if any part is unreadable.`
    : '';

  return [
    `Output language: ${input.language === 'en-US' ? 'English' : 'Simplified Chinese'}`,
    `Course: ${input.courseName || 'not specified'}`,
    `Topic or problem:\n${input.topic}`,
    imageNote,
    `Requirements:\n- ${task.join('\n- ')}`,
    `Evidence boundary:\n${sourceBoundary}`,
    'Return polished Markdown only. Do not create calendar, practice, memory, or classroom actions.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function generatePublicExplanation(args: {
  model: LanguageModel;
  input: PublicExplanationInput;
}) {
  const system =
    'You are a careful course tutor. Teach directly, preserve evidence boundaries, and return only the requested learner-facing Markdown.';
  const prompt = explanationPrompt(args.input);
  const images = args.input.images ?? [];
  const result = await callLLM(
    images.length
      ? {
          model: args.model,
          system,
          messages: [
            {
              role: 'user' as const,
              content: [
                { type: 'text' as const, text: prompt },
                ...images.map((image) => ({
                  type: 'image' as const,
                  image: image.dataBase64,
                  mediaType: image.mimeType,
                })),
              ],
            },
          ],
          maxOutputTokens: 7000,
          maxRetries: 0,
        }
      : {
          model: args.model,
          system,
          prompt,
          maxOutputTokens: 7000,
          maxRetries: 0,
        },
    'public-api-explanation',
  );
  return { markdown: result.text.trim(), usage: result.usage };
}
