/**
 * Web Worker for Optimization
 *
 * Runs the evolutionary algorithm in a separate thread to prevent
 * blocking the UI during computation.
 *
 * Uses WASM for fast physics computations when available.
 */

import {
  WorkerMessage,
  WorkerResponse,
  OptimizationParams,
  ProgressUpdate
} from '../types';
import { runEvolutionaryAlgorithm, EAConfig } from '../optimization/evolutionaryAlgorithm';
import { initWasm, isWasmReady, getCurrentThreadCount } from '../physics/frequencies';

// Track if we should stop
let shouldStop = false;

// WASM initialization state - now deferred until START message to get maxCores
let wasmInitialized = false;
let wasmInitError: Error | null = null;
let wasmInitPromise: Promise<void> | null = null;

/**
 * Initialize WASM with specified maxCores
 */
async function initializeWasm(maxCores: number): Promise<void> {
  if (wasmInitPromise) {
    await wasmInitPromise;
    return;
  }

  wasmInitPromise = initWasm(maxCores)
    .then(() => {
      wasmInitialized = true;
      const threads = getCurrentThreadCount();
      console.log(`Worker: WASM initialized successfully with ${threads} threads, isWasmReady():`, isWasmReady());
    })
    .catch((err) => {
      wasmInitError = err;
      console.warn('Worker: WASM initialization failed, using JS fallback:', err);
    });

  await wasmInitPromise;
}

/**
 * Handle messages from main thread
 */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'START':
      shouldStop = false;
      // Initialize WASM with maxCores from params
      const maxCores = message.params.eaParams.maxCores ?? 0;
      console.log(`Worker: START received, initializing WASM with maxCores=${maxCores}...`);
      await initializeWasm(maxCores);
      console.log('Worker: WASM init complete. wasmInitialized:', wasmInitialized, 'isWasmReady():', isWasmReady());
      if (wasmInitError) {
        console.log('Worker: WASM had error, falling back to JS');
      }
      startOptimization(message.params);
      break;

    case 'STOP':
      shouldStop = true;
      postMessage({ type: 'STOPPED' } as WorkerResponse);
      break;

    case 'PAUSE':
      // Pause is handled by temporarily setting shouldStop
      shouldStop = true;
      break;

    case 'RESUME':
      shouldStop = false;
      break;
  }
};

/**
 * Run the optimization and send progress updates
 */
async function startOptimization(params: OptimizationParams): Promise<void> {
  try {
    const config: EAConfig = {
      bar: params.bar,
      material: params.material,
      targetFrequencies: params.targetFrequencies,
      numCuts: params.numCuts,
      penaltyType: params.penaltyType,
      penaltyWeight: params.penaltyWeight,
      eaParams: params.eaParams,
      seedGenes: params.seedGenes,
      onProgress: (update: ProgressUpdate) => {
        postMessage({
          type: 'PROGRESS',
          data: update
        } as WorkerResponse);
      },
      shouldStop: () => shouldStop
    };

    const result = await runEvolutionaryAlgorithm(config);

    if (!shouldStop) {
      postMessage({
        type: 'COMPLETE',
        result
      } as WorkerResponse);
    }
  } catch (error) {
    postMessage({
      type: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown error'
    } as WorkerResponse);
  }
}

// Export empty object to make TypeScript happy
export {};
