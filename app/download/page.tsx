import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, Laptop, Monitor } from 'lucide-react';
import { SyntaraMark } from '@/components/brand/syntara-mark';
import { readDesktopRelease } from '@/lib/server/desktop-release';
import styles from './download.module.css';

export const metadata: Metadata = {
  title: '下载桌面版 · Syntara',
  description: '下载 Syntara Mac 桌面版。在电脑上查看课程、提问、做题和复习。',
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function DownloadPage() {
  const release = await readDesktopRelease();
  const info = release?.info;
  const webHref = process.env.SYNTARA_APP_ENV === 'staging' ? '/test' : '/login';

  return (
    <main className={styles.page}>
      <div className={styles.background} aria-hidden>
        <Image src="/home/backgrounds-v3/hero-starry.webp" alt="" fill sizes="100vw" priority />
      </div>
      <header className={styles.nav}>
        <Link href="/" className={styles.brand} aria-label="Syntara 首页">
          <SyntaraMark />
          <span>Syntara</span>
        </Link>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={15} aria-hidden />
          返回首页
        </Link>
      </header>

      <div className={styles.content}>
        <section className={styles.intro} aria-labelledby="download-title">
          <span className={styles.eyebrow}>桌面版</span>
          <h1 id="download-title">
            Syntara
            <br />
            桌面版
          </h1>
          <p>在电脑上看讲义、问问题、做题。</p>
          <div className={styles.appIdentity}>
            <Image src="/brand/syntara-app-icon.png" width={56} height={56} alt="" />
            <div>
              <strong>Syntara Test</strong>
              <span>Mac 桌面测试版</span>
            </div>
          </div>
          <Link href={webHref} className={styles.webLink}>
            也可以在浏览器里用
            <ArrowUpRight size={16} aria-hidden />
          </Link>
        </section>

        <section className={styles.downloads} aria-label="桌面版下载">
          <article className={styles.macCard} aria-labelledby="mac-title">
            <div className={styles.cardHeading}>
              <span className={styles.platformIcon}>
                <Laptop size={28} strokeWidth={1.6} aria-hidden />
              </span>
              <span className={styles.badge}>测试版</span>
            </div>
            <h2 id="mac-title">下载 Mac 版</h2>
            <p className={styles.requirements}>Apple Silicon · macOS 14 或更新版本</p>
            <p className={styles.chips}>适用于 M 系列芯片的 Mac</p>

            {info ? (
              <a
                href="/api/downloads/macos"
                download={info.fileName}
                className={styles.downloadButton}
                aria-label="下载 Syntara Mac Apple Silicon 测试版"
              >
                <ArrowDownToLine size={18} aria-hidden />
                下载 Mac 版
              </a>
            ) : (
              <button type="button" className={styles.downloadButton} disabled>
                安装包准备中
              </button>
            )}

            {info ? (
              <p className={styles.releaseMeta}>
                v{info.version} · {(info.size / 1024 / 1024).toFixed(1)} MB · ZIP
                <span>
                  更新于{' '}
                  {new Intl.DateTimeFormat('zh-CN', {
                    dateStyle: 'medium',
                    timeZone: 'America/Toronto',
                  }).format(new Date(info.builtAt))}
                </span>
              </p>
            ) : (
              <p className={styles.releaseMeta}>准备好后，就能在这里下载。</p>
            )}
            {info && !info.notarized ? (
              <p className={styles.testNote}>
                这是尚未经过 Apple 公证的测试包，macOS 可能会阻止首次打开。
              </p>
            ) : null}
          </article>

          <article className={styles.otherPlatform}>
            <Monitor size={21} strokeWidth={1.6} aria-hidden />
            <div>
              <h2>Windows 与 Intel Mac</h2>
              <p>暂未提供安装包</p>
            </div>
          </article>
        </section>
      </div>

      <section className={styles.install} aria-labelledby="install-title">
        <h2 id="install-title">下载之后</h2>
        <ol>
          <li>
            <span>1</span>
            <div>
              <h3>解压文件</h3>
              <p>打开下载的 ZIP，找到 Syntara Test。</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>放进应用程序</h3>
              <p>把 App 拖进 Mac 的「应用程序」文件夹。</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>登录，打开课程</h3>
              <p>测试版使用 Google 账号登录。</p>
            </div>
          </li>
        </ol>
      </section>

      {info ? (
        <details className={styles.checksum}>
          <summary>安装包校验值（SHA-256）</summary>
          <code>{info.sha256}</code>
        </details>
      ) : null}
      <footer className={styles.footer}>© {new Date().getFullYear()} Syntara</footer>
    </main>
  );
}
