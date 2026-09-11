/**
 * PhysicsTicker - Web Worker desacoplado para emisión de ticks a 60 Hz exactos.
 * Inmune a la suspensión o reducción de frecuencia de pestañas en segundo plano (background tab throttling).
 */
export class PhysicsTicker {
  private worker: Worker | null = null;
  public onTick?: () => void;
  public isRunning: boolean = false;

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
          this.onTick();
        }
      };
    }
  }

  public start(): void {
    this.isRunning = true;
    if (this.worker) {
      this.worker.postMessage('START');
    }
  }

  public stop(): void {
    this.isRunning = false;
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
