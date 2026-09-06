'use client';

import { useAiActivity } from '@/lib/ai-progress/use-ai-activity';
import styles from './ai-activity-light.module.css';

/** Decorative activity signal. All completion/progress text remains in the task UI. */
export function AiActivityLight() {
  const active = useAiActivity();
  return active ? (
    <span data-ai-activity-light aria-hidden="true" className={styles.light} />
  ) : null;
}
