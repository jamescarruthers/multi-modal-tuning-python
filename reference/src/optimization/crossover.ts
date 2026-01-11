/**
 * Crossover Operators for Evolutionary Algorithm
 *
 * Implements heuristic crossover (Eq. 16 from paper)
 * and other crossover strategies.
 */

import { Individual, VariableBounds } from '../types';
import { clampToBounds } from './population';

/**
 * Heuristic crossover from Eq. 16
 *
 * c1 = p1 + r * (p2 - p1)
 * c2 = p2 + r * (p1 - p2)
 *
 * where r is uniform random [0, 1]
 *
 * @param parent1 - First parent
 * @param parent2 - Second parent
 * @param bounds - Variable bounds for clamping
 * @returns Two children
 */
export function heuristicCrossover(
  parent1: Individual,
  parent2: Individual,
  bounds: VariableBounds
): [Individual, Individual] {
  const numGenes = parent1.genes.length;
  const r = Math.random();

  const child1Genes: number[] = new Array(numGenes);
  const child2Genes: number[] = new Array(numGenes);

  for (let i = 0; i < numGenes; i++) {
    const p1 = parent1.genes[i];
    const p2 = parent2.genes[i];

    child1Genes[i] = p1 + r * (p2 - p1);
    child2Genes[i] = p2 + r * (p1 - p2);
  }

  // Clamp to bounds
  const clampedChild1 = clampToBounds(child1Genes, bounds);
  const clampedChild2 = clampToBounds(child2Genes, bounds);

  // Handle sigmas for self-adaptive mutation
  let child1Sigmas: number[] | undefined;
  let child2Sigmas: number[] | undefined;

  if (parent1.sigmas && parent2.sigmas) {
    child1Sigmas = parent1.sigmas.map((s1, i) => {
      const s2 = parent2.sigmas![i];
      return s1 + r * (s2 - s1);
    });
    child2Sigmas = parent2.sigmas.map((s2, i) => {
      const s1 = parent1.sigmas![i];
      return s2 + r * (s1 - s2);
    });
  }

  return [
    { genes: clampedChild1, fitness: Infinity, sigmas: child1Sigmas },
    { genes: clampedChild2, fitness: Infinity, sigmas: child2Sigmas }
  ];
}

/**
 * Single-point crossover
 * Genes are swapped after a random crossover point
 *
 * @param parent1 - First parent
 * @param parent2 - Second parent
 * @param bounds - Variable bounds
 * @returns Two children
 */
export function singlePointCrossover(
  parent1: Individual,
  parent2: Individual,
  bounds: VariableBounds
): [Individual, Individual] {
  const numGenes = parent1.genes.length;
  const crossoverPoint = Math.floor(Math.random() * (numGenes - 1)) + 1;

  const child1Genes = [
    ...parent1.genes.slice(0, crossoverPoint),
    ...parent2.genes.slice(crossoverPoint)
  ];

  const child2Genes = [
    ...parent2.genes.slice(0, crossoverPoint),
    ...parent1.genes.slice(crossoverPoint)
  ];

  return [
    { genes: clampToBounds(child1Genes, bounds), fitness: Infinity },
    { genes: clampToBounds(child2Genes, bounds), fitness: Infinity }
  ];
}

/**
 * Two-point crossover
 * Genes between two random points are swapped
 */
export function twoPointCrossover(
  parent1: Individual,
  parent2: Individual,
  bounds: VariableBounds
): [Individual, Individual] {
  const numGenes = parent1.genes.length;

  let point1 = Math.floor(Math.random() * numGenes);
  let point2 = Math.floor(Math.random() * numGenes);

  if (point1 > point2) {
    [point1, point2] = [point2, point1];
  }

  const child1Genes = [
    ...parent1.genes.slice(0, point1),
    ...parent2.genes.slice(point1, point2),
    ...parent1.genes.slice(point2)
  ];

  const child2Genes = [
    ...parent2.genes.slice(0, point1),
    ...parent1.genes.slice(point1, point2),
    ...parent2.genes.slice(point2)
  ];

  return [
    { genes: clampToBounds(child1Genes, bounds), fitness: Infinity },
    { genes: clampToBounds(child2Genes, bounds), fitness: Infinity }
  ];
}

/**
 * Uniform crossover
 * Each gene is randomly chosen from either parent
 */
export function uniformCrossover(
  parent1: Individual,
  parent2: Individual,
  bounds: VariableBounds,
  mixingRatio: number = 0.5
): [Individual, Individual] {
  const numGenes = parent1.genes.length;

  const child1Genes: number[] = new Array(numGenes);
  const child2Genes: number[] = new Array(numGenes);

  for (let i = 0; i < numGenes; i++) {
    if (Math.random() < mixingRatio) {
      child1Genes[i] = parent1.genes[i];
      child2Genes[i] = parent2.genes[i];
    } else {
      child1Genes[i] = parent2.genes[i];
      child2Genes[i] = parent1.genes[i];
    }
  }

  return [
    { genes: clampToBounds(child1Genes, bounds), fitness: Infinity },
    { genes: clampToBounds(child2Genes, bounds), fitness: Infinity }
  ];
}

/**
 * Blend crossover (BLX-alpha)
 * Children are generated in an extended range around parents
 *
 * @param alpha - Extension parameter (default 0.5)
 */
export function blendCrossover(
  parent1: Individual,
  parent2: Individual,
  bounds: VariableBounds,
  alpha: number = 0.5
): [Individual, Individual] {
  const numGenes = parent1.genes.length;

  const child1Genes: number[] = new Array(numGenes);
  const child2Genes: number[] = new Array(numGenes);

  for (let i = 0; i < numGenes; i++) {
    const p1 = parent1.genes[i];
    const p2 = parent2.genes[i];

    const min = Math.min(p1, p2);
    const max = Math.max(p1, p2);
    const range = max - min;

    const extendedMin = min - alpha * range;
    const extendedMax = max + alpha * range;

    child1Genes[i] = extendedMin + Math.random() * (extendedMax - extendedMin);
    child2Genes[i] = extendedMin + Math.random() * (extendedMax - extendedMin);
  }

  return [
    { genes: clampToBounds(child1Genes, bounds), fitness: Infinity },
    { genes: clampToBounds(child2Genes, bounds), fitness: Infinity }
  ];
}

/**
 * Perform crossover on multiple parent pairs
 *
 * @param pairs - Array of parent pairs
 * @param bounds - Variable bounds
 * @param method - Crossover method to use
 * @returns Array of children
 */
export function performCrossover(
  pairs: [Individual, Individual][],
  bounds: VariableBounds,
  method: 'heuristic' | 'single' | 'two' | 'uniform' | 'blend' = 'heuristic'
): Individual[] {
  const crossoverFn = {
    heuristic: heuristicCrossover,
    single: singlePointCrossover,
    two: twoPointCrossover,
    uniform: uniformCrossover,
    blend: blendCrossover
  }[method];

  const children: Individual[] = [];

  for (const [parent1, parent2] of pairs) {
    const [child1, child2] = crossoverFn(parent1, parent2, bounds);
    children.push(child1, child2);
  }

  return children;
}
