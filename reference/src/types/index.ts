// Material properties
export interface Material {
  name: string;
  E: number;        // Young's modulus (Pa)
  rho: number;      // Density (kg/m^3)
  nu: number;       // Poisson's ratio
  category: 'metal' | 'wood';
}

// Bar geometry
export interface BarParameters {
  L: number;        // Length (m)
  b: number;        // Width (m)
  h0: number;       // Original thickness (m)
  hMin: number;     // Minimum thickness (m) - typically 10% of h0
}

// Single rectangular cut
export interface Cut {
  lambda: number;   // Length from center (m)
  h: number;        // Height at cut (m)
}

// Tuning preset
export interface TuningPreset {
  name: string;
  ratios: number[];
  description: string;
  instrument: string;
}

// Optimization parameters
export interface EAParameters {
  populationSize: number;     // Npop
  elitismPercent: number;     // Pe (0-100)
  crossoverPercent: number;   // Pc (0-100)
  mutationPercent: number;    // Pm (0-100, Pe + Pc + Pm = 100)
  mutationStrength: number;   // sigma for uniform mutation (0.05-0.2)
  maxGenerations: number;
  targetError: number;        // Stopping criterion (percentage)
  numElements: number;        // Ne for FEM discretization
  f1Priority: number;         // Weight multiplier for f1 (1 = equal, 2-3 = prioritize f1)
  minCutWidth: number;        // Minimum width between cut boundaries (m)
  maxCutWidth: number;        // Maximum cut width (2*lambda) (m), 0 = no limit
  minCutDepth: number;        // Minimum cut depth (h0 - h) (m), 0 = no limit
  maxCutDepth: number;        // Maximum cut depth (h0 - h) (m), 0 = no limit (uses hMin)
  maxLengthTrim: number;      // Max trim from each end (m), 0 = no trimming allowed
  maxLengthExtend: number;    // Max extension from each end (m), 0 = no extension allowed
  maxCores: number;           // Max CPU cores for WASM threading (0 = auto/max available)
}

// Individual in EA population
export interface Individual {
  genes: number[];            // [lambda_1, h_1, lambda_2, h_2, ..., lengthAdjust?]
                              // lengthAdjust: negative = extend, positive = trim
  fitness: number;
  sigmas?: number[];          // For self-adaptive Gaussian mutation
}

// Optimization result
export interface OptimizationResult {
  bestIndividual: Individual;
  cuts: Cut[];
  computedFrequencies: number[];
  targetFrequencies: number[];
  tuningError: number;        // epsilon (%)
  maxErrorCents: number;
  errorsInCents: number[];
  volumePercent: number;
  roughnessPercent: number;
  generations: number;
  lengthTrim: number;         // How much trimmed from each end (m)
  effectiveLength: number;    // L - 2*lengthTrim (m)
}

// Progress update from worker
export interface ProgressUpdate {
  generation: number;
  bestFitness: number;
  bestIndividual: Individual;
  averageFitness: number;
  computedFrequencies?: number[];
  errorsInCents?: number[];
  lengthTrim?: number;        // How much trimmed from each end (m)
}

// Worker message types
export type WorkerMessage =
  | { type: 'START'; params: OptimizationParams }
  | { type: 'STOP' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' };

export type WorkerResponse =
  | { type: 'PROGRESS'; data: ProgressUpdate }
  | { type: 'COMPLETE'; result: OptimizationResult }
  | { type: 'ERROR'; message: string }
  | { type: 'STOPPED' };

// Combined optimization parameters
export interface OptimizationParams {
  bar: BarParameters;
  material: Material;
  targetFrequencies: number[];
  numCuts: number;
  penaltyType: 'volume' | 'roughness' | 'none';
  penaltyWeight: number;      // alpha (0-1)
  eaParams: EAParameters;
  seedGenes?: number[];       // Optional seed genes to initialize population
}

// App state for UI
export interface AppState {
  // Bar parameters
  barLength: number;          // mm (UI units)
  barWidth: number;           // mm
  barThickness: number;       // mm
  selectedMaterial: string;

  // Tuning parameters
  tuningMode: 'preset' | 'custom';
  selectedPreset: string;
  customRatios: number[];
  fundamentalFrequency: number; // Hz

  // Optimization parameters
  numCuts: number;
  penaltyType: 'volume' | 'roughness' | 'none';
  penaltyWeight: number;
  populationSize: number;
  maxGenerations: number;

  // Status
  isRunning: boolean;
  currentGeneration: number;
  result: OptimizationResult | null;
}

// Timoshenko element matrices result
export interface ElementMatrices {
  Ke: number[][];   // 4x4 element stiffness matrix
  Me: number[][];   // 4x4 element mass matrix
}

// Bounds for optimization variables
export interface VariableBounds {
  lambdaMin: number;
  lambdaMax: number;
  hMin: number;
  hMax: number;
  minCutWidth: number;  // Minimum distance between cut boundaries
  maxCutWidth: number;  // Maximum cut width (2*lambda), 0 = use lambdaMax
  minCutDepth: number;  // Minimum depth (constrains hMax = h0 - minDepth)
  maxCutDepth: number;  // Maximum depth (constrains hMin = h0 - maxDepth)
  maxLengthTrim: number; // Maximum trim from each end, 0 = no trimming
  maxLengthExtend: number; // Maximum extension from each end, 0 = no extension
}

// ============================================
// Bar Range Finder Types
// ============================================

// Re-export from noteUtils for convenience
export type { ScaleType, NoteInfo } from '../utils/noteUtils';

// Result of finding optimal bar length for a single note
export interface BarLengthResult {
  note: {
    name: string;
    frequency: number;
    midiNumber: number;
  };
  targetFrequency: number;      // Hz - same as note.frequency
  optimalLength: number;        // mm
  computedFrequency: number;    // Hz - f1 at optimal length
  errorCents: number;           // Error in cents
  searchIterations: number;     // Number of binary search iterations
  selected: boolean;            // For batch optimization selection
}

// Parameters for bar range finding
export interface BarRangeParams {
  width: number;          // mm
  thickness: number;      // mm
  material: Material;
  startNote: string;      // e.g., "F4"
  endNote: string;        // e.g., "F5"
  scaleType: 'chromatic' | 'natural' | 'custom';
  customNotes?: string[]; // For custom scale type
  minLength: number;      // mm - minimum bar length to search
  maxLength: number;      // mm - maximum bar length to search
  toleranceCents: number; // Acceptable frequency error in cents
}

// Current progress data during optimization
export interface BatchProgressData {
  generation: number;
  bestFitness: number;
  computedFrequencies: number[];
  errorsInCents: number[];
  lengthTrim?: number;
  genes: number[];
}

// Item in batch optimization queue
export interface BatchOptimizationItem {
  barResult: BarLengthResult;
  optimizationResult?: OptimizationResult;
  status: 'pending' | 'running' | 'complete' | 'error' | 'skipped';
  error?: string;
  currentGeneration?: number;
  maxGenerations?: number;
  currentProgress?: BatchProgressData;  // Live feedback during optimization
}

// Batch optimization configuration
export interface BatchOptimizationConfig {
  // Bar parameters (fixed for all bars)
  barWidth: number;          // mm
  barThickness: number;      // mm
  material: Material;

  // Tuning parameters
  tuningPreset: string;      // Preset name like '1:4:10'

  // Optimization parameters
  numCuts: number;
  penaltyType: 'volume' | 'roughness' | 'none';
  penaltyWeight: number;
  populationSize: number;
  maxGenerations: number;
  targetError: number;       // % error threshold
  f1Priority: number;
  numElements: number;
  minCutWidth: number;       // mm
  maxCutWidth: number;       // mm
  minCutDepth: number;       // mm
  maxCutDepth: number;       // mm
  maxLengthTrim: number;     // mm
  maxLengthExtend: number;   // mm
  maxCores: number;
}

// Worker messages for bar range finding
export type BarRangeWorkerMessage =
  | { type: 'FIND_LENGTHS'; params: BarRangeParams }
  | { type: 'STOP' };

export type BarRangeWorkerResponse =
  | { type: 'FIND_PROGRESS'; note: string; index: number; total: number }
  | { type: 'FIND_COMPLETE'; results: BarLengthResult[] }
  | { type: 'ERROR'; message: string }
  | { type: 'STOPPED' };
