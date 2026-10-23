import type { CSSProperties } from 'react';

import biology from '@/apps/native/src/assets/marbles/ex-any-biology.webp';
import chemistry from '@/apps/native/src/assets/marbles/ex-any-chemistry.webp';
import mushroom from '@/apps/native/src/assets/marbles/ex-any-mushroom.webp';
import ocean from '@/apps/native/src/assets/marbles/ex-any-ocean.webp';
import rainforest from '@/apps/native/src/assets/marbles/ex-any-rainforest.webp';
import blue from '@/apps/native/src/assets/marbles/sr-blue-cloud.webp';
import green from '@/apps/native/src/assets/marbles/sr-green-aurora.webp';
import pink from '@/apps/native/src/assets/marbles/sr-pink-sakura.webp';
import purple from '@/apps/native/src/assets/marbles/sr-purple-moon.webp';
import cosmos from '@/apps/native/src/assets/marbles/ssr-any-cosmos.webp';
import amber from '@/apps/native/src/assets/marbles/ssr-any-gold.webp';

/** Shared artwork for canvas sprites, decorative marbles, and navigation. */
export const LANDING_MARBLE_ART = {
  pink,
  amber,
  blue,
  green,
  purple,
  cosmos,
  biology,
  chemistry,
  ocean,
  rainforest,
  mushroom,
} as const;

export const LANDING_MARBLE_STYLE = Object.fromEntries(
  Object.entries(LANDING_MARBLE_ART).map(([name, art]) => [
    `--marble-${name}`,
    `url("${art.src}")`,
  ]),
) as CSSProperties;

export const CLOSING_MARBLES = ['chemistry', 'rainforest', 'ocean', 'biology', 'mushroom'] as const;
