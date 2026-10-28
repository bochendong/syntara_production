/** Display answer references as numbered blanks, including inside code fences. */
export function fillBlankPrompt(template: string, blankIds: readonly string[]): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, raw: string) => {
    const index = blankIds.indexOf(raw.trim());
    return index >= 0 ? `[${index + 1}] ____` : '____';
  });
}
