export function stripStreamingBlockquoteMarkers(rawText: string, existingText: string): string {
  let text = rawText.replace(/\n>+\s?/g, '\n');
  if ((!existingText || existingText.endsWith('\n')) && text.startsWith('>')) {
    text = text.replace(/^>+\s?/, '');
  }
  return text;
}
