/**
 * Selection Operators for Evolutionary Algorithm
 *
 * Implements roulette wheel selection (Eq. 15 from paper)
 * and other selection strategies.
 */

import { Individual } from '../types';

/**
 * Roulette wheel selection (fitness proportional) from Eq. 15
 *
 * p_i = (1/e_i) / sum(1/e_j)
 *
 * Lower fitness = higher probability of selection
 *
 * @param population - Array of individuals with fitness values
 * @param numSelections - Number of individuals to select
 * @returns Selected individuals
 */
export function rouletteSelection(
  population: Individual[],
  numSelections: number
): Individual[] {
  // Filter out individuals with invalid fitness
  const validPopulation = population.filter(
    ind => isFinite(ind.fitness) && ind.fitness > 0
  );

  if (validPopulation.length === 0) {
    // Fallback: return random selection from original population
    return Array.from({ length: numSelections }, () =>
      population[Math.floor(Math.random() * population.length)]
    );
  }

  // Calculate selection probabilities (inverse of fitness)
  const inverseFitnesses = validPopulation.map(ind => 1 / ind.fitness);
  const sumInverse = inverseFitnesses.reduce((a, b) => a + b, 0);
  const probabilities = inverseFitnesses.map(inv => inv / sumInverse);

  // Calculate cumulative probabilities
  const cumulative: number[] = [];
  let cumSum = 0;
  for (const prob of probabilities) {
    cumSum += prob;
    cumulative.push(cumSum);
  }

  // Select individuals using roulette wheel
  const selected: Individual[] = [];
  for (let i = 0; i < numSelections; i++) {
    const r = Math.random();

    // Find the individual corresponding to this random number
    let selectedIndex = 0;
    for (let j = 0; j < cumulative.length; j++) {
      if (r <= cumulative[j]) {
        selectedIndex = j;
        break;
      }
    }

    selected.push(validPopulation[selectedIndex]);
  }

  return selected;
}

/**
 * Tournament selection
 * Selects the best individual from a random subset of the population
 *
 * @param population - Array of individuals
 * @param numSelections - Number of individuals to select
 * @param tournamentSize - Size of each tournament (default: 3)
 * @returns Selected individuals
 */
export function tournamentSelection(
  population: Individual[],
  numSelections: number,
  tournamentSize: number = 3
): Individual[] {
  const selected: Individual[] = [];

  for (let i = 0; i < numSelections; i++) {
    // Pick random individuals for tournament
    const tournament: Individual[] = [];
    for (let j = 0; j < tournamentSize; j++) {
      const idx = Math.floor(Math.random() * population.length);
      tournament.push(population[idx]);
    }

    // Select the best from tournament
    const winner = tournament.reduce((best, current) =>
      current.fitness < best.fitness ? current : best
    );

    selected.push(winner);
  }

  return selected;
}

/**
 * Rank-based selection
 * Selection probability based on rank rather than absolute fitness
 *
 * @param population - Array of individuals
 * @param numSelections - Number of individuals to select
 * @param selectionPressure - Higher values favor better individuals (1.0-2.0)
 * @returns Selected individuals
 */
export function rankSelection(
  population: Individual[],
  numSelections: number,
  selectionPressure: number = 1.5
): Individual[] {
  // Sort by fitness (ascending - best first)
  const sorted = [...population].sort((a, b) => a.fitness - b.fitness);
  const n = sorted.length;

  // Calculate rank-based probabilities
  // Linear ranking: p_i = (2 - s) / n + 2 * (s - 1) * (n - i) / (n * (n - 1))
  // where s is selection pressure, i is rank (0 = best)
  const probabilities = sorted.map((_, i) => {
    const rank = i;
    return (2 - selectionPressure) / n +
      2 * (selectionPressure - 1) * (n - 1 - rank) / (n * (n - 1));
  });

  // Normalize probabilities
  const sumProb = probabilities.reduce((a, b) => a + b, 0);
  const normalizedProbs = probabilities.map(p => p / sumProb);

  // Calculate cumulative probabilities
  const cumulative: number[] = [];
  let cumSum = 0;
  for (const prob of normalizedProbs) {
    cumSum += prob;
    cumulative.push(cumSum);
  }

  // Select individuals
  const selected: Individual[] = [];
  for (let i = 0; i < numSelections; i++) {
    const r = Math.random();
    let selectedIndex = 0;
    for (let j = 0; j < cumulative.length; j++) {
      if (r <= cumulative[j]) {
        selectedIndex = j;
        break;
      }
    }
    selected.push(sorted[selectedIndex]);
  }

  return selected;
}

/**
 * Select pairs for mating
 * Ensures each pair contains two different individuals
 *
 * @param population - Array of individuals
 * @param numPairs - Number of pairs to select
 * @param selectionMethod - Selection method to use
 * @returns Array of pairs [parent1, parent2]
 */
export function selectMatingPairs(
  population: Individual[],
  numPairs: number,
  selectionMethod: 'roulette' | 'tournament' | 'rank' = 'roulette'
): [Individual, Individual][] {
  const pairs: [Individual, Individual][] = [];

  const selectFn = {
    roulette: (p: Individual[], n: number) => rouletteSelection(p, n),
    tournament: (p: Individual[], n: number) => tournamentSelection(p, n),
    rank: (p: Individual[], n: number) => rankSelection(p, n)
  }[selectionMethod];

  for (let i = 0; i < numPairs; i++) {
    // Select two parents
    const [parent1] = selectFn(population, 1);

    // Keep selecting second parent until it's different
    let parent2: Individual;
    let attempts = 0;
    do {
      [parent2] = selectFn(population, 1);
      attempts++;
    } while (parent2 === parent1 && attempts < 10);

    pairs.push([parent1, parent2]);
  }

  return pairs;
}

/**
 * Elitism: select the best individuals to pass unchanged to next generation
 *
 * @param population - Current population
 * @param numElite - Number of elite individuals
 * @returns Array of elite individuals (cloned)
 */
export function selectElite(population: Individual[], numElite: number): Individual[] {
  const sorted = [...population].sort((a, b) => a.fitness - b.fitness);
  return sorted.slice(0, numElite).map(ind => ({
    genes: [...ind.genes],
    fitness: ind.fitness,
    sigmas: ind.sigmas ? [...ind.sigmas] : undefined
  }));
}
