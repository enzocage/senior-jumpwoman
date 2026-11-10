/**
 * SENIOR JUMPWOMAN — MOS 6581 SID 3-Voice Web Audio Synthesizer
 * Zero-dependency authentic C64 pulse-width, sawtooth, triangle & LFSR noise engine
 */
(function (global) {
  'use strict';

  const NOTE_SEMITONES = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
    'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
  };

  function noteToFreq(note) {
    if (!note || note === '-' || note === 'R') return 0;
    if (typeof note === 'number') return note;
    const m = /^([A-G][#b]?)(-?\d)$/.exec(note);
    if (!m) return 0;
    const semi = NOTE_SEMITONES[m[1]];
    const oct = parseInt(m[2], 10);
    const midi = (oct + 1) * 12 + semi;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  class SID6581 {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.filterNode = null;
      this.noiseBuffer = null;
      this.pulse12Wave = null;
      this.pulse25Wave = null;

      this.muted = false;
      this.volume = 0.45;
      this.unlocked = false;

      // Sequencer state
      this.seqTimer = null;
      this.activeNodes = new Set();

      // Ambient wind node (Level 12 Hurricane)
      this.windNode = null;
      this.windGain = null;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => {});
        }
        return true;
      }
      const AudioCtx = global.AudioContext || global.webkitAudioContext;
      if (!AudioCtx) return false;

      try {
        this.ctx = new AudioCtx();
      } catch (e) {
        return false;
      }

      // MOS 6581 warm analog lowpass filter + master output
      this.filterNode = this.ctx.createBiquadFilter();
      this.filterNode.type = 'lowpass';
      this.filterNode.frequency.value = 3400;
      this.filterNode.Q.value = 1.15;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;

      this.filterNode.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      // Build custom C64 Pulse PeriodicWaves (12.5% & 25% duty cycle)
      this.pulse25Wave = this._createPulseWave(0.25);
      this.pulse12Wave = this._createPulseWave(0.125);

      // Build C64 23-bit LFSR style crunchy noise buffer (2 seconds)
      this.noiseBuffer = this._createLFSRNoiseBuffer();

      this.unlocked = true;
      return true;
    }

    unlock() {
      if (!this.ctx) {
        this.init();
      } else if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    setMuted(muted) {
      this.muted = !!muted;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(
          this.muted ? 0 : this.volume,
          this.ctx.currentTime,
          0.015
        );
      }
      return this.muted;
    }

    toggleMute() {
      return this.setMuted(!this.muted);
    }

    setVolume(vol) {
      this.volume = Math.max(0, Math.min(1, vol));
      if (this.masterGain && this.ctx && !this.muted) {
        this.masterGain.gain.setTargetAtTime(
          this.volume,
          this.ctx.currentTime,
          0.015
        );
      }
    }

    _createPulseWave(duty) {
      const harmonics = 48;
      const real = new Float32Array(harmonics + 1);
      const imag = new Float32Array(harmonics + 1);
      for (let n = 1; n <= harmonics; n++) {
        const coeff = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
        imag[n] = coeff;
      }
      return this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    _createLFSRNoiseBuffer() {
      const sr = this.ctx.sampleRate;
      const len = sr * 2;
      const buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      let lfsr = 0x7ffff8;
      let held = 0;
      // Step LFSR every 4 samples for classic gritty C64 SID noise texture
      for (let i = 0; i < len; i++) {
        if ((i & 3) === 0) {
          const bit = ((lfsr >> 22) ^ (lfsr >> 17)) & 1;
          lfsr = ((lfsr << 1) | bit) & 0x7fffff;
          held = ((lfsr & 0xfff) / 2048) - 1;
        }
        data[i] = held;
      }
      return buf;
    }

    /**
     * Play a single SID voice note with ADSR & optional pitch slide
     */
    playTone({
      freq = 440,
      endFreq = null,
      wave = 'pulse25', // 'pulse25' | 'pulse12' | 'sawtooth' | 'triangle' | 'square'
      time = 0,
      dur = 0.12,
      attack = 0.004,
      decay = 0.04,
      sustain = 0.55,
      release = 0.03,
      gain = 0.22,
      vibratoHz = 0,
      vibratoDepth = 0
    }) {
      if (!this.init() || this.muted || freq <= 0) return;

      const t0 = Math.max(this.ctx.currentTime, time || this.ctx.currentTime);
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();

      if (wave === 'pulse25' && this.pulse25Wave) {
        osc.setPeriodicWave(this.pulse25Wave);
      } else if (wave === 'pulse12' && this.pulse12Wave) {
        osc.setPeriodicWave(this.pulse12Wave);
      } else {
        osc.type = wave === 'pulse25' || wave === 'pulse12' ? 'square' : wave;
      }

      osc.frequency.setValueAtTime(freq, t0);
      if (endFreq && endFreq > 10) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
      }

      let lfo = null;
      if (vibratoHz > 0 && vibratoDepth > 0) {
        lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.setValueAtTime(vibratoHz, t0);
        lfoGain.gain.setValueAtTime(vibratoDepth, t0);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start(t0);
        lfo.stop(t0 + dur + release + 0.02);
      }

      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(gain, t0 + attack);
      env.gain.linearRampToValueAtTime(
        Math.max(0.0001, gain * sustain),
        t0 + attack + decay
      );
      env.gain.setValueAtTime(Math.max(0.0001, gain * sustain), t0 + dur);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);

      osc.connect(env);
      env.connect(this.filterNode);

      this.activeNodes.add(osc);
      osc.onended = () => {
        this.activeNodes.delete(osc);
      };

      osc.start(t0);
      osc.stop(t0 + dur + release + 0.02);
    }

    /**
     * Play SID LFSR Noise burst through bandpass/lowpass filter
     */
    playNoise({
      time = 0,
      dur = 0.1,
      gain = 0.25,
      filterFreq = 1200,
      endFilterFreq = null,
      q = 1.5,
      attack = 0.002,
      release = 0.04
    }) {
      if (!this.init() || this.muted || !this.noiseBuffer) return;

      const t0 = Math.max(this.ctx.currentTime, time || this.ctx.currentTime);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;

      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(filterFreq, t0);
      if (endFilterFreq) {
        bp.frequency.exponentialRampToValueAtTime(
          Math.max(40, endFilterFreq),
          t0 + dur + release
        );
      }
      bp.Q.value = q;

      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.linearRampToValueAtTime(gain, t0 + attack);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);

      src.connect(bp);
      bp.connect(env);
      env.connect(this.filterNode);

      this.activeNodes.add(src);
      src.onended = () => {
        this.activeNodes.delete(src);
      };

      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + dur + release + 0.02);
    }

    stopMusic() {
      if (this.seqTimer) {
        clearTimeout(this.seqTimer);
        this.seqTimer = null;
      }
      this.setWindActive(false);
    }

    stopAll() {
      this.stopMusic();
      for (const node of this.activeNodes) {
        try {
          node.stop();
        } catch (e) {}
      }
      this.activeNodes.clear();
    }

    // =========================================================================
    // 3-VOICE SID MUSIC SEQUENCER
    // Each step = [v1Note, v2Note, v3BassNote, stepSixteenths]
    // =========================================================================
    _playSequence(steps, stepDurSec, loop = false, onDone = null) {
      this.stopMusic();
      if (!this.init()) {
        if (onDone) setTimeout(onDone, 200);
        return;
      }

      let idx = 0;
      const scheduleNext = () => {
        if (idx >= steps.length) {
          if (loop) {
            idx = 0;
          } else {
            this.seqTimer = null;
            if (onDone) onDone();
            return;
          }
        }

        const [n1, n2, n3, len = 1] = steps[idx++];
        const dur = len * stepDurSec;
        const now = this.ctx.currentTime + 0.01;

        if (n1 && n1 !== '-') {
          this.playTone({
            freq: noteToFreq(n1),
            wave: 'pulse12',
            time: now,
            dur: dur * 0.82,
            gain: 0.20,
            vibratoHz: 6,
            vibratoDepth: 2.2
          });
        }
        if (n2 && n2 !== '-') {
          this.playTone({
            freq: noteToFreq(n2),
            wave: 'pulse25',
            time: now,
            dur: dur * 0.72,
            gain: 0.13
          });
        }
        if (n3 && n3 !== '-') {
          this.playTone({
            freq: noteToFreq(n3),
            wave: 'sawtooth',
            time: now,
            dur: dur * 0.85,
            gain: 0.16,
            sustain: 0.45
          });
        }

        this.seqTimer = setTimeout(scheduleNext, dur * 1000);
      };

      scheduleNext();
    }

    // Randy Glover / Epyx inspired upbeat C64 3-voice Title Theme
    playTitleTheme() {
      const steps = [
        // Phrase A (Jaunty C-major Epyx arcade theme)
        ['G4', 'E4', 'C3', 1], ['A4', '-', 'C3', 1], ['B4', 'D4', 'G2', 1], ['C5', 'E4', 'C3', 1],
        ['E5', 'G4', 'C3', 2], ['D5', 'F4', 'B2', 1], ['C5', 'E4', 'A2', 1],
        ['A4', 'F4', 'F2', 2], ['C5', 'F4', 'A2', 2],
        ['G4', 'E4', 'C3', 2], ['E4', 'C4', 'G2', 2],

        ['F4', 'D4', 'D3', 1], ['G4', '-', 'D3', 1], ['A4', 'F4', 'A2', 1], ['B4', 'F4', 'D3', 1],
        ['D5', 'B4', 'G2', 2], ['C5', 'A4', 'G2', 1], ['B4', 'G4', 'G2', 1],
        ['C5', 'E4', 'C3', 2], ['E5', 'G4', 'G2', 2],
        ['D5', 'B4', 'G2', 2], ['G4', 'F4', 'B2', 2],

        // Phrase B (Bright bridge)
        ['E5', 'C5', 'C3', 2], ['G5', 'E5', 'E3', 1], ['E5', 'C5', 'G3', 1],
        ['F5', 'A4', 'F3', 2], ['D5', 'A4', 'D3', 2],
        ['E5', 'G4', 'C3', 2], ['C5', 'E4', 'A2', 2],
        ['D5', 'F#4', 'D3', 2], ['B4', 'G4', 'G2', 2],

        // Finale turnaround
        ['C5', 'E4', 'C3', 1], ['D5', 'F4', 'D3', 1], ['E5', 'G4', 'E3', 1], ['F5', 'A4', 'F3', 1],
        ['G5', 'C5', 'G3', 2], ['E5', 'C5', 'G2', 2],
        ['D5', 'B4', 'G2', 1], ['C5', 'A4', 'A2', 1], ['B4', 'G4', 'B2', 1], ['D5', 'F4', 'G2', 1],
        ['C5', 'E4', 'C3', 3], ['-', '-', '-', 1]
      ];
      this._playSequence(steps, 0.145, true);
    }

    playStartJingle(onDone) {
      const steps = [
        ['C4', 'E3', 'C2', 1], ['E4', 'G3', 'E2', 1], ['G4', 'C4', 'G2', 1],
        ['C5', 'E4', 'C3', 2], ['G4', 'D4', 'B2', 1], ['C5', 'E4', 'C3', 3]
      ];
      this._playSequence(steps, 0.11, false, onDone);
    }

    playMaterialize() {
      if (!this.init() || this.muted) return;
      const now = this.ctx.currentTime;
      const arp = ['C4', 'E4', 'G4', 'B4', 'C5', 'E5', 'G5', 'C6', 'G5', 'C6'];
      for (let i = 0; i < arp.length; i++) {
        this.playTone({
          freq: noteToFreq(arp[i]),
          wave: i % 2 === 0 ? 'pulse12' : 'triangle',
          time: now + i * 0.065,
          dur: 0.06,
          gain: 0.18
        });
      }
    }

    playLevelClear(onDone) {
      const steps = [
        ['C5', 'E4', 'C3', 1], ['E5', 'G4', 'E3', 1], ['G5', 'C5', 'G3', 2],
        ['E5', 'G4', 'C3', 1], ['G5', 'B4', 'G3', 1], ['C6', 'E5', 'C4', 4]
      ];
      this._playSequence(steps, 0.115, false, onDone);
    }

    playWellDone(onDone) {
      const steps = [
        ['C5', 'E4', 'C3', 1], ['E5', 'G4', 'G2', 1], ['G5', 'C5', 'C3', 2],
        ['A5', 'C5', 'F3', 1], ['G5', 'C5', 'E3', 1], ['E5', 'G4', 'C3', 2],
        ['F5', 'A4', 'D3', 1], ['E5', 'G4', 'E3', 1], ['D5', 'F4', 'F3', 1], ['E5', 'G4', 'G3', 1],
        ['C5', 'E4', 'C3', 3], ['G4', 'D4', 'G2', 1],
        ['C5', 'E4', 'C3', 1], ['E5', 'G4', 'E3', 1], ['G5', 'B4', 'G3', 1], ['A5', 'C5', 'A3', 1],
        ['B5', 'D5', 'G3', 2], ['G5', 'B4', 'G2', 2],
        ['C6', 'E5', 'C3', 4], ['-', '-', '-', 1]
      ];
      this._playSequence(steps, 0.14, false, onDone);
    }

    playLifeLost(onDone) {
      const steps = [
        ['E4', 'C4', 'A2', 2], ['Eb4', 'B3', 'Ab2', 2],
        ['D4', 'Bb3', 'G2', 2], ['Db4', 'A3', 'Gb2', 4]
      ];
      this._playSequence(steps, 0.15, false, onDone);
    }

    playGameOver(onDone) {
      const steps = [
        ['G4', 'Eb4', 'C3', 2], ['F4', 'D4', 'B2', 2],
        ['Eb4', 'C4', 'Bb2', 2], ['D4', 'B3', 'A2', 2],
        ['C4', 'Ab3', 'Ab2', 2], ['B3', 'G3', 'G2', 2],
        ['C4', 'G3', 'C2', 5]
      ];
      this._playSequence(steps, 0.17, false, onDone);
    }

    playExtraLife() {
      if (!this.init() || this.muted) return;
      const now = this.ctx.currentTime;
      const notes = ['E5', 'G5', 'E6', 'C6', 'D6', 'G6'];
      notes.forEach((n, i) => {
        this.playTone({
          freq: noteToFreq(n),
          wave: 'pulse25',
          time: now + i * 0.075,
          dur: 0.07,
          gain: 0.22
        });
      });
    }

    // =========================================================================
    // REAL-TIME GAMEPLAY SFX
    // =========================================================================
    sfxStep(toggle) {
      this.playTone({
        freq: toggle ? 155 : 190,
        endFreq: toggle ? 115 : 140,
        wave: 'triangle',
        dur: 0.025,
        release: 0.01,
        gain: 0.14
      });
    }

    sfxClimb(toggle) {
      this.playTone({
        freq: toggle ? 310 : 390,
        wave: 'pulse25',
        dur: 0.022,
        release: 0.01,
        gain: 0.12
      });
    }

    sfxRope(isUp, step) {
      const base = isUp ? 440 + (step % 5) * 45 : 580 - (step % 5) * 45;
      this.playTone({
        freq: base,
        wave: 'triangle',
        dur: 0.024,
        release: 0.01,
        gain: 0.13
      });
    }

    sfxJump() {
      this.playTone({
        freq: 230,
        endFreq: 590,
        wave: 'pulse25',
        dur: 0.14,
        release: 0.03,
        gain: 0.19
      });
    }

    sfxDefuse(isSpellBonus = false) {
      if (!this.init() || this.muted) return;
      const now = this.ctx.currentTime;
      this.playTone({
        freq: 587.33, // D5
        wave: 'pulse12',
        time: now,
        dur: 0.055,
        gain: 0.22
      });
      this.playTone({
        freq: 880, // A5
        wave: 'pulse25',
        time: now + 0.055,
        dur: 0.09,
        gain: 0.22
      });
      if (isSpellBonus) {
        this.playTone({
          freq: 1174.66, // D6
          wave: 'pulse12',
          time: now + 0.12,
          dur: 0.12,
          gain: 0.24
        });
      }
    }

    sfxBonusTick(pitchStep = 0) {
      this.playTone({
        freq: 700 + (pitchStep % 12) * 35,
        wave: 'pulse25',
        dur: 0.028,
        release: 0.01,
        gain: 0.15
      });
    }

    sfxReactive() {
      this.playTone({
        freq: 520,
        endFreq: 260,
        wave: 'sawtooth',
        dur: 0.075,
        gain: 0.14
      });
    }

    sfxBulletLock() {
      this.playTone({
        freq: 1350,
        endFreq: 310,
        wave: 'pulse12',
        dur: 0.12,
        gain: 0.17
      });
    }

    sfxHellstoneBounce() {
      this.playNoise({
        dur: 0.055,
        gain: 0.22,
        filterFreq: 260,
        endFilterFreq: 95,
        q: 2.2
      });
    }

    sfxHatch() {
      this.playTone({
        freq: 920,
        endFreq: 1480,
        wave: 'pulse12',
        dur: 0.06,
        gain: 0.15
      });
    }

    sfxTeleport() {
      this.playTone({
        freq: 420,
        endFreq: 960,
        wave: 'triangle',
        dur: 0.07,
        gain: 0.13
      });
    }

    sfxTumbleStart() {
      this.playTone({
        freq: 660,
        endFreq: 135,
        wave: 'pulse25',
        dur: 0.42,
        release: 0.06,
        gain: 0.22
      });
    }

    sfxKabam() {
      if (!this.init() || this.muted) return;
      const now = this.ctx.currentTime;
      this.playNoise({
        time: now,
        dur: 0.36,
        gain: 0.42,
        filterFreq: 780,
        endFilterFreq: 75,
        q: 0.9,
        release: 0.12
      });
      this.playTone({
        freq: 120,
        endFreq: 36,
        wave: 'sawtooth',
        time: now,
        dur: 0.32,
        gain: 0.28
      });
    }

    sfxCrumbleTick() {
      this.playNoise({
        dur: 0.05,
        gain: 0.16,
        filterFreq: 420,
        endFilterFreq: 120,
        q: 1.4
      });
    }

    setWindActive(active) {
      if (!active) {
        if (this.windNode) {
          try {
            this.windNode.stop();
          } catch (e) {}
          this.windNode = null;
          this.windGain = null;
        }
        return;
      }
      if (this.windNode || !this.init() || !this.noiseBuffer) return;

      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;

      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 480;
      bp.Q.value = 2.8;

      const g = this.ctx.createGain();
      g.gain.value = 0.055;

      src.connect(bp);
      bp.connect(g);
      g.connect(this.filterNode);
      src.start();

      this.windNode = src;
      this.windGain = g;
    }
  }

  global.SID = new SID6581();
})(window);
