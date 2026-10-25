import { startNativeRealtimeTranscription } from '../data/platform-api-client';

type TranscriptionEvent = {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
};

export type RealtimeTranscription = {
  /** 停止说话：提交最后一段音频，等它的最终文字回来（最多几秒），再断开。 */
  finish: () => Promise<string>;
  /** 直接断开，不等结果。 */
  close: () => void;
};

/** 收尾时最多等这么久最终文字，等不到就用已经出来的字。 */
const FINAL_TRANSCRIPT_WAIT_MS = 4000;

/**
 * 用平台发的临时密钥，经 WebRTC 直连 OpenAI Realtime 转写会话。
 * 每来一段字就回调 onText（整段累计文字），音频不经过我们的服务器。
 */
export async function connectRealtimeTranscription(
  stream: MediaStream,
  onText: (text: string) => void,
): Promise<RealtimeTranscription> {
  const session = await startNativeRealtimeTranscription({});
  const peer = new RTCPeerConnection();
  stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
  const channel = peer.createDataChannel('oai-events');

  // 按 item 顺序拼字：增量先放进去，completed 到了再换成最终版本。
  const order: string[] = [];
  const texts = new Map<string, string>();
  const pending = new Set<string>();
  let finishWaiter: (() => void) | null = null;
  const fullText = () =>
    order
      .map((id) => texts.get(id)?.trim() ?? '')
      .filter(Boolean)
      .join(' ');
  const touch = (id: string) => {
    if (!texts.has(id)) {
      order.push(id);
      texts.set(id, '');
    }
  };

  channel.onmessage = (message) => {
    let event: TranscriptionEvent;
    try {
      event = JSON.parse(String(message.data)) as TranscriptionEvent;
    } catch {
      return;
    }
    const id = event.item_id;
    if (event.type === 'input_audio_buffer.committed' && id) {
      touch(id);
      pending.add(id);
    } else if (event.type === 'conversation.item.input_audio_transcription.delta' && id) {
      touch(id);
      texts.set(id, `${texts.get(id) ?? ''}${event.delta ?? ''}`);
      onText(fullText());
    } else if (event.type === 'conversation.item.input_audio_transcription.completed' && id) {
      touch(id);
      texts.set(id, event.transcript ?? texts.get(id) ?? '');
      pending.delete(id);
      onText(fullText());
      if (!pending.size) finishWaiter?.();
    } else if (event.type === 'conversation.item.input_audio_transcription.failed' && id) {
      pending.delete(id);
      if (!pending.size) finishWaiter?.();
    } else if (event.type === 'error') {
      // 比如没说话就 commit 了空缓冲：不用再等。
      if (!pending.size) finishWaiter?.();
    }
  };

  const controller = new AbortController();
  const opened = new Promise<void>((resolve, reject) => {
    channel.onopen = () => resolve();
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') reject(new Error('Realtime connection failed'));
    };
  });

  void opened.catch(() => {});

  const close = () => {
    controller.abort();
    finishWaiter?.();
    channel.close();
    peer.close();
  };

  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const response = await fetch(session.callsUrl, {
      method: 'POST',
      signal: controller.signal,
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${session.clientSecret}`,
        'Content-Type': 'application/sdp',
      },
    });
    if (!response.ok) throw new Error(`Realtime call failed (${response.status})`);
    await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
    await Promise.race([
      opened,
      new Promise<void>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Realtime timeout')), {
          once: true,
        });
        if (controller.signal.aborted) reject(new Error('Realtime timeout'));
      }),
    ]);
  } catch (error) {
    close();
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return {
    close,
    finish: async () => {
      if (channel.readyState === 'open') {
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(resolve, FINAL_TRANSCRIPT_WAIT_MS);
          // commit 之后先等 committed 登记，再等所有 item 都 completed。
          finishWaiter = () => {
            window.clearTimeout(timer);
            finishWaiter = null;
            resolve();
          };
          try {
            channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          } catch (error) {
            clearTimeout(timer);
            finishWaiter = null;
            close();
            reject(error);
          }
        });
      }
      close();
      return fullText();
    },
  };
}
