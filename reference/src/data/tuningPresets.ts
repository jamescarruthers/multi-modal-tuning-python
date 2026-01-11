import { TuningPreset } from '../types';

export const TUNING_PRESETS: TuningPreset[] = [
  {
    name: '1:2.76:5.40',
    ratios: [1, 2.756, 5.404],
    description: 'Natural uniform bar frequencies (no tuning needed)',
    instrument: 'Uniform Bar'
  },
  {
    name: '1:4:10',
    ratios: [1, 4, 10],
    description: 'Standard marimba tuning (triple tuning)',
    instrument: 'Marimba'
  },
  {
    name: '1:4:9',
    ratios: [1, 4, 9],
    description: 'Alternative marimba/vibraphone tuning',
    instrument: 'Vibraphone'
  },
  {
    name: '1:3:6',
    ratios: [1, 3, 6],
    description: 'Xylophone tuning',
    instrument: 'Xylophone'
  },
  {
    name: '1:3:6:12',
    ratios: [1, 3, 6, 12],
    description: 'Extended harmonic series (quadruple tuning)',
    instrument: 'Custom'
  },
  {
    name: '1:2:4:8',
    ratios: [1, 2, 4, 8],
    description: 'Octave series (demanding)',
    instrument: 'Custom'
  },
  {
    name: '1:2:4:8:16',
    ratios: [1, 2, 4, 8, 16],
    description: 'Extended octave series (5 modes)',
    instrument: 'Custom'
  },
  {
    name: '1:5:10:15',
    ratios: [1, 5, 10, 15],
    description: 'Unorthodox quintal tuning',
    instrument: 'Custom'
  },
  {
    name: '1:2:5:10',
    ratios: [1, 2, 5, 10],
    description: 'Mixed interval tuning',
    instrument: 'Custom'
  },
  {
    name: '1:3:5:7:9',
    ratios: [1, 3, 5, 7, 9],
    description: 'Odd harmonic series',
    instrument: 'Custom'
  }
];

// Get preset by name
export function getPreset(name: string): TuningPreset | undefined {
  return TUNING_PRESETS.find(p => p.name === name);
}

// Calculate target frequencies from preset and fundamental
export function calculateTargetFrequencies(
  ratios: number[],
  fundamentalHz: number
): number[] {
  return ratios.map(r => r * fundamentalHz);
}

// Convert frequency ratio to cents deviation
// 1 cent = 1/100 of a semitone = 1/1200 of an octave
export function frequencyToCents(computed: number, target: number): number {
  return 1200 * Math.log2(computed / target);
}

// Natural frequencies of a uniform rectangular bar (free-free)
// For reference: f_n = (beta_n)^2 / (2*pi*L^2) * sqrt(E*I / (rho*A))
// where beta_1 = 4.730, beta_2 = 7.853, beta_3 = 10.996, beta_4 = 14.137
export const UNIFORM_BAR_BETAS = [4.730041, 7.853205, 10.995608, 14.137165, 17.278760];

// Frequency ratios for uniform bar (relative to first mode)
// f_n / f_1 = (beta_n / beta_1)^2
export const UNIFORM_BAR_RATIOS = UNIFORM_BAR_BETAS.map(b => (b / UNIFORM_BAR_BETAS[0]) ** 2);
// Results: [1, 2.76, 5.40, 8.93, 13.34] approximately
