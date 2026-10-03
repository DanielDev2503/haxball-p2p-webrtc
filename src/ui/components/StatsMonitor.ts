/**
 * StatsMonitor - Widget de Telemetría (Ping, FPS y Sparkline en Tiempo Real)
 * Estructura fija en esquina inferior izquierda con Cero Alocaciones en tiempo de ejecución (Zero-GC).
 */
export class StatsMonitor {
  private container: HTMLElement | null = null;
  private pingEl: HTMLElement | null = null;
  private fpsEl: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  // Buffer circular estático prealocado de 40 muestras para Cero Alocaciones en 60 Hz
  public readonly capacity: number = 40;
  public readonly samples: Float32Array = new Float32Array(40);
  private head: number = 0;
  private count: number = 0;

  // Ventana deslizante estática prealocada para promedio de ping
  private readonly pingSamples: Float32Array = new Float32Array(20);
  private pingHead: number = 0;
  private pingCount: number = 0;
  private cachedAvgPing: number = 0;

  // Cache numérico primitivo
  private currentPing: number = 0;
  private currentFps: number = 60;

  constructor() {
    if (typeof document === 'undefined') return;

    this.container = document.getElementById('statsMonitor');
    if (!this.container) {
      this.createDOM();
    } else {
      this.bindElements();
    }
  }

  private createDOM(): void {
    if (typeof document === 'undefined') return;

    this.container = document.createElement('div');
    this.container.id = 'statsMonitor';
    this.container.className = 'stats-monitor-widget fixed bottom-3 left-3 z-30 select-none pointer-events-none';

    this.pingEl = document.createElement('div');
    this.pingEl.id = 'statsPingText';
    this.pingEl.className = 'stats-line font-mono text-xs text-white';
    this.pingEl.textContent = 'Ping: 0ms - 0ms';

    this.fpsEl = document.createElement('div');
    this.fpsEl.id = 'statsFpsText';
    this.fpsEl.className = 'stats-line font-mono text-xs text-white';
    this.fpsEl.textContent = 'Fps: 60';

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'statsSparkline';
    this.canvas.className = 'stats-sparkline';
    this.canvas.width = 110;
    this.canvas.height = 28;

    this.container.appendChild(this.pingEl);
    this.container.appendChild(this.fpsEl);
    this.container.appendChild(this.canvas);

    document.body.appendChild(this.container);

    if (this.canvas && typeof this.canvas.getContext === 'function') {
      this.ctx = this.canvas.getContext('2d');
    }
  }

  private bindElements(): void {
    if (!this.container) return;

    this.pingEl = document.getElementById('statsPingText');
    this.fpsEl = document.getElementById('statsFpsText');
    this.canvas = document.getElementById('statsSparkline') as HTMLCanvasElement | null;

    if (this.canvas && typeof this.canvas.getContext === 'function') {
      this.ctx = this.canvas.getContext('2d');
    }
  }

  /**
   * Actualiza las métricas y dibuja el sparkline en el canvas de 110x28.
   * CERO alocaciones en bucle caliente de 60 Hz.
   */
  public update(pingMs: number, fps: number, sampleVal?: number): void {
    this.currentPing = pingMs;
    this.currentFps = fps;

    // Actualizar ventana deslizante de ping sin GC
    this.pingSamples[this.pingHead] = pingMs;
    this.pingHead = (this.pingHead + 1) % 20;
    if (this.pingCount < 20) this.pingCount++;

    let pingSum = 0;
    for (let i = 0; i < this.pingCount; i++) {
      pingSum += this.pingSamples[i];
    }
    this.cachedAvgPing = pingSum / this.pingCount;

    // Registrar muestra en buffer circular estático
    const sample = sampleVal !== undefined
      ? sampleVal
      : (pingMs > 0 ? pingMs : (1000 / Math.max(1, fps)));

    this.samples[this.head] = sample;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;

    // Actualizar textos de estado
    if (this.pingEl) {
      this.pingEl.textContent = `Ping: ${Math.round(this.currentPing)}ms - ${Math.round(this.cachedAvgPing)}ms`;
    }
    if (this.fpsEl) {
      this.fpsEl.textContent = `Fps: ${Math.round(this.currentFps)}`;
    }

    this.drawSparkline();
  }

  /**
   * Renderiza el gráfico Sparkline sobre el canvas mini (110 x 28)
   */
  private drawSparkline(): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = 110;
    const h = 28;

    ctx.clearRect(0, 0, w, h);

    // Línea de base horizontal continua gris (rgba(148, 163, 184, 0.45))
    const baseY = 24.5;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(w, baseY);
    ctx.stroke();

    if (this.count === 0) return;

    // Escala dinámica basada en el valor máximo de la ventana
    let maxVal = 20;
    for (let i = 0; i < this.count; i++) {
      if (this.samples[i] > maxVal) {
        maxVal = this.samples[i];
      }
    }

    // Barras verticales verde brillante (#22c55e)
    ctx.fillStyle = '#22c55e';
    const barWidth = 2;
    const availableHeight = 21; // Espacio libre vertical por encima de la línea base

    // Recorre de la muestra más antigua a la más nueva
    const startIdx = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (startIdx + i) % this.capacity;
      const val = this.samples[idx];
      const normHeight = Math.min(availableHeight, Math.max(2, (val / maxVal) * availableHeight));
      const x = i * 2.75;
      const y = baseY - normHeight;
      ctx.fillRect(x, y, barWidth, normHeight);
    }
  }

  public getSampleCount(): number {
    return this.count;
  }

  public getCurrentPing(): number {
    return this.currentPing;
  }

  public getAvgPing(): number {
    return this.cachedAvgPing;
  }

  public getCurrentFps(): number {
    return this.currentFps;
  }
}
