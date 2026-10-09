/**
 * Procedural Audio Synthesizer for Haxball using the Web Audio API.
 * Synthesizes kicks, wall bounces, post clinks, referee whistles, and countdown beeps
 * with zero external asset dependencies.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  public isMuted: boolean = false;
  public volume: number = 0.5;

  // Toggles independientes de efectos sonoros
  public chatSoundEnabled: boolean = true;
  public postHitSoundEnabled: boolean = true;
  public kickSoundEnabled: boolean = true;
  public goalSoundEnabled: boolean = true;
  public whistleSoundEnabled: boolean = true;

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

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
    if (this.isMuted || !this.kickSoundEnabled) return;
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
    if (this.isMuted || !this.postHitSoundEnabled) return;
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

  public playGoal(): void {
    this.playGoalWhistle(true);
  }

  public playWhistle(): void {
    this.playGoalWhistle(false);
  }

  public playGoalWhistle(isGoal: boolean = true): void {
    if (this.isMuted) return;
    if (isGoal && !this.goalSoundEnabled) return;
    if (!isGoal && !this.whistleSoundEnabled) return;
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

  /**
   * Tono suave tipo blip/burbuja para mensajes de chat.
   * Sine wave: 800 Hz -> 1200 Hz en 0.05s, decay en 0.08s con ganancia 0.12.
   */
  public playChatMessageSound(): void {
    if (this.isMuted || !this.chatSoundEnabled) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(1200, t + 0.05);

      const maxGain = 0.12 * (this.volume / 0.5);
      gain.gain.setValueAtTime(maxGain, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.08);
    } catch {
      // Ignorar errores de contexto de audio en entornos de prueba o silenciados
    }
  }

  /**
   * Acorde ascendente sutil y agradable de bienvenida al unirse un jugador.
   * Arpegio C5 (523.25 Hz) a E5 (659.25 Hz) con 60ms de intervalo, decaimiento en 0.15s y ganancia 0.18.
   */
  public playPlayerJoinedSound(): void {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    try {
      const t = this.ctx.currentTime;
      const notes = [523.25, 659.25];
      const noteInterval = 0.06;
      const noteDuration = 0.15;
      const baseGain = 0.18 * (this.volume / 0.5);

      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const noteTime = t + idx * noteInterval;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(baseGain, noteTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + noteDuration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(noteTime);
        osc.stop(noteTime + noteDuration);
      });
    } catch {
      // Ignorar errores de contexto de audio
    }
  }

  public play(type: 'kick' | 'bounce' | 'post' | 'goal' | 'countdown' | 'chat' | 'player_joined' | string, isGo?: boolean): void {
    switch (type) {
      case 'kick': return this.playKick();
      case 'bounce': return this.playBounce();
      case 'post': return this.playPostHit();
      case 'goal': return this.playGoalWhistle();
      case 'countdown': return this.playCountdown(isGo);
      case 'chat': return this.playChatMessageSound();
      case 'player_joined': return this.playPlayerJoinedSound();
    }
  }
}
