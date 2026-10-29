import { APP_VERSION, APP_RELEASE, SYNC_PROTOCOL } from '../../../lib/version/app-release';
import { nativeChannel } from './channel';
export const appBuild = {
  version: APP_VERSION,
  release: APP_RELEASE,
  syncProtocol: SYNC_PROTOCOL,
  channel: nativeChannel,
  revision: import.meta.env.VITE_SYNTARA_REVISION || 'development',
};
