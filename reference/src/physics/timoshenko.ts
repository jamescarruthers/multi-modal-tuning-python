/**
 * Timoshenko Beam Element Matrices
 *
 * Implements the Timoshenko beam theory from the paper (Eq. 1)
 * Each element has 2 nodes with 2 DOF per node: transverse displacement y and rotation phi
 * This results in 4x4 element stiffness and mass matrices.
 *
 * The Timoshenko model accounts for shear deformation, which is important
 * for non-slender beams like marimba bars.
 */

import { ElementMatrices } from '../types';
import { KAPPA, calculateShearModulus } from '../data/materials';

/**
 * Compute Timoshenko beam element stiffness and mass matrices
 *
 * @param Le - Element length (m)
 * @param H - Element height/thickness (m)
 * @param b - Bar width (m)
 * @param E - Young's modulus (Pa)
 * @param rho - Density (kg/m^3)
 * @param nu - Poisson's ratio
 * @returns Object containing 4x4 Ke (stiffness) and Me (mass) matrices
 */
export function computeTimoshenkoElement(
  Le: number,
  H: number,
  b: number,
  E: number,
  rho: number,
  nu: number
): ElementMatrices {
  // Cross-sectional properties
  const A = b * H;                    // Cross-sectional area
  const I = (b * H * H * H) / 12;     // Second moment of area
  const G = calculateShearModulus(E, nu);  // Shear modulus
  const kappa = KAPPA;                // Shear correction factor (5/6)

  // Timoshenko shear parameter
  // Phi = 12*E*I / (kappa*G*A*Le^2)
  const phi = (12 * E * I) / (kappa * G * A * Le * Le);

  // Stiffness matrix coefficients
  const EI = E * I;
  const L = Le;
  const L2 = L * L;
  const L3 = L * L * L;
  const denom = (1 + phi);

  // Element stiffness matrix [Ke]
  // DOF order: [y1, phi1, y2, phi2]
  // Based on consistent Timoshenko beam element formulation
  const Ke: number[][] = [
    [12 * EI / (L3 * denom),      6 * EI / (L2 * denom),     -12 * EI / (L3 * denom),     6 * EI / (L2 * denom)],
    [6 * EI / (L2 * denom),       (4 + phi) * EI / (L * denom), -6 * EI / (L2 * denom),    (2 - phi) * EI / (L * denom)],
    [-12 * EI / (L3 * denom),     -6 * EI / (L2 * denom),    12 * EI / (L3 * denom),      -6 * EI / (L2 * denom)],
    [6 * EI / (L2 * denom),       (2 - phi) * EI / (L * denom), -6 * EI / (L2 * denom),   (4 + phi) * EI / (L * denom)]
  ];

  // Element mass matrix [Me]
  // Consistent mass matrix including rotary inertia for Timoshenko beam
  const rhoA = rho * A;
  const rhoI = rho * I;

  // Mass matrix with rotary inertia (Timoshenko formulation)
  // Simplified consistent mass matrix
  const m1 = rhoA * L / 420;
  const m2 = rhoI / (30 * L);

  // Translational mass contributions
  const a1 = 156 * m1;
  const a2 = 22 * L * m1;
  const a3 = 54 * m1;
  const a4 = -13 * L * m1;

  // Rotational mass contributions
  const b1 = 4 * L * L * m1 + 36 * m2;
  const b2 = 3 * L * L * m1 - 36 * m2;
  const b3 = -3 * L * m2;

  const Me: number[][] = [
    [a1,        a2,        a3,        a4      ],
    [a2,        b1,        -a4,       b2      ],
    [a3,        -a4,       a1,        -a2     ],
    [a4,        b2,        -a2,       b1      ]
  ];

  // Add rotary inertia corrections for Timoshenko beam
  // These corrections become significant for thick beams
  const phi2 = phi * phi;
  const denom2 = (1 + phi) * (1 + phi);

  // Additional mass matrix terms for consistency with Timoshenko theory
  const Me_corrected = Me.map((row, i) =>
    row.map((val, j) => {
      // Scale mass matrix to account for shear deformation effects
      // This is a simplification - full Timoshenko mass matrix is more complex
      return val / denom2 + (phi > 0.01 ? phi2 * rhoA * L * (i === j ? 0.01 : 0) : 0);
    })
  );

  return { Ke, Me: Me_corrected };
}

/**
 * Compute element matrices for a set of elements with varying heights
 * This is useful when computing the full bar model
 *
 * @param heights - Array of element heights (m)
 * @param Le - Element length (m)
 * @param b - Bar width (m)
 * @param E - Young's modulus (Pa)
 * @param rho - Density (kg/m^3)
 * @param nu - Poisson's ratio
 * @returns Array of element matrices
 */
export function computeAllElementMatrices(
  heights: number[],
  Le: number,
  b: number,
  E: number,
  rho: number,
  nu: number
): ElementMatrices[] {
  // Cache computed matrices for identical heights to improve performance
  const cache = new Map<number, ElementMatrices>();

  return heights.map(H => {
    // Round height to avoid floating point issues in cache lookup
    const roundedH = Math.round(H * 1e8) / 1e8;

    if (cache.has(roundedH)) {
      return cache.get(roundedH)!;
    }

    const matrices = computeTimoshenkoElement(Le, H, b, E, rho, nu);
    cache.set(roundedH, matrices);
    return matrices;
  });
}

/**
 * Validate that element dimensions are physically reasonable
 */
export function validateElementParams(
  Le: number,
  H: number,
  b: number,
  E: number,
  rho: number
): { valid: boolean; message?: string } {
  if (Le <= 0) return { valid: false, message: 'Element length must be positive' };
  if (H <= 0) return { valid: false, message: 'Element height must be positive' };
  if (b <= 0) return { valid: false, message: 'Bar width must be positive' };
  if (E <= 0) return { valid: false, message: "Young's modulus must be positive" };
  if (rho <= 0) return { valid: false, message: 'Density must be positive' };

  // Check for reasonable aspect ratio
  const aspectRatio = Le / H;
  if (aspectRatio < 0.1 || aspectRatio > 100) {
    return { valid: false, message: `Element aspect ratio ${aspectRatio.toFixed(2)} is outside reasonable range [0.1, 100]` };
  }

  return { valid: true };
}
