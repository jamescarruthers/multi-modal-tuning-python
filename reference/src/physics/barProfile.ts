/**
 * Bar Profile Generation
 *
 * Implements the symmetric rectangular undercut model from the paper.
 * The undercut is defined by N cuts, each with a length (lambda_n) and height (h_n).
 *
 * Key equations from paper:
 * - Profile H(x) defined by Eq. 3
 * - Quadratic interpolation for discontinuities (Eq. 6)
 */

import { Cut, BarParameters } from '../types';

/**
 * Compute the bar profile H(x) for a given x position
 * Based on Eq. 3 from the paper
 *
 * The profile is symmetric about x = L/2 (center of bar)
 * Cuts are nested: lambda_1 > lambda_2 > ... > lambda_N > 0
 * The innermost cut (smallest lambda) that contains the point determines the height
 *
 * @param x - Position along bar (m), 0 <= x <= L
 * @param cuts - Array of cuts (will be sorted internally)
 * @param L - Bar length (m)
 * @param h0 - Original bar height (m)
 * @returns Height H(x) at position x
 */
export function computeHeight(
  x: number,
  cuts: Cut[],
  L: number,
  h0: number
): number {
  // Distance from center
  const distFromCenter = Math.abs(x - L / 2);

  // Sort cuts by lambda descending (largest first = outermost)
  const sortedCuts = [...cuts].sort((a, b) => b.lambda - a.lambda);

  // Find all cuts that contain this point, then return the innermost one's height
  // The innermost cut is the one with the smallest lambda that still contains the point
  const containingCuts = sortedCuts.filter(cut =>
    cut.lambda > 0 && distFromCenter <= cut.lambda
  );

  if (containingCuts.length === 0) {
    // Outside all cuts - return original height
    return h0;
  }

  // Return innermost (smallest lambda) containing cut
  // Since sortedCuts is descending, the last matching cut is the innermost
  return containingCuts[containingCuts.length - 1].h;
}

/**
 * Generate element heights for FEM discretization with quadratic interpolation
 * at discontinuities (Eq. 6 from paper)
 *
 * The quadratic weighting: H_i = sqrt((h_{n-1}^2 * dx1 + h_n^2 * dx2) / (dx1 + dx2))
 *
 * @param cuts - Array of cuts
 * @param L - Bar length (m)
 * @param h0 - Original height (m)
 * @param Ne - Number of finite elements
 * @returns Array of element heights (length Ne)
 */
export function generateElementHeights(
  cuts: Cut[],
  L: number,
  h0: number,
  Ne: number
): number[] {
  const Le = L / Ne;  // Element length
  const heights: number[] = [];
  const centerX = L / 2;

  // Sort cuts by lambda (descending - largest/outermost first)
  const sortedCuts = [...cuts].sort((a, b) => b.lambda - a.lambda);

  // Build list of discontinuity positions with heights on each side
  // A discontinuity occurs at each cut boundary (both left and right of center)
  const discontinuities: { pos: number; hBefore: number; hAfter: number }[] = [];

  // For each cut boundary, compute heights just before and after the boundary
  for (const cut of sortedCuts) {
    if (cut.lambda <= 0) continue;

    const leftBoundary = centerX - cut.lambda;
    const rightBoundary = centerX + cut.lambda;

    // At left boundary (moving left to right): we transition INTO this cut's region
    // hBefore = height just outside (to the left), hAfter = height just inside
    const hOutsideLeft = computeHeight(leftBoundary - 0.0001, sortedCuts, L, h0);
    const hInsideLeft = computeHeight(leftBoundary + 0.0001, sortedCuts, L, h0);
    if (Math.abs(hOutsideLeft - hInsideLeft) > 1e-9) {
      discontinuities.push({
        pos: leftBoundary,
        hBefore: hOutsideLeft,
        hAfter: hInsideLeft
      });
    }

    // At right boundary (moving left to right): we transition OUT OF this cut's region
    const hInsideRight = computeHeight(rightBoundary - 0.0001, sortedCuts, L, h0);
    const hOutsideRight = computeHeight(rightBoundary + 0.0001, sortedCuts, L, h0);
    if (Math.abs(hInsideRight - hOutsideRight) > 1e-9) {
      discontinuities.push({
        pos: rightBoundary,
        hBefore: hInsideRight,
        hAfter: hOutsideRight
      });
    }
  }

  // Sort discontinuities by position
  discontinuities.sort((a, b) => a.pos - b.pos);

  // For each element, compute the appropriate height
  for (let i = 0; i < Ne; i++) {
    const xStart = i * Le;
    const xEnd = (i + 1) * Le;
    const xMid = (xStart + xEnd) / 2;

    // Check if element contains a discontinuity
    let foundDiscontinuity = false;
    for (const disc of discontinuities) {
      if (disc.pos > xStart && disc.pos < xEnd) {
        // Element contains a discontinuity - use quadratic interpolation (Eq. 6)
        const dx1 = disc.pos - xStart;
        const dx2 = xEnd - disc.pos;
        const h1 = disc.hBefore;
        const h2 = disc.hAfter;

        // Quadratic weighting from Eq. 6
        heights.push(Math.sqrt((h1 * h1 * dx1 + h2 * h2 * dx2) / (dx1 + dx2)));
        foundDiscontinuity = true;
        break;
      }
    }

    if (!foundDiscontinuity) {
      // No discontinuity in this element - use height at midpoint
      heights.push(computeHeight(xMid, sortedCuts, L, h0));
    }
  }

  return heights;
}

/**
 * Convert genes array to cuts array
 * Genes format: [lambda_1, h_1, lambda_2, h_2, ..., lengthAdjust?]
 * Note: genes may have an optional trailing lengthAdjust value that should be ignored
 *
 * @param genes - Flat array of optimization variables
 * @returns Array of Cut objects
 */
export function genesToCuts(genes: number[]): Cut[] {
  const cuts: Cut[] = [];
  // Process pairs of genes (lambda, h) - stop before incomplete pair
  // This handles the optional trailing lengthAdjust gene
  for (let i = 0; i + 1 < genes.length; i += 2) {
    const lambda = genes[i];
    const h = genes[i + 1];
    // Only add valid cuts (skip any NaN or undefined values)
    if (typeof lambda === 'number' && typeof h === 'number' &&
        !isNaN(lambda) && !isNaN(h)) {
      cuts.push({ lambda, h });
    }
  }
  // Sort by lambda descending (largest first)
  return cuts.sort((a, b) => b.lambda - a.lambda);
}

/**
 * Convert cuts array to genes array
 * Cuts are sorted by lambda (descending) before conversion
 *
 * @param cuts - Array of Cut objects
 * @returns Flat array of genes [lambda_1, h_1, lambda_2, h_2, ...]
 */
export function cutsToGenes(cuts: Cut[]): number[] {
  // Sort by lambda descending
  const sortedCuts = [...cuts].sort((a, b) => b.lambda - a.lambda);
  const genes: number[] = [];
  for (const cut of sortedCuts) {
    genes.push(cut.lambda, cut.h);
  }
  return genes;
}

/**
 * Compute the effective number of cuts (ignoring cuts that are inside others)
 * If lambda_n >= lambda_{n-1}, the outer cut becomes inconsequential
 */
export function countEffectiveCuts(cuts: Cut[]): number {
  // Sort by lambda descending
  const sorted = [...cuts].sort((a, b) => b.lambda - a.lambda);

  let effectiveCount = 0;
  let lastLambda = Infinity;

  for (const cut of sorted) {
    if (cut.lambda < lastLambda && cut.lambda > 0) {
      effectiveCount++;
      lastLambda = cut.lambda;
    }
  }

  return effectiveCount;
}

/**
 * Validate cuts are within bounds
 */
export function validateCuts(
  cuts: Cut[],
  bar: BarParameters
): { valid: boolean; message?: string } {
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];

    if (cut.lambda < 0 || cut.lambda > bar.L / 2) {
      return {
        valid: false,
        message: `Cut ${i + 1} lambda (${cut.lambda}) out of bounds [0, ${bar.L / 2}]`
      };
    }

    if (cut.h < bar.hMin || cut.h > bar.h0) {
      return {
        valid: false,
        message: `Cut ${i + 1} height (${cut.h}) out of bounds [${bar.hMin}, ${bar.h0}]`
      };
    }
  }

  return { valid: true };
}

/**
 * Generate profile points for visualization
 * Returns an array of [x, h] pairs representing the profile shape
 *
 * @param cuts - Array of cuts
 * @param L - Bar length (m)
 * @param h0 - Original height (m)
 * @param numPoints - Number of points for smooth visualization
 * @returns Array of [x, h] coordinate pairs
 */
export function generateProfilePoints(
  cuts: Cut[],
  L: number,
  h0: number,
  numPoints: number = 200
): [number, number][] {
  const points: [number, number][] = [];
  const sortedCuts = [...cuts].sort((a, b) => b.lambda - a.lambda);

  // Generate points from left to right
  for (let i = 0; i <= numPoints; i++) {
    const x = (i / numPoints) * L;
    const h = computeHeight(x, sortedCuts, L, h0);
    points.push([x, h]);
  }

  // Add extra points at discontinuities for crisp edges
  const extraPoints: [number, number][] = [];
  for (const cut of sortedCuts) {
    const leftEdge = L / 2 - cut.lambda;
    const rightEdge = L / 2 + cut.lambda;

    // Add points just before and after each discontinuity
    const epsilon = L / 10000;

    if (leftEdge > 0 && leftEdge < L) {
      extraPoints.push([leftEdge - epsilon, computeHeight(leftEdge - epsilon, sortedCuts, L, h0)]);
      extraPoints.push([leftEdge + epsilon, computeHeight(leftEdge + epsilon, sortedCuts, L, h0)]);
    }

    if (rightEdge > 0 && rightEdge < L) {
      extraPoints.push([rightEdge - epsilon, computeHeight(rightEdge - epsilon, sortedCuts, L, h0)]);
      extraPoints.push([rightEdge + epsilon, computeHeight(rightEdge + epsilon, sortedCuts, L, h0)]);
    }
  }

  // Merge and sort all points by x
  const allPoints = [...points, ...extraPoints].sort((a, b) => a[0] - b[0]);

  return allPoints;
}
