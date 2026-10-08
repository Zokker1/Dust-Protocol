// All sound is synthesized with WebAudio — no asset files. Positional sounds are
// panned/attenuated against the listener basis that main.js updates every frame.
import { clamp } from './utils.js';

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 }; // pos + right vector (xz)
    this.menuMusic = null;
    this.menuMusicSrc = '';
    this.menuMusicStarted = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 22; comp.ratio.value = 9;
    comp.attack.value = 0.002; comp.release.value = 0.16;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp).connect(ctx.destination);
    // shared noise buffer
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startWind();
  }

  setMenuMusic(src) {
    if (this.menuMusicSrc === src && this.menuMusic) return;
    const wasStarted = this.menuMusicStarted;
    if (this.menuMusic) {
      this.menuMusic.pause();
      try { this.menuMusic.currentTime = 0; } catch {}
    }
    this.menuMusicSrc = src;
    this.menuMusic = new Audio(src);
    this.menuMusic.loop = true;
    this.menuMusic.preload = 'auto';
    this.menuMusic.volume = this.musicVolume();
    if (wasStarted) this.startMenuMusic();
  }

  musicVolume() {
    return Math.min(1, this.volume * 0.42);
  }

  startMenuMusic() {
    if (!this.menuMusic) return;
    this.menuMusicStarted = true;
    this.menuMusic.volume = this.musicVolume();
    const playing = this.menuMusic.play();
    if (playing?.catch) playing.catch(() => {});
  }

  stopMenuMusic() {
    if (!this.menuMusic) return;
    this.menuMusic.pause();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
    if (this.menuMusic) this.menuMusic.volume = this.musicVolume();
  }

  updateListener(pos, right) {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    this.listener.rx = right.x; this.listener.rz = right.z;
  }

  // Returns { out, t } — a gain node already panned/attenuated for `pos` (or dry if null).
  _bus(pos, baseGain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let gain = baseGain;
    let pan = 0;
    if (pos) {
      const dx = pos.x - this.listener.x, dy = pos.y - this.listener.y, dz = pos.z - this.listener.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      gain *= 1 / (1 + Math.pow(dist / 650, 1.7));
      if (dist > 1) pan = clamp((dx * this.listener.rx + dz * this.listener.rz) / dist, -1, 1) * 0.75;
    }
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.master);
    return g;
  }

  _noise(out, { dur = 0.1, freq = 1000, q = 1, type = 'bandpass', gain = 1, attack = 0.001, rate = 1 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t); src.stop(t + attack + dur + 0.05);
  }

  _tone(out, { f0 = 440, f1 = null, dur = 0.1, type = 'sine', gain = 1, delay = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, pos = null) {
    if (!this.ctx) return;
    const b = (g = 1) => this._bus(pos, g);
    switch (name) {
      case 'shot_ak': {
        const o = b(0.9);
        this._noise(o, { dur: 0.14, freq: 850, q: 0.7, gain: 1.0 });
        this._noise(o, { dur: 0.03, freq: 3200, q: 1, gain: 0.6 });
        this._tone(o, { f0: 150, f1: 55, dur: 0.12, type: 'triangle', gain: 0.9 });
        break;
      }
      case 'shot_m4': {
        const o = b(0.8);
        this._noise(o, { dur: 0.1, freq: 1300, q: 0.8, gain: 0.9 });
        this._tone(o, { f0: 180, f1: 70, dur: 0.09, type: 'triangle', gain: 0.7 });
        break;
      }
      case 'shot_awp': {
        const o = b(1.1);
        this._noise(o, { dur: 0.34, freq: 500, q: 0.5, gain: 1.1 });
        this._noise(o, { dur: 0.05, freq: 2600, q: 1, gain: 0.7 });
        this._tone(o, { f0: 110, f1: 38, dur: 0.3, type: 'triangle', gain: 1.2 });
        break;
      }
      case 'shot_deagle': {
        const o = b(1.0);
        this._noise(o, { dur: 0.13, freq: 1100, q: 0.8, gain: 1.0 });
        this._tone(o, { f0: 200, f1: 60, dur: 0.11, type: 'triangle', gain: 0.9 });
        this._tone(o, { f0: 2300, f1: 900, dur: 0.02, type: 'square', gain: 0.25 });
        break;
      }
      case 'shot_usp': {
        const o = b(0.5);
        this._noise(o, { dur: 0.045, freq: 2100, q: 1.4, gain: 0.7 });
        this._tone(o, { f0: 320, f1: 130, dur: 0.045, type: 'triangle', gain: 0.35 });
        break;
      }
      case 'shot_nova': {
        const o = b(1.05);
        this._noise(o, { dur: 0.2, freq: 420, q: 0.45, gain: 1.15 });
        this._noise(o, { dur: 0.04, freq: 1800, q: 0.9, gain: 0.55 });
        this._tone(o, { f0: 95, f1: 42, dur: 0.18, type: 'triangle', gain: 1.0 });
        break;
      }
      case 'pump': {
        const o = b(0.55);
        this._noise(o, { dur: 0.07, freq: 520, q: 0.8, gain: 0.65, rate: 0.75 });
        this._tone(o, { f0: 180, f1: 90, dur: 0.06, type: 'triangle', gain: 0.4 });
        break;
      }
      case 'knife_swing': this._noise(b(0.5), { dur: 0.09, freq: 1900, q: 4, gain: 0.3, attack: 0.02, rate: 1.4 }); break;
      case 'knife_hit': {
        const o = b(0.8);
        this._noise(o, { dur: 0.05, freq: 700, q: 1, gain: 0.8 });
        this._tone(o, { f0: 140, f1: 70, dur: 0.07, type: 'triangle', gain: 0.6 });
        break;
      }
      case 'knife_wall': this._tone(b(0.6), { f0: 2900, f1: 1800, dur: 0.05, type: 'square', gain: 0.2 }); break;
      case 'dink': { // the helmet ping
        const o = b(0.65);
        this._tone(o, { f0: 2489, dur: 0.13, type: 'triangle', gain: 0.6 });
        this._tone(o, { f0: 3729, dur: 0.1, type: 'triangle', gain: 0.4 });
        this._noise(o, { dur: 0.015, freq: 5000, q: 2, gain: 0.3 });
        break;
      }
      case 'hit': {
        const o = b(0.55);
        this._noise(o, { dur: 0.035, freq: 500, q: 1, type: 'lowpass', gain: 0.8 });
        this._tone(o, { f0: 170, f1: 90, dur: 0.05, type: 'triangle', gain: 0.5 });
        break;
      }
      case 'kill': {
        const o = b(0.7);
        this._tone(o, { f0: 740, dur: 0.05, type: 'sine', gain: 0.35 });
        this._tone(o, { f0: 1180, dur: 0.07, type: 'sine', gain: 0.3, delay: 0.055 });
        break;
      }
      case 'death': {
        const o = b(0.9);
        this._tone(o, { f0: 220, f1: 60, dur: 0.5, type: 'sawtooth', gain: 0.25 });
        this._noise(o, { dur: 0.3, freq: 300, q: 0.6, type: 'lowpass', gain: 0.5 });
        break;
      }
      case 'step': this._noise(b(0.35), { dur: 0.045, freq: 480 + Math.random() * 180, q: 0.9, type: 'lowpass', gain: 0.6, rate: 0.8 + Math.random() * 0.4 }); break;
      case 'land': {
        const o = b(0.6);
        this._noise(o, { dur: 0.09, freq: 380, q: 0.8, type: 'lowpass', gain: 0.9 });
        break;
      }
      case 'impact': this._noise(b(0.45), { dur: 0.05, freq: 900 + Math.random() * 1500, q: 1.2, gain: 0.55, rate: 0.9 + Math.random() * 0.5 }); break;
      case 'whiz': this._noise(b(0.3), { dur: 0.08, freq: 4200, q: 6, gain: 0.3, attack: 0.015, rate: 1.6 }); break;
      case 'magout': this._noise(b(0.5), { dur: 0.03, freq: 1600, q: 3, gain: 0.5 }); break;
      case 'magin': {
        const o = b(0.55);
        this._noise(o, { dur: 0.035, freq: 1200, q: 3, gain: 0.6 });
        this._tone(o, { f0: 300, f1: 160, dur: 0.04, type: 'triangle', gain: 0.3 });
        break;
      }
      case 'bolt': {
        const o = b(0.55);
        this._noise(o, { dur: 0.025, freq: 2400, q: 3, gain: 0.55 });
        this._noise(o, { dur: 0.03, freq: 1800, q: 3, gain: 0.5, attack: 0.07 });
        break;
      }
      case 'draw': this._noise(b(0.4), { dur: 0.06, freq: 1400, q: 1.6, gain: 0.35, rate: 1.2 }); break;
      case 'buy': {
        const o = b(0.5);
        this._tone(o, { f0: 880, dur: 0.04, type: 'sine', gain: 0.3 });
        this._tone(o, { f0: 1320, dur: 0.06, type: 'sine', gain: 0.25, delay: 0.04 });
        break;
      }
      case 'click': this._tone(b(0.4), { f0: 1100, dur: 0.025, type: 'sine', gain: 0.25 }); break;
      case 'nade_throw': this._noise(b(0.5), { dur: 0.12, freq: 1700, q: 2, gain: 0.3, attack: 0.035, rate: 1.3 }); break;
      case 'nade_bounce': {
        const o = b(0.5);
        this._tone(o, { f0: 1250, f1: 600, dur: 0.04, type: 'square', gain: 0.22 });
        this._noise(o, { dur: 0.02, freq: 2600, q: 3, gain: 0.18 });
        break;
      }
      case 'explosion': {
        const o = b(1.25);
        this._noise(o, { dur: 0.5, freq: 230, q: 0.4, type: 'lowpass', gain: 1.35 });
        this._noise(o, { dur: 0.08, freq: 1700, q: 0.7, gain: 0.7 });
        this._tone(o, { f0: 92, f1: 30, dur: 0.45, type: 'triangle', gain: 1.1 });
        break;
      }
      case 'fire': this._noise(b(0.4), { dur: 0.26, freq: 760 + Math.random() * 700, q: 0.8, gain: 0.16, attack: 0.05, rate: 0.9 }); break;
      case 'beep': this._tone(b(0.6), { f0: 1046, dur: 0.09, type: 'square', gain: 0.12 }); break;
      case 'go': {
        const o = b(0.7);
        this._tone(o, { f0: 523, dur: 0.08, type: 'square', gain: 0.1 });
        this._tone(o, { f0: 659, dur: 0.08, type: 'square', gain: 0.1, delay: 0.09 });
        this._tone(o, { f0: 784, dur: 0.14, type: 'square', gain: 0.12, delay: 0.18 });
        break;
      }
    }
  }

  startWind() {
    // faint desert ambience
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 240; f.Q.value = 0.4;
    const g = ctx.createGain(); g.gain.value = 0.028;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.012;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(f).connect(g).connect(this.master);
    src.start(); lfo.start();
  }
}
