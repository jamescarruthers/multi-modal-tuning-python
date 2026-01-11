/**
 * Mutation Operators for Evolutionary Algorithm
 *
 * Implements uniform random mutation and self-adaptive Gaussian mutation
 * from Section 3.3 of the paper (Eq. 17-18).
 */

import { Individual, VariableBounds } from '../types';
import { clampToBounds } from './population';

/**
 * Frequency error info for adaptive length mutation
 */
export interface FrequencyError {
  f1Error: number;  // f1_computed - f1_target (positive = too high, negative = too low)
}

/**
 * Uniform random mutation
 * As described in paper Section 3.3:
 * 1. Randomly select number of genes to mutate (1 to 2N)
 * 2. Randomly select which genes to mutate
 * 3. Mutate with: c = p + sigma * r, where r is uniform [-1, 1]
 *
 * @param individual - Individual to mutate
 * @param sigma - Mutation strength (normalized to bounds)
 * @param bounds - Variable bounds
 * @returns Mutated individual
 */
export function uniformMutation(
  individual: Individual,
  sigma: number,
  bounds: VariableBounds
): Individual {
  const genes = [...individual.genes];
  const numGenes = genes.length;

  // Step 1: Random number of genes to mutate
  const numMutate = Math.floor(Math.random() * numGenes) + 1;

  // Step 2: Select which genes to mutate
  const indicesToMutate: Set<number> = new Set();
  while (indicesToMutate.size < numMutate) {
    indicesToMutate.add(Math.floor(Math.random() * numGenes));
  }

  // Determine if length adjustment gene is present
  const hasLengthAdjust = bounds.maxLengthTrim > 0 || bounds.maxLengthExtend > 0;
  const numCuts = hasLengthAdjust ? Math.floor((numGenes - 1) / 2) : Math.floor(numGenes / 2);
  const cutGenesCount = numCuts * 2;

  // Step 3: Mutate selected genes
  for (const idx of indicesToMutate) {
    // Determine bound range for this gene
    let range: number;
    if (hasLengthAdjust && idx === cutGenesCount) {
      // This is the length adjustment gene: range is from -maxExtend to +maxTrim
      range = bounds.maxLengthTrim + bounds.maxLengthExtend;
    } else {
      // Cut genes: alternating lambda and h
      const isLambda = idx % 2 === 0;
      range = isLambda
        ? bounds.lambdaMax - bounds.lambdaMin
        : bounds.hMax - bounds.hMin;
    }

    // Random mutation: r is uniform [-1, 1]
    const r = (Math.random() * 2 - 1);
    genes[idx] += sigma * range * r;
  }

  // Clamp to bounds
  const mutatedGenes = clampToBounds(genes, bounds);

  return {
    genes: mutatedGenes,
    fitness: Infinity,
    sigmas: individual.sigmas ? [...individual.sigmas] : undefined
  };
}

/**
 * Adaptive mutation with gradient-aware length adjustment
 *
 * When mutating the length gene, biases the direction based on f₁ error:
 * - If f₁ is too high (positive error), bias toward trimming (positive length adjust)
 * - If f₁ is too low (negative error), bias toward extending (negative length adjust)
 *
 * Physics: f₁ ∝ 1/L², so shorter bar = higher frequency
 *
 * @param individual - Individual to mutate
 * @param sigma - Mutation strength (normalized to bounds)
 * @param bounds - Variable bounds
 * @param freqError - Optional frequency error info for adaptive length mutation
 * @param adaptiveBias - How strongly to bias toward the correct direction (0-1, default 0.7)
 * @returns Mutated individual
 */
export function adaptiveLengthMutation(
  individual: Individual,
  sigma: number,
  bounds: VariableBounds,
  freqError?: FrequencyError,
  adaptiveBias: number = 0.7
): Individual {
  const genes = [...individual.genes];
  const numGenes = genes.length;

  // Step 1: Random number of genes to mutate
  const numMutate = Math.floor(Math.random() * numGenes) + 1;

  // Step 2: Select which genes to mutate
  const indicesToMutate: Set<number> = new Set();
  while (indicesToMutate.size < numMutate) {
    indicesToMutate.add(Math.floor(Math.random() * numGenes));
  }

  // Determine if length adjustment gene is present
  const hasLengthAdjust = bounds.maxLengthTrim > 0 || bounds.maxLengthExtend > 0;
  const numCuts = hasLengthAdjust ? Math.floor((numGenes - 1) / 2) : Math.floor(numGenes / 2);
  const cutGenesCount = numCuts * 2;
  const lengthGeneIdx = cutGenesCount;

  // Step 3: Mutate selected genes
  for (const idx of indicesToMutate) {
    // Determine bound range for this gene
    let range: number;

    if (hasLengthAdjust && idx === lengthGeneIdx) {
      // This is the length adjustment gene - use adaptive mutation
      range = bounds.maxLengthTrim + bounds.maxLengthExtend;

      if (freqError && Math.abs(freqError.f1Error) > 0.001) {
        // Use gradient-aware mutation for length gene
        // f1Error > 0 means f1 is too high, need to extend (negative length adjust)
        // f1Error < 0 means f1 is too low, need to trim (positive length adjust)

        // Determine desired direction: positive = trim, negative = extend
        const desiredDirection = freqError.f1Error < 0 ? 1 : -1;

        // Generate biased random value
        // With probability adaptiveBias, move in the correct direction
        // With probability (1 - adaptiveBias), move randomly for exploration
        let r: number;
        if (Math.random() < adaptiveBias) {
          // Biased: move in the desired direction with random magnitude
          r = desiredDirection * Math.random();
        } else {
          // Random exploration
          r = (Math.random() * 2 - 1);
        }

        genes[idx] += sigma * range * r;
      } else {
        // No frequency error info, use standard random mutation
        const r = (Math.random() * 2 - 1);
        genes[idx] += sigma * range * r;
      }
    } else {
      // Cut genes: alternating lambda and h - standard random mutation
      const isLambda = idx % 2 === 0;
      range = isLambda
        ? bounds.lambdaMax - bounds.lambdaMin
        : bounds.hMax - bounds.hMin;

      const r = (Math.random() * 2 - 1);
      genes[idx] += sigma * range * r;
    }
  }

  // Clamp to bounds
  const mutatedGenes = clampToBounds(genes, bounds);

  return {
    genes: mutatedGenes,
    fitness: Infinity,
    sigmas: individual.sigmas ? [...individual.sigmas] : undefined
  };
}

/**
 * Self-adaptive Gaussian mutation from Eq. 17-18
 *
 * sigma_k^{t+1} = sigma_k^t * exp(tau1 * z1 + tau2 * z2)
 * c_k = p_k + sigma_k^{t+1} * z3
 *
 * where:
 * - tau1 = 1 / sqrt(2 * sqrt(2n))
 * - tau2 = 1 / sqrt(4n)
 * - z1, z2, z3 are Gaussian random numbers with standard deviation phi
 *
 * @param individual - Individual to mutate (must have sigmas)
 * @param phi - Base standard deviation for random numbers
 * @param bounds - Variable bounds
 * @returns Mutated individual with updated sigmas
 */
export function gaussianSelfAdaptiveMutation(
  individual: Individual,
  phi: number,
  bounds: VariableBounds
): Individual {
  const genes = [...individual.genes];
  const numGenes = genes.length;
  const n = numGenes;  // Total number of genes

  // Initialize sigmas if not present
  const sigmas = individual.sigmas ? [...individual.sigmas] : new Array(numGenes).fill(0.2);

  // Learning rates from Eq. 18
  const tau1 = 1 / Math.sqrt(2 * Math.sqrt(2 * n));
  const tau2 = 1 / Math.sqrt(4 * n);

  // Common random factor (same for all genes in this mutation)
  const z1 = gaussianRandom() * phi;

  // Determine if length adjustment gene is present
  const hasLengthAdjust = bounds.maxLengthTrim > 0 || bounds.maxLengthExtend > 0;
  const numCuts = hasLengthAdjust ? Math.floor((numGenes - 1) / 2) : Math.floor(numGenes / 2);
  const cutGenesCount = numCuts * 2;

  for (let k = 0; k < numGenes; k++) {
    // Gene-specific random factors
    const z2 = gaussianRandom() * phi;
    const z3 = gaussianRandom();

    // Update sigma (Eq. 17, first line)
    sigmas[k] = sigmas[k] * Math.exp(tau1 * z1 + tau2 * z2);

    // Clamp sigma to reasonable range
    sigmas[k] = Math.max(0.001, Math.min(1.0, sigmas[k]));

    // Mutate gene (Eq. 17, second line)
    let range: number;
    if (hasLengthAdjust && k === cutGenesCount) {
      // This is the length adjustment gene: range is from -maxExtend to +maxTrim
      range = bounds.maxLengthTrim + bounds.maxLengthExtend;
    } else {
      // Cut genes: alternating lambda and h
      const isLambda = k % 2 === 0;
      range = isLambda
        ? bounds.lambdaMax - bounds.lambdaMin
        : bounds.hMax - bounds.hMin;
    }

    genes[k] += sigmas[k] * range * z3;
  }

  // Clamp to bounds
  const mutatedGenes = clampToBounds(genes, bounds);

  return {
    genes: mutatedGenes,
    fitness: Infinity,
    sigmas
  };
}

/**
 * Generate a random number from standard Gaussian distribution
 * Using Box-Muller transform
 */
function gaussianRandom(): number {
  let u1 = Math.random();
  let u2 = Math.random();

  // Avoid log(0)
  while (u1 === 0) u1 = Math.random();

  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Polynomial mutation
 * Non-uniform mutation that can produce values close to parents or at bounds
 *
 * @param individual - Individual to mutate
 * @param mutationProb - Probability of mutating each gene
 * @param eta - Distribution index (higher = closer to parent)
 * @param bounds - Variable bounds
 */
export function polynomialMutation(
  individual: Individual,
  mutationProb: number,
  eta: number,
  bounds: VariableBounds
): Individual {
  const genes = [...individual.genes];
  const numGenes = genes.length;

  // Determine if length adjustment gene is present
  const hasLengthAdjust = bounds.maxLengthTrim > 0 || bounds.maxLengthExtend > 0;
  const numCuts = hasLengthAdjust ? Math.floor((numGenes - 1) / 2) : Math.floor(numGenes / 2);
  const cutGenesCount = numCuts * 2;

  for (let i = 0; i < numGenes; i++) {
    if (Math.random() > mutationProb) continue;

    let min: number;
    let max: number;
    if (hasLengthAdjust && i === cutGenesCount) {
      // Length adjustment gene: range is from -maxExtend to +maxTrim
      min = -bounds.maxLengthExtend;
      max = bounds.maxLengthTrim;
    } else {
      // Cut genes: alternating lambda and h
      const isLambda = i % 2 === 0;
      min = isLambda ? bounds.lambdaMin : bounds.hMin;
      max = isLambda ? bounds.lambdaMax : bounds.hMax;
    }

    const x = genes[i];
    const delta1 = (x - min) / (max - min);
    const delta2 = (max - x) / (max - min);

    const r = Math.random();
    let delta: number;

    if (r < 0.5) {
      const xy = 1 - delta1;
      const val = 2 * r + (1 - 2 * r) * Math.pow(xy, eta + 1);
      delta = Math.pow(val, 1 / (eta + 1)) - 1;
    } else {
      const xy = 1 - delta2;
      const val = 2 * (1 - r) + 2 * (r - 0.5) * Math.pow(xy, eta + 1);
      delta = 1 - Math.pow(val, 1 / (eta + 1));
    }

    genes[i] = x + delta * (max - min);
  }

  return {
    genes: clampToBounds(genes, bounds),
    fitness: Infinity,
    sigmas: individual.sigmas ? [...individual.sigmas] : undefined
  };
}

/**
 * Perform mutation on a set of individuals
 *
 * @param individuals - Individuals to mutate
 * @param bounds - Variable bounds
 * @param method - Mutation method
 * @param sigma - Mutation strength (for uniform) or phi (for gaussian)
 * @returns Mutated individuals
 */
export function performMutation(
  individuals: Individual[],
  bounds: VariableBounds,
  method: 'uniform' | 'gaussian' = 'uniform',
  sigma: number = 0.1
): Individual[] {
  if (method === 'uniform') {
    return individuals.map(ind => uniformMutation(ind, sigma, bounds));
  } else {
    return individuals.map(ind => gaussianSelfAdaptiveMutation(ind, sigma, bounds));
  }
}

/**
 * Create mutated copies of top individuals
 * Useful for exploration around good solutions
 */
export function mutateTopIndividuals(
  population: Individual[],
  numToMutate: number,
  bounds: VariableBounds,
  sigma: number = 0.1
): Individual[] {
  // Sort by fitness
  const sorted = [...population].sort((a, b) => a.fitness - b.fitness);
  const topIndividuals = sorted.slice(0, numToMutate);

  return topIndividuals.map(ind => uniformMutation(ind, sigma, bounds));
}
