/**
 * Evolutionary Algorithm for Bar Tuning Optimization
 *
 * Main optimization loop implementing the algorithm from Section 3 of the paper.
 * Combines elitism, selection, crossover, and mutation to find optimal
 * undercut geometries for target frequencies.
 */

import {
  Individual,
  BarParameters,
  Material,
  EAParameters,
  OptimizationResult,
  ProgressUpdate,
  Cut
} from '../types';
import {
  initializePopulation,
  createBounds,
  createUncutBarIndividual,
  getBestIndividual,
  calculatePopulationStats,
  cloneIndividual,
  getLengthAdjustFromGenes
} from './population';
import { evaluateFitness, evaluateDetailed, computeTuningError } from './objectiveFunction';
import { selectElite, selectMatingPairs } from './selection';
import { performCrossover, heuristicCrossover } from './crossover';
import { uniformMutation, gaussianSelfAdaptiveMutation, adaptiveLengthMutation, FrequencyError } from './mutation';
import { genesToCuts } from '../physics/barProfile';
import { batchComputeFitness, isWasmReady, computeFrequenciesFromGenes } from '../physics/frequencies';
import { computeVolumePenalty, computeRoughnessPenalty } from './penalties';

/**
 * Configuration for the evolutionary algorithm
 */
export interface EAConfig {
  bar: BarParameters;
  material: Material;
  targetFrequencies: number[];
  numCuts: number;
  penaltyType: 'volume' | 'roughness' | 'none';
  penaltyWeight: number;
  eaParams: EAParameters;
  seedGenes?: number[];  // Optional seed genes to initialize population
  onProgress?: (update: ProgressUpdate) => void;
  shouldStop?: () => boolean;
}

/**
 * Compute frequencies and cents errors for an individual
 * Used for progress updates during optimization
 */
function computeFrequenciesAndErrors(
  genes: number[],
  bar: BarParameters,
  material: Material,
  targetFrequencies: number[],
  numElements: number,
  numCuts: number
): { computedFrequencies: number[]; errorsInCents: number[]; lengthTrim: number } {
  try {
    const lengthTrim = getLengthAdjustFromGenes(genes, numCuts);
    const computedFrequencies = computeFrequenciesFromGenes(
      genes,
      bar,
      material,
      targetFrequencies.length,
      numElements,
      numCuts
    );

    const errorsInCents = computedFrequencies.map((comp, i) => {
      const target = targetFrequencies[i];
      if (!target || target === 0) return 0;
      return 1200 * Math.log2(comp / target);
    });

    return { computedFrequencies, errorsInCents, lengthTrim };
  } catch {
    return {
      computedFrequencies: [],
      errorsInCents: [],
      lengthTrim: 0
    };
  }
}

/**
 * Batch evaluate population fitness using WASM when available
 * This minimizes JS-WASM boundary crossings for significant speedup
 */
function batchEvaluatePopulation(
  population: Individual[],
  bar: BarParameters,
  material: Material,
  targetFrequencies: number[],
  penaltyType: 'volume' | 'roughness' | 'none',
  penaltyWeight: number,
  numElements: number,
  f1Priority: number = 1,
  numCuts: number = 1
): Individual[] {
  // Get tuning errors via batch computation
  const genesArray = population.map(ind => ind.genes);
  const tuningErrors = batchComputeFitness(
    genesArray,
    bar,
    material,
    targetFrequencies,
    numElements,
    f1Priority,
    numCuts
  );

  // Apply penalties if needed
  return population.map((ind, i) => {
    let fitness = tuningErrors[i];

    if (penaltyType !== 'none' && penaltyWeight > 0) {
      // Extract cut genes only (exclude length trim)
      const cutGenes = ind.genes.slice(0, numCuts * 2);
      const cuts = genesToCuts(cutGenes);

      // Get effective bar length if length adjustment is used
      const lengthAdjust = getLengthAdjustFromGenes(ind.genes, numCuts);
      const effectiveL = bar.L - 2 * lengthAdjust;

      if (penaltyType === 'volume') {
        const penalty = computeVolumePenalty(cuts, effectiveL, bar.h0);
        fitness = (1 - penaltyWeight) * fitness + penaltyWeight * penalty;
      } else {
        const penalty = computeRoughnessPenalty(cuts, bar.h0);
        fitness = (1 - penaltyWeight) * fitness + penaltyWeight * penalty;
      }
    }

    return { ...ind, fitness };
  });
}

/**
 * Run the evolutionary algorithm
 *
 * @param config - Algorithm configuration
 * @returns Optimization result
 */
export async function runEvolutionaryAlgorithm(config: EAConfig): Promise<OptimizationResult> {
  const {
    bar,
    material,
    targetFrequencies,
    numCuts,
    penaltyType,
    penaltyWeight,
    eaParams,
    seedGenes,
    onProgress,
    shouldStop
  } = config;

  const bounds = createBounds(bar, numCuts, {
    minCutWidth: eaParams.minCutWidth ?? 0,
    maxCutWidth: eaParams.maxCutWidth ?? 0,
    minCutDepth: eaParams.minCutDepth ?? 0,
    maxCutDepth: eaParams.maxCutDepth ?? 0,
    maxLengthTrim: eaParams.maxLengthTrim ?? 0,
    maxLengthExtend: eaParams.maxLengthExtend ?? 0
  });
  const useWasm = isWasmReady();
  const f1Priority = eaParams.f1Priority ?? 1;
  const hasLengthAdjust = (eaParams.maxLengthTrim ?? 0) > 0 || (eaParams.maxLengthExtend ?? 0) > 0;

  // Report Generation 0: uncut bar baseline
  if (onProgress) {
    const uncutBar = createUncutBarIndividual(numCuts, bounds, bar.h0);
    // Evaluate the uncut bar
    const [evaluatedUncut] = batchEvaluatePopulation(
      [uncutBar], bar, material, targetFrequencies,
      penaltyType, penaltyWeight, eaParams.numElements, f1Priority, numCuts
    );
    const { computedFrequencies, errorsInCents, lengthTrim } = computeFrequenciesAndErrors(
      evaluatedUncut.genes,
      bar,
      material,
      targetFrequencies,
      eaParams.numElements,
      numCuts
    );
    onProgress({
      generation: 0,
      bestFitness: evaluatedUncut.fitness,
      bestIndividual: evaluatedUncut,
      averageFitness: evaluatedUncut.fitness,
      computedFrequencies,
      errorsInCents,
      lengthTrim
    });
  }

  // Initialize population (with optional seed)
  let population = initializePopulation(eaParams.populationSize, numCuts, bounds, seedGenes);

  // Evaluate initial population
  population = batchEvaluatePopulation(
    population, bar, material, targetFrequencies,
    penaltyType, penaltyWeight, eaParams.numElements, f1Priority, numCuts
  );

  // Calculate percentages for different operations
  const numElite = Math.max(1, Math.floor(eaParams.populationSize * eaParams.elitismPercent / 100));
  const numCrossover = Math.floor(eaParams.populationSize * eaParams.crossoverPercent / 100);
  const numCrossoverPairs = Math.ceil(numCrossover / 2);

  let bestEver = getBestIndividual(population);
  let generation = 0;

  // Main evolution loop
  while (generation < eaParams.maxGenerations) {
    // Check stopping condition
    if (shouldStop?.()) break;

    // Check if target error reached
    if (bestEver.fitness <= eaParams.targetError) break;

    // Create next generation (without fitness - will batch evaluate later)
    const nextGeneration: Individual[] = [];

    // 1. Elitism: Keep best individuals unchanged (already have fitness)
    const elite = selectElite(population, numElite);
    nextGeneration.push(...elite);

    // 2. Crossover: Select parents and create children
    const newOffspring: Individual[] = [];
    if (numCrossover > 0) {
      const matingPairs = selectMatingPairs(population, numCrossoverPairs, 'roulette');

      for (const [parent1, parent2] of matingPairs) {
        const [child1, child2] = heuristicCrossover(parent1, parent2, bounds);
        newOffspring.push(child1);
        if (nextGeneration.length + newOffspring.length < eaParams.populationSize) {
          newOffspring.push(child2);
        }
      }
    }

    // 3. Mutation: Select individuals and mutate
    const sortedPop = [...population].sort((a, b) => a.fitness - b.fitness);
    while (nextGeneration.length + newOffspring.length < eaParams.populationSize) {
      const idx = Math.floor(Math.random() * Math.min(sortedPop.length, numElite + numCrossover));
      const parent = sortedPop[idx];

      // Use adaptive mutation if length adjustment is enabled
      let mutant: Individual;
      if (hasLengthAdjust) {
        // Compute f1 error for the parent to guide length mutation
        const parentFreqs = computeFrequenciesFromGenes(
          parent.genes, bar, material, 1, eaParams.numElements, numCuts
        );
        const f1Error = parentFreqs[0] - targetFrequencies[0];
        const freqError: FrequencyError = { f1Error };
        mutant = adaptiveLengthMutation(parent, eaParams.mutationStrength, bounds, freqError);
      } else {
        mutant = uniformMutation(parent, eaParams.mutationStrength, bounds);
      }
      newOffspring.push(mutant);
    }

    // Batch evaluate all new offspring at once
    if (newOffspring.length > 0) {
      const evaluatedOffspring = batchEvaluatePopulation(
        newOffspring, bar, material, targetFrequencies,
        penaltyType, penaltyWeight, eaParams.numElements, f1Priority, numCuts
      );
      nextGeneration.push(...evaluatedOffspring);
    }

    // Update population
    population = nextGeneration;

    // Update best ever
    const currentBest = getBestIndividual(population);
    if (currentBest.fitness < bestEver.fitness) {
      bestEver = cloneIndividual(currentBest);
    }

    generation++;

    // Report progress
    if (onProgress) {
      const stats = calculatePopulationStats(population);
      const { computedFrequencies, errorsInCents, lengthTrim } = computeFrequenciesAndErrors(
        bestEver.genes,
        bar,
        material,
        targetFrequencies,
        eaParams.numElements,
        numCuts
      );
      onProgress({
        generation,
        bestFitness: bestEver.fitness,
        bestIndividual: cloneIndividual(bestEver),
        averageFitness: stats.averageFitness,
        computedFrequencies,
        errorsInCents,
        lengthTrim
      });
    }

    // Yield control to allow stop messages to be processed
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  // Get detailed results for best solution using SAME elements as optimization
  // Using different numElements would give different frequencies than what was optimized for
  const lengthAdjust = getLengthAdjustFromGenes(bestEver.genes, numCuts);
  const effectiveLength = bar.L - 2 * lengthAdjust;

  // Create effective bar for detailed evaluation
  const effectiveBar = lengthAdjust !== 0 ? { ...bar, L: effectiveLength } : bar;

  // Extract only cut genes
  const cutGenes = bestEver.genes.slice(0, numCuts * 2);

  const detailed = evaluateDetailed(
    cutGenes,
    effectiveBar,
    material,
    targetFrequencies,
    penaltyType,
    penaltyWeight,
    eaParams.numElements
  );

  return {
    bestIndividual: bestEver,
    cuts: genesToCuts(cutGenes),
    computedFrequencies: detailed.computedFrequencies,
    targetFrequencies: detailed.targetFrequencies,
    tuningError: detailed.tuningError,
    maxErrorCents: detailed.maxCentsError,
    errorsInCents: detailed.centsErrors,
    volumePercent: detailed.volumePenalty,
    roughnessPercent: detailed.roughnessPenalty,
    generations: generation,
    lengthTrim: lengthAdjust,
    effectiveLength
  };
}

/**
 * Run optimization with adaptive mutation
 * Uses self-adaptive Gaussian mutation for potentially better convergence
 */
export async function runAdaptiveEvolution(config: EAConfig): Promise<OptimizationResult> {
  const {
    bar,
    material,
    targetFrequencies,
    numCuts,
    penaltyType,
    penaltyWeight,
    eaParams,
    onProgress,
    shouldStop
  } = config;

  const bounds = createBounds(bar, numCuts, {
    minCutWidth: eaParams.minCutWidth ?? 0,
    maxCutWidth: eaParams.maxCutWidth ?? 0,
    minCutDepth: eaParams.minCutDepth ?? 0,
    maxCutDepth: eaParams.maxCutDepth ?? 0,
    maxLengthTrim: eaParams.maxLengthTrim ?? 0,
    maxLengthExtend: eaParams.maxLengthExtend ?? 0
  });
  const f1Priority = eaParams.f1Priority ?? 1;
  const hasLengthAdjust = (eaParams.maxLengthTrim ?? 0) > 0 || (eaParams.maxLengthExtend ?? 0) > 0;
  const numGenes = hasLengthAdjust ? numCuts * 2 + 1 : numCuts * 2;

  // Report Generation 0: uncut bar baseline
  if (onProgress) {
    const uncutBar = createUncutBarIndividual(numCuts, bounds, bar.h0);
    const [evaluatedUncut] = batchEvaluatePopulation(
      [uncutBar], bar, material, targetFrequencies,
      penaltyType, penaltyWeight, eaParams.numElements, f1Priority, numCuts
    );
    const { computedFrequencies, errorsInCents, lengthTrim } = computeFrequenciesAndErrors(
      evaluatedUncut.genes,
      bar,
      material,
      targetFrequencies,
      eaParams.numElements,
      numCuts
    );
    onProgress({
      generation: 0,
      bestFitness: evaluatedUncut.fitness,
      bestIndividual: evaluatedUncut,
      averageFitness: evaluatedUncut.fitness,
      computedFrequencies,
      errorsInCents,
      lengthTrim
    });
  }

  // Initialize population with sigmas for self-adaptive mutation
  let population: Individual[] = initializePopulation(eaParams.populationSize, numCuts, bounds)
    .map(ind => ({
      ...ind,
      sigmas: new Array(numGenes).fill(0.2) as number[]
    }));

  // Evaluate initial population
  population = batchEvaluatePopulation(
    population, bar, material, targetFrequencies,
    penaltyType, penaltyWeight, eaParams.numElements, f1Priority, numCuts
  );

  const numElite = Math.max(1, Math.floor(eaParams.populationSize * eaParams.elitismPercent / 100));

  let bestEver = getBestIndividual(population);
  let generation = 0;

  while (generation < eaParams.maxGenerations) {
    if (shouldStop?.()) break;
    if (bestEver.fitness <= eaParams.targetError) break;

    const nextGeneration: Individual[] = [];

    // Elitism
    const elite = selectElite(population, numElite);
    nextGeneration.push(...elite);

    // Generate offspring through mutation only (mu + lambda strategy)
    const newOffspring: Individual[] = [];
    const sortedPop = [...population].sort((a, b) => a.fitness - b.fitness);

    while (nextGeneration.length + newOffspring.length < eaParams.populationSize) {
      const idx = Math.floor(Math.random() * sortedPop.length * 0.5); // Top 50%
      const parent = sortedPop[idx];
      const mutant = gaussianSelfAdaptiveMutation(parent, eaParams.mutationStrength, bounds);
      newOffspring.push(mutant);
    }

    // Batch evaluate all new offspring at once
    if (newOffspring.length > 0) {
      const evaluatedOffspring = batchEvaluatePopulation(
        newOffspring, bar, material, targetFrequencies,
        penaltyType, penaltyWeight, eaParams.numElements, f1Priority, numCuts
      );
      nextGeneration.push(...evaluatedOffspring);
    }

    population = nextGeneration;

    const currentBest = getBestIndividual(population);
    if (currentBest.fitness < bestEver.fitness) {
      bestEver = cloneIndividual(currentBest);
    }

    generation++;

    if (onProgress) {
      const stats = calculatePopulationStats(population);
      const { computedFrequencies, errorsInCents, lengthTrim } = computeFrequenciesAndErrors(
        bestEver.genes,
        bar,
        material,
        targetFrequencies,
        eaParams.numElements,
        numCuts
      );
      onProgress({
        generation,
        bestFitness: bestEver.fitness,
        bestIndividual: cloneIndividual(bestEver),
        averageFitness: stats.averageFitness,
        computedFrequencies,
        errorsInCents,
        lengthTrim
      });
    }

    // Yield control to allow stop messages to be processed
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  // Get detailed results for best solution using SAME elements as optimization
  const lengthAdjust = getLengthAdjustFromGenes(bestEver.genes, numCuts);
  const effectiveLength = bar.L - 2 * lengthAdjust;

  // Create effective bar for detailed evaluation
  const effectiveBar = lengthAdjust !== 0 ? { ...bar, L: effectiveLength } : bar;

  // Extract only cut genes
  const cutGenes = bestEver.genes.slice(0, numCuts * 2);

  const detailed = evaluateDetailed(
    cutGenes,
    effectiveBar,
    material,
    targetFrequencies,
    penaltyType,
    penaltyWeight,
    eaParams.numElements
  );

  return {
    bestIndividual: bestEver,
    cuts: genesToCuts(cutGenes),
    computedFrequencies: detailed.computedFrequencies,
    targetFrequencies: detailed.targetFrequencies,
    tuningError: detailed.tuningError,
    maxErrorCents: detailed.maxCentsError,
    errorsInCents: detailed.centsErrors,
    volumePercent: detailed.volumePenalty,
    roughnessPercent: detailed.roughnessPenalty,
    generations: generation,
    lengthTrim: lengthAdjust,
    effectiveLength
  };
}

/**
 * Get default EA parameters based on problem size
 */
export function getDefaultEAParameters(numCuts: number): EAParameters {
  return {
    populationSize: Math.max(30, numCuts * 10),
    elitismPercent: 10,
    crossoverPercent: 30,
    mutationPercent: 60,
    mutationStrength: 0.1,
    maxGenerations: 100,
    targetError: 0.01, // 0.01% error
    numElements: 150,
    f1Priority: 1,
    minCutWidth: 0,
    maxCutWidth: 0,
    minCutDepth: 0,
    maxCutDepth: 0,
    maxLengthTrim: 0,
    maxLengthExtend: 0,
    maxCores: 0  // 0 = auto (use all available cores)
  };
}

/**
 * Estimate computation time based on parameters
 */
export function estimateComputationTime(
  populationSize: number,
  maxGenerations: number,
  numElements: number
): { minSeconds: number; maxSeconds: number } {
  // Rough estimate: ~20ms per evaluation with Ne=150
  const msPerEval = (numElements / 150) * 20;
  const totalEvals = populationSize * maxGenerations;
  const totalMs = msPerEval * totalEvals;

  return {
    minSeconds: totalMs / 1000 * 0.5,  // Best case
    maxSeconds: totalMs / 1000 * 1.5   // Worst case
  };
}
