/**
 * Finite Element Assembly
 *
 * Assembles global stiffness [K] and mass [M] matrices from element matrices.
 * The bar is modeled as a series of Ne Timoshenko beam elements.
 *
 * DOF numbering: [y_1, phi_1, y_2, phi_2, ..., y_{N+1}, phi_{N+1}]
 * where N = Ne (number of elements), so there are N+1 nodes.
 *
 * Free-free boundary conditions: no constraints applied (naturally satisfied
 * as we don't modify any DOFs).
 */

import { Material, BarParameters, Cut } from '../types';
import { computeAllElementMatrices } from './timoshenko';
import { generateElementHeights } from './barProfile';

/**
 * Global matrix assembly result
 */
export interface GlobalMatrices {
  K: number[][];  // Global stiffness matrix
  M: number[][];  // Global mass matrix
  numDOF: number; // Total degrees of freedom
}

/**
 * Assemble global stiffness and mass matrices from element matrices
 *
 * @param elementHeights - Array of element heights (length Ne)
 * @param Le - Element length (m)
 * @param b - Bar width (m)
 * @param E - Young's modulus (Pa)
 * @param rho - Density (kg/m^3)
 * @param nu - Poisson's ratio
 * @returns Global K and M matrices
 */
export function assembleGlobalMatrices(
  elementHeights: number[],
  Le: number,
  b: number,
  E: number,
  rho: number,
  nu: number
): GlobalMatrices {
  const Ne = elementHeights.length;  // Number of elements
  const numNodes = Ne + 1;           // Number of nodes
  const numDOF = numNodes * 2;       // 2 DOF per node (y, phi)

  // Initialize global matrices with zeros
  const K: number[][] = Array(numDOF).fill(null).map(() => Array(numDOF).fill(0));
  const M: number[][] = Array(numDOF).fill(null).map(() => Array(numDOF).fill(0));

  // Compute all element matrices
  const elementMatrices = computeAllElementMatrices(
    elementHeights, Le, b, E, rho, nu
  );

  // Assemble each element into global matrices
  for (let e = 0; e < Ne; e++) {
    const { Ke, Me } = elementMatrices[e];

    // Element DOF indices in global system
    // Element e connects nodes e and e+1
    // Node e has DOFs [2*e, 2*e+1] = [y_e, phi_e]
    // Node e+1 has DOFs [2*(e+1), 2*(e+1)+1] = [y_{e+1}, phi_{e+1}]
    const dofMap = [
      2 * e,         // y_e
      2 * e + 1,     // phi_e
      2 * (e + 1),   // y_{e+1}
      2 * (e + 1) + 1 // phi_{e+1}
    ];

    // Add element contributions to global matrices
    for (let i = 0; i < 4; i++) {
      const gi = dofMap[i];
      for (let j = 0; j < 4; j++) {
        const gj = dofMap[j];
        K[gi][gj] += Ke[i][j];
        M[gi][gj] += Me[i][j];
      }
    }
  }

  return { K, M, numDOF };
}

/**
 * Assemble global matrices from cuts and bar parameters
 * Convenience function that generates element heights internally
 *
 * @param cuts - Array of rectangular cuts
 * @param bar - Bar parameters
 * @param material - Material properties
 * @param Ne - Number of finite elements
 * @returns Global K and M matrices
 */
export function assembleFromCuts(
  cuts: Cut[],
  bar: BarParameters,
  material: Material,
  Ne: number
): GlobalMatrices {
  // Generate element heights
  const elementHeights = generateElementHeights(cuts, bar.L, bar.h0, Ne);

  // Element length
  const Le = bar.L / Ne;

  return assembleGlobalMatrices(
    elementHeights,
    Le,
    bar.b,
    material.E,
    material.rho,
    material.nu
  );
}

/**
 * Create a deep copy of a matrix
 */
export function copyMatrix(matrix: number[][]): number[][] {
  return matrix.map(row => [...row]);
}

/**
 * Matrix-vector multiplication
 */
export function matVecMul(A: number[][], x: number[]): number[] {
  const n = A.length;
  const result = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < A[i].length; j++) {
      result[i] += A[i][j] * x[j];
    }
  }
  return result;
}

/**
 * Matrix-matrix multiplication C = A * B
 */
export function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const n = B[0].length;
  const p = B.length;

  const C: number[][] = Array(m).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < p; k++) {
        C[i][j] += A[i][k] * B[k][j];
      }
    }
  }

  return C;
}

/**
 * Transpose a matrix
 */
export function transpose(A: number[][]): number[][] {
  const m = A.length;
  const n = A[0].length;
  const T: number[][] = Array(n).fill(null).map(() => Array(m).fill(0));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      T[j][i] = A[i][j];
    }
  }

  return T;
}

/**
 * Check if a matrix is symmetric (within tolerance)
 */
export function isSymmetric(A: number[][], tol: number = 1e-10): boolean {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(A[i][j] - A[j][i]) > tol * Math.max(Math.abs(A[i][j]), 1)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Make a matrix symmetric by averaging A and A^T
 */
export function symmetrize(A: number[][]): number[][] {
  const n = A.length;
  const S: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      S[i][j] = (A[i][j] + A[j][i]) / 2;
    }
  }

  return S;
}

/**
 * Get the diagonal elements of a matrix
 */
export function getDiagonal(A: number[][]): number[] {
  return A.map((row, i) => row[i]);
}

/**
 * Create an identity matrix of size n
 */
export function identity(n: number): number[][] {
  const I: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    I[i][i] = 1;
  }
  return I;
}
