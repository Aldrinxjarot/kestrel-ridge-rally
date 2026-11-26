// audio.js — all sound is synthesised with WebAudio: a two-oscillator
// engine whose pitch follows the throttle, filtered wind noise that rises
// with airspeed, and short cues for rings, warnings, touchdown and crashes.
// Nothing is loaded; the context opens on the first user gesture.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastWarn = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    // Engine: a sawtooth under a lowpass, plus a square sub-oscillator.
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineSub.start();

    // Wind: looped noise through a bandpass.
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    noise.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  /** Per-frame: engine note and wind level from the flight state. */
  update(flight) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const running = !flight.engineOut && flight.mode !== 'done' && flight.mode !== 'crashed';
    const rpm = running ? 0.25 + flight.throttle * 0.75 : 0;
    this.engineOsc.frequency.setTargetAtTime(52 + rpm * 88, t, 0.08);
    this.engineSub.frequency.setTargetAtTime(26 + rpm * 44, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(240 + rpm * 700, t, 0.1);
    this.engineGain.gain.setTargetAtTime(running ? 0.05 + rpm * 0.1 : 0, t, 0.12);
    const wind = Math.min(0.16, Math.max(0, (flight.speed - 18) / 70) * 0.16);
    this.windGain.gain.setTargetAtTime(flight.onGround ? wind * 0.4 : wind, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(420 + flight.speed * 9, t, 0.2);
  }

  blip(freq, dur, type = 'sine', gain = 0.16, when = 0, slideTo = null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  ring() { this.blip(880, 0.14, 'sine', 0.18); this.blip(1318, 0.22, 'sine', 0.16, 0.09); }
  fuelGate() { this.blip(660, 0.12, 'triangle', 0.18); this.blip(990, 0.2, 'triangle', 0.16, 0.08); }
  gear() { this.blip(220, 0.1, 'square', 0.07); }
  liftoff() { this.blip(392, 0.16, 'triangle', 0.12); this.blip(523, 0.24, 'triangle', 0.12, 0.1); }
  touchdown() { this.blip(196, 0.18, 'sine', 0.2, 0, 130); }
  warn(now) {
    if (now - this.lastWarn < 0.9) return;
    this.lastWarn = now;
    this.blip(1180, 0.09, 'square', 0.05);
  }
  crash() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    g.gain.setValueAtTime(0.5, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    src.stop(ctx.currentTime + 0.75);
    this.blip(90, 0.6, 'sine', 0.4, 0, 34);
  }
}
