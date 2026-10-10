import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Stadium } from '../../src/core/entities/Stadium';
import { Camera } from '../../src/render/Camera';
import { MinimapRenderer, DEFAULT_MINIMAP_SETTINGS } from '../../src/render/MinimapRenderer';
import { CanvasRenderer } from '../../src/render/CanvasRenderer';
import { GameSnapshot } from '../../src/core/game/GameState';
import { SettingsModal, DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../../src/ui/components/SettingsModal';
import { InputManager } from '../../src/client/InputManager';

describe('MinimapRenderer - Real-time Radar & Coordinate Projections', () => {
  let stadium: Stadium;
  let minimap: MinimapRenderer;

  beforeEach(() => {
    const mockCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      arc: vi.fn(),
      roundRect: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      setLineDash: vi.fn(),
      drawImage: vi.fn()
    };

    const createMockCanvas = (w: number = 200, h: number = 90) => ({
      width: w,
      height: h,
      clientWidth: w,
      clientHeight: h,
      getContext: vi.fn(() => mockCtx)
    });

    (globalThis as any).document = {
      createElement: vi.fn((tag: string) => {
        if (tag === 'canvas') return createMockCanvas();
        return {
          classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
          style: {},
          appendChild: vi.fn(),
          querySelector: vi.fn(() => null),
          querySelectorAll: vi.fn(() => []),
          addEventListener: vi.fn()
        };
      }),
      getElementById: vi.fn(() => null),
      documentElement: { style: { setProperty: vi.fn() } },
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => [])
    };

    // Estadio clásico: ancho 1200, alto 540 (halfWidth 600, halfHeight 270)
    stadium = new Stadium({ width: 1200, height: 540 });
    minimap = new MinimapRenderer(stadium);
  });

  describe('1. Matemática de Proyección de Coordenadas (Mundo -> Minimapa)', () => {
    it('proyecta el centro de la cancha (0, 0) exactamente en el centro del minimapa', () => {
      const minimapW = 200;
      const minimapH = 90;
      const p = MinimapRenderer.projectCoordinates(0, 0, 1200, 540, minimapW, minimapH);

      expect(p.x).toBeCloseTo(100, 5);
      expect(p.y).toBeCloseTo(45, 5);

      const instP = minimap.worldToMinimap(0, 0);
      expect(instP.x).toBeCloseTo(100, 5);
      expect(instP.y).toBeCloseTo(45, 5);
    });

    it('proyecta las cuatro coordenadas extremas del estadio exactamente en los límites del minimapa', () => {
      const hw = stadium.halfWidth; // 600
      const hh = stadium.halfHeight; // 270
      const w = minimap.width; // 200
      const h = minimap.height; // 90

      // 1. Esquina superior izquierda: (-halfWidth, -halfHeight) -> (0, 0)
      const topLeft = minimap.worldToMinimap(-hw, -hh);
      expect(topLeft.x).toBeCloseTo(0, 5);
      expect(topLeft.y).toBeCloseTo(0, 5);

      // 2. Esquina superior derecha: (+halfWidth, -halfHeight) -> (width, 0)
      const topRight = minimap.worldToMinimap(hw, -hh);
      expect(topRight.x).toBeCloseTo(w, 5);
      expect(topRight.y).toBeCloseTo(0, 5);

      // 3. Esquina inferior izquierda: (-halfWidth, +halfHeight) -> (0, height)
      const bottomLeft = minimap.worldToMinimap(-hw, hh);
      expect(bottomLeft.x).toBeCloseTo(0, 5);
      expect(bottomLeft.y).toBeCloseTo(h, 5);

      // 4. Esquina inferior derecha: (+halfWidth, +halfHeight) -> (width, height)
      const bottomRight = minimap.worldToMinimap(hw, hh);
      expect(bottomRight.x).toBeCloseTo(w, 5);
      expect(bottomRight.y).toBeCloseTo(h, 5);
    });

    it('proyecta coordenadas intermedias con precisión lineal y continua', () => {
      // Cuarto de cancha (+300, +135) -> u = 0.75, v = 0.75 -> (150, 67.5)
      const p = minimap.worldToMinimap(300, 135);
      expect(p.x).toBeCloseTo(150, 5);
      expect(p.y).toBeCloseTo(67.5, 5);

      // Cuarto opuesto (-300, -135) -> u = 0.25, v = 0.25 -> (50, 22.5)
      const p2 = minimap.worldToMinimap(-300, -135);
      expect(p2.x).toBeCloseTo(50, 5);
      expect(p2.y).toBeCloseTo(22.5, 5);
    });

    it('soporta coordenadas absolutas en espacio de pantalla con margen de 16 px', () => {
      const screenW = 800;
      const screenH = 600;
      minimap.x = screenW - minimap.width - 16; // 800 - 200 - 16 = 584
      minimap.y = screenH - minimap.height - 16; // 600 - 90 - 16 = 494

      const absCenter = minimap.worldToMinimap(0, 0, true);
      expect(absCenter.x).toBeCloseTo(584 + 100, 5);
      expect(absCenter.y).toBeCloseTo(494 + 45, 5);

      const absTopLeft = minimap.worldToMinimap(-stadium.halfWidth, -stadium.halfHeight, true);
      expect(absTopLeft.x).toBeCloseTo(584, 5);
      expect(absTopLeft.y).toBeCloseTo(494, 5);

      const absBottomRight = minimap.worldToMinimap(stadium.halfWidth, stadium.halfHeight, true);
      expect(absBottomRight.x).toBeCloseTo(584 + 200, 5);
      expect(absBottomRight.y).toBeCloseTo(494 + 90, 5);
    });

    it('restringe adecuadamente los límites mediante worldToMinimapClamped', () => {
      // Coordenadas que sobrepasan el terreno de juego (ej: fondo de la portería)
      const outOfBoundsLeft = minimap.worldToMinimapClamped(-800, 0);
      expect(outOfBoundsLeft.x).toBe(0);
      expect(outOfBoundsLeft.y).toBeCloseTo(45, 5);

      const outOfBoundsRight = minimap.worldToMinimapClamped(1000, 0);
      expect(outOfBoundsRight.x).toBe(minimap.width);
      expect(outOfBoundsRight.y).toBeCloseTo(45, 5);

      const outOfBoundsTop = minimap.worldToMinimapClamped(0, -400);
      expect(outOfBoundsTop.x).toBeCloseTo(100, 5);
      expect(outOfBoundsTop.y).toBe(0);

      const outOfBoundsBottom = minimap.worldToMinimapClamped(0, 400);
      expect(outOfBoundsBottom.x).toBeCloseTo(100, 5);
      expect(outOfBoundsBottom.y).toBe(minimap.height);
    });
  });

  describe('2. Dimensionamiento y Relación de Aspecto Proporcional', () => {
    it('calcula la altura proporcional inicial de acuerdo al ratio del estadio', () => {
      // 1200 x 540 -> aspect = 540 / 1200 = 0.45 -> 200 * 0.45 = 90
      expect(minimap.width).toBe(200);
      expect(minimap.height).toBe(90);
    });

    it('recalcula la altura proporcional al cambiar el tamaño base (Pequeño: 160, Mediano: 200, Grande: 240)', () => {
      minimap.setSize(160);
      expect(minimap.width).toBe(160);
      expect(minimap.height).toBe(Math.round(160 * 0.45)); // 72

      minimap.setSize(240);
      expect(minimap.width).toBe(240);
      expect(minimap.height).toBe(Math.round(240 * 0.45)); // 108
    });

    it('adapta el aspect ratio dinámicamente cuando cambia el estadio', () => {
      const squareStadium = new Stadium({ width: 800, height: 800 });
      minimap.setStadium(squareStadium);

      expect(minimap.width).toBe(200);
      expect(minimap.height).toBe(200);

      const wideStadium = new Stadium({ width: 1000, height: 500 });
      minimap.setStadium(wideStadium);
      expect(minimap.height).toBe(100);
    });
  });

  describe('3. Caché Estática de la Cancha y Regeneración Selectiva', () => {
    it('genera la caché en un canvas auxiliar', () => {
      expect(minimap.cachedCanvas).not.toBeNull();
      expect(minimap.cachedCanvas?.width).toBe(200);
      expect(minimap.cachedCanvas?.height).toBe(90);
    });

    it('invalida y regenera la caché únicamente cuando cambia el estadio o el tamaño', () => {
      const initialCanvas = minimap.cachedCanvas;

      // Volver a llamar cachePitch sin cambios no crea un canvas nuevo
      minimap.cachePitch();
      expect(minimap.cachedCanvas).toBe(initialCanvas);

      // Cambiar de estadio invalida la caché
      const newStadium = new Stadium({ width: 1400, height: 600 });
      minimap.setStadium(newStadium);
      minimap.cachePitch();

      expect(minimap.cachedCanvas).not.toBe(initialCanvas);
      expect(minimap.stadium).toBe(newStadium);
    });
  });

  describe('4. Renderizado Dinámico y Elementos Visuales (Frustum, Jugadores y Balón)', () => {
    it('renderiza jugadores con colores distintivos por equipo y anillo para el jugador local', () => {
      const mockCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        roundRect: vi.fn(),
        clip: vi.fn(),
        strokeRect: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        drawImage: vi.fn(),
        setLineDash: vi.fn(),
        globalAlpha: 1.0,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        shadowColor: '',
        shadowBlur: 0
      } as unknown as CanvasRenderingContext2D;

      const camera = new Camera(0, 0);
      const snapshot = {
        tick: 1,
        scoreRed: 0,
        scoreBlue: 0,
        timerSeconds: 120,
        discs: [
          { id: 0, x: 0, y: 0, vx: 0, vy: 0, radius: 5.8, team: 0, kicking: false, avatar: '' }, // Balón
          { id: 1, x: -100, y: 0, vx: 0, vy: 0, radius: 15, team: 1, kicking: false, avatar: '1' }, // Rojo (Local)
          { id: 2, x: 100, y: 0, vx: 0, vy: 0, radius: 15, team: 2, kicking: false, avatar: '2' } // Azul
        ]
      } as unknown as GameSnapshot;

      minimap.render(mockCtx, snapshot, camera, 1, {
        minimapEnabled: true,
        minimapOpacity: 0.7,
        minimapCameraFrustum: true
      }, 800, 600);

      // Verificación de recorte
      expect(mockCtx.clip).toHaveBeenCalled();

      // Verificación de opacidad
      expect(mockCtx.drawImage).toHaveBeenCalled();

      // Verificación de llamadas de trazo de círculos (anillo local + discos + balón)
      expect(mockCtx.arc).toHaveBeenCalled();

      // Verificación de strokeRect para el frustum de la cámara
      expect(mockCtx.strokeRect).toHaveBeenCalled();
    });

    it('omite el renderizado por completo si minimapEnabled es false', () => {
      const mockCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        drawImage: vi.fn(),
        clip: vi.fn()
      } as unknown as CanvasRenderingContext2D;

      const camera = new Camera(0, 0);
      const snapshot = {
        tick: 1,
        scoreRed: 0,
        scoreBlue: 0,
        timerSeconds: 120,
        discs: []
      } as unknown as GameSnapshot;

      minimap.render(mockCtx, snapshot, camera, null, { minimapEnabled: false }, 800, 600);

      expect(mockCtx.drawImage).not.toHaveBeenCalled();
      expect(mockCtx.clip).not.toHaveBeenCalled();
    });

    it('Camera.getViewportBounds proyecta los límites visibles del viewport en coordenadas del mundo', () => {
      const camera = new Camera(0, 0);
      camera.zoom = 1.0;
      const bounds = camera.getViewportBounds(800, 600, 400, 300);

      expect(bounds.minX).toBe(-400);
      expect(bounds.maxX).toBe(400);
      expect(bounds.minY).toBe(-300);
      expect(bounds.maxY).toBe(300);
      expect(bounds.width).toBe(800);
      expect(bounds.height).toBe(600);
    });
  });

  describe('5. Integración con SettingsModal y Persistencia haxball_settings_v1', () => {
    it('SettingsModal contiene los valores por defecto del minimapa', () => {
      expect(DEFAULT_SETTINGS.minimapEnabled).toBe(true);
      expect(DEFAULT_SETTINGS.minimapOpacity).toBe(0.6);
      expect(DEFAULT_SETTINGS.minimapSize).toBe(200);
      expect(DEFAULT_SETTINGS.minimapCameraFrustum).toBe(true);
      expect(SETTINGS_STORAGE_KEY).toBe('haxball_settings_v1');
      expect(DEFAULT_MINIMAP_SETTINGS.minimapEnabled).toBe(true);
      expect(DEFAULT_MINIMAP_SETTINGS.minimapSize).toBe(200);
    });

    it('CanvasRenderer tiene instanciado MinimapRenderer y sincroniza sus configuraciones', () => {
      const mockCanvas = {
        getContext: () => ({
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn(),
          translate: vi.fn(),
          fillRect: vi.fn(),
          clearRect: vi.fn()
        }),
        clientWidth: 800,
        clientHeight: 600,
        width: 800,
        height: 600
      } as unknown as HTMLCanvasElement;

      const renderer = new CanvasRenderer(mockCanvas, stadium);
      expect(renderer.minimapRenderer).toBeDefined();
      expect(renderer.minimapEnabled).toBe(true);
      expect(renderer.minimapOpacity).toBe(0.6);
      expect(renderer.minimapSize).toBe(200);

      // Simular enlace con SettingsModal
      const inputManager = new InputManager();
      const modal = new SettingsModal(inputManager, undefined, renderer);

      modal.settings.minimapOpacity = 0.85;
      modal.settings.minimapSize = 240;
      modal.settings.minimapCameraFrustum = false;
      modal.applySettings();

      expect(renderer.minimapOpacity).toBe(0.85);
      expect(renderer.minimapSize).toBe(240);
      expect(renderer.minimapCameraFrustum).toBe(false);
      expect(renderer.minimapRenderer.opacity).toBe(0.85);
      expect(renderer.minimapRenderer.width).toBe(240);
      expect(renderer.minimapRenderer.cameraFrustum).toBe(false);
    });
  });
});
