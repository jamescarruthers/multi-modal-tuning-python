/**
 * Frequency Calculation Module
 *
 * High-level interface for computing natural frequencies of a bar
 * given its geometry (cuts), dimensions, and material.
 *
 * Supports both WASM (fast) and JavaScript (fallback) implementations.
 */

import { Material, BarParameters, Cut } from '../types';
import { assembleFromCuts } from './femAssembly';
import { solveEigenvalueProblem, EigenResult } from './eigenSolver';
import { genesToCuts } from './barProfile';
import {
  isWasmReady,
  computeFrequenciesFromGenesWasm,
  batchComputeFitnessWasm
} from './wasmBridge';

// Re-export WASM initialization for worker use
export { initWasm, isWasmReady, getMaxCores, getCurrentThreadCount } from './wasmBridge';

/**
 * Compute natural frequencies for a bar with given cuts
 *
 * @param cuts - Array of rectangular cuts
 * @param bar - Bar parameters (L, b, h0, hMin)
 * @param material - Material properties (E, rho, nu)
 * @param numModes - Number of modes to compute (default: 10)
 * @param numElements - Number of FEM elements (default: 150)
 * @returns Natural frequencies in Hz
 */
export function computeBarFrequencies(
  cuts: Cut[],
  bar: BarParameters,
  material: Material,
  numModes: number = 10,
  numElements: number = 150
): number[] {
  // Assemble global matrices
  const globalMatrices = assembleFromCuts(cuts, bar, material, numElements);

  // Solve eigenvalue problem
  const result = solveEigenvalueProblem(globalMatrices, numModes, false);

  return result.frequencies;
}

/**
 * Extract length adjustment from genes if present
 * Gene format: [lambda_1, h_1, lambda_2, h_2, ..., lengthAdjust?]
 * lengthAdjust: positive = trim (shorten), negative = extend (lengthen)
 */
function extractLengthAdjust(genes: number[], numCuts: number): number {
  const expectedCutGenes = numCuts * 2;
  if (genes.length > expectedCutGenes) {
    return genes[expectedCutGenes];
  }
  return 0;
}

/**
 * Compute frequencies from genes (optimization variable format)
 * Automatically uses WASM if available, otherwise falls back to JavaScript.
 *
 * @param genes - Flat array [lambda_1, h_1, lambda_2, h_2, ..., lengthAdjust?]
 * @param bar - Bar parameters
 * @param material - Material properties
 * @param numModes - Number of modes to compute
 * @param numElements - Number of FEM elements
 * @param numCuts - Number of cuts (needed to extract lengthAdjust)
 * @returns Natural frequencies in Hz
 */
export function computeFrequenciesFromGenes(
  genes: number[],
  bar: BarParameters,
  material: Material,
  numModes: number = 10,
  numElements: number = 150,
  numCuts?: number
): number[] {
  // Determine number of cuts from genes if not provided
  const nCuts = numCuts ?? Math.floor(genes.length / 2);

  // Extract length adjustment if present (positive = trim, negative = extend)
  const lengthAdjust = extractLengthAdjust(genes, nCuts);

  // Create effective bar with adjusted length
  // lengthAdjust > 0 means trim (shorten), < 0 means extend (lengthen)
  const effectiveBar = lengthAdjust !== 0 ? {
    ...bar,
    L: bar.L - 2 * lengthAdjust  // Adjust from both ends
  } : bar;

  // Extract only the cut genes (exclude length trim)
  const cutGenes = genes.slice(0, nCuts * 2);

  // Use WASM if available (10-50x faster)
  if (isWasmReady()) {
    return computeFrequenciesFromGenesWasm(
      cutGenes,
      effectiveBar.L,
      effectiveBar.b,
      effectiveBar.h0,
      numElements,
      material.E,
      material.rho,
      material.nu,
      numModes
    );
  }

  // Fallback to JavaScript implementation
  const cuts = genesToCuts(cutGenes);
  return computeBarFrequencies(cuts, effectiveBar, material, numModes, numElements);
}

/**
 * Batch compute fitness for entire population
 * Uses WASM if available for significant performance gains.
 * Supports length adjustment gene: when maxLengthTrim > 0 or maxLengthExtend > 0,
 * each individual may have a lengthAdjust gene as the last gene.
 *
 * @param genesArray - Array of gene arrays (one per individual)
 * @param bar - Bar parameters
 * @param material - Material properties
 * @param targetFrequencies - Target frequencies
 * @param numElements - Number of FEM elements
 * @param f1Priority - Priority weight for fundamental frequency
 * @param numCuts - Number of cuts (needed to identify length adjustment gene)
 * @returns Array of fitness values
 */
// Track WASM usage for diagnostics
let wasmCallCount = 0;
let jsCallCount = 0;
let lastLogTime = 0;

export function batchComputeFitness(
  genesArray: number[][],
  bar: BarParameters,
  material: Material,
  targetFrequencies: number[],
  numElements: number = 150,
  f1Priority: number = 1,
  numCuts?: number
): number[] {
  if (genesArray.length === 0) return [];

  // Determine if length trim is enabled by checking gene array length
  const nCuts = numCuts ?? Math.floor(genesArray[0].length / 2);
  const hasLengthTrim = genesArray[0].length > nCuts * 2;

  // If we have length trim, we can't use the WASM batch directly
  // because each individual may have a different effective bar length
  // Fall back to individual computation
  if (hasLengthTrim || !isWasmReady()) {
    jsCallCount++;
    // Log periodically
    const now = Date.now();
    if (now - lastLogTime > 2000) {
      const reason = hasLengthTrim ? 'length trim enabled' : `WASM ready: ${isWasmReady()}`;
      console.log(`Batch fitness: using per-individual computation (${reason}, calls: JS=${jsCallCount}, WASM=${wasmCallCount})`);
      lastLogTime = now;
    }
    // Compute one by one with weighted error
    return genesArray.map(genes => {
      const frequencies = computeFrequenciesFromGenes(genes, bar, material, targetFrequencies.length, numElements, nCuts);
      let weightedSumSq = 0;
      let totalWeight = 0;
      for (let i = 0; i < targetFrequencies.length; i++) {
        const weight = i === 0 ? f1Priority : 1;
        const relErr = (frequencies[i] - targetFrequencies[i]) / targetFrequencies[i];
        weightedSumSq += weight * relErr * relErr;
        totalWeight += weight;
      }
      return totalWeight > 0 ? 100 * weightedSumSq / totalWeight : Infinity;
    });
  }

  wasmCallCount++;

  // Flatten all genes into a single array for WASM
  const genesPerIndividual = genesArray[0].length;
  const allGenes = genesArray.flat();

  // Log f1Priority once at start to verify it's being passed
  if (wasmCallCount === 1) {
    console.log(`WASM batch: f1Priority = ${f1Priority}`);
  }

  const startTime = performance.now();
  const result = batchComputeFitnessWasm(
    allGenes,
    genesArray.length,
    genesPerIndividual,
    targetFrequencies,
    bar.L,
    bar.b,
    bar.h0,
    numElements,
    material.E,
    material.rho,
    material.nu,
    f1Priority
  );
  const elapsed = performance.now() - startTime;

  // Log periodically with timing
  const now = Date.now();
  if (now - lastLogTime > 2000) {
    const msPerInd = elapsed / genesArray.length;
    console.log(`WASM batch: ${genesArray.length} individuals in ${elapsed.toFixed(1)}ms (${msPerInd.toFixed(2)}ms/ind)`);
    lastLogTime = now;
  }

  return result;
}

/**
 * Compute full eigenvalue result including mode shapes
 *
 * @param cuts - Array of rectangular cuts
 * @param bar - Bar parameters
 * @param material - Material properties
 * @param numModes - Number of modes to compute
 * @param numElements - Number of FEM elements
 * @returns Full eigenvalue result with frequencies and mode shapes
 */
export function computeFullEigenResult(
  cuts: Cut[],
  bar: BarParameters,
  material: Material,
  numModes: number = 10,
  numElements: number = 150
): EigenResult {
  const globalMatrices = assembleFromCuts(cuts, bar, material, numElements);
  return solveEigenvalueProblem(globalMatrices, numModes, true);
}

/**
 * Calculate frequency ratios relative to fundamental
 *
 * @param frequencies - Array of frequencies in Hz
 * @returns Array of ratios [1, f2/f1, f3/f1, ...]
 */
export function calculateFrequencyRatios(frequencies: number[]): number[] {
  if (frequencies.length === 0) return [];

  const f1 = frequencies[0];
  if (f1 === 0) return frequencies.map(() => 0);

  return frequencies.map(f => f / f1);
}

/**
 * Calculate error between computed and target frequencies
 *
 * @param computed - Computed frequencies
 * @param target - Target frequencies
 * @returns Object with various error metrics
 */
export function calculateFrequencyError(
  computed: number[],
  target: number[]
): {
  relativeErrors: number[];        // Relative error for each mode
  absoluteErrors: number[];        // Absolute error in Hz
  centsErrors: number[];           // Error in cents
  averageSquaredError: number;     // Average squared relative error (%)
  maxCentsError: number;           // Maximum error in cents
} {
  const numModes = Math.min(computed.length, target.length);

  const relativeErrors: number[] = [];
  const absoluteErrors: number[] = [];
  const centsErrors: number[] = [];
  let sumSquaredError = 0;

  for (let i = 0; i < numModes; i++) {
    const comp = computed[i];
    const tgt = target[i];

    // Relative error
    const relErr = (comp - tgt) / tgt;
    relativeErrors.push(relErr);

    // Absolute error
    absoluteErrors.push(comp - tgt);

    // Error in cents: 1200 * log2(comp/tgt)
    const cents = tgt > 0 && comp > 0 ? 1200 * Math.log2(comp / tgt) : 0;
    centsErrors.push(cents);

    // Squared relative error
    sumSquaredError += relErr * relErr;
  }

  // Average squared error as percentage (Eq. 7 from paper)
  const averageSquaredError = 100 * (sumSquaredError / numModes);

  // Maximum absolute cents error
  const maxCentsError = Math.max(...centsErrors.map(Math.abs));

  return {
    relativeErrors,
    absoluteErrors,
    centsErrors,
    averageSquaredError,
    maxCentsError
  };
}

/**
 * Check if tuning is acceptable (all modes within tolerance)
 *
 * @param centsErrors - Error for each mode in cents
 * @param toleranceCents - Acceptable tolerance (default: 5 cents)
 * @returns True if all modes are within tolerance
 */
export function isTuningAcceptable(
  centsErrors: number[],
  toleranceCents: number = 5
): boolean {
  return centsErrors.every(err => Math.abs(err) <= toleranceCents);
}

/**
 * Format frequency for display
 *
 * @param freq - Frequency in Hz
 * @param decimals - Number of decimal places
 * @returns Formatted string
 */
export function formatFrequency(freq: number, decimals: number = 1): string {
  if (freq >= 1000) {
    return `${(freq / 1000).toFixed(decimals)} kHz`;
  }
  return `${freq.toFixed(decimals)} Hz`;
}

/**
 * Format cents error for display
 *
 * @param cents - Error in cents
 * @returns Formatted string with sign
 */
export function formatCents(cents: number): string {
  const sign = cents >= 0 ? '+' : '';
  return `${sign}${cents.toFixed(1)} cents`;
}
