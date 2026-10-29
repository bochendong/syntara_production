import { browserAccountId, platformAvailable } from './browser-runtime';
import { readStoredLearnerProfile, mergeStoredLearnerProfile } from './learner-profile';
import { syncNativePreferences } from './platform-api-client';
const tourKey = (kind: string) => `syntara:feature-guide:v1:${browserAccountId()}:${kind}`;
let running: Promise<void> | undefined;
export function syncAccountPreferences(): Promise<void> {
  if (!platformAvailable()) return Promise.resolve();
  if (running) return running;
  const account = browserAccountId();
  running = (async () => {
    const profile = readStoredLearnerProfile();
    const remote = await syncNativePreferences({
      ...(profile.updatedAt > 0 ? { profile } : {}),
      ...(localStorage.getItem(tourKey('memory')) ? { memoryTourSeen: true } : {}),
      ...(localStorage.getItem(tourKey('progress')) ? { progressTourSeen: true } : {}),
    });
    if (browserAccountId() !== account) return;
    if (remote.profile) mergeStoredLearnerProfile(remote.profile);
    if (remote.memoryTourSeen) localStorage.setItem(tourKey('memory'), 'seen');
    if (remote.progressTourSeen) localStorage.setItem(tourKey('progress'), 'seen');
    window.dispatchEvent(new Event('syntara:preferences-synced'));
  })().finally(() => {
    running = undefined;
  });
  return running;
}
