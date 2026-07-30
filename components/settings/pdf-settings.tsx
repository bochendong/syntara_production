'use client';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import type { PDFProviderId } from '@/lib/pdf/types';
import { CheckCircle2, ShieldCheck } from 'lucide-react';

/**
 * Get display label for feature
 */
function getFeatureLabel(feature: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    text: t('settings.featureText'),
    images: t('settings.featureImages'),
    tables: t('settings.featureTables'),
    formulas: t('settings.featureFormulas'),
    'layout-analysis': t('settings.featureLayoutAnalysis'),
    metadata: t('settings.featureMetadata'),
  };
  return labels[feature] || feature;
}

interface PDFSettingsProps {
  selectedProviderId: PDFProviderId;
}

export function PDFSettings({ selectedProviderId }: PDFSettingsProps) {
  const { t } = useI18n();

  const pdfProvidersConfig = useSettingsStore((state) => state.pdfProvidersConfig);

  const pdfProvider = PDF_PROVIDERS[selectedProviderId];
  const isServerConfigured = !!pdfProvidersConfig[selectedProviderId]?.isServerConfigured;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Provider: {pdfProvider?.name || selectedProviderId}</Badge>
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3.5 w-3.5" />
            {isServerConfigured
              ? '系统托管'
              : selectedProviderId === 'unpdf'
                ? '本机内置'
                : '暂不可用'}
          </Badge>
        </div>
        <p className="mt-3">
          {isServerConfigured
            ? 'PDF 服务凭据由 Syntara 内置 Keychain 统一托管，无需填写 API Key 或 Base URL。'
            : selectedProviderId === 'unpdf'
              ? '当前使用本机内置 PDF 解析，不需要 API Key。'
              : '当前 PDF 服务暂不可用，请联系管理员。'}
        </p>
      </div>

      {/* Documented flows: PDF / MD / PPTX */}
      <div className="rounded-xl border border-slate-900/[0.06] bg-slate-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.04]">
        <p className="text-sm font-medium text-slate-900 dark:text-white">
          {t('settings.fileParseDocTitle')}
        </p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('settings.fileParsePdfHeading')}
        </p>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <li>{t('settings.fileParseFlow1')}</li>
          <li>{t('settings.fileParseFlow2')}</li>
          <li>{t('settings.fileParseFlow3')}</li>
          <li>{t('settings.fileParseFlow4')}</li>
        </ol>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('settings.fileParseMarkdownHeading')}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {t('settings.fileParseMarkdownDetail')}
        </p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t('settings.fileParsePptxHeading')}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {t('settings.fileParsePptxDetail')}
        </p>
      </div>

      {/* Features List */}
      <div className="space-y-2">
        <Label className="text-sm">{t('settings.pdfFeatures')}</Label>
        <div className="flex flex-wrap gap-2">
          {pdfProvider.features.map((feature) => (
            <Badge key={feature} variant="secondary" className="font-normal">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {getFeatureLabel(feature, t)}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
