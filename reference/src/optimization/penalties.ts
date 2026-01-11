/**
 * Geometric Penalties for Optimization
 *
 * Implements volumetric and roughness penalties from the paper
 * to generate more manufacture-friendly geometries.
 */

import { Cut } from '../types';

/**
 * Compute the volumetric penalty (Eq. 10 from paper)
 *
 * V = 100 * (2 / h0*L) * integral(h0 - H(x)) dx
 *
 * This represents the percentage of volume extracted from the bar.
 * For rectangular cuts, this simplifies to sum of cut volumes.
 *
 * @param cuts - Array of rectangular cuts
 * @param L - Bar length (m)
 * @param h0 - Original bar height (m)
 * @returns Volume penalty as percentage (0-100)
 */
export function computeVolumePenalty(
  cuts: Cut[],
  L: number,
  h0: number
): number {
  if (cuts.length === 0) return 0;

  // Sort cuts by lambda (descending - largest first)
  const sortedCuts = [...cuts].sort((a, b) => b.lambda - a.lambda);

  // Original volume (half bar, since symmetric)
  const halfBarVolume = (L / 2) * h0;

  // Calculate extracted volume from symmetric undercuts
  // Each cut extends from center outward, creating a region with reduced height
  let extractedVolume = 0;
  let prevLambda = 0;

  // Process cuts from innermost (smallest lambda) to outermost (largest lambda)
  for (let i = sortedCuts.length - 1; i >= 0; i--) {
    const cut = sortedCuts[i];

    if (cut.lambda > prevLambda && cut.lambda > 0) {
      // Width of this cut region
      const width = cut.lambda - prevLambda;

      // Height removed in this region
      const heightRemoved = h0 - cut.h;

      // Volume removed (just one side, will multiply by 2 later)
      extractedVolume += width * heightRemoved;

      prevLambda = cut.lambda;
    }
  }

  // Calculate percentage (multiply by 2 for both sides, divide by full half-bar volume)
  const volumePercent = 100 * (extractedVolume / halfBarVolume);

  return Math.max(0, Math.min(100, volumePercent));
}

/**
 * Compute the roughness penalty (Eq. 12 from paper)
 *
 * S = 100 * (1/N) * sum(|h_{n-1} - h_n| / h0)
 *
 * This represents the average height change per discontinuity,
 * normalized to the original height.
 *
 * @param cuts - Array of rectangular cuts
 * @param h0 - Original bar height (m)
 * @returns Roughness penalty as percentage
 */
export function computeRoughnessPenalty(
  cuts: Cut[],
  h0: number
): number {
  if (cuts.length === 0) return 0;

  // Sort cuts by lambda (descending - largest first)
  const sortedCuts = [...cuts].sort((a, b) => b.lambda - a.lambda);

  // Calculate sum of height changes
  let sumHeightChanges = 0;
  let numDiscontinuities = 0;

  // First discontinuity: from h0 to first (outermost) cut
  if (sortedCuts.length > 0) {
    sumHeightChanges += Math.abs(h0 - sortedCuts[0].h);
    numDiscontinuities++;
  }

  // Discontinuities between consecutive cuts
  for (let i = 1; i < sortedCuts.length; i++) {
    // Only count if this cut is actually visible (not hidden inside larger cut)
    if (sortedCuts[i].lambda < sortedCuts[i - 1].lambda) {
      sumHeightChanges += Math.abs(sortedCuts[i - 1].h - sortedCuts[i].h);
      numDiscontinuities++;
    }
  }

  // If no discontinuities, return 0
  if (numDiscontinuities === 0) return 0;

  // Calculate average roughness as percentage
  const roughnessPercent = 100 * (sumHeightChanges / (numDiscontinuities * h0));

  return roughnessPercent;
}

/**
 * Compute both penalties at once for efficiency
 */
export function computeBothPenalties(
  cuts: Cut[],
  L: number,
  h0: number
): { volume: number; roughness: number } {
  return {
    volume: computeVolumePenalty(cuts, L, h0),
    roughness: computeRoughnessPenalty(cuts, h0)
  };
}

/**
 * Estimate the minimum volume needed to achieve a tuning target
 * Based on empirical observations from the paper
 *
 * This is just a rough estimate - actual minimum depends on target ratio
 */
export function estimateMinimumVolume(
  targetRatios: number[],
  numCuts: number
): number {
  // More modes generally require more material removal
  // Unorthodox ratios (far from uniform bar ratios) require more removal

  // Uniform bar ratios (approximately)
  const uniformRatios = [1, 2.76, 5.40, 8.93, 13.34];

  let deviationSum = 0;
  for (let i = 0; i < Math.min(targetRatios.length, uniformRatios.length); i++) {
    deviationSum += Math.abs(targetRatios[i] - uniformRatios[i]) / uniformRatios[i];
  }

  // Rough estimate: 5-50% volume based on deviation
  const baseVolume = 5;
  const deviationFactor = Math.min(deviationSum * 10, 45);

  return baseVolume + deviationFactor;
}

/**
 * Get penalty description for UI
 */
export function getPenaltyDescription(
  penaltyType: 'volume' | 'roughness' | 'none',
  alpha: number
): string {
  if (penaltyType === 'none' || alpha === 0) {
    return 'No geometric penalty applied';
  }

  if (penaltyType === 'volume') {
    return `Volume penalty (α=${alpha.toFixed(2)}): Minimizes material removal`;
  }

  return `Roughness penalty (α=${alpha.toFixed(2)}): Minimizes abrupt height changes`;
}
