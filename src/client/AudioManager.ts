/**
 * Procedural Audio Synthesizer for Haxball using the Web Audio API.
 * Synthesizes kicks, wall bounces, post clinks, referee whistles, and countdown beeps
 * with zero external asset dependencies.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  public isMuted: boolean = false;
  public volume: number = 0.5;

  private initContext(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public playKick(): void {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    // Frequency drop for punchy kick impact
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.08);

    gain.gain.setValueAtTime(this.volume * 0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.08);
  }

  public playBounce(): void {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.06);

    gain.gain.setValueAtTime(this.volume * 0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + 0.06);
  }

  public playPostHit(): void {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // Metallic dual-resonance chime
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1400, t);
    osc1.frequency.exponentialRampToValueAtTime(900, t + 0.25);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2850, t);
    osc2.frequency.exponentialRampToValueAtTime(2100, t + 0.25);

    gain.gain.setValueAtTime(this.volume * 0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(t);
    osc2.start(t + 0.002);
    osc1.stop(t + 0.25);
    osc2.stop(t + 0.25);
  }

  public playGoalWhistle(): void {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // Referee dual-tone whistle with subtle vibrato
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const masterGain = this.ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(2600, t);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2950, t);

    // LFO for whistle trill (30Hz flutter)
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(32, t);
    lfoGain.gain.setValueAtTime(150, t);

    lfo.connect(osc1.frequency);
    lfo.connect(osc2.frequency);

    masterGain.gain.setValueAtTime(0, t);
    masterGain.gain.linearRampToValueAtTime(this.volume * 0.6, t + 0.05);
    masterGain.gain.setValueAtTime(this.volume * 0.6, t + 0.5);
    masterGain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);

    osc1.connect(masterGain);
    osc2.connect(masterGain);
    masterGain.connect(this.ctx.destination);

    lfo.start(t);
    osc1.start(t);
    osc2.start(t);

    lfo.stop(t + 0.9);
    osc1.stop(t + 0.9);
    osc2.stop(t + 0.9);
  }

  public playCountdown(isGo: boolean = false): void {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const freq = isGo ? 880 : 440;
    const duration = isGo ? 0.35 : 0.15;

    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(this.volume * 0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(t);
    osc.stop(t + duration);
  }
}
