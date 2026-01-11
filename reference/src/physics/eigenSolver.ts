/**
 * Eigenvalue Solver for Generalized Eigenvalue Problem
 *
 * Solves the generalized eigenvalue problem from FEM:
 * ([K] - omega^2 [M]) {phi} = 0
 *
 * This is equivalent to: [K]{phi} = lambda [M]{phi} where lambda = omega^2
 *
 * Strategy:
 * Use the generalized eigenvalue approach by computing M^{-1} K
 * and solving the standard eigenvalue problem.
 */

import { Matrix, EigenvalueDecomposition, inverse, solve } from 'ml-matrix';
import { GlobalMatrices } from './femAssembly';

/**
 * Result of eigenvalue computation
 */
export interface EigenResult {
  eigenvalues: number[];      // omega^2 values
  frequencies: number[];      // Natural frequencies in Hz
  eigenvectors?: number[][];  // Mode shapes (optional)
}

/**
 * Solve the generalized eigenvalue problem [K]{phi} = lambda[M]{phi}
 *
 * @param globalMatrices - Global K and M matrices from FEM assembly
 * @param numModes - Number of modes to extract (default: 10)
 * @param computeVectors - Whether to compute eigenvectors (mode shapes)
 * @returns Eigenvalues (omega^2) and frequencies (Hz)
 */
export function solveEigenvalueProblem(
  globalMatrices: GlobalMatrices,
  numModes: number = 10,
  computeVectors: boolean = false
): EigenResult {
  const { K, M, numDOF } = globalMatrices;

  // Convert to ml-matrix Matrix objects
  const Kmat = new Matrix(K);
  const Mmat = new Matrix(M);

  // Add small regularization to M for numerical stability
  const epsilon = 1e-10;
  for (let i = 0; i < numDOF; i++) {
    Mmat.set(i, i, Mmat.get(i, i) + epsilon);
  }

  // Compute M^{-1} * K to convert to standard eigenvalue problem
  // [K]{phi} = lambda[M]{phi}  =>  M^{-1}K{phi} = lambda{phi}
  let Minv: Matrix;
  try {
    Minv = inverse(Mmat);
  } catch {
    // If direct inverse fails, add more regularization
    for (let i = 0; i < numDOF; i++) {
      Mmat.set(i, i, Mmat.get(i, i) + 1e-6);
    }
    Minv = inverse(Mmat);
  }

  const A = Minv.mmul(Kmat);

  // Symmetrize to avoid numerical issues
  const Asym = A.add(A.transpose()).mul(0.5);

  // Solve standard eigenvalue problem
  const eig = new EigenvalueDecomposition(Asym);

  // Get eigenvalues (these are lambda = omega^2)
  const realEigenvalues = eig.realEigenvalues;

  // Create array of {index, value} for sorting
  const indexed = realEigenvalues.map((val, idx) => ({ idx, val }));

  // Sort by eigenvalue (ascending)
  indexed.sort((a, b) => a.val - b.val);

  // Skip rigid body modes (first 2 near-zero eigenvalues for free-free beam)
  const rigidBodyThreshold = 1e-4;
  const elasticModes = indexed.filter(item => item.val > rigidBodyThreshold);

  // Extract the requested number of modes
  const selectedModes = elasticModes.slice(0, Math.min(numModes, elasticModes.length));

  // Convert eigenvalues to frequencies
  const eigenvalues = selectedModes.map(item => item.val);
  const frequencies = eigenvalues.map(lambda => {
    const omega = Math.sqrt(Math.max(0, lambda));  // omega = sqrt(lambda)
    return omega / (2 * Math.PI);                   // f = omega / (2*pi)
  });

  // Optionally compute eigenvectors (mode shapes)
  let eigenvectors: number[][] | undefined;
  if (computeVectors) {
    const V = eig.eigenvectorMatrix;
    eigenvectors = selectedModes.map(item => {
      return V.getColumn(item.idx);
    });
  }

  return {
    eigenvalues,
    frequencies,
    eigenvectors
  };
}

/**
 * Compute natural frequencies for a given bar configuration
 * This is a convenience function that combines FEM assembly and eigenvalue solving
 *
 * @param K - Global stiffness matrix
 * @param M - Global mass matrix
 * @param numModes - Number of modes to extract
 * @returns Natural frequencies in Hz
 */
export function computeNaturalFrequencies(
  K: number[][],
  M: number[][],
  numModes: number = 10
): number[] {
  const numDOF = K.length;
  const result = solveEigenvalueProblem({ K, M, numDOF }, numModes, false);
  return result.frequencies;
}

/**
 * Validate eigenvalue results
 * Check that frequencies are positive and in ascending order
 */
export function validateEigenResult(result: EigenResult): { valid: boolean; message?: string } {
  const { frequencies } = result;

  if (frequencies.length === 0) {
    return { valid: false, message: 'No eigenvalues computed' };
  }

  // Check for negative frequencies
  if (frequencies.some(f => f < 0)) {
    return { valid: false, message: 'Negative frequencies detected' };
  }

  // Check for NaN
  if (frequencies.some(f => isNaN(f))) {
    return { valid: false, message: 'NaN frequencies detected' };
  }

  // Check ascending order
  for (let i = 1; i < frequencies.length; i++) {
    if (frequencies[i] < frequencies[i - 1]) {
      return { valid: false, message: 'Frequencies not in ascending order' };
    }
  }

  return { valid: true };
}

/**
 * Estimate the fundamental frequency of a uniform bar (for validation)
 * Using Euler-Bernoulli theory: f_1 = (beta_1)^2 / (2*pi*L^2) * sqrt(EI/(rho*A))
 * where beta_1 = 4.730 for free-free boundary conditions
 */
export function estimateUniformBarFrequency(
  L: number,    // Length (m)
  b: number,    // Width (m)
  h: number,    // Height (m)
  E: number,    // Young's modulus (Pa)
  rho: number   // Density (kg/m^3)
): number {
  const A = b * h;
  const I = (b * h * h * h) / 12;
  const beta1 = 4.730041;  // First mode parameter for free-free beam

  const f1 = (beta1 * beta1 / (2 * Math.PI * L * L)) * Math.sqrt(E * I / (rho * A));

  return f1;
}
