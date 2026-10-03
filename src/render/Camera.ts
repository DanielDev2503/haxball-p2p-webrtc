import { clamp } from '../core/math/MathUtils';

export class Camera {
  public x: number = 0;
  public y: number = 0;
  public targetX: number = 0;
  public targetY: number = 0;
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
   * Restricción a límites de cancha (Clamping) con soporte para área segura inferior (Chat / UI):
   * Limita el desplazamiento para nunca mostrar espacio vacío más allá del perímetro exterior,
   * y garantiza que el jugador y el balón permanezcan plenamente visibles por encima del área de chat.
   * cam_x = clamp(cam_x, -(W_ext - V_w)/2, (W_ext - V_w)/2)
   * cam_y = clamp(cam_y, -(H_ext - Usable_h)/2, (H_ext - Usable_h)/2)
   */
  public clamp(wExt: number, hExt: number, vWidth: number, vHeight: number, safeAreaBottom: number = 0): void {
    const boundX = (wExt - vWidth) / 2;
    if (boundX <= 0) {
      this.x = 0;
    } else {
      this.x = clamp(this.x, -boundX, boundX);
    }

    const usableHeight = vHeight - safeAreaBottom;
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
