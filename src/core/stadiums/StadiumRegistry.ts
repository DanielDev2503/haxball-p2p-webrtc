import { Stadium, StadiumOptions } from '../entities/Stadium';

export type StadiumId = 'small' | 'classic' | 'big';

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
}

export const STADIUM_PRESETS: Record<StadiumId, StadiumPreset> = {
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

export function createStadium(id: StadiumId | string = 'classic', customOptions?: Partial<StadiumOptions>): Stadium {
  const presetKey = (id in STADIUM_PRESETS) ? (id as StadiumId) : 'classic';
  const preset = STADIUM_PRESETS[presetKey];

  return new Stadium({
    id: preset.id,
    name: preset.name,
    width: preset.width,
    height: preset.height,
    goalSize: preset.goalSize,
    goalDepth: preset.goalDepth,
    runOff: preset.runOff,
    ...customOptions
  });
}
