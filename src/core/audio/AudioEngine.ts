// src/core/audio/AudioEngine.ts
/**
 * Procedural audio synthesis for Haxball clone using Web Audio API.
 * Provides lightweight, customizable sound effects for kick, wall hit, goal, and ambient whistle.
 * All sounds are generated on the fly without external assets, adhering to the requirement
 * for procedural audio.
 */
export class AudioEngine {
  private readonly context: AudioContext;
  private masterGain: GainNode;

  constructor() {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    this.context = new AudioCtx();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.5; // master volume
    this.masterGain.connect(this.context.destination);
  }

  /** Helper to create an oscillator with given type and frequency */
  private createOscillator(type: OscillatorType, frequency: number): OscillatorNode {
    const osc = this.context.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    return osc;
  }

  /** Helper to schedule oscillator stop after given duration (seconds) */
  private scheduleStop(node: AudioScheduledSourceNode, startTime: number, duration: number) {
    node.stop(startTime + duration);
  }

  /** Play a short "kick" sound (sharp bass) */
  public playKick(): void {
    const now = this.context.currentTime;
    const osc = this.createOscillator('sine', 120);
    const gain = this.context.createGain();
    // envelope
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    this.scheduleStop(osc, now, 0.2);
  }

  /** Play a wall‑hit "ping" (high‑pitched short tone) */
  public playWallHit(): void {
    const now = this.context.currentTime;
    const osc = this.createOscillator('triangle', 800);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.6, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    this.scheduleStop(osc, now, 0.1);
  }

  /** Play a goal "cheer" (quick rise‑fall synth) */
  public playGoal(): void {
    const now = this.context.currentTime;
    const osc = this.createOscillator('sawtooth', 200);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.8, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    // pitch bend for effect
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.3);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    this.scheduleStop(osc, now, 0.6);
  }

  /** Play a short whistle (used for kickoff) */
  public playWhistle(): void {
    const now = this.context.currentTime;
    const osc = this.createOscillator('square', 1200);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    this.scheduleStop(osc, now, 0.4);
  }

  /** Adjust master volume (0.0 – 1.0) */
  public setVolume(value: number): void {
    this.masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, value)), this.context.currentTime);
  }
}
