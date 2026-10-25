import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync('apps/native/src/lib/realtime-transcription.ts', 'utf8').replace(
  /^import .*platform-api-client';/m,
  '',
);
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const peers = [];
const currentPeer = () => peers.at(-1);
let status = 200;
class Peer {
  connectionState = 'new';
  constructor() {
    peers.push(this);
  }
  addTrack() {}
  createDataChannel() {
    this.channel = {
      readyState: 'open',
      close() {
        this.readyState = 'closed';
      },
      send: () => {
        this.emit('input_audio_buffer.committed', { item_id: 'b' });
        this.emit('conversation.item.input_audio_transcription.completed', {
          item_id: 'b',
          transcript: 'world!',
        });
      },
    };
    return this.channel;
  }
  async createOffer() {
    return { sdp: 'test-offer' };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {
    this.channel.onopen();
  }
  close() {
    this.closed = true;
  }
  emit(type, data = {}) {
    this.channel.onmessage({ data: JSON.stringify({ type, ...data }) });
  }
}
const scope = {
  exports: {},
  RTCPeerConnection: Peer,
  AbortController,
  setTimeout,
  clearTimeout,
  window: { setTimeout, clearTimeout },
  startNativeRealtimeTranscription: async () => ({
    clientSecret: 'ephemeral-test',
    callsUrl: 'https://api.openai.com/v1/realtime/calls',
  }),
  fetch: async (url, args) => {
    assert.equal(args.headers.Authorization, 'Bearer ephemeral-test');
    assert.equal(args.body, 'test-offer');
    return { ok: status === 200, status, text: async () => 'test-answer' };
  },
};
vm.runInNewContext(code, scope);
const texts = [];
const live = await scope.exports.connectRealtimeTranscription(
  { getAudioTracks: () => [{}] },
  (text) => texts.push(text),
);
currentPeer().emit('conversation.item.input_audio_transcription.delta', {
  item_id: 'a',
  delta: 'Hel',
});
currentPeer().emit('conversation.item.input_audio_transcription.delta', {
  item_id: 'a',
  delta: 'lo',
});
assert.equal(texts.at(-1), 'Hello', 'deltas appear before stop');
currentPeer().emit('conversation.item.input_audio_transcription.completed', {
  item_id: 'a',
  transcript: 'Hello,',
});
assert.equal(
  await live.finish(),
  'Hello, world!',
  'synchronous final commit events cannot race waiter',
);
assert.ok(currentPeer().closed);
status = 502;
await assert.rejects(
  scope.exports.connectRealtimeTranscription({ getAudioTracks: () => [] }, () => {}),
  /502/,
);
assert.ok(currentPeer().closed, 'connection failure releases peer');
console.log('PASS live deltas, final correction, commit race and network-failure cleanup');
