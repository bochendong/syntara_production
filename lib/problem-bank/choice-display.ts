/** Keep stable answer IDs separate from student-facing option letters. */
export function choiceDisplayLabel(id: string, index: number): string {
  return /^[A-Z]$/.test(id) ? id : String.fromCharCode(65 + index);
}
