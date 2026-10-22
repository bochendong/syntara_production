import { MARBLE_AVATAR_URLS } from './marble-avatars';

/**
 * Shared constants for agent profile generation.
 *
 * Used by API routes and server-side generation to keep colors and avatars in sync.
 */

/** Color palette cycled for generated agents */
export const AGENT_COLOR_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
  '#f97316',
  '#14b8a6',
  '#e11d48',
  '#6366f1',
  '#84cc16',
  '#a855f7',
] as const;

/**
 * Default avatar paths cycled for generated agents.
 *
 * Every entry must correspond to a file under `public/avatars/`.
 */
export const AGENT_DEFAULT_AVATARS = MARBLE_AVATAR_URLS;
