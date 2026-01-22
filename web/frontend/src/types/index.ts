// Material types
export interface Material {
  key: string;
  name: string;
  E: number;
  rho: number;
  nu: number;
  category: string;
}

export interface MaterialsResponse {
  materials: {
    metals: Material[];
    woods: Material[];
  };
}

// Preset types
export interface Preset {
  name: string;
  ratios: number[];
  description: string;
  // Target modes for 3D analysis (e.g., ['V1', 'V2', 'V3', 'T1'])
  // V=vertical_bending, T=torsional, L=lateral, A=axial
  target_modes?: string[];
}

export interface PresetsResponse {
  presets: Preset[];
}

// Bar dimensions
export interface BarDimensions {
  L: number;
  b: number;
  h0: number;
  hMin?: number;
}

// Mesh data for Three.js
export interface MeshData {
  vertices: number[];
  indices: number[];
  heights: number[];
  bar_length: number;
  bar_width: number;
  bar_height: number;
}

// EA parameters
export interface EAParams {
  population_size: number;
  max_generations: number;
  target_error: number;
  num_elements: number;
  elitism_percent: number;
  crossover_percent: number;
  mutation_percent: number;
  mutation_strength: number;
  f1_priority: number;
  // Target modes for 3D analysis (e.g., ['V1', 'V2', 'V3'] or ['V1', 'T1', 'V2'])
  // V=vertical_bending, T=torsional, L=lateral, A=axial
  target_modes?: string[];
}

// Surrogate parameters
export interface SurrogateParams {
  max_iterations: number;
  initial_samples: number;
  target_error: number;
  num_elements: number;
  f1_priority: number;
  // Target modes for 3D analysis (e.g., ['V1', 'V2', 'V3'] or ['V1', 'T1', 'V2'])
  // V=vertical_bending, T=torsional, L=lateral, A=axial
  target_modes?: string[];
}

// Penalty configuration
export type PenaltyType = 'none' | 'volume' | 'roughness';

export interface PenaltyConfig {
  penalty_type: PenaltyType;
  penalty_weight: number;
}

// Length adjustment configuration
export interface LengthAdjustConfig {
  max_trim: number;
  max_extend: number;
}

// Optimization config
export interface OptimizationConfig {
  material: string;
  bar: BarDimensions;
  preset?: string;
  custom_ratios?: number[];
  fundamental_hz: number;
  num_cuts: number;
  algorithm: 'evolutionary' | 'surrogate';
  analysis_mode: '2d' | '3d';
  ea_params?: EAParams;
  surrogate_params?: SurrogateParams;
  penalty?: PenaltyConfig;
  length_adjust?: LengthAdjustConfig;
  num_elements_y: number;
  num_elements_z: number;
  mesh_update_interval: number; // Update mesh every N generations (1 = every generation)
}

// FEM progress state for granular feedback during 3D analysis
export interface FEMProgressState {
  stage: 'mesh' | 'assembly' | 'eigenvalue' | 'classification' | 'complete';
  percent: number;
  message: string;
}

// Batch progress state for population evaluation
export interface BatchProgressState {
  completed: number;
  total: number;
  best_fitness_so_far?: number | null;
  message: string;
}

// Progress update from WebSocket
export interface ProgressUpdate {
  type: 'progress';
  generation: number;
  best_fitness: number;
  computed_frequencies: number[];
  errors_cents: number[];
  best_genes: number[];
  mesh?: MeshData;
  // Granular progress for slow operations
  batch_progress?: BatchProgressState;
  fem_progress?: FEMProgressState;
}

// Individual in population
export interface Individual {
  genes: number[];
  fitness: number;
  frequencies?: number[];
}

// Generation data for playback
export interface GenerationData {
  type: 'generation';
  generation: number;
  population: Individual[];
  best_individual: Individual;
}

// Optimization result
export interface OptimizationResult {
  cut_positions: number[];
  cut_depths: number[];
  computed_frequencies: number[];
  target_frequencies: number[];
  errors_cents: number[];
  tuning_error: number;
  generations_run: number;
  best_genes: number[];
  original_bar_length?: number;
  final_bar_length?: number;
  length_adjustment?: number;
}

// Complete message from WebSocket
export interface CompleteMessage {
  type: 'complete';
  result: OptimizationResult;
  final_mesh: MeshData;
  mode_shapes?: ModeShapesData; // Mode shapes data (for 3D analysis)
}

// History message for playback
export interface HistoryMessage {
  type: 'history';
  generations: ProgressUpdate[];
}

// All possible WebSocket messages
export type WebSocketMessage =
  | { type: 'started'; message: string }
  | { type: 'stopped'; message: string }
  | { type: 'error'; message: string }
  | { type: 'info'; message: string }
  | { type: 'pong' }
  | ProgressUpdate
  | CompleteMessage
  | HistoryMessage;

// Mode shape visualization types
export type ModeType = 'vertical_bending' | 'torsional' | 'lateral' | 'axial' | 'unknown';

export interface ModeShape {
  mode_index: number;
  frequency: number;
  mode_type: ModeType; // Classification: vertical_bending, torsional, lateral, axial
  mode_number: number; // Mode number within its type (1, 2, 3...)
  displacements: number[]; // Flat array [dx1,dy1,dz1, dx2,dy2,dz2, ...]
  strain_energy: number[]; // Per-element normalized strain energy (0-1)
  max_displacement: number;
}

export interface ClassifiedModeEntry {
  frequency: number;
  mode_index: number;
  mode_number: number;
}

export interface ClassifiedModes {
  vertical_bending: ClassifiedModeEntry[];
  torsional: ClassifiedModeEntry[];
  lateral: ClassifiedModeEntry[];
  axial: ClassifiedModeEntry[];
}

export interface ModeShapesData {
  frequencies: number[];
  classified_modes?: ClassifiedModes; // Modes organized by type
  mode_shapes: ModeShape[];
  num_nodes: number;
  num_elements: number;
  mesh: MeshData; // Mesh matching the mode shape computation
}

// Store state
export interface OptimizationState {
  // Config
  material: string;
  barDimensions: BarDimensions;
  preset: string;
  presetRatios: number[]; // Full ratios array from selected preset
  presetTargetModes: string[] | null; // Target modes from selected preset (e.g., ['V1', 'V2', 'V3', 'T1'])
  customRatios: number[] | null;
  fundamentalHz: number;
  numCuts: number;
  algorithm: 'evolutionary' | 'surrogate';
  analysisMode: '2d' | '3d';
  eaParams: EAParams;
  surrogateParams: SurrogateParams;
  penaltyConfig: PenaltyConfig;

  // Granular progress for slow operations (3D FEM)
  batchProgress: BatchProgressState | null;
  femProgress: FEMProgressState | null;
  lengthAdjustConfig: LengthAdjustConfig;
  numElementsY: number;
  numElementsZ: number;
  meshUpdateInterval: number; // Update mesh every N generations

  // Progress
  isRunning: boolean;
  currentGeneration: number;
  bestFitness: number;
  computedFrequencies: number[];
  errorsCents: number[];
  currentMesh: MeshData | null;

  // History (for playback)
  generations: ProgressUpdate[];
  playbackIndex: number;
  isPlaying: boolean;

  // Result
  result: OptimizationResult | null;
  finalMesh: MeshData | null;

  // Mode shape visualization
  modeShapes: ModeShapesData | null;
  selectedModeIndex: number;
  showModeAnimation: boolean;
  showStrainEnergy: boolean;
  deformationScale: number;
  isLoadingModeShapes: boolean;
}
