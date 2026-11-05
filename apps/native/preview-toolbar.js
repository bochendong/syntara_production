// Injected by the dev server only. Keep the App and published layout untouched.
if (
  !('__TAURI_INTERNALS__' in window) &&
  ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
) {
  const host = document.createElement('aside');
  host.setAttribute('aria-label', '本地预览环境');
  Object.assign(host.style, {
    position: 'fixed',
    bottom: '12px',
    right: '12px',
    zIndex: '2147483647',
  });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{font:12px/1.5 system-ui,sans-serif;color:#243248}details{max-width:min(380px,calc(100vw - 24px));background:#fff;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 4px 24px #17203620}summary{padding:8px 12px;cursor:pointer;font-weight:600;list-style:none}.body{border-top:1px solid #e2e8f0;padding:12px;overflow-wrap:anywhere}.body p{margin:0 0 8px}.body a{color:#0670d8;margin-right:12px}code{font-size:11px}.warning{color:#9a4b00}button{font:inherit;cursor:pointer;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:3px 8px}
    </style><details><summary>正在核对预览环境…</summary><div class="body"></div></details>`;
  document.body.append(host);
  const summary = root.querySelector('summary');
  const body = root.querySelector('.body');
  const fixture = location.pathname.startsWith('/qa/');
  async function refresh() {
    try {
      const response = await fetch('/__syntara_preview/status', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const status = await response.json();
      const real = !fixture && status.mode === 'staging-readonly';
      summary.textContent = real ? '本地预览 · 测试服数据 · 只读' : '演示页面 · 模拟数据';
      if (real)
        summary.textContent += status.error
          ? ' · 版本未核对'
          : !status.includesBaseline
            ? ' · 基线已落后'
            : status.uiMatches
              ? ' · 源码一致'
              : ' · 有本地改动';
      summary.className =
        real && !status.error && status.includesBaseline && status.uiMatches ? '' : 'warning';
      body.replaceChildren();
      const line = (text) => {
        const p = document.createElement('p');
        p.textContent = text;
        body.append(p);
      };
      if (!real) line('这是隔离演示页，不代表测试服当前数据。日常 UI 调整请使用完整 App 预览。');
      line(
        status.error ||
          (!status.includesBaseline
            ? '本地未包含当前测试服基线，请先同步源码。'
            : status.uiMatches
              ? 'UI 源码与当前测试服一致。'
              : `UI 有本地改动（${status.changedFiles.length} 个文件），尚未部署。`),
      );
      if (!status.error)
        line(
          `本地 ${status.localRevision.slice(0, 8)} · 测试服 ${status.stagingRevision.slice(0, 8)} · ${status.branch}`,
        );
      if (real)
        line('运行完整 App；读取现有设备账号的测试服数据，保存、开课、提交及 AI 请求均被阻止。');
      for (const [label, href] of [
        ['完整 App', '/test/app?as=teacher'],
        ['打开测试服', `${status.stagingOrigin}/test/app`],
      ]) {
        const a = document.createElement('a');
        a.textContent = label;
        a.href = href;
        if (href.startsWith('https:')) {
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        body.append(a);
      }
      document.title = `${real ? '本地只读预览' : '模拟演示'} · Syntara`;
    } catch {
      summary.textContent = '预览环境核对失败';
      summary.className = 'warning';
      body.textContent = '请从任务工作树运行 pnpm staging:preview，不要将此页当作测试服。';
    }
  }
  void refresh();
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
}
