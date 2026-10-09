/**
 * PhysicsTicker - Web Worker desacoplado para emisión de ticks a 60 Hz exactos.
 * Inmune a la suspensión o reducción de frecuencia de pestañas en segundo plano (background tab throttling).
 */
export class PhysicsTicker {
  private worker: Worker | null = null;
  public onTick?: (dt?: number) => void;
  public isRunning: boolean = false;
  public fixedStep: number = 1 / 60;
  public accumulator: number = 0;
  private lastTime: number = 0;

  constructor() {
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined') {
      const workerCode = `
        let intervalId = null;
        self.onmessage = function(e) {
          if (e.data === 'START') {
            if (!intervalId) {
              intervalId = setInterval(function() {
                self.postMessage('TICK');
              }, 1000 / 60);
            }
          } else if (e.data === 'STOP') {
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = null;
            }
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (e: MessageEvent) => {
        if (e.data === 'TICK' && this.isRunning && this.onTick) {
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const rawDelta = this.lastTime > 0 ? (now - this.lastTime) / 1000 : this.fixedStep;
          this.lastTime = now;
          this.update(rawDelta);
        }
      };
    }
  }

  public update(rawDelta: number): void {
    const maxDelta = 0.1; // 100 ms máximo
    const dt = Math.min(rawDelta, maxDelta);
    this.accumulator += dt;

    let steps = 0;
    const MAX_STEPS_PER_FRAME = 4;

    while (this.accumulator >= this.fixedStep && steps < MAX_STEPS_PER_FRAME) {
      if (this.onTick) {
        this.onTick(this.fixedStep);
      }
      this.accumulator -= this.fixedStep;
      steps++;
    }

    // Descartar exceso residual si el motor se quedó atrás
    if (this.accumulator >= this.fixedStep) {
      this.accumulator = 0;
    }
  }

  public start(): void {
    this.isRunning = true;
    this.accumulator = 0;
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.worker) {
      this.worker.postMessage('START');
    }
  }

  public stop(): void {
    this.isRunning = false;
    this.accumulator = 0;
    this.lastTime = 0;
    if (this.worker) {
      this.worker.postMessage('STOP');
    }
  }

  public destroy(): void {
    this.stop();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
