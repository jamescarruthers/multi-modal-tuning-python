/**
 * Objective Function for Optimization
 *
 * Implements the tuning error objective function from the paper (Eq. 7)
 * and combined objective functions with penalties (Eq. 11, 13)
 */

import { Cut, BarParameters, Material, Individual } from '../types';
import { computeFrequenciesFromGenes } from '../physics/frequencies';
import { genesToCuts } from '../physics/barProfile';
import { computeVolumePenalty, computeRoughnessPenalty } from './penalties';

/**
 * Compute the weighted squared tuning error (modified Eq. 7 from paper)
 *
 * epsilon = 100 * sum(w_m * ((omega_bar_m - omega_star_m) / omega_star_m)^2) / sum(w_m)
 *
 * With f1Priority > 1, f1 is weighted more heavily than higher modes.
 * This helps ensure the fundamental frequency is well-tuned.
 *
 * @param computedFreq - Computed frequencies from FEM
 * @param targetFreq - Target frequencies
 * @param f1Priority - Weight multiplier for f1 (default 1 = equal weighting)
 * @returns Weighted average squared error as percentage
 */
export function computeTuningError(
  computedFreq: number[],
  targetFreq: number[],
  f1Priority: number = 1
): number {
  const M = Math.min(computedFreq.length, targetFreq.length);
  if (M === 0) return Infinity;

  let weightedSumSquaredError = 0;
  let totalWeight = 0;

  for (let m = 0; m < M; m++) {
    const computed = computedFreq[m];
    const target = targetFreq[m];

    if (target === 0) continue;

    // Weight: f1 gets f1Priority, other modes get 1
    const weight = m === 0 ? f1Priority : 1;

    const relativeError = (computed - target) / target;
    weightedSumSquaredError += weight * relativeError * relativeError;
    totalWeight += weight;
  }

  // Return as percentage
  return totalWeight > 0 ? 100 * (weightedSumSquaredError / totalWeight) : Infinity;
}

/**
 * Compute the maximum squared error (Eq. 8 from paper)
 *
 * epsilon = 100 * max((omega_bar_m - omega_star_m) / omega_star_m)^2
 *
 * @param computedFreq - Computed frequencies
 * @param targetFreq - Target frequencies
 * @returns Maximum squared error as percentage
 */
export function computeMaxTuningError(
  computedFreq: number[],
  targetFreq: number[]
): number {
  const M = Math.min(computedFreq.length, targetFreq.length);
  if (M === 0) return Infinity;

  let maxSquaredError = 0;

  for (let m = 0; m < M; m++) {
    const computed = computedFreq[m];
    const target = targetFreq[m];

    if (target === 0) continue;

    const relativeError = (computed - target) / target;
    const squaredError = relativeError * relativeError;

    if (squaredError > maxSquaredError) {
      maxSquaredError = squaredError;
    }
  }

  return 100 * maxSquaredError;
}

/**
 * Combined objective function with volumetric penalty (Eq. 11)
 *
 * E = (1 - alpha) * epsilon + alpha * V
 *
 * @param tuningError - Tuning error epsilon (%)
 * @param volumePenalty - Volume penalty V (%)
 * @param alpha - Weighting factor (0-1)
 * @returns Combined objective value
 */
export function combinedObjectiveVolume(
  tuningError: number,
  volumePenalty: number,
  alpha: number
): number {
  return (1 - alpha) * tuningError + alpha * volumePenalty;
}

/**
 * Combined objective function with roughness penalty (Eq. 13)
 *
 * E = (1 - alpha) * epsilon + alpha * S
 *
 * @param tuningError - Tuning error epsilon (%)
 * @param roughnessPenalty - Roughness penalty S (%)
 * @param alpha - Weighting factor (0-1)
 * @returns Combined objective value
 */
export function combinedObjectiveRoughness(
  tuningError: number,
  roughnessPenalty: number,
  alpha: number
): number {
  return (1 - alpha) * tuningError + alpha * roughnessPenalty;
}

/**
 * Evaluate fitness of an individual
 * Lower fitness is better (we're minimizing)
 *
 * @param individual - Individual with genes
 * @param bar - Bar parameters
 * @param material - Material properties
 * @param targetFreq - Target frequencies
 * @param penaltyType - Type of penalty ('volume', 'roughness', or 'none')
 * @param alpha - Penalty weight (0-1)
 * @param numElements - Number of FEM elements
 * @param f1Priority - Weight multiplier for f1 (default 1 = equal)
 * @returns Fitness value (lower is better)
 */
export function evaluateFitness(
  individual: Individual,
  bar: BarParameters,
  material: Material,
  targetFreq: number[],
  penaltyType: 'volume' | 'roughness' | 'none',
  alpha: number,
  numElements: number = 150,
  f1Priority: number = 1
): number {
  const { genes } = individual;

  try {
    // Compute frequencies
    const computedFreq = computeFrequenciesFromGenes(
      genes,
      bar,
      material,
      targetFreq.length,
      numElements
    );

    // Compute tuning error (with f1 priority weighting)
    const tuningError = computeTuningError(computedFreq, targetFreq, f1Priority);

    // If no penalty, return tuning error
    if (penaltyType === 'none' || alpha === 0) {
      return tuningError;
    }

    // Convert genes to cuts for penalty calculation
    const cuts = genesToCuts(genes);

    // Compute penalty based on type
    if (penaltyType === 'volume') {
      const volumePenalty = computeVolumePenalty(cuts, bar.L, bar.h0);
      return combinedObjectiveVolume(tuningError, volumePenalty, alpha);
    } else {
      const roughnessPenalty = computeRoughnessPenalty(cuts, bar.h0);
      return combinedObjectiveRoughness(tuningError, roughnessPenalty, alpha);
    }
  } catch {
    // Return high fitness if computation fails
    return 1e10;
  }
}

/**
 * Evaluate an entire population
 *
 * @param population - Array of individuals
 * @param bar - Bar parameters
 * @param material - Material properties
 * @param targetFreq - Target frequencies
 * @param penaltyType - Type of penalty
 * @param alpha - Penalty weight
 * @param numElements - Number of FEM elements
 * @returns Population with updated fitness values
 */
export function evaluatePopulation(
  population: Individual[],
  bar: BarParameters,
  material: Material,
  targetFreq: number[],
  penaltyType: 'volume' | 'roughness' | 'none',
  alpha: number,
  numElements: number = 150
): Individual[] {
  return population.map(ind => ({
    ...ind,
    fitness: evaluateFitness(ind, bar, material, targetFreq, penaltyType, alpha, numElements)
  }));
}

/**
 * Get detailed evaluation results for an individual
 * Used for displaying results to user
 */
export interface DetailedEvaluation {
  computedFrequencies: number[];
  targetFrequencies: number[];
  tuningError: number;
  volumePenalty: number;
  roughnessPenalty: number;
  combinedFitness: number;
  centsErrors: number[];
  maxCentsError: number;
}

export function evaluateDetailed(
  genes: number[],
  bar: BarParameters,
  material: Material,
  targetFreq: number[],
  penaltyType: 'volume' | 'roughness' | 'none',
  alpha: number,
  numElements: number = 150
): DetailedEvaluation {
  const cuts = genesToCuts(genes);

  // Compute frequencies
  const computedFrequencies = computeFrequenciesFromGenes(
    genes,
    bar,
    material,
    targetFreq.length,
    numElements
  );

  // Compute tuning error
  const tuningError = computeTuningError(computedFrequencies, targetFreq);

  // Compute penalties
  const volumePenalty = computeVolumePenalty(cuts, bar.L, bar.h0);
  const roughnessPenalty = computeRoughnessPenalty(cuts, bar.h0);

  // Compute combined fitness
  let combinedFitness = tuningError;
  if (penaltyType === 'volume' && alpha > 0) {
    combinedFitness = combinedObjectiveVolume(tuningError, volumePenalty, alpha);
  } else if (penaltyType === 'roughness' && alpha > 0) {
    combinedFitness = combinedObjectiveRoughness(tuningError, roughnessPenalty, alpha);
  }

  // Compute cents errors
  const centsErrors = computedFrequencies.map((comp, i) => {
    const target = targetFreq[i];
    if (!target || target === 0) return 0;
    return 1200 * Math.log2(comp / target);
  });

  const maxCentsError = Math.max(...centsErrors.map(Math.abs));

  return {
    computedFrequencies,
    targetFrequencies: targetFreq,
    tuningError,
    volumePenalty,
    roughnessPenalty,
    combinedFitness,
    centsErrors,
    maxCentsError
  };
}
