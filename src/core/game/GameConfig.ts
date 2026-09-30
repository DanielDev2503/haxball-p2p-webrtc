export interface GameplayConfig {
  playerMaxSpeed: number;       // min: 1.5, max: 5.5, def: 2.8 (px/tick)
  playerAcceleration: number;   // min: 0.04, max: 0.28, def: 0.11
  kickStrength: number;         // min: 2.0, max: 9.0, def: 4.545
  playerRadius: number;         // min: 10.0, max: 26.0, def: 15.0 (px)
  ballRadius: number;           // min: 3.8, max: 12.0, def: 5.8 (px)
  ballRestitution: number;      // min: 0.15, max: 0.92, def: 0.412 (bCoef)
  boostMultiplier: number;      // min: 1.2, max: 3.0, def: 1.75
  dashDistance: number;         // min: 40.0, max: 140.0, def: 75.0 (px)
  staminaRechargeRate: number;  // min: 10.0, max: 70.0, def: 25.0 (%/s)
  magnusCurveStrength: number;  // min: 0.08, max: 0.70, def: 0.32
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
    min: 1.5,
    max: 5.5,
    step: 0.1,
    default: 2.8,
    label: 'Velocidad Jugador',
    unit: 'px/tick',
    description: '>5.5 causa jitter severo en paredes de esquinas.'
  },
  playerAcceleration: {
    min: 0.04,
    max: 0.28,
    step: 0.01,
    default: 0.11,
    label: 'Aceleración Jugador',
    description: '<0.04 genera respuesta lenta; >0.28 salto abrupto.'
  },
  kickStrength: {
    min: 2.0,
    max: 9.0,
    step: 0.05,
    default: 4.545,
    label: 'Fuerza de Patada',
    description: '>9.0 exige substepping >= 12 para no atravesar la red.'
  },
  playerRadius: {
    min: 10.0,
    max: 26.0,
    step: 0.5,
    default: 15.0,
    label: 'Radio del Jugador',
    unit: 'px',
    description: '>26 bloquea la portería; <10 salta postes.'
  },
  ballRadius: {
    min: 3.8,
    max: 12.0,
    step: 0.2,
    default: 5.8,
    label: 'Radio del Balón',
    unit: 'px',
    description: '<3.8 genera tunelización en postes (r=5.4).'
  },
  ballRestitution: {
    min: 0.15,
    max: 0.92,
    step: 0.01,
    default: 0.412,
    label: 'Rebote Balón (bCoef)',
    description: '>0.92 crea oscilaciones perpetuas en rebotes dobles.'
  },
  boostMultiplier: {
    min: 1.2,
    max: 3.0,
    step: 0.05,
    default: 1.75,
    label: 'Potencia del Boost',
    description: 'Factor multiplicador sobre velocidad y aceleración.'
  },
  dashDistance: {
    min: 40.0,
    max: 140.0,
    step: 1.0,
    default: 75.0,
    label: 'Distancia de Dash',
    unit: 'px',
    description: '>140 requiere substepping extremo en el jugador.'
  },
  staminaRechargeRate: {
    min: 10.0,
    max: 70.0,
    step: 1.0,
    default: 25.0,
    label: 'Tasa Recarga Estamina',
    unit: '%/s',
    description: 'Velocidad de recuperación en reposo de teclas.'
  },
  magnusCurveStrength: {
    min: 0.08,
    max: 0.70,
    step: 0.01,
    default: 0.35,
    label: 'Fuerza de Curva Magnus',
    description: 'Curvatura de comba con teclas A / D.'
  }
};

export const DEFAULT_GAMEPLAY_CONFIG: Readonly<GameplayConfig> = Object.freeze({
  playerMaxSpeed: 2.8,
  playerAcceleration: 0.11,
  kickStrength: 4.545,
  playerRadius: 15.0,
  ballRadius: 5.8,
  ballRestitution: 0.412,
  boostMultiplier: 1.75,
  dashDistance: 75.0,
  staminaRechargeRate: 25.0,
  magnusCurveStrength: 0.35
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
      result[key] = Math.max(limits.min, Math.min(limits.max, val));
    }
  }

  return result;
}
