/** Keep one failed source from preventing the others from refreshing. */
export async function independentCourseRefresh<Page, Content>(tasks: {
  problems: () => Promise<boolean>;
  conversations: () => Promise<Page>;
  content: () => Promise<Content>;
  shouldStop?: () => boolean;
  onError: (source: 'problems' | 'conversations' | 'content', error: unknown) => void;
}): Promise<{ problems: boolean; conversations: Page | null; content: Content | null }> {
  // Run serially: each task may use the same local SQLite connection.
  let problems = false;
  let conversations: Page | null = null;
  let content: Content | null = null;
  if (!tasks.shouldStop?.()) {
    try {
      conversations = await tasks.conversations();
    } catch (error) {
      tasks.onError('conversations', error);
    }
  }
  if (!tasks.shouldStop?.()) {
    try {
      content = await tasks.content();
    } catch (error) {
      tasks.onError('content', error);
    }
  }
  if (!tasks.shouldStop?.()) {
    try {
      problems = await tasks.problems();
    } catch (error) {
      tasks.onError('problems', error);
    }
  }
  return { problems, conversations, content };
}
