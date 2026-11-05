import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBackendAuth } from '../learn/syntara-backend-auth.mjs';
import { stagingOrigin, previewSourceStatus } from '../../apps/native/staging-preview-plugin.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--credential-file')) {
    throw new Error('用法：pnpm staging:preview [--credential-file /path/to/private-device.json]');
  }
  const credentialFile = resolve(args[1] || `${homedir()}/.config/syntara/staging-backend.json`);
  const version = await fetch(`${stagingOrigin}/api/native/v1/version`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!version.ok) throw new Error('无法读取测试服版本，未启动预览。');
  const { revision } = await version.json();
  let status;
  try {
    status = previewSourceStatus(revision);
  } catch {
    throw new Error(
      '本地没有当前测试服的源码基线。请先 git fetch origin codex/staging-next，核对 docs/branch-state.md 后再启动。',
    );
  }
  if (!status.includesBaseline)
    throw new Error(
      '当前工作树未包含正在运行的测试服版本。请先按 docs/branch-state.md 同步基线，避免预览旧 UI。',
    );
  const auth = await resolveBackendAuth({ credentialFile, origin: stagingOrigin });
  const identity = await fetch(`${stagingOrigin}/api/native/v1/auth/me`, {
    headers: { Authorization: `Bearer ${await auth.getToken()}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!identity.ok) throw new Error('设备账号无法访问测试服，请先完成设备登录。');
  console.log(
    `测试服 ${revision.slice(0, 8)} · 本地 ${status.localRevision.slice(0, 8)} · ${status.branch}`,
  );
  console.log(
    status.uiMatches
      ? 'UI 源码一致。'
      : `UI 有本地改动：${status.changedFiles.length} 个文件。请核对预览面板。`,
  );
  console.log('完整 App（测试服数据，只读）：http://127.0.0.1:1422/test/app?as=teacher');
  const child = spawn(
    'pnpm',
    ['exec', 'vite', '--host', '127.0.0.1', '--port', '1422', '--strictPort'],
    {
      cwd: fileURLToPath(new URL('../../apps/native/', import.meta.url)),
      stdio: 'inherit',
      env: {
        ...process.env,
        VITE_SYNTARA_WEB_APP: '1',
        VITE_SYNTARA_CHANNEL: 'staging',
        SYNTARA_STAGING_PREVIEW: '1',
        SYNTARA_STAGING_PREVIEW_CREDENTIAL_FILE: credentialFile,
        SYNTARA_QA_CHAT_CREDENTIAL_FILE: '',
      },
    },
  );
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', () => {
    console.error('无法启动 pnpm/Vite。');
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
