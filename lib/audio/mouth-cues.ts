import type { MouthCue, MouthShape, SpeechVisemeCue } from '@/lib/types/action';

const CLOSED_VISEME_IDS = new Set([0, 21]);

function compactMouthCues(cues: MouthCue[]): MouthCue[] {
  const compacted: MouthCue[] = [];

  for (const cue of cues) {
    if (cue.endMs <= cue.startMs) continue;
    const previous = compacted[compacted.length - 1];

    if (previous && previous.shape === cue.shape && Math.abs(previous.endMs - cue.startMs) <= 24) {
      previous.endMs = Math.max(previous.endMs, cue.endMs);
      continue;
    }

    compacted.push({ ...cue });
  }

  return compacted;
}

export function mapAzureVisemeToMouthShape(visemeId: number): MouthShape {
  switch (visemeId) {
    case 0:
    case 21:
      return 'closed';
    case 1:
    case 2:
    case 9:
    case 11:
      return 'A';
    case 6:
      return 'I';
    case 7:
      return 'U';
    case 3:
    case 8:
    case 10:
      return 'O';
    default:
      return 'E';
  }
}

export function mapAzureVisemeToLegacyMouthShape(
  visemeId: number | null | undefined,
): MouthShape | null {
  if (visemeId == null) return null;
  return mapAzureVisemeToMouthShape(visemeId);
}

export function normalizeAzureVisemesToMouthCues(
  visemes: SpeechVisemeCue[] | undefined,
): MouthCue[] | undefined {
  if (!visemes?.length) return undefined;

  const cues: MouthCue[] = [];
  for (let index = 0; index < visemes.length; index++) {
    const current = visemes[index];
    const next = visemes[index + 1];
    const gapMs =
      next && next.offsetMs > current.offsetMs
        ? next.offsetMs - current.offsetMs
        : CLOSED_VISEME_IDS.has(current.visemeId)
          ? 72
          : 128;
    const startMs = Math.max(0, current.offsetMs);
    const endMs = startMs + Math.max(48, gapMs);

    cues.push({
      startMs,
      endMs,
      shape: mapAzureVisemeToMouthShape(current.visemeId),
    });
  }

  return compactMouthCues(cues);
}

export function mapRhubarbCueToMouthShape(value: string): MouthShape {
  switch (value.toUpperCase()) {
    case 'X':
    case 'A':
      return 'closed';
    case 'C':
      return 'I';
    case 'D':
      return 'A';
    case 'E':
      return 'O';
    case 'F':
      return 'U';
    default:
      return 'E';
  }
}

export function normalizeRhubarbMouthCues(
  cues: Array<{ start: number; end: number; value: string }> | undefined,
): MouthCue[] | undefined {
  if (!cues?.length) return undefined;

  return compactMouthCues(
    cues.map((cue) => ({
      startMs: Math.max(0, Math.round(cue.start * 1000)),
      endMs: Math.max(0, Math.round(cue.end * 1000)),
      shape: mapRhubarbCueToMouthShape(cue.value),
    })),
  );
}

export function resolveCurrentMouthCueFrame(
  mouthCues: MouthCue[] | undefined,
  currentTimeMs: number,
): { mouthShape: MouthShape | null; cadence: 'active' | 'pause' } {
  if (!mouthCues?.length) {
    return { mouthShape: null, cadence: 'pause' };
  }

  const currentCue = mouthCues.find(
    (cue) => currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs,
  );

  if (!currentCue) {
    return { mouthShape: null, cadence: 'pause' };
  }

  const cueDurationMs = currentCue.endMs - currentCue.startMs;
  return {
    mouthShape: currentCue.shape,
    cadence: currentCue.shape === 'closed' && cueDurationMs >= 90 ? 'pause' : 'active',
  };
}
