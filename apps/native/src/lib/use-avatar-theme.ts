import { useEffect, useState, type CSSProperties } from 'react';

import { nativeAccountAvatarUrl, profileThemeForAvatar } from '../assets';
import { readStoredLearnerProfile, subscribeLearnerProfile } from '../data/learner-profile';
import { loadNativeAuthSession, subscribeNativeAuth } from '../data/native-auth';
import { useSidebarBackground } from './use-sidebar-background';

type AvatarThemeStyle = CSSProperties & {
  '--avatar-sidebar-image': string;
  '--avatar-theme-accent': string;
};

/** Keep the app chrome in sync with the avatar shown in the profile card. */
export function useAvatarTheme() {
  const [sidebarBackgroundEnabled] = useSidebarBackground();
  const [profile, setProfile] = useState(readStoredLearnerProfile);
  const [accountImage, setAccountImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let authChanged = false;
    const unsubscribeProfile = subscribeLearnerProfile(() =>
      setProfile(readStoredLearnerProfile()),
    );
    const unsubscribeAuth = subscribeNativeAuth((session) => {
      authChanged = true;
      setAccountImage(session?.user.image ?? null);
    });
    void loadNativeAuthSession()
      .then((session) => {
        if (!cancelled && !authChanged) setAccountImage(session?.user.image ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribeProfile();
      unsubscribeAuth();
    };
  }, []);

  const avatarUrl = nativeAccountAvatarUrl(profile.avatarId, accountImage);
  const theme = sidebarBackgroundEnabled ? profileThemeForAvatar(avatarUrl) : undefined;
  const style: AvatarThemeStyle | undefined = theme
    ? {
        '--avatar-sidebar-image': theme.sidebarUrl
          ? `url(${JSON.stringify(theme.sidebarUrl)})`
          : 'none',
        '--avatar-theme-accent': theme.accent,
      }
    : undefined;

  return { themed: Boolean(theme), style };
}
