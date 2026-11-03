/**
 * 首页分「学生登录」和「老师登录」。登录页把选择带到 /test/app?as=teacher|student，
 * App 打开时读一次、记在本机，然后把参数从地址栏去掉。
 * 老师登录：直接打开「教学」，还没认领课就进认领页；不弹学生的手机尾号。
 */
export type LoginIntent = 'student' | 'teacher';

const STORAGE_KEY = 'syntara.login-as.v1';
let cached: LoginIntent | null = null;

export function readLoginIntent(): LoginIntent {
  if (cached) return cached;
  let intent: LoginIntent = 'student';
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('as');
    if (fromUrl === 'teacher' || fromUrl === 'student') {
      intent = fromUrl;
      localStorage.setItem(STORAGE_KEY, intent);
      url.searchParams.delete('as');
      window.history.replaceState(window.history.state, '', url.toString());
    } else if (localStorage.getItem(STORAGE_KEY) === 'teacher') {
      intent = 'teacher';
    }
  } catch {
    /* 没有本机存储时按学生处理。 */
  }
  cached = intent;
  return intent;
}

export function clearLoginIntent() {
  cached = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
