/**
 * Bar Length Finder Utility
 *
 * Uses binary search to find optimal bar length for a target fundamental frequency.
 * The physics relationship: f1 is proportional to h/L² for a uniform bar.
 * Longer bars -> lower frequencies, shorter bars -> higher frequencies.
 */

import { Material, BarParameters, BarLengthResult } from '../types';
import { computeFrequenciesFromGenes } from '../physics/frequencies';
import { NoteInfo, frequencyErrorCents } from './noteUtils';

/**
 * Compute f1 for a uniform bar (no cuts) at given length
 *
 * @param length - Bar length in mm
 * @param width - Bar width in mm
 * @param thickness - Bar thickness in mm
 * @param material - Material properties
 * @param numElements - Number of FEM elements (default: 80)
 * @returns Fundamental frequency f1 in Hz
 */
export function computeF1ForUniformBar(
  length: number,
  width: number,
  thickness: number,
  material: Material,
  numElements: number = 80
): number {
  // Convert mm to meters for physics calculations
  const bar: BarParameters = {
    L: length / 1000,
    b: width / 1000,
    h0: thickness / 1000,
    hMin: thickness / 10000  // 10% of thickness
  };

  // Empty genes = uniform bar with no cuts
  const genes: number[] = [];

  const frequencies = computeFrequenciesFromGenes(
    genes,
    bar,
    material,
    1,           // Only need f1
    numElements,
    0            // 0 cuts
  );

  return frequencies[0] || 0;
}

/**
 * Result of binary search for optimal bar length
 */
export interface LengthSearchResult {
  length: number;         // Optimal length in mm
  computedFreq: number;   // f1 at optimal length (Hz)
  iterations: number;     // Number of search iterations
  errorCents: number;     // Error in cents
}

/**
 * Find optimal bar length for a target frequency using binary search
 *
 * Uses the fact that f1 decreases monotonically with length:
 * - If computed f1 is too high, need a longer bar (search upper half)
 * - If computed f1 is too low, need a shorter bar (search lower half)
 *
 * @param targetFrequency - Target fundamental frequency in Hz
 * @param width - Bar width in mm
 * @param thickness - Bar thickness in mm
 * @param material - Material properties
 * @param minLength - Minimum bar length to search (mm)
 * @param maxLength - Maximum bar length to search (mm)
 * @param toleranceCents - Stop search when within this tolerance (cents)
 * @param maxIterations - Maximum search iterations
 * @param numElements - Number of FEM elements
 * @returns Search result with optimal length and computed frequency
 */
export function findOptimalLength(
  targetFrequency: number,
  width: number,
  thickness: number,
  material: Material,
  minLength: number,
  maxLength: number,
  toleranceCents: number = 1,
  maxIterations: number = 50,
  numElements: number = 80
): LengthSearchResult {
  let low = minLength;
  let high = maxLength;
  let iterations = 0;
  let bestLength = (low + high) / 2;
  let bestFreq = 0;
  let bestError = Infinity;

  // Check bounds first
  const fAtMin = computeF1ForUniformBar(minLength, width, thickness, material, numElements);
  const fAtMax = computeF1ForUniformBar(maxLength, width, thickness, material, numElements);

  // f1 decreases with length, so fAtMin > fAtMax
  // If target is outside this range, return the closest bound
  if (targetFrequency >= fAtMin) {
    return {
      length: minLength,
      computedFreq: fAtMin,
      iterations: 1,
      errorCents: frequencyErrorCents(fAtMin, targetFrequency)
    };
  }
  if (targetFrequency <= fAtMax) {
    return {
      length: maxLength,
      computedFreq: fAtMax,
      iterations: 1,
      errorCents: frequencyErrorCents(fAtMax, targetFrequency)
    };
  }

  // Binary search
  while (iterations < maxIterations && high - low > 0.01) {  // 0.01mm precision
    iterations++;
    const mid = (low + high) / 2;
    const f1 = computeF1ForUniformBar(mid, width, thickness, material, numElements);

    const errorCents = frequencyErrorCents(f1, targetFrequency);

    if (Math.abs(errorCents) < Math.abs(bestError)) {
      bestLength = mid;
      bestFreq = f1;
      bestError = errorCents;
    }

    // Check if within tolerance
    if (Math.abs(errorCents) <= toleranceCents) {
      break;
    }

    // f1 decreases with length, so:
    // If computed f1 is too high, need longer bar -> search upper half
    // If computed f1 is too low, need shorter bar -> search lower half
    if (f1 > targetFrequency) {
      low = mid;  // Need longer bar (lower frequency)
    } else {
      high = mid; // Need shorter bar (higher frequency)
    }
  }

  return {
    length: bestLength,
    computedFreq: bestFreq,
    iterations,
    errorCents: bestError
  };
}

/**
 * Find optimal lengths for all notes in a range
 *
 * @param notes - Array of notes to find lengths for
 * @param width - Bar width in mm
 * @param thickness - Bar thickness in mm
 * @param material - Material properties
 * @param minLength - Minimum bar length to search (mm)
 * @param maxLength - Maximum bar length to search (mm)
 * @param toleranceCents - Acceptable frequency error in cents
 * @param numElements - Number of FEM elements
 * @param onProgress - Callback for progress updates
 * @returns Array of results for each note
 */
export function findLengthsForNotes(
  notes: NoteInfo[],
  width: number,
  thickness: number,
  material: Material,
  minLength: number,
  maxLength: number,
  toleranceCents: number = 1,
  numElements: number = 80,
  onProgress?: (note: string, index: number, total: number) => void
): BarLengthResult[] {
  const results: BarLengthResult[] = [];

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];

    if (onProgress) {
      onProgress(note.name, i, notes.length);
    }

    const result = findOptimalLength(
      note.frequency,
      width,
      thickness,
      material,
      minLength,
      maxLength,
      toleranceCents,
      50,
      numElements
    );

    results.push({
      note: {
        name: note.name,
        frequency: note.frequency,
        midiNumber: note.midiNumber
      },
      targetFrequency: note.frequency,
      optimalLength: result.length,
      computedFrequency: result.computedFreq,
      errorCents: result.errorCents,
      searchIterations: result.iterations,
      selected: false
    });
  }

  return results;
}

/**
 * Estimate bar length from Euler-Bernoulli beam theory
 * This is an approximation - actual frequency depends on exact boundary conditions
 * and Timoshenko corrections for thick bars.
 *
 * f1 = (beta^2 / (2*pi)) * sqrt(E*I / (rho*A*L^4))
 * where beta ≈ 4.73 for first mode of free-free beam
 *
 * Rearranging for L:
 * L = ((beta^2 / (2*pi*f1))^2 * E*I / (rho*A))^0.25
 *
 * For rectangular cross-section: I = b*h^3/12, A = b*h
 *
 * @param targetFrequency - Target f1 in Hz
 * @param width - Bar width in mm
 * @param thickness - Bar thickness in mm
 * @param material - Material properties
 * @returns Estimated bar length in mm
 */
export function estimateLengthFromTheory(
  targetFrequency: number,
  width: number,
  thickness: number,
  material: Material
): number {
  const beta1 = 4.73004074;  // First mode eigenvalue for free-free beam
  const E = material.E;       // Pa
  const rho = material.rho;   // kg/m³

  // Convert mm to m
  const b = width / 1000;
  const h = thickness / 1000;

  // Second moment of area for rectangular cross-section
  const I = (b * Math.pow(h, 3)) / 12;  // m^4
  const A = b * h;                        // m^2

  // From Euler-Bernoulli: f = (beta^2 / (2*pi*L^2)) * sqrt(E*I / (rho*A))
  // Rearranging: L^2 = (beta^2 / (2*pi*f)) * sqrt(E*I / (rho*A))
  // L = sqrt((beta^2 / (2*pi*f)) * sqrt(E*I / (rho*A)))

  const factor = Math.pow(beta1, 2) / (2 * Math.PI * targetFrequency);
  const stiffnessTerm = Math.sqrt((E * I) / (rho * A));
  const L = Math.sqrt(factor * stiffnessTerm);

  // Convert back to mm
  return L * 1000;
}
