import Image from 'next/image';

import styles from './landing.module.css';

export type LandingScene =
  | 'hero'
  | 'notes'
  | 'classroom'
  | 'problems'
  | 'memory'
  | 'calendar'
  | 'closing';

/** The opening starfield leads into a shared glass setting for the feature screens. */
export function ScreenBackdrop({
  scene,
  priority = false,
}: {
  scene: LandingScene;
  priority?: boolean;
}) {
  return (
    <div className={styles.backdrop} data-scene={scene} aria-hidden>
      <Image
        src={
          scene === 'hero'
            ? '/home/backgrounds-v3/hero-starry.webp'
            : '/home/backgrounds-v2/shared.webp'
        }
        alt=""
        fill
        sizes="100vw"
        priority={priority}
        className={styles.backdropArt}
      />
      <div className={styles.backdropGlow} />
      <div className={styles.backdropShade} />
    </div>
  );
}
