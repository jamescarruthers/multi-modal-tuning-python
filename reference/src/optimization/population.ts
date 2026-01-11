/**
 * Population Management for Evolutionary Algorithm
 *
 * Handles creation, manipulation, and analysis of populations of individuals.
 */

import { Individual, VariableBounds, BarParameters } from '../types';

/**
 * Constraint options for creating bounds
 */
export interface BoundsConstraints {
  minCutWidth?: number;   // Minimum spacing between cut boundaries (m)
  maxCutWidth?: number;   // Maximum cut width = 2*lambda (m), 0 = no limit
  minCutDepth?: number;   // Minimum depth = h0 - h (m), 0 = no limit
  maxCutDepth?: number;   // Maximum depth = h0 - h (m), 0 = use bar.hMin
  maxLengthTrim?: number; // Maximum trim from each end (m), 0 = no trimming
  maxLengthExtend?: number; // Maximum extension from each end (m), 0 = no extension
}

/**
 * Create bounds for optimization variables based on bar parameters
 *
 * @param bar - Bar parameters
 * @param numCuts - Number of cuts
 * @param constraints - Optional constraint parameters
 * @returns Variable bounds
 */
export function createBounds(
  bar: BarParameters,
  numCuts: number,
  constraints: BoundsConstraints = {}
): VariableBounds {
  const {
    minCutWidth = 0,
    maxCutWidth = 0,
    minCutDepth = 0,
    maxCutDepth = 0,
    maxLengthTrim = 0,
    maxLengthExtend = 0
  } = constraints;

  // Lambda bounds
  // lambdaMax is always L/2 (cuts can extend to bar ends)
  // maxCutWidth constrains the WIDTH of each cut (difference between adjacent lambdas),
  // not the position - this is enforced during population creation and clamping
  const lambdaMin = 0;
  const lambdaMax = bar.L / 2;

  // Height bounds (remember: depth = h0 - h, so larger depth means smaller h)
  // hMax: constrained by minCutDepth (must remove at least this much)
  const hMax = minCutDepth > 0
    ? Math.max(bar.hMin, bar.h0 - minCutDepth)
    : bar.h0;
  // hMin: constrained by maxCutDepth (cannot remove more than this)
  const hMin = maxCutDepth > 0
    ? Math.max(bar.hMin, bar.h0 - maxCutDepth)
    : bar.hMin;

  return {
    lambdaMin,
    lambdaMax,
    hMin,
    hMax,
    minCutWidth,
    maxCutWidth,
    minCutDepth,
    maxCutDepth,
    maxLengthTrim,
    maxLengthExtend
  };
}

/**
 * Create an "uncut bar" individual - baseline with no modifications
 * All lambdas = 0 (no cuts), all heights = h0 (full thickness)
 *
 * @param numCuts - Number of cuts (determines gene array size)
 * @param bounds - Variable bounds (used for h0 via hMax when minCutDepth=0)
 * @param h0 - Original bar thickness
 * @returns Individual representing an uncut bar
 */
export function createUncutBarIndividual(
  numCuts: number,
  bounds: VariableBounds,
  h0: number
): Individual {
  const genes: number[] = [];

  // All cuts have lambda=0 and h=h0 (no material removed)
  for (let i = 0; i < numCuts; i++) {
    genes.push(0);   // lambda = 0 (no cut extent)
    genes.push(h0);  // h = h0 (full original thickness)
  }

  // Add length adjustment gene if enabled (set to 0 = no trim/extend)
  const hasLengthAdjust = bounds.maxLengthTrim > 0 || bounds.maxLengthExtend > 0;
  if (hasLengthAdjust) {
    genes.push(0);  // No length adjustment
  }

  return {
    genes,
    fitness: Infinity  // Will be evaluated later
  };
}

/**
 * Create a random individual within bounds, respecting min/max cut width constraints
 *
 * Cut width = difference between adjacent lambdas (the step width in the wedding cake)
 * - minCutWidth: minimum step width (gap between tiers)
 * - maxCutWidth: maximum step width (how wide each tier can be)
 *
 * @param numCuts - Number of cuts (2 genes per cut: lambda, h)
 * @param bounds - Variable bounds
 * @returns New individual with random genes
 */
export function createRandomIndividual(
  numCuts: number,
  bounds: VariableBounds
): Individual {
  const genes: number[] = [];
  const minWidth = bounds.minCutWidth || 0;
  const maxWidth = bounds.maxCutWidth || 0;

  // Generate lambdas that respect both min and max cut width constraints
  // Each cut's "width" is the difference between its lambda and the next inner lambda
  // (or just lambda for the innermost cut)
  const lambdas: number[] = [];

  if (numCuts === 1) {
    // Single cut: width = lambda (distance from center to edge of cut)
    // The full cut spans 2*lambda (symmetric about center)
    let lambda = bounds.lambdaMin + Math.random() * (bounds.lambdaMax - bounds.lambdaMin);
    if (maxWidth > 0) {
      // For single cut, the "cut width" is the full extent, but we measure lambda
      // maxCutWidth constrains how wide the step is - for single cut this is lambda
      lambda = Math.min(lambda, maxWidth);
    }
    lambdas.push(lambda);
  } else {
    // Multiple cuts: generate with spacing constraints
    // Start from outermost and work inward
    let currentMax = bounds.lambdaMax;

    for (let i = 0; i < numCuts; i++) {
      const remainingCuts = numCuts - i - 1;
      // Reserve space for remaining cuts (each needs at least minWidth)
      const reservedSpace = remainingCuts * minWidth;
      const availableMax = currentMax - reservedSpace;

      // Determine the range for this cut's lambda
      let cutMin = bounds.lambdaMin + reservedSpace;
      let cutMax = availableMax;

      // If maxWidth is set, this cut can't be more than maxWidth from the next boundary
      if (maxWidth > 0 && i > 0) {
        // Previous lambda sets outer boundary, this cut must be within maxWidth of it
        cutMin = Math.max(cutMin, lambdas[i - 1] - maxWidth);
      }

      if (cutMax < cutMin) {
        cutMax = cutMin; // Fallback if constraints are too tight
      }

      const lambda = cutMin + Math.random() * (cutMax - cutMin);
      lambdas.push(lambda);

      // Next cut must be at least minWidth smaller
      currentMax = lambda - minWidth;
    }
  }

  // Ensure lambdas are sorted descending (they should be already)
  lambdas.sort((a, b) => b - a);

  // Build genes array with lambdas and random heights
  for (let i = 0; i < numCuts; i++) {
    genes.push(lambdas[i]);
    // Random height within bounds
    const h = bounds.hMin + Math.random() * (bounds.hMax - bounds.hMin);
    genes.push(h);
  }

  // Add length adjustment gene if enabled (last gene in array)
  // Negative = extend, Positive = trim
  const hasLengthAdjust = bounds.maxLengthTrim > 0 || bounds.maxLengthExtend > 0;
  if (hasLengthAdjust) {
    // Random value between -maxLengthExtend and +maxLengthTrim
    const minVal = -bounds.maxLengthExtend;
    const maxVal = bounds.maxLengthTrim;
    const lengthAdjust = minVal + Math.random() * (maxVal - minVal);
    genes.push(lengthAdjust);
  }

  return {
    genes,
    fitness: Infinity  // Will be evaluated later
  };
}

/**
 * Create an individual with self-adaptive mutation parameters
 *
 * @param numCuts - Number of cuts
 * @param bounds - Variable bounds
 * @param initialSigma - Initial standard deviation for Gaussian mutation
 * @returns Individual with sigma values
 */
export function createAdaptiveIndividual(
  numCuts: number,
  bounds: VariableBounds,
  initialSigma: number = 0.2
): Individual {
  const individual = createRandomIndividual(numCuts, bounds);

  // Initialize sigma values for self-adaptive Gaussian mutation
  // One sigma per gene (including length adjustment if enabled)
  const hasLengthAdjust = bounds.maxLengthTrim > 0 || bounds.maxLengthExtend > 0;
  const numGenes = hasLengthAdjust ? numCuts * 2 + 1 : numCuts * 2;
  individual.sigmas = new Array(numGenes).fill(initialSigma);

  return individual;
}

/**
 * Initialize a population of random individuals, optionally seeded with initial genes
 *
 * @param populationSize - Number of individuals
 * @param numCuts - Number of cuts per individual
 * @param bounds - Variable bounds
 * @param seedGenes - Optional seed genes to use for initial individual(s)
 * @returns Array of individuals
 */
export function initializePopulation(
  populationSize: number,
  numCuts: number,
  bounds: VariableBounds,
  seedGenes?: number[]
): Individual[] {
  const population: Individual[] = [];

  // If seed genes provided, create an individual from them
  if (seedGenes && seedGenes.length > 0) {
    const clampedGenes = clampToBounds(seedGenes, bounds);
    population.push({
      genes: clampedGenes,
      fitness: Infinity
    });

    // Also add some mutated variants of the seed for diversity
    const numVariants = Math.min(Math.floor(populationSize * 0.2), 10); // 20% or max 10 variants
    for (let i = 0; i < numVariants && population.length < populationSize; i++) {
      const variantGenes = clampedGenes.map(g => {
        // Add small random variation (±5%)
        const variation = g * (0.95 + Math.random() * 0.1);
        return variation;
      });
      population.push({
        genes: clampToBounds(variantGenes, bounds),
        fitness: Infinity
      });
    }
  }

  // Fill remaining slots with random individuals
  while (population.length < populationSize) {
    population.push(createRandomIndividual(numCuts, bounds));
  }

  return population;
}

/**
 * Initialize population with self-adaptive mutation
 */
export function initializeAdaptivePopulation(
  populationSize: number,
  numCuts: number,
  bounds: VariableBounds,
  initialSigma: number = 0.2
): Individual[] {
  return Array.from({ length: populationSize }, () =>
    createAdaptiveIndividual(numCuts, bounds, initialSigma)
  );
}

/**
 * Get the best individual from a population
 * (Lowest fitness is best - we're minimizing)
 */
export function getBestIndividual(population: Individual[]): Individual {
  return population.reduce((best, current) =>
    current.fitness < best.fitness ? current : best
  );
}

/**
 * Get the N best individuals from a population
 */
export function getTopIndividuals(population: Individual[], n: number): Individual[] {
  return [...population]
    .sort((a, b) => a.fitness - b.fitness)
    .slice(0, n);
}

/**
 * Calculate population statistics
 */
export interface PopulationStats {
  bestFitness: number;
  worstFitness: number;
  averageFitness: number;
  medianFitness: number;
  standardDeviation: number;
}

export function calculatePopulationStats(population: Individual[]): PopulationStats {
  const fitnesses = population.map(ind => ind.fitness).filter(f => isFinite(f));

  if (fitnesses.length === 0) {
    return {
      bestFitness: Infinity,
      worstFitness: Infinity,
      averageFitness: Infinity,
      medianFitness: Infinity,
      standardDeviation: 0
    };
  }

  fitnesses.sort((a, b) => a - b);

  const sum = fitnesses.reduce((acc, f) => acc + f, 0);
  const average = sum / fitnesses.length;

  const median = fitnesses.length % 2 === 0
    ? (fitnesses[fitnesses.length / 2 - 1] + fitnesses[fitnesses.length / 2]) / 2
    : fitnesses[Math.floor(fitnesses.length / 2)];

  const squaredDiffs = fitnesses.map(f => (f - average) ** 2);
  const variance = squaredDiffs.reduce((acc, d) => acc + d, 0) / fitnesses.length;
  const standardDeviation = Math.sqrt(variance);

  return {
    bestFitness: fitnesses[0],
    worstFitness: fitnesses[fitnesses.length - 1],
    averageFitness: average,
    medianFitness: median,
    standardDeviation
  };
}

/**
 * Deep clone an individual
 */
export function cloneIndividual(individual: Individual): Individual {
  return {
    genes: [...individual.genes],
    fitness: individual.fitness,
    sigmas: individual.sigmas ? [...individual.sigmas] : undefined
  };
}

/**
 * Check if genes are within bounds and clamp if necessary.
 * Enforces both minimum and maximum cut width constraints.
 *
 * Cut width = difference between adjacent lambdas (step width in wedding cake)
 *
 * Gene format: [lambda_1, h_1, lambda_2, h_2, ..., lengthTrim?]
 * Length trim is the last gene if maxLengthTrim > 0
 */
export function clampToBounds(genes: number[], bounds: VariableBounds): number[] {
  const clamped = [...genes];
  const minWidth = bounds.minCutWidth || 0;
  const maxWidth = bounds.maxCutWidth || 0;

  // Determine if length adjustment gene is present
  const hasLengthAdjust = bounds.maxLengthTrim > 0 || bounds.maxLengthExtend > 0;
  const numCuts = hasLengthAdjust ? (clamped.length - 1) / 2 : clamped.length / 2;
  const cutGenesLength = numCuts * 2;

  // First pass: clamp individual cut values (lambda and h)
  for (let i = 0; i < cutGenesLength; i += 2) {
    // Clamp lambda
    clamped[i] = Math.max(bounds.lambdaMin, Math.min(bounds.lambdaMax, clamped[i]));
    // Clamp height
    clamped[i + 1] = Math.max(bounds.hMin, Math.min(bounds.hMax, clamped[i + 1]));
  }

  // Clamp length adjustment gene if present
  // Range: [-maxLengthExtend, +maxLengthTrim]
  if (hasLengthAdjust && clamped.length > cutGenesLength) {
    const minVal = -bounds.maxLengthExtend;
    const maxVal = bounds.maxLengthTrim;
    clamped[cutGenesLength] = Math.max(minVal, Math.min(maxVal, clamped[cutGenesLength]));
  }

  // Second pass: enforce min/max spacing between lambdas
  if ((minWidth > 0 || maxWidth > 0) && numCuts >= 1) {
    // Extract lambdas with their original indices
    const lambdasWithIdx: { lambda: number; idx: number }[] = [];
    for (let i = 0; i < numCuts; i++) {
      lambdasWithIdx.push({ lambda: clamped[i * 2], idx: i * 2 });
    }

    // Sort by lambda descending (outermost first)
    lambdasWithIdx.sort((a, b) => b.lambda - a.lambda);

    // Enforce constraints from outside in
    for (let i = 1; i < lambdasWithIdx.length; i++) {
      const outerLambda = lambdasWithIdx[i - 1].lambda;
      let innerLambda = lambdasWithIdx[i].lambda;

      // Enforce minimum spacing (inner must be at least minWidth smaller)
      if (minWidth > 0) {
        const maxAllowed = outerLambda - minWidth;
        if (innerLambda > maxAllowed) {
          innerLambda = Math.max(bounds.lambdaMin, maxAllowed);
        }
      }

      // Enforce maximum spacing (inner can't be more than maxWidth smaller)
      if (maxWidth > 0) {
        const minAllowed = outerLambda - maxWidth;
        if (innerLambda < minAllowed) {
          innerLambda = Math.max(bounds.lambdaMin, minAllowed);
        }
      }

      lambdasWithIdx[i].lambda = innerLambda;
    }

    // Write back to clamped array
    for (const item of lambdasWithIdx) {
      clamped[item.idx] = item.lambda;
    }
  }

  return clamped;
}

/**
 * Extract length adjustment from genes array
 * Returns 0 if length adjustment is not enabled (genes length is even = numCuts * 2)
 *
 * @param genes - Gene array [lambda_1, h_1, ..., lengthAdjust?]
 * @param numCuts - Number of cuts
 * @returns Length adjustment value (m): positive = trim, negative = extend, 0 if not present
 */
export function getLengthAdjustFromGenes(genes: number[], numCuts: number): number {
  const expectedCutGenes = numCuts * 2;
  if (genes.length > expectedCutGenes) {
    return genes[expectedCutGenes];
  }
  return 0;
}

/**
 * @deprecated Use getLengthAdjustFromGenes instead
 * Kept for backwards compatibility - returns the same value
 */
export function getLengthTrimFromGenes(genes: number[], numCuts: number): number {
  return getLengthAdjustFromGenes(genes, numCuts);
}

/**
 * Calculate diversity measure for population
 * Higher values indicate more diverse population
 */
export function calculateDiversity(population: Individual[]): number {
  if (population.length < 2) return 0;

  const numGenes = population[0].genes.length;
  let totalVariance = 0;

  for (let g = 0; g < numGenes; g++) {
    const geneValues = population.map(ind => ind.genes[g]);
    const mean = geneValues.reduce((a, b) => a + b, 0) / geneValues.length;
    const variance = geneValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / geneValues.length;
    totalVariance += variance;
  }

  return Math.sqrt(totalVariance / numGenes);
}
