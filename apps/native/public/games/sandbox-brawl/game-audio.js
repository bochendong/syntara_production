const BAR_SECONDS = 4 * 60 / 112;
const MUSIC_VOLUME = 0.32;
const EFFECTS = {
  hit: { gain: 0.23, interval: 0.12 },
};

export function createGameAudio() {
  let context, output, musicGain, tensionGain;
  let music, phase = 'title', muted = false, hidden = document.hidden;
  const buffers = {};
  let lowHealth = false, tense = false;
  const lastEffect = { hit: -Infinity };

  async function load(file) {
    try {
      const response = await fetch(new URL('./audio/' + file, import.meta.url));
      if (!response.ok) throw new Error('Failed to load ' + file);
      return await context.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.warn('Sandbox Brawl audio:', error);
      return null;
    }
  }

  function unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!context) {
      context = new AudioContext();
      output = context.createGain();
      output.gain.value = muted || hidden ? 0 : 1;
      output.connect(context.destination);
      musicGain = context.createGain();
      musicGain.gain.value = 0;
      musicGain.connect(output);
      tensionGain = context.createGain();
      tensionGain.gain.value = 0;
      tensionGain.connect(musicGain);
      Promise.all([load('music.flac'), load('tension.flac')]).then(([base, tension]) => {
        buffers.music = base;
        buffers.tension = tension;
        if (phase === 'play' || phase === 'levelup') startMusic();
      });
      for (const key of Object.keys(EFFECTS)) {
        load(key + '.wav').then((buffer) => { buffers[key] = buffer; });
      }
    }
    if (context.state !== 'running') context.resume().catch(() => {});
  }

  function ramp(param, value, at, speed) {
    param.cancelScheduledValues(context.currentTime);
    param.setTargetAtTime(value, at, speed);
  }

  function startMusic() {
    if (music || !buffers.music || hidden) return;
    const start = context.currentTime + 0.03;
    const tracks = [track(buffers.music, musicGain, start)];
    if (buffers.tension?.length === buffers.music.length) {
      tracks.push(track(buffers.tension, tensionGain, start));
    }
    music = { start, tracks };
    tensionGain.gain.value = tense ? 1 : 0;
    ramp(musicGain.gain, MUSIC_VOLUME, start, 0.06);
  }

  function track(buffer, gain, start) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start(start);
    return source;
  }

  function update(state, bossActive, health) {
    const active = state === 'play' || state === 'levelup';
    const inRun = active || state === 'paused';
    lowHealth = inRun && health < (lowHealth ? 0.4 : 0.3);
    const nextTense = inRun && (bossActive || lowHealth);
    const changed = phase !== state;
    phase = state;
    if (music && changed) {
      const now = context.currentTime;
      if (!inRun) {
        for (const source of music.tracks) source.stop(now);
        music = null;
        ramp(musicGain.gain, 0, now, 0.04);
      } else {
        ramp(musicGain.gain, active && !hidden ? MUSIC_VOLUME : 0, now, 0.07);
      }
    }
    if (music && nextTense !== tense) {
      const now = context.currentTime;
      const bar = Math.max(0, Math.ceil((now - music.start) / BAR_SECONDS));
      const boundary = Math.max(now, music.start + bar * BAR_SECONDS);
      ramp(tensionGain.gain, nextTense ? 1 : 0, boundary, 0.14);
    }
    tense = nextTense;
    if (active) startMusic();
  }

  function play(name) {
    if (hidden || muted || context?.state !== 'running' || !buffers[name]) return;
    const now = context.currentTime;
    const { gain, interval } = EFFECTS[name];
    if (now - lastEffect[name] < interval) return;
    lastEffect[name] = now;
    const source = context.createBufferSource();
    const volume = context.createGain();
    volume.gain.value = gain;
    source.buffer = buffers[name];
    source.connect(volume).connect(output);
    source.start(now);
  }

  // Filtered air on the forward cast, then a short broad-band snap on contact.
  function whip(sound) {
    if (hidden || muted || context?.state !== 'running') return;
    if (!buffers.whipNoise) {
      buffers.whipNoise = context.createBuffer(1, Math.ceil(context.sampleRate * .28), context.sampleRate);
      const data = buffers.whipNoise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const snap = sound === 'snap', now = context.currentTime;
    const duration = snap ? .065 : .26;
    const source = context.createBufferSource();
    source.buffer = buffers.whipNoise;
    const filter = context.createBiquadFilter();
    filter.type = snap ? 'highpass' : 'bandpass';
    filter.frequency.setValueAtTime(snap ? 1100 : 450, now);
    filter.frequency.exponentialRampToValueAtTime(snap ? 2600 : 3600, now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(snap ? .44 : .22, now + (snap ? .002 : .14));
    gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    source.connect(filter).connect(gain).connect(output);
    source.start(now); source.stop(now + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  // Short mallet attack followed by a tier-specific cadence, through the game's mute bus.
  function reveal(tier) {
    if (hidden || muted || context?.state !== 'running') return;
    const notes = [[330, 440, 550], [392, 587, 784], [392, 494, 587, 988]][tier];
    const start = context.currentTime;
    for (const [i, hz] of [105, ...notes].entries()) {
      const time = start + (i ? 0.22 + i * 0.08 : 0);
      const duration = i === notes.length ? 0.24 : 0.09;
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.type = i ? 'sine' : 'triangle';
      tone.frequency.setValueAtTime(hz, time);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(i ? 0.10 : 0.19, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      tone.connect(gain).connect(output);
      tone.start(time);
      tone.stop(time + duration);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    }
  }

  function toggleMute() {
    muted = !muted;
    if (context) ramp(output.gain, muted || hidden ? 0 : 1, context.currentTime, 0.03);
    return muted;
  }

  function setHidden(value) {
    hidden = value;
    if (!context) return;
    output.gain.cancelScheduledValues(context.currentTime);
    output.gain.setValueAtTime(muted || hidden ? 0 : 1, context.currentTime);
    const active = phase === 'play' || phase === 'levelup';
    if (music) ramp(musicGain.gain, active && !hidden ? MUSIC_VOLUME : 0, context.currentTime, 0.07);
    else if (active) startMusic();
  }

  return { unlock, update, play, whip, reveal, toggleMute, setHidden };
}
