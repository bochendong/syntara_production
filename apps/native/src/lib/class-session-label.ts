/** Older sessions and older servers keep the numbered classroom label. */
export function classSessionLabel(session: { number: number; name?: string | null }) {
  return session.name?.trim() || `第 ${session.number} 节`;
}
