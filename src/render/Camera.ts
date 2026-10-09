import { clamp } from '../core/math/MathUtils';

export class Camera {
  public x: number = 0;
  public y: number = 0;
  public targetX: number = 0;
  public targetY: number = 0;
  public zoom: number = 1.0;
  public readonly lerpFactor: number = 0.12;

  constructor(initialX: number = 0, initialY: number = 0) {
    this.x = initialX;
    this.y = initialY;
    this.targetX = initialX;
    this.targetY = initialY;
  }

  /**
   * Actualiza el objetivo de seguimiento y aplica interpolación suave (Lerp: p_cam += (p_target - p_cam) * 0.12)
   */
  public follow(targetX: number, targetY: number): void {
    this.targetX = targetX;
    this.targetY = targetY;
    this.x += (this.targetX - this.x) * this.lerpFactor;
    this.y += (this.targetY - this.y) * this.lerpFactor;
  }

  /**
   * Calcula la posición objetivo de seguimiento dual (Jugador Prioritario + Balón)
   * respetando la ponderación w_ball (0.25) y la restricción radial máxima (Leash D_max = 180px).
   * Devuelve siempre coordenadas numéricas finitas válidas (cero NaN).
   */
  public calculateDualTarget(
    playerX: number,
    playerY: number,
    ballX: number,
    ballY: number,
    wBall: number = 0.25,
    maxDistance: number = 180
  ): { x: number; y: number } {
    const dx = ballX - playerX;
    const dy = ballY - playerY;
    const distSq = dx * dx + dy * dy;

    if (distSq <= 1e-6) {
      return { x: playerX, y: playerY };
    }

    const dist = Math.sqrt(distSq);
    if (!Number.isFinite(dist) || isNaN(dist)) {
      return { x: playerX, y: playerY };
    }

    const offset = Math.min(dist * wBall, maxDistance);
    const ratio = offset / dist;

    return {
      x: playerX + dx * ratio,
      y: playerY + dy * ratio
    };
  }

  /**
   * Seguimiento cinemático dual en tiempo real con Zero-GC a 60 Hz:
   * Calcula el vector ponderado con leash constraint y aplica lerp(0.12)
   */
  public followDual(
    playerX: number,
    playerY: number,
    ballX: number,
    ballY: number,
    wBall: number = 0.25,
    maxDistance: number = 180
  ): void {
    const dx = ballX - playerX;
    const dy = ballY - playerY;
    const distSq = dx * dx + dy * dy;

    if (distSq <= 1e-6) {
      this.targetX = playerX;
      this.targetY = playerY;
    } else {
      const dist = Math.sqrt(distSq);
      if (!Number.isFinite(dist) || isNaN(dist)) {
        this.targetX = playerX;
        this.targetY = playerY;
      } else {
        const offset = Math.min(dist * wBall, maxDistance);
        const ratio = offset / dist;
        this.targetX = playerX + dx * ratio;
        this.targetY = playerY + dy * ratio;
      }
    }

    this.x += (this.targetX - this.x) * this.lerpFactor;
    this.y += (this.targetY - this.y) * this.lerpFactor;
  }

  /**
   * Restricción a límites de cancha (Clamping) con soporte para área segura inferior (Chat / UI):
   * Limita el desplazamiento para nunca mostrar espacio vacío más allá del perímetro exterior,
   * y garantiza que el jugador y el balón permanezcan plenamente visibles por encima del área de chat.
   * cam_x = clamp(cam_x, -(W_ext - V_w)/2, (W_ext - V_w)/2)
   * cam_y = clamp(cam_y, -(H_ext - Usable_h)/2, (H_ext - Usable_h)/2)
   */
  public clamp(wExt: number, hExt: number, vWidth: number, vHeight: number, safeAreaBottom: number = 0): void {
    const z = Math.max(0.1, this.zoom || 1.0);
    const effectiveVWidth = vWidth / z;
    const boundX = (wExt - effectiveVWidth) / 2;
    if (boundX <= 0) {
      this.x = 0;
    } else {
      this.x = clamp(this.x, -boundX, boundX);
    }

    const usableHeight = (vHeight - safeAreaBottom) / z;
    const boundY = (hExt - usableHeight) / 2;
    if (boundY <= 0) {
      this.y = 0;
    } else {
      this.y = clamp(this.y, -boundY, boundY);
    }
  }

  public reset(x: number = 0, y: number = 0): void {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
  }
}
