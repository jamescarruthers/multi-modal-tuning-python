/**
 * WASM Bridge for Physics Computations
 *
 * Provides TypeScript interface to the Rust WASM module for
 * fast FEM and eigenvalue computations.
 *
 * Supports multithreading via Rayon when COOP/COEP headers are present.
 */

import init, {
  compute_frequencies,
  compute_frequencies_from_genes,
  batch_compute_fitness,
  initThreadPool
} from '../../wasm-physics/pkg/wasm_physics';

let wasmReady = false;
let wasmInitPromise: Promise<void> | null = null;
let threadingEnabled = false;
let currentThreadCount = 0;

/**
 * Check if SharedArrayBuffer is available (requires COOP/COEP headers)
 */
function isSharedArrayBufferAvailable(): boolean {
  try {
    return typeof SharedArrayBuffer !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Get the maximum number of available CPU cores
 */
export function getMaxCores(): number {
  return navigator.hardwareConcurrency || 4;
}

/**
 * Get the current thread count being used
 */
export function getCurrentThreadCount(): number {
  return currentThreadCount;
}

/**
 * Initialize the WASM module
 * Must be called before using any WASM functions
 * Will attempt to initialize thread pool if SharedArrayBuffer is available
 *
 * @param maxCores - Maximum number of CPU cores to use (0 = auto/max available)
 */
export async function initWasm(maxCores: number = 0): Promise<void> {
  if (wasmReady) return;

  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      await init();

      // Try to initialize thread pool if SharedArrayBuffer is available
      if (isSharedArrayBufferAvailable()) {
        try {
          // Calculate thread count based on maxCores setting
          const availableCores = navigator.hardwareConcurrency || 4;
          const numThreads = maxCores > 0
            ? Math.min(maxCores, availableCores)
            : availableCores;
          console.log(`Attempting to initialize thread pool with ${numThreads} threads (maxCores=${maxCores}, available=${availableCores})...`);
          await initThreadPool(numThreads);
          threadingEnabled = true;
          currentThreadCount = numThreads;
          console.log(`WASM physics module initialized with ${numThreads} threads`);
        } catch (e) {
          console.error('Failed to initialize thread pool:', e);
          if (e instanceof Error) {
            console.error('Error name:', e.name);
            console.error('Error message:', e.message);
            console.error('Error stack:', e.stack);
          }
          threadingEnabled = false;
          currentThreadCount = 1;
          console.log('WASM physics module initialized (single-threaded fallback)');
        }
      } else {
        currentThreadCount = 1;
        console.log('WASM physics module initialized (single-threaded, SharedArrayBuffer not available)');
      }

      wasmReady = true;
    })();
  }

  await wasmInitPromise;
}

/**
 * Check if threading is enabled
 */
export function isThreadingEnabled(): boolean {
  return threadingEnabled;
}

/**
 * Check if WASM is ready to use
 */
export function isWasmReady(): boolean {
  return wasmReady;
}

/**
 * Compute natural frequencies using WASM
 *
 * @param elementHeights - Array of element heights (m)
 * @param le - Element length (m)
 * @param b - Bar width (m)
 * @param E - Young's modulus (Pa)
 * @param rho - Density (kg/m³)
 * @param nu - Poisson's ratio
 * @param numModes - Number of modes to extract
 * @returns Array of natural frequencies (Hz)
 */
export function computeFrequenciesWasm(
  elementHeights: number[],
  le: number,
  b: number,
  E: number,
  rho: number,
  nu: number,
  numModes: number
): number[] {
  if (!wasmReady) {
    throw new Error('WASM not initialized. Call initWasm() first.');
  }

  return Array.from(compute_frequencies(
    new Float64Array(elementHeights),
    le,
    b,
    E,
    rho,
    nu,
    numModes
  ));
}

/**
 * Compute frequencies directly from genes using WASM
 *
 * @param genes - Flat array [lambda_1, h_1, lambda_2, h_2, ...]
 * @param barLength - Bar length (m)
 * @param barWidth - Bar width (m)
 * @param h0 - Original bar height (m)
 * @param numElements - Number of finite elements
 * @param E - Young's modulus (Pa)
 * @param rho - Density (kg/m³)
 * @param nu - Poisson's ratio
 * @param numModes - Number of modes to extract
 * @returns Array of natural frequencies (Hz)
 */
export function computeFrequenciesFromGenesWasm(
  genes: number[],
  barLength: number,
  barWidth: number,
  h0: number,
  numElements: number,
  E: number,
  rho: number,
  nu: number,
  numModes: number
): number[] {
  if (!wasmReady) {
    throw new Error('WASM not initialized. Call initWasm() first.');
  }

  return Array.from(compute_frequencies_from_genes(
    new Float64Array(genes),
    barLength,
    barWidth,
    h0,
    numElements,
    E,
    rho,
    nu,
    numModes
  ));
}

/**
 * Batch compute fitness for entire population using WASM
 * This is the most efficient way to evaluate a population as it
 * minimizes JavaScript-WASM boundary crossings.
 *
 * @param allGenes - Flat array of all genes concatenated
 * @param populationSize - Number of individuals
 * @param genesPerIndividual - Genes per individual (2 * numCuts)
 * @param targetFrequencies - Target frequencies (Hz)
 * @param barLength - Bar length (m)
 * @param barWidth - Bar width (m)
 * @param h0 - Original bar height (m)
 * @param numElements - Number of finite elements
 * @param E - Young's modulus (Pa)
 * @param rho - Density (kg/m³)
 * @param nu - Poisson's ratio
 * @param f1Priority - Weight multiplier for f1 (1 = equal, >1 prioritizes f1)
 * @returns Array of fitness values
 */
export function batchComputeFitnessWasm(
  allGenes: number[],
  populationSize: number,
  genesPerIndividual: number,
  targetFrequencies: number[],
  barLength: number,
  barWidth: number,
  h0: number,
  numElements: number,
  E: number,
  rho: number,
  nu: number,
  f1Priority: number = 1
): number[] {
  if (!wasmReady) {
    throw new Error('WASM not initialized. Call initWasm() first.');
  }

  return Array.from(batch_compute_fitness(
    new Float64Array(allGenes),
    populationSize,
    genesPerIndividual,
    new Float64Array(targetFrequencies),
    barLength,
    barWidth,
    h0,
    numElements,
    E,
    rho,
    nu,
    f1Priority
  ));
}
