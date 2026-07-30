const LEARNER_PROFILE_STORAGE_KEY = 'syntara.native.learner-profile.v1';
const LEARNER_PROFILE_CHANGED_EVENT = 'syntara-native-learner-profile-changed';

export type LearnerProfile = {
  avatarId: string | null;
  name: string;
  signature: string;
  school: string;
  updatedAt: number;
};

export const DEFAULT_LEARNER_PROFILE: LearnerProfile = {
  avatarId: null,
  name: '本机学习者',
  signature: '本地模式不依赖在线账户即可使用课程内容。',
  school: '',
  updatedAt: 0,
};

function isLearnerProfile(value: unknown): value is LearnerProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<LearnerProfile>;
  return (
    (profile.avatarId === null || typeof profile.avatarId === 'string') &&
    typeof profile.name === 'string' &&
    typeof profile.signature === 'string' &&
    typeof profile.school === 'string' &&
    typeof profile.updatedAt === 'number'
  );
}

export function readStoredLearnerProfile(): LearnerProfile {
  try {
    const raw = window.localStorage.getItem(LEARNER_PROFILE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LEARNER_PROFILE };
    const parsed = JSON.parse(raw) as unknown;
    if (!isLearnerProfile(parsed)) return { ...DEFAULT_LEARNER_PROFILE };
    return {
      avatarId: parsed.avatarId,
      name: parsed.name.trim() || DEFAULT_LEARNER_PROFILE.name,
      signature: parsed.signature,
      school: parsed.school,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return { ...DEFAULT_LEARNER_PROFILE };
  }
}

export function writeStoredLearnerProfile(profile: Omit<LearnerProfile, 'updatedAt'>): LearnerProfile {
  const next: LearnerProfile = {
    avatarId: profile.avatarId,
    name: profile.name.trim() || DEFAULT_LEARNER_PROFILE.name,
    signature: profile.signature.trim(),
    school: profile.school.trim(),
    updatedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(LEARNER_PROFILE_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(LEARNER_PROFILE_CHANGED_EVENT));
  } catch {
    // Ignore storage failures; in-memory draft still works for this session.
  }
  return next;
}

export function subscribeLearnerProfile(listener: () => void): () => void {
  window.addEventListener(LEARNER_PROFILE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(LEARNER_PROFILE_CHANGED_EVENT, listener);
}
