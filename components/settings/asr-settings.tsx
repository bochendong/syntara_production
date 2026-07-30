'use client';

import { useState, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { SettingsButton } from '@/components/settings/settings-button';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { ASR_PROVIDERS } from '@/lib/audio/constants';
import type { ASRProviderId } from '@/lib/audio/types';
import { Mic, MicOff, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('ASRSettings');

interface ASRSettingsProps {
  selectedProviderId: ASRProviderId;
}

export function ASRSettings({ selectedProviderId }: ASRSettingsProps) {
  const { t } = useI18n();

  const asrLanguage = useSettingsStore((state) => state.asrLanguage);
  const asrProvidersConfig = useSettingsStore((state) => state.asrProvidersConfig);

  const asrProvider = ASR_PROVIDERS[selectedProviderId] ?? ASR_PROVIDERS['openai-whisper'];
  const isServerConfigured = !!asrProvidersConfig[selectedProviderId]?.isServerConfigured;

  const [isRecording, setIsRecording] = useState(false);
  const [asrResult, setASRResult] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Reset state when provider changes (derived state pattern)
  const [prevProviderId, setPrevProviderId] = useState(selectedProviderId);
  if (selectedProviderId !== prevProviderId) {
    setPrevProviderId(selectedProviderId);
    setTestStatus('idle');
    setTestMessage('');
    setASRResult('');
  }

  const handleToggleASRRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      setASRResult('');
      setTestStatus('testing');
      setTestMessage('');

      if (selectedProviderId === 'browser-native') {
        const SpeechRecognitionCtor =
          (window as unknown as Record<string, unknown>).SpeechRecognition ||
          (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
        if (!SpeechRecognitionCtor) {
          setTestStatus('error');
          setTestMessage(t('settings.asrNotSupported'));
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Vendor-prefixed API without standard typings
        const recognition = new (SpeechRecognitionCtor as new () => any)();
        recognition.lang = asrLanguage || 'zh-CN';
        recognition.onresult = (event: {
          results: {
            [index: number]: { [index: number]: { transcript: string } };
          };
        }) => {
          const transcript = event.results[0][0].transcript;
          setASRResult(transcript);
          setTestStatus('success');
          setTestMessage(t('settings.asrTestSuccess'));
        };
        recognition.onerror = (event: { error: string }) => {
          setTestStatus('error');
          setTestMessage(t('settings.asrTestFailed') + ': ' + event.error);
        };
        recognition.onend = () => {
          setIsRecording(false);
        };
        recognition.start();
        setIsRecording(true);
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          const audioChunks: Blob[] = [];
          mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
          };
          mediaRecorder.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop());
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const formData = new FormData();
            formData.append('audio', audioBlob, 'recording.webm');
            formData.append('providerId', selectedProviderId);
            formData.append('language', asrLanguage);

            try {
              const response = await fetch('/api/transcription', {
                method: 'POST',
                body: formData,
              });
              if (response.ok) {
                const data = await response.json();
                setASRResult(data.text);
                setTestStatus('success');
                setTestMessage(t('settings.asrTestSuccess'));
              } else {
                setTestStatus('error');
                const errorData = await response
                  .json()
                  .catch(() => ({ error: response.statusText }));
                setTestMessage(errorData.details || errorData.error || t('settings.asrTestFailed'));
              }
            } catch (error) {
              log.error('ASR test failed:', error);
              setTestStatus('error');
              setTestMessage(t('settings.asrTestFailed'));
            }
          };
          mediaRecorder.start();
          setIsRecording(true);
        } catch (error) {
          log.error('Failed to access microphone:', error);
          setTestStatus('error');
          setTestMessage(t('settings.microphoneAccessFailed'));
        }
      }
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {selectedProviderId === 'browser-native'
              ? '当前使用浏览器内置语音识别，不需要 API Key。'
              : isServerConfigured
                ? '语音识别凭据由 Syntara 内置 Keychain 统一托管，无需手动设置。'
                : '当前语音识别服务暂不可用，请联系管理员。'}
          </span>
        </p>
      </div>

      {/* Test ASR */}
      <div className="space-y-2">
        <Label className="text-sm">{t('settings.testASR')}</Label>
        <div className="flex gap-2">
          <Input
            value={asrResult}
            readOnly
            placeholder={t('settings.asrResultPlaceholder')}
            className="flex-1 bg-muted/50"
          />
          <SettingsButton
            onClick={handleToggleASRRecording}
            disabled={
              asrProvider.requiresApiKey &&
              !asrProvidersConfig[selectedProviderId]?.apiKey?.trim() &&
              !isServerConfigured
            }
            className="w-[140px] gap-2"
          >
            {isRecording ? (
              <>
                <MicOff className="h-4 w-4" />
                {t('settings.stopRecording')}
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                {t('settings.startRecording')}
              </>
            )}
          </SettingsButton>
        </div>
      </div>

      {testMessage && (
        <div
          className={cn(
            'rounded-lg p-3 text-sm overflow-hidden',
            testStatus === 'success' &&
              'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/50 dark:text-green-400 dark:border-green-800',
            testStatus === 'error' &&
              'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800',
          )}
        >
          <div className="flex items-start gap-2 min-w-0">
            {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />}
            {testStatus === 'error' && <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <p className="flex-1 min-w-0 break-all">{testMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}
