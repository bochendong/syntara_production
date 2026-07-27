'use client';

import dynamic from 'next/dynamic';
import type { CSSProperties } from 'react';
import { getLearnBackground, type LearnBackgroundId } from '@/lib/learn/learn-backgrounds';
import { cn } from '@/lib/utils';

const SoftAuroraStageBackground = dynamic(
  () =>
    import('@/components/gamification/soft-aurora-stage-background').then(
      (module) => module.SoftAuroraStageBackground,
    ),
  { ssr: false },
);

const ParticlesStageBackground = dynamic(
  () =>
    import('@/components/gamification/particles-stage-background').then(
      (module) => module.ParticlesStageBackground,
    ),
  { ssr: false },
);

const FloatingLinesStageBackground = dynamic(
  () =>
    import('@/components/gamification/floating-lines-stage-background').then(
      (module) => module.FloatingLinesStageBackground,
    ),
  { ssr: false },
);

type LearnBackgroundVisualProps = {
  backgroundId: LearnBackgroundId;
  className?: string;
  preview?: boolean;
};

export function LearnBackgroundVisual({
  backgroundId,
  className,
  preview = false,
}: LearnBackgroundVisualProps) {
  const background = getLearnBackground(backgroundId);

  if (background.kind === 'static') {
    const style: CSSProperties = {
      backgroundImage: `url("${preview ? background.previewUrl : background.imageUrl}")`,
    };
    return (
      <div
        className={cn('bg-cover bg-center', className)}
        style={style}
        data-learn-background={background.id}
        aria-hidden="true"
      />
    );
  }

  if (preview) {
    const previewClassName =
      background.id === 'soft-aurora'
        ? 'bg-[radial-gradient(ellipse_at_35%_75%,rgba(79,156,255,0.9),transparent_38%),radial-gradient(ellipse_at_72%_38%,rgba(217,117,255,0.75),transparent_42%),linear-gradient(145deg,#070a17,#182350)]'
        : background.id === 'star-particles'
          ? 'bg-[radial-gradient(circle_at_18%_24%,rgba(255,255,255,0.95)_0_1px,transparent_2px),radial-gradient(circle_at_72%_34%,rgba(168,199,255,0.9)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_42%_78%,rgba(217,184,255,0.9)_0_1px,transparent_2px),radial-gradient(circle_at_50%_25%,#283568_0%,#10162f_42%,#060817_100%)] bg-[length:54px_54px,76px_76px,92px_92px,100%_100%]'
          : 'bg-[radial-gradient(ellipse_at_20%_70%,rgba(94,215,255,0.55),transparent_34%),radial-gradient(ellipse_at_78%_42%,rgba(239,133,255,0.5),transparent_36%),linear-gradient(145deg,#071525_0%,#10213e_48%,#180d31_100%)]';
    return (
      <div
        className={cn(previewClassName, className)}
        data-learn-background={background.id}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      className={cn('overflow-hidden', className)}
      data-learn-background={background.id}
      aria-hidden="true"
    >
      {background.id === 'soft-aurora' ? (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_115%,#273578_0%,#11152e_42%,#070a17_78%)]">
          <SoftAuroraStageBackground
            className="absolute inset-0"
            speed={0.35}
            brightness={0.9}
            color1="#4f9cff"
            color2="#d975ff"
            enableMouseInteraction={false}
          />
        </div>
      ) : null}

      {background.id === 'star-particles' ? (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,#283568_0%,#10162f_40%,#060817_100%)]">
          <ParticlesStageBackground
            className="absolute inset-0"
            particleColors={['#ffffff', '#a8c7ff', '#d9b8ff']}
            particleCount={160}
            particleSpread={13}
            particleBaseSize={90}
            speed={0.045}
            alphaParticles
          />
        </div>
      ) : null}

      {background.id === 'floating-waves' ? (
        <div className="absolute inset-0 bg-[linear-gradient(145deg,#071525_0%,#10213e_48%,#180d31_100%)]">
          <FloatingLinesStageBackground
            className="absolute inset-0"
            gradientStart="#5ed7ff"
            gradientMid="#8c7dff"
            gradientEnd="#ef85ff"
            animationSpeed={0.45}
            interactive
          />
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.035] to-black/10" />
    </div>
  );
}
