import type { Metadata } from 'next';
import { Suspense } from 'react';
import localFont from 'next/font/local';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/server-providers-init';
import { AppLayoutChrome } from '@/components/app-layout-chrome';
import { AuthSessionProvider } from '@/components/auth-session-provider';
import { NotificationCenterProvider } from '@/components/notifications/notification-center-provider';
import { WebOnboardingCoach } from '@/components/onboarding/web-onboarding-coach';

const inter = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  variable: '--font-sans',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: 'Syntara',
  applicationName: 'Syntara',
  description:
    'AI learning space for courses, notebooks, and agents. Upload a PDF or describe a topic to generate an immersive, multi-agent classroom.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nativeStaging = process.env.SYNTARA_APP_ENV === 'staging';
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <I18nProvider>
            {nativeStaging ? null : <ServerProvidersInit />}
            <AuthSessionProvider syncWebProfile={!nativeStaging}>
              {nativeStaging ? (
                children
              ) : (
                <>
                  <Suspense fallback={<>{children}</>}>
                    <AppLayoutChrome>{children}</AppLayoutChrome>
                  </Suspense>
                  <NotificationCenterProvider />
                  <WebOnboardingCoach />
                </>
              )}
            </AuthSessionProvider>
            <Toaster position="top-right" />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
