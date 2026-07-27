'use client';

import { FloatingLinesStageBackground } from '@/components/gamification/floating-lines-stage-background';
import { LightRaysStageBackground } from '@/components/gamification/light-rays-stage-background';
import { PixelSnowStageBackground } from '@/components/gamification/pixel-snow-stage-background';
import { SoftAuroraStageBackground } from '@/components/gamification/soft-aurora-stage-background';
import { LightPillarStageBackground } from '@/components/gamification/light-pillar-stage-background';
import { PrismStageBackground } from '@/components/gamification/prism-stage-background';
import { PlasmaWaveStageBackground } from '@/components/gamification/plasma-wave-stage-background';
import { ColorBendsStageBackground } from '@/components/gamification/color-bends-stage-background';
import { ParticlesStageBackground } from '@/components/gamification/particles-stage-background';
import { EvilEyeStageBackground } from '@/components/gamification/evil-eye-stage-background';
import type { Live2DPresenterModelId } from '@/lib/live2d/presenter-models';

export function Live2DCompanionStageBackdrop({
  modelId,
  skinId,
}: {
  modelId: Live2DPresenterModelId | null;
  skinId?: string | null;
}) {
  return <>{modelId === 'haru' && skinId === 'haru-clear' ? (
  <PrismStageBackground
    className="pointer-events-none absolute inset-0 z-0 opacity-70"
    timeScale={0.5}
    height={3.5}
    baseWidth={5.5}
    scale={3.6}
    hueShift={0}
    colorFrequency={1}
    noise={0}
    glow={1}
    bloom={1}
  />
) : null}
{modelId === 'hiyori' && skinId === 'hiyori-moon' ? (
  <LightPillarStageBackground
    className="pointer-events-none absolute inset-0 z-0 opacity-60"
    topColor="#7C4DFF"
    bottomColor="#F7A8FF"
    intensity={1}
    rotationSpeed={0.3}
    glowAmount={0.002}
    pillarWidth={3}
    pillarHeight={0.4}
    noiseIntensity={0.5}
    pillarRotation={25}
    interactive={false}
    mixBlendMode="screen"
    quality="high"
  />
) : null}
{modelId === 'hiyori' && skinId === 'hiyori-sakura' ? (
  <PixelSnowStageBackground
    className="pointer-events-none absolute inset-0 z-0 opacity-65"
    color="#ffffff"
    flakeSize={0.01}
    minFlakeSize={1.25}
    pixelResolution={200}
    speed={1.25}
    density={0.3}
    direction={125}
    brightness={1}
    depthFade={8}
    farPlane={20}
    gamma={0.4545}
    variant="square"
  />
) : null}
{modelId === 'haru' && skinId === 'haru-sunrise' ? (
  <FloatingLinesStageBackground
    className="pointer-events-none absolute inset-0 z-0 opacity-55"
    interactive
    animationSpeed={1}
    gradientStart="#e945f5"
    gradientMid="#6f6f6f"
    gradientEnd="#6a6a6a"
    mixBlendMode="screen"
  />
) : null}
{modelId === 'mark' && skinId === 'mark-command' ? (
  <LightRaysStageBackground
    className="pointer-events-none absolute inset-0 z-0 opacity-60"
    raysOrigin="top-center"
    raysColor="#ffffff"
    raysSpeed={1}
    lightSpread={0.5}
    rayLength={3}
    followMouse
    mouseInfluence={0.1}
    noiseAmount={0}
    distortion={0}
    pulsating={false}
    fadeDistance={1}
    saturation={1}
  />
) : null}
{modelId === 'mark' && skinId === 'mark-sprint' ? (
  <SoftAuroraStageBackground
    className="pointer-events-none absolute inset-0 z-0 opacity-55"
    speed={0.6}
    scale={1.5}
    brightness={1}
    color1="#f7f7f7"
    color2="#e100ff"
    noiseFrequency={2.5}
    noiseAmplitude={1}
    bandHeight={0.5}
    bandSpread={1}
    octaveDecay={0.1}
    layerOffset={0}
    colorSpeed={1}
    enableMouseInteraction
    mouseInfluence={0.25}
  />
) : null}
{modelId === 'mao' && skinId === 'mao-pop' ? (
  <ParticlesStageBackground
    className="absolute inset-0 z-0 opacity-65"
    particleColors={['#ffffff']}
    particleCount={200}
    particleSpread={10}
    speed={0.1}
    particleBaseSize={100}
    moveParticlesOnHover
    alphaParticles={false}
    disableRotation={false}
    pixelRatio={1}
  />
) : null}
{modelId === 'mao' && skinId === 'mao-spark' ? (
  <EvilEyeStageBackground
    className="absolute inset-0 z-0 opacity-75"
    eyeColor="#FF6F37"
    intensity={1.5}
    pupilSize={0.6}
    irisWidth={0.25}
    glowIntensity={0.35}
    scale={0.8}
    noiseScale={1}
    pupilFollow={1}
    flameSpeed={1}
    backgroundColor="#120F17"
  />
) : null}
{modelId === 'rice' && skinId === 'rice-warm' ? (
  <ColorBendsStageBackground
    className="absolute inset-0 z-0 opacity-70"
    colors={['#ff5c7a', '#8a5cff', '#7dd3fc']}
    rotation={90}
    speed={0.2}
    scale={1}
    frequency={1}
    warpStrength={1}
    mouseInfluence={1}
    noise={0.15}
    parallax={0.5}
    iterations={1}
    intensity={1.5}
    bandWidth={6}
    transparent
    autoRotate={0}
  />
) : null}
{modelId === 'rice' && skinId === 'rice-dusk' ? (
  <PlasmaWaveStageBackground
    className="pointer-events-none absolute inset-0 z-0 opacity-70"
    colors={['#A855F7', '#38bdf8']}
    speed1={0.05}
    speed2={0.05}
    focalLength={0.8}
    bend1={1}
    bend2={0.5}
    dir2={1}
    rotationDeg={0}
  />
) : null}
  </>;
}
