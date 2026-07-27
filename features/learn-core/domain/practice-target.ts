export function explicitPracticeTarget(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (/讲解.*练题|练题.*讲解|讲解.*做题|做题.*讲解|都有|都要|both/i.test(trimmed)) {
    return null;
  }
  if (!/(练题目?|做题|刷题|练习|practice|quiz)/i.test(trimmed)) return null;

  const plannedTopicMatch =
    trimmed.match(
      /(?:从题库(?:里)?\s*)?(?:选|挑)\s*\d*\s*道\s+(.+?)\s*(?:题|练习)(?:[，,。]|$)/i,
    ) || trimmed.match(/制定(?:一个|一份)?\s+(.+?)\s+(?:复习|练习|刷题)(?:计划)?(?:[，,。]|$)/i);
  if (plannedTopicMatch?.[1]?.trim()) {
    return plannedTopicMatch[1].trim();
  }

  const directMatch =
    trimmed.match(
      /(?:我想|想|我要|需要|请)?\s*(?:练题目?|做题|刷题|练习|practice|quiz)\s*[：:]\s*(.+)$/i,
    ) ||
    trimmed.match(
      /(?:我想|想|我要|需要|请)?\s*(?:练题目?|做题|刷题|练习|practice|quiz)(?:一下|一组|一些|点)?\s+(.+)$/i,
    );
  const rawTarget = (directMatch?.[1] || trimmed)
    .replace(/^(?:我)?(?:需要|想要|想|要|准备|打算)\s*/i, '')
    .replace(/^(?:我)?(?:需要|想要|想)?\s*复习\s*/i, '')
    .replace(/^(?:复习|练习|巩固|刷)\s*/i, '')
    .replace(/^复习\s*/i, '')
    .replace(/^关于\s*/i, '')
    .trim();
  return rawTarget || trimmed;
}
