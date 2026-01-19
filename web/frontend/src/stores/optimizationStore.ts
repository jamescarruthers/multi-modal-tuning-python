import { create } from 'zustand';
import type {
  OptimizationState,
  BarDimensions,
  EAParams,
  SurrogateParams,
  PenaltyConfig,
  LengthAdjustConfig,
  MeshData,
  ProgressUpdate,
  OptimizationResult,
  ModeShapesData,
} from '../types';

interface OptimizationActions {
  // Config setters
  setMaterial: (material: string) => void;
  setBarDimensions: (dims: Partial<BarDimensions>) => void;
  setPreset: (preset: string, ratios?: number[], targetModes?: string[] | null) => void;
  setCustomRatios: (ratios: number[] | null) => void;
  setFundamentalHz: (hz: number) => void;
  setNumCuts: (cuts: number) => void;
  setAlgorithm: (algo: 'evolutionary' | 'surrogate') => void;
  setAnalysisMode: (mode: '2d' | '3d') => void;
  setEAParams: (params: Partial<EAParams>) => void;
  setSurrogateParams: (params: Partial<SurrogateParams>) => void;
  setPenaltyConfig: (config: Partial<PenaltyConfig>) => void;
  setLengthAdjustConfig: (config: Partial<LengthAdjustConfig>) => void;
  setNumElementsY: (n: number) => void;
  setNumElementsZ: (n: number) => void;
  setMeshUpdateInterval: (n: number) => void;

  // Progress
  setIsRunning: (running: boolean) => void;
  updateProgress: (update: ProgressUpdate) => void;
  addGeneration: (gen: ProgressUpdate) => void;

  // Playback
  setPlaybackIndex: (index: number) => void;
  setIsPlaying: (playing: boolean) => void;
  playNext: () => void;
  playPrev: () => void;

  // Result
  setResult: (result: OptimizationResult, mesh: MeshData, modeShapes?: ModeShapesData | null) => void;
  setGenerations: (gens: ProgressUpdate[]) => void;

  // Mode shape visualization
  setModeShapes: (data: ModeShapesData | null) => void;
  setSelectedModeIndex: (index: number) => void;
  setShowModeAnimation: (show: boolean) => void;
  setShowStrainEnergy: (show: boolean) => void;
  setDeformationScale: (scale: number) => void;
  setIsLoadingModeShapes: (loading: boolean) => void;

  // Reset
  reset: () => void;
}

const defaultEAParams: EAParams = {
  population_size: 100,
  max_generations: 200,
  target_error: 0.1,
  num_elements: 80,
  elitism_percent: 10,
  crossover_percent: 30,
  mutation_percent: 60,
  mutation_strength: 0.12,
  f1_priority: 1.5,
  // target_modes: undefined means use preset's target_modes (or default to V1, V2, V3... in backend)
};

const defaultSurrogateParams: SurrogateParams = {
  max_iterations: 100,
  initial_samples: 50,
  target_error: 0.1,
  num_elements: 80,
  f1_priority: 1.5,
  // target_modes: undefined means use preset's target_modes (or default to V1, V2, V3... in backend)
};

const defaultPenaltyConfig: PenaltyConfig = {
  penalty_type: 'none',
  penalty_weight: 0.0,
};

const defaultLengthAdjustConfig: LengthAdjustConfig = {
  max_trim: 0.0,
  max_extend: 0.0,
};

const initialState: OptimizationState = {
  // Config
  material: 'rosewood',
  barDimensions: { L: 0.175, b: 0.032, h0: 0.019 },
  preset: '1:4:10',
  presetRatios: [1, 4, 10], // Default ratios for 1:4:10 preset
  presetTargetModes: null, // No explicit target modes for bending-only preset
  customRatios: null,
  fundamentalHz: 440,
  numCuts: 2,
  algorithm: 'evolutionary',
  analysisMode: '2d',
  eaParams: defaultEAParams,
  surrogateParams: defaultSurrogateParams,
  penaltyConfig: defaultPenaltyConfig,
  lengthAdjustConfig: defaultLengthAdjustConfig,
  numElementsY: 3,
  numElementsZ: 3,
  meshUpdateInterval: 1, // Update mesh every generation by default

  // Progress
  isRunning: false,
  currentGeneration: 0,
  bestFitness: Infinity,
  computedFrequencies: [],
  errorsCents: [],
  currentMesh: null,

  // History
  generations: [],
  playbackIndex: -1,
  isPlaying: false,

  // Result
  result: null,
  finalMesh: null,

  // Mode shape visualization
  modeShapes: null,
  selectedModeIndex: 0,
  showModeAnimation: false,
  showStrainEnergy: false,
  deformationScale: 10.0,
  isLoadingModeShapes: false,
};

export const useOptimizationStore = create<OptimizationState & OptimizationActions>(
  (set, get) => ({
    ...initialState,

    // Config setters
    setMaterial: (material) => set({ material }),

    setBarDimensions: (dims) =>
      set((state) => ({
        barDimensions: { ...state.barDimensions, ...dims },
      })),

    setPreset: (preset, ratios, targetModes) =>
      set({
        preset,
        ...(ratios !== undefined && { presetRatios: ratios }),
        ...(targetModes !== undefined && { presetTargetModes: targetModes }),
      }),
    setCustomRatios: (ratios) => set({ customRatios: ratios }),
    setFundamentalHz: (hz) => set({ fundamentalHz: hz }),
    setNumCuts: (cuts) => set({ numCuts: cuts }),
    setAlgorithm: (algo) => set({ algorithm: algo }),
    setAnalysisMode: (mode) => set({ analysisMode: mode }),

    setEAParams: (params) =>
      set((state) => ({
        eaParams: { ...state.eaParams, ...params },
      })),

    setSurrogateParams: (params) =>
      set((state) => ({
        surrogateParams: { ...state.surrogateParams, ...params },
      })),

    setPenaltyConfig: (config) =>
      set((state) => ({
        penaltyConfig: { ...state.penaltyConfig, ...config },
      })),

    setLengthAdjustConfig: (config) =>
      set((state) => ({
        lengthAdjustConfig: { ...state.lengthAdjustConfig, ...config },
      })),

    setNumElementsY: (n) => set({ numElementsY: n }),
    setNumElementsZ: (n) => set({ numElementsZ: n }),
    setMeshUpdateInterval: (n) => set({ meshUpdateInterval: n }),

    // Progress
    setIsRunning: (running) => set({ isRunning: running }),

    updateProgress: (update) =>
      set({
        currentGeneration: update.generation,
        bestFitness: update.best_fitness,
        computedFrequencies: update.computed_frequencies,
        errorsCents: update.errors_cents,
        currentMesh: update.mesh || null,
      }),

    addGeneration: (gen) =>
      set((state) => ({
        generations: [...state.generations, gen],
      })),

    // Playback
    setPlaybackIndex: (index) => {
      const { generations } = get();
      if (index >= 0 && index < generations.length) {
        const gen = generations[index];
        set({
          playbackIndex: index,
          currentGeneration: gen.generation,
          bestFitness: gen.best_fitness,
          computedFrequencies: gen.computed_frequencies,
          errorsCents: gen.errors_cents,
          currentMesh: gen.mesh || null,
        });
      }
    },

    setIsPlaying: (playing) => set({ isPlaying: playing }),

    playNext: () => {
      const { playbackIndex, generations } = get();
      if (playbackIndex < generations.length - 1) {
        get().setPlaybackIndex(playbackIndex + 1);
      } else {
        set({ isPlaying: false });
      }
    },

    playPrev: () => {
      const { playbackIndex } = get();
      if (playbackIndex > 0) {
        get().setPlaybackIndex(playbackIndex - 1);
      }
    },

    // Result
    setResult: (result, mesh, modeShapes) =>
      set({
        result,
        finalMesh: mesh,
        isRunning: false,
        // Auto-populate mode shapes if provided (for 3D analysis)
        modeShapes: modeShapes || null,
        // Reset mode shape UI state when new result comes in
        selectedModeIndex: 0,
        showModeAnimation: false,
        showStrainEnergy: false,
      }),

    setGenerations: (gens) =>
      set({
        generations: gens,
        playbackIndex: gens.length - 1,
      }),

    // Mode shape visualization
    setModeShapes: (data) => set({ modeShapes: data }),
    setSelectedModeIndex: (index) => set({ selectedModeIndex: index }),
    setShowModeAnimation: (show) => set({ showModeAnimation: show }),
    setShowStrainEnergy: (show) => set({ showStrainEnergy: show }),
    setDeformationScale: (scale) => set({ deformationScale: scale }),
    setIsLoadingModeShapes: (loading) => set({ isLoadingModeShapes: loading }),

    // Reset
    reset: () =>
      set({
        isRunning: false,
        currentGeneration: 0,
        bestFitness: Infinity,
        computedFrequencies: [],
        errorsCents: [],
        currentMesh: null,
        generations: [],
        playbackIndex: -1,
        isPlaying: false,
        result: null,
        finalMesh: null,
        modeShapes: null,
        selectedModeIndex: 0,
        showModeAnimation: false,
        showStrainEnergy: false,
      }),
  })
);
