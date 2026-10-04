import { Stadium, StadiumOptions, StadiumBallPhysics, StadiumPlayerPhysics } from '../entities/Stadium';
import { defaultStadium } from '../game/GameConfig';

export type StadiumId = 'AF 3v3 Official' | 'af3v3' | 'small' | 'classic' | 'big';

export interface StadiumPreset {
  id: StadiumId;
  name: string;
  description: string;
  width: number;
  height: number;
  goalSize: number;
  goalWidth: number;
  goalDepth: number;
  runOff: number;
  spawnDistance?: number;
  kickOffRadius?: number;
  bgColor?: string;
  postRadius?: number;
  postColor?: string;
  ballPhysics?: StadiumBallPhysics;
  playerPhysics?: StadiumPlayerPhysics;
  leftGoalPos?: { p0: { x: number; y: number }; p1: { x: number; y: number } };
  rightGoalPos?: { p0: { x: number; y: number }; p1: { x: number; y: number } };
}

const AF_3V3_PRESET: StadiumPreset = {
  id: 'AF 3v3 Official',
  name: 'AF 3v3 Official by Vitão ®',
  description: '710x300 - Arcos 170 (Oficial Vitão)',
  width: 1200,
  height: 540,
  goalSize: 170,
  goalWidth: 170,
  goalDepth: 35,
  runOff: 110, // Expande los límites exteriores invisibles a 710 x 300 (hw 600 + 110 = 710)
  spawnDistance: 366.5,
  kickOffRadius: 80,
  bgColor: '#1D2431',
  postRadius: 5.4,
  postColor: '#3B424F',
  ballPhysics: {
    radius: 5.8,
    bCoef: 0.412,
    invMass: 1.5,
    color: '#FFA500'
  },
  playerPhysics: {
    acceleration: 0.11,
    kickingAcceleration: 0.083,
    kickStrength: 4.545,
    bCoef: 0
  },
  leftGoalPos: {
    p0: { x: -608.3, y: -85 },
    p1: { x: -608.3, y: 85 }
  },
  rightGoalPos: {
    p0: { x: 608.3, y: 85 },
    p1: { x: 608.3, y: -85 }
  }
};

export const STADIUM_PRESETS: Record<string, StadiumPreset> = {
  'AF 3v3 Official': AF_3V3_PRESET,
  af3v3: { ...AF_3V3_PRESET, id: 'af3v3' },
  small: {
    id: 'small',
    name: 'Pequeño (1v1 / 2v2)',
    description: '1000x460 - Arcos 140',
    width: 1000,
    height: 460,
    goalSize: 140,
    goalWidth: 140,
    goalDepth: 35,
    runOff: 45
  },
  classic: {
    id: 'classic',
    name: 'Mediano (3v3 Clásico)',
    description: '1200x540 - Arcos 170',
    width: 1200,
    height: 540,
    goalSize: 170,
    goalWidth: 170,
    goalDepth: 35,
    runOff: 45
  },
  big: {
    id: 'big',
    name: 'Grande (4v4 / Competitivo)',
    description: '1600x720 - Arcos 200',
    width: 1600,
    height: 720,
    goalSize: 200,
    goalWidth: 200,
    goalDepth: 35,
    runOff: 45
  }
};

export const StadiumRegistry: Record<string, StadiumPreset> = STADIUM_PRESETS;

export function createStadium(id: StadiumId | string = defaultStadium, customOptions?: Partial<StadiumOptions>): Stadium {
  const presetKey = (id in STADIUM_PRESETS)
    ? id
    : (defaultStadium in STADIUM_PRESETS ? defaultStadium : 'classic');
  const preset = STADIUM_PRESETS[presetKey];

  return new Stadium({
    id: preset.id,
    name: preset.name,
    width: preset.width,
    height: preset.height,
    goalSize: preset.goalSize,
    goalDepth: preset.goalDepth,
    runOff: preset.runOff,
    spawnDistance: preset.spawnDistance,
    kickOffRadius: preset.kickOffRadius,
    bgColor: preset.bgColor,
    postRadius: preset.postRadius,
    postColor: preset.postColor,
    ballPhysics: preset.ballPhysics,
    playerPhysics: preset.playerPhysics,
    leftGoalPos: preset.leftGoalPos,
    rightGoalPos: preset.rightGoalPos,
    ...customOptions
  });
}
