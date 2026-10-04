export interface GameplayConfig {
  playerMaxSpeed: number;       // min: 0.7, max: 11.2, def: 2.8 (px/tick, 0.25x - 4.0x)
  playerAcceleration: number;   // min: 0.03, max: 0.55, def: 0.11 (0.25x - 5.0x)
  kickStrength: number;         // min: 0.9, max: 18.2, def: 4.545 (0.2x - 4.0x)
  playerRadius: number;         // min: 8.0, max: 30.0, def: 15.0 (px)
  ballRadius: number;           // min: 3.0, max: 16.0, def: 5.8 (px)
  ballRestitution: number;      // min: 0.0, max: 1.8, def: 0.5 (bCoef)
  boostMultiplier: number;      // min: 1.1, max: 4.0, def: 2.0 (Turbo Multiplier)
  dashDistance: number;         // min: 1.8, max: 56.5, def: 18.75 (px, 0.1x - 3.0x de 18.75px)
  staminaRechargeRate: number;  // min: 5.0, max: 100.0, def: 25.0 (%/s)
  magnusCurveStrength: number;  // min: 0.0, max: 5.0, def: 1.05 (0.0x - 5.0x)
  ballMass: number;             // min: 0.1, max: 10.0, def: 1.0
  playerMass: number;           // min: 0.1, max: 10.0, def: 2.0
}

export interface ConfigLimits {
  min: number;
  max: number;
  step: number;
  default: number;
  label: string;
  unit?: string;
  description: string;
}

export const GAMEPLAY_CONFIG_LIMITS: Record<keyof GameplayConfig, ConfigLimits> = {
  playerMaxSpeed: {
    min: 0.7,
    max: 11.2,
    step: 0.1,
    default: 2.8,
    label: 'Velocidad Jugador',
    unit: 'px/tick',
    description: 'Escala 0.25x - 4.0x sobre velocidad base del jugador.'
  },
  playerAcceleration: {
    min: 0.03,
    max: 0.55,
    step: 0.01,
    default: 0.11,
    label: 'Aceleración Jugador',
    description: 'Escala 0.25x - 5.0x sobre aceleración motriz base.'
  },
  kickStrength: {
    min: 0.9,
    max: 18.2,
    step: 0.05,
    default: 4.545,
    label: 'Fuerza de Patada',
    description: 'Escala 0.2x - 4.0x sobre el impulso cinemático de tiro.'
  },
  playerRadius: {
    min: 8.0,
    max: 30.0,
    step: 0.5,
    default: 15.0,
    label: 'Radio del Jugador',
    unit: 'px',
    description: 'Radio físico de colisión y renderizado del disco jugador.'
  },
  ballRadius: {
    min: 3.0,
    max: 16.0,
    step: 0.2,
    default: 5.8,
    label: 'Radio del Balón',
    unit: 'px',
    description: 'Radio geométrico del balón en colisiones con postes y jugadores.'
  },
  ballRestitution: {
    min: 0.0,
    max: 1.8,
    step: 0.01,
    default: 0.5,
    label: 'Rebote Balón (bCoef)',
    description: 'Coeficiente de restitución elástica (0.0 sin rebote, >1.0 superelástico).'
  },
  boostMultiplier: {
    min: 1.1,
    max: 4.0,
    step: 0.05,
    default: 2.0,
    label: 'Multiplicador de Turbo',
    description: 'Factor multiplicador de velocidad y aceleración en sprint (1.1x - 4.0x).'
  },
  dashDistance: {
    min: 1.8,
    max: 56.5,
    step: 0.25,
    default: 18.75,
    label: 'Distancia de Dash',
    unit: 'px',
    description: 'Desplazamiento total instantáneo en ráfaga (0.1x - 3.0x de 18.75 px).'
  },
  staminaRechargeRate: {
    min: 5.0,
    max: 100.0,
    step: 1.0,
    default: 25.0,
    label: 'Tasa Recarga Estamina',
    unit: '%/s',
    description: 'Tasa de recuperación pasiva en reposo de teclas.'
  },
  magnusCurveStrength: {
    min: 0.0,
    max: 5.0,
    step: 0.05,
    default: 1.05,
    label: 'Fuerza de Curva Magnus',
    description: 'Intensidad de curvatura lateral durante la pulsación activa de Z / C.'
  },
  ballMass: {
    min: 0.1,
    max: 10.0,
    step: 0.1,
    default: 1.0,
    label: 'Masa del Balón',
    description: 'Masa inercial del balón en transferencias de momento y choques.'
  },
  playerMass: {
    min: 0.1,
    max: 10.0,
    step: 0.1,
    default: 2.0,
    label: 'Masa del Jugador',
    description: 'Masa inercial del jugador para colisiones de cuerpo y tackle.'
  }
};

export const DEFAULT_GAMEPLAY_CONFIG: Readonly<GameplayConfig> = Object.freeze({
  playerMaxSpeed: 2.8,
  playerAcceleration: 0.11,
  kickStrength: 4.545,
  playerRadius: 15.0,
  ballRadius: 5.8,
  ballRestitution: 0.5,
  boostMultiplier: 2.0,
  dashDistance: 18.75,
  staminaRechargeRate: 25.0,
  magnusCurveStrength: 1.05,
  ballMass: 1.0,
  playerMass: 2.0
});

/**
 * Sanea y acota cualquier configuración parcial o externa a límites numéricos seguros.
 * Garantiza cero colapsos numéricos o valores NaN/fuera de rango en el motor.
 */
export function sanitizeGameplayConfig(partial?: Partial<GameplayConfig> | null): GameplayConfig {
  const result: GameplayConfig = { ...DEFAULT_GAMEPLAY_CONFIG };
  if (!partial) return result;

  for (const key of Object.keys(DEFAULT_GAMEPLAY_CONFIG) as Array<keyof GameplayConfig>) {
    const val = partial[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      const limits = GAMEPLAY_CONFIG_LIMITS[key];
      if (limits) {
        result[key] = Math.max(limits.min, Math.min(limits.max, val));
      }
    }
  }

  return result;
}
