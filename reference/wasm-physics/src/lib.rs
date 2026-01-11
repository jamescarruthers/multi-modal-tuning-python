//! WASM Physics Module for Multi-Modal Bar Tuning
//!
//! Implements Timoshenko beam FEM and eigenvalue solving for
//! computing natural frequencies of undercut bars.

use wasm_bindgen::prelude::*;
use nalgebra::{DMatrix, DVector, SymmetricEigen, Cholesky};
use std::f64::consts::PI;
use rayon::prelude::*;

// Re-export thread pool initialization for WASM
pub use wasm_bindgen_rayon::init_thread_pool;

/// Shear correction factor for rectangular cross-section
const KAPPA: f64 = 5.0 / 6.0;

/// Compute Timoshenko beam element stiffness matrix (4x4)
/// DOFs: [w1, theta1, w2, theta2] - transverse displacement and rotation
fn compute_element_stiffness(
    le: f64,      // element length
    e: f64,       // Young's modulus
    i: f64,       // second moment of area
    g: f64,       // shear modulus
    a: f64,       // cross-sectional area
) -> [[f64; 4]; 4] {
    let phi = 12.0 * e * i / (KAPPA * g * a * le * le);
    let denom = (1.0 + phi) * le * le * le;

    let k11 = 12.0 * e * i / denom;
    let k12 = 6.0 * e * i * le / denom;
    let k22 = (4.0 + phi) * e * i * le * le / denom;
    let k23 = (2.0 - phi) * e * i * le * le / denom;

    [
        [k11,   k12,  -k11,   k12],
        [k12,   k22,  -k12,   k23],
        [-k11, -k12,   k11,  -k12],
        [k12,   k23,  -k12,   k22],
    ]
}

/// Compute Timoshenko beam element mass matrix (4x4)
/// Using consistent mass matrix formulation
fn compute_element_mass(
    le: f64,      // element length
    rho: f64,     // density
    a: f64,       // cross-sectional area
    i: f64,       // second moment of area
    e: f64,       // Young's modulus
    g: f64,       // shear modulus
) -> [[f64; 4]; 4] {
    let phi = 12.0 * e * i / (KAPPA * g * a * le * le);
    let denom = (1.0 + phi).powi(2);

    // Translational mass terms
    let m = rho * a * le;

    // Rotary inertia terms
    let r2 = i / a;  // radius of gyration squared

    let c1 = (13.0/35.0 + 7.0*phi/10.0 + phi*phi/3.0) / denom;
    let c2 = (9.0/70.0 + 3.0*phi/10.0 + phi*phi/6.0) / denom;
    let c3 = (11.0/210.0 + 11.0*phi/120.0 + phi*phi/24.0) * le / denom;
    let c4 = (13.0/420.0 + 3.0*phi/40.0 + phi*phi/24.0) * le / denom;
    let c5 = (1.0/105.0 + phi/60.0 + phi*phi/120.0) * le * le / denom;
    let c6 = (1.0/140.0 + phi/60.0 + phi*phi/120.0) * le * le / denom;

    // Add rotary inertia contribution
    let r_scale = r2 / (le * le);
    let r1 = (6.0/5.0) / denom * r_scale;
    let r2_term = (2.0/15.0 + phi/6.0 + phi*phi/3.0) * le * le / denom * r_scale;
    let r3 = (1.0/10.0 - phi/2.0) * le / denom * r_scale;
    let r4 = (-1.0/30.0 - phi/6.0 + phi*phi/6.0) * le * le / denom * r_scale;

    [
        [m * (c1 + r1),     m * (c3 + r3),      m * (c2 - r1),     m * (-c4 + r3)],
        [m * (c3 + r3),     m * (c5 + r2_term), m * (c4 - r3),     m * (-c6 + r4)],
        [m * (c2 - r1),     m * (c4 - r3),      m * (c1 + r1),     m * (-c3 - r3)],
        [m * (-c4 + r3),    m * (-c6 + r4),     m * (-c3 - r3),    m * (c5 + r2_term)],
    ]
}

/// Assemble global stiffness and mass matrices from element matrices
fn assemble_global_matrices(
    element_heights: &[f64],
    le: f64,
    b: f64,
    e_modulus: f64,
    rho: f64,
    nu: f64,
) -> (DMatrix<f64>, DMatrix<f64>) {
    let ne = element_heights.len();
    let num_dof = 2 * (ne + 1);

    let mut k_global = DMatrix::<f64>::zeros(num_dof, num_dof);
    let mut m_global = DMatrix::<f64>::zeros(num_dof, num_dof);

    let g = e_modulus / (2.0 * (1.0 + nu));  // Shear modulus

    for e in 0..ne {
        let h = element_heights[e];
        let area = b * h;
        let inertia = b * h.powi(3) / 12.0;

        let ke = compute_element_stiffness(le, e_modulus, inertia, g, area);
        let me = compute_element_mass(le, rho, area, inertia, e_modulus, g);

        // DOF mapping: element DOFs [0,1,2,3] -> global DOFs [2e, 2e+1, 2e+2, 2e+3]
        let dof_map = [2*e, 2*e+1, 2*(e+1), 2*(e+1)+1];

        for i in 0..4 {
            for j in 0..4 {
                let gi = dof_map[i];
                let gj = dof_map[j];
                k_global[(gi, gj)] += ke[i][j];
                m_global[(gi, gj)] += me[i][j];
            }
        }
    }

    (k_global, m_global)
}

/// Solve generalized eigenvalue problem K*phi = lambda*M*phi
/// using inverse iteration approach: convert to M^{-1}K phi = lambda phi
fn solve_generalized_eigenvalue(
    k: &DMatrix<f64>,
    m: &DMatrix<f64>,
    num_modes: usize,
) -> Vec<f64> {
    let n = k.nrows();

    // Add small regularization to M for numerical stability
    let mut m_reg = m.clone();
    for i in 0..n {
        m_reg[(i, i)] += 1e-12 * m[(i, i)].abs().max(1e-20);
    }

    // Compute M^{-1} K using Cholesky solve
    // This converts Kφ = λMφ to (M^{-1}K)φ = λφ
    let chol = match Cholesky::new(m_reg.clone()) {
        Some(c) => c,
        None => {
            // Fallback: add more regularization
            for i in 0..n {
                m_reg[(i, i)] += 1e-8;
            }
            Cholesky::new(m_reg).expect("Cholesky decomposition failed")
        }
    };

    // Compute M^{-1}K column by column
    let mut m_inv_k = DMatrix::<f64>::zeros(n, n);
    for j in 0..n {
        let k_col = k.column(j);
        let solved = chol.solve(&DVector::from_column_slice(k_col.as_slice()));
        m_inv_k.set_column(j, &solved);
    }

    // M^{-1}K is not symmetric, but we can use regular eigenvalue decomposition
    // For symmetric M and K, eigenvalues should still be real and positive
    // Use a different approach: compute eigenvalues of symmetric problem

    // Alternative: use the fact that eigenvalues of M^{-1}K equal those of L^{-1}KL^{-T}
    // where M = LL^T. Let's compute this more carefully.
    let l = chol.l();

    // Compute L^{-1} by forward substitution (solving L*X = I)
    let mut l_inv = DMatrix::<f64>::zeros(n, n);
    for j in 0..n {
        for i in j..n {
            if i == j {
                l_inv[(i, j)] = 1.0 / l[(i, i)];
            } else {
                let mut sum = 0.0;
                for p in j..i {
                    sum += l[(i, p)] * l_inv[(p, j)];
                }
                l_inv[(i, j)] = -sum / l[(i, i)];
            }
        }
    }

    // K_tilde = L^{-1} * K * L^{-T}
    let temp = &l_inv * k;
    let k_tilde = &temp * l_inv.transpose();

    // Symmetrize to remove numerical errors
    let mut k_sym = k_tilde.clone();
    for i in 0..n {
        for j in (i+1)..n {
            let avg = (k_sym[(i, j)] + k_sym[(j, i)]) / 2.0;
            k_sym[(i, j)] = avg;
            k_sym[(j, i)] = avg;
        }
    }

    // Solve standard symmetric eigenvalue problem
    let eig = SymmetricEigen::new(k_sym);
    let eigenvalues = eig.eigenvalues;

    // Collect and sort eigenvalues
    let mut eigen_pairs: Vec<f64> = eigenvalues.iter().copied().collect();
    eigen_pairs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    // Filter out rigid body modes (very small or negative eigenvalues)
    // For a free-free beam, there are 2 rigid body modes with ~zero eigenvalues
    let threshold = 1.0;  // omega^2 = 1 rad^2/s^2 -> f = 0.16 Hz
    let elastic_modes: Vec<f64> = eigen_pairs
        .into_iter()
        .filter(|&ev| ev > threshold)
        .collect();

    // Convert eigenvalues to frequencies: f = sqrt(lambda) / (2*pi)
    elastic_modes
        .into_iter()
        .take(num_modes)
        .map(|lambda| lambda.sqrt() / (2.0 * PI))
        .collect()
}

/// Main WASM export: compute natural frequencies for a bar with given element heights
///
/// # Arguments
/// * `element_heights` - Height of each finite element (in meters)
/// * `le` - Length of each element (in meters)
/// * `b` - Bar width (in meters)
/// * `e_modulus` - Young's modulus (in Pa)
/// * `rho` - Density (in kg/m³)
/// * `nu` - Poisson's ratio
/// * `num_modes` - Number of modes to extract
///
/// # Returns
/// Vector of natural frequencies in Hz
#[wasm_bindgen]
pub fn compute_frequencies(
    element_heights: &[f64],
    le: f64,
    b: f64,
    e_modulus: f64,
    rho: f64,
    nu: f64,
    num_modes: usize,
) -> Vec<f64> {
    let (k, m) = assemble_global_matrices(element_heights, le, b, e_modulus, rho, nu);
    solve_generalized_eigenvalue(&k, &m, num_modes)
}

/// Compute frequencies directly from cut parameters (genes)
/// This combines profile generation and frequency computation
///
/// # Arguments
/// * `genes` - Flat array [lambda_1, h_1, lambda_2, h_2, ...]
/// * `bar_length` - Total bar length (m)
/// * `bar_width` - Bar width (m)
/// * `h0` - Original bar height (m)
/// * `num_elements` - Number of finite elements
/// * `e_modulus` - Young's modulus (Pa)
/// * `rho` - Density (kg/m³)
/// * `nu` - Poisson's ratio
/// * `num_modes` - Number of modes to extract
#[wasm_bindgen]
pub fn compute_frequencies_from_genes(
    genes: &[f64],
    bar_length: f64,
    bar_width: f64,
    h0: f64,
    num_elements: usize,
    e_modulus: f64,
    rho: f64,
    nu: f64,
    num_modes: usize,
) -> Vec<f64> {
    // Parse genes into cuts
    let num_cuts = genes.len() / 2;
    let mut cuts: Vec<(f64, f64)> = Vec::with_capacity(num_cuts);
    for i in 0..num_cuts {
        cuts.push((genes[2*i], genes[2*i + 1]));
    }
    // Sort by lambda descending (largest first)
    cuts.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // Generate element heights
    let le = bar_length / num_elements as f64;
    let center_x = bar_length / 2.0;

    let element_heights: Vec<f64> = (0..num_elements)
        .map(|e| {
            let x_mid = (e as f64 + 0.5) * le;
            let dist_from_center = (x_mid - center_x).abs();

            // Find all cuts that contain this point, return the innermost one's height
            // Cuts are sorted by lambda descending (largest/outermost first)
            // The innermost cut is the one with smallest lambda that still contains the point
            let mut innermost_h = h0;
            for &(lambda, h) in &cuts {
                if lambda > 0.0 && dist_from_center <= lambda {
                    // This cut contains the point - it might be the innermost
                    // Since we iterate largest-to-smallest, keep updating
                    innermost_h = h;
                }
            }
            innermost_h
        })
        .collect();

    compute_frequencies(&element_heights, le, bar_width, e_modulus, rho, nu, num_modes)
}

/// Internal version of compute_frequencies_from_genes for parallel use
fn compute_frequencies_from_genes_internal(
    genes: &[f64],
    bar_length: f64,
    bar_width: f64,
    h0: f64,
    num_elements: usize,
    e_modulus: f64,
    rho: f64,
    nu: f64,
    num_modes: usize,
) -> Vec<f64> {
    // Parse genes into cuts
    let num_cuts = genes.len() / 2;
    let mut cuts: Vec<(f64, f64)> = Vec::with_capacity(num_cuts);
    for i in 0..num_cuts {
        cuts.push((genes[2*i], genes[2*i + 1]));
    }
    // Sort by lambda descending (largest first)
    cuts.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // Generate element heights
    let le = bar_length / num_elements as f64;
    let center_x = bar_length / 2.0;

    let element_heights: Vec<f64> = (0..num_elements)
        .map(|e| {
            let x_mid = (e as f64 + 0.5) * le;
            let dist_from_center = (x_mid - center_x).abs();

            let mut innermost_h = h0;
            for &(lambda, h) in &cuts {
                if lambda > 0.0 && dist_from_center <= lambda {
                    innermost_h = h;
                }
            }
            innermost_h
        })
        .collect();

    compute_frequencies(&element_heights, le, bar_width, e_modulus, rho, nu, num_modes)
}

/// Batch compute fitness for entire population
/// This minimizes WASM boundary crossings for better performance
///
/// # Arguments
/// * `all_genes` - Flat array of all genes: [ind1_genes..., ind2_genes..., ...]
/// * `population_size` - Number of individuals
/// * `genes_per_individual` - Number of genes per individual (2 * num_cuts)
/// * `target_frequencies` - Target frequencies (Hz)
/// * `bar_length`, `bar_width`, `h0`, `num_elements` - Bar parameters
/// * `e_modulus`, `rho`, `nu` - Material properties
/// * `f1_priority` - Weight multiplier for f1 (1.0 = equal weighting, >1 prioritizes f1)
///
/// # Returns
/// Vector of fitness values for each individual
#[wasm_bindgen]
pub fn batch_compute_fitness(
    all_genes: &[f64],
    population_size: usize,
    genes_per_individual: usize,
    target_frequencies: &[f64],
    bar_length: f64,
    bar_width: f64,
    h0: f64,
    num_elements: usize,
    e_modulus: f64,
    rho: f64,
    nu: f64,
    f1_priority: f64,
) -> Vec<f64> {
    let num_modes = target_frequencies.len();

    (0..population_size)
        .into_par_iter()
        .map(|i| {
            let start = i * genes_per_individual;
            let end = start + genes_per_individual;
            let genes = &all_genes[start..end];

            let frequencies = compute_frequencies_from_genes_internal(
                genes, bar_length, bar_width, h0, num_elements,
                e_modulus, rho, nu, num_modes
            );

            // Compute weighted tuning error (modified Eq. 7)
            // f1 gets f1_priority weight, other modes get weight 1
            if frequencies.len() < num_modes {
                return f64::INFINITY;
            }

            let mut weighted_sum_sq_error = 0.0;
            let mut total_weight = 0.0;
            for m in 0..num_modes {
                let weight = if m == 0 { f1_priority } else { 1.0 };
                let rel_error = (frequencies[m] - target_frequencies[m]) / target_frequencies[m];
                weighted_sum_sq_error += weight * rel_error * rel_error;
                total_weight += weight;
            }

            if total_weight > 0.0 {
                100.0 * weighted_sum_sq_error / total_weight
            } else {
                f64::INFINITY
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uniform_bar() {
        // Test with a uniform aluminum bar
        let num_elements = 100;
        let bar_length = 0.35;  // 350mm
        let bar_width = 0.05;   // 50mm
        let h0 = 0.01;          // 10mm
        let e_modulus = 68.9e9; // Aluminum
        let rho = 2700.0;
        let nu = 0.33;

        let le = bar_length / num_elements as f64;
        let element_heights: Vec<f64> = vec![h0; num_elements];

        let frequencies = compute_frequencies(
            &element_heights, le, bar_width, e_modulus, rho, nu, 5
        );

        println!("Aluminum 350x50x10mm bar frequencies:");
        for (i, f) in frequencies.iter().enumerate() {
            println!("  Mode {}: {:.1} Hz", i+1, f);
        }

        // Should get some reasonable positive frequencies
        assert!(!frequencies.is_empty());
        assert!(frequencies[0] > 0.0);

        // Frequencies should be in ascending order
        for i in 1..frequencies.len() {
            assert!(frequencies[i] >= frequencies[i-1]);
        }
    }

    #[test]
    fn test_sapele_bar() {
        // Test with Sapele bar - known dimensions
        let num_elements = 100;
        let bar_length = 0.52;   // 520mm
        let bar_width = 0.05;    // 50mm
        let h0 = 0.025;          // 25mm
        let e_modulus = 12.0e9;  // Sapele
        let rho = 640.0;
        let nu = 0.35;

        let le = bar_length / num_elements as f64;
        let element_heights: Vec<f64> = vec![h0; num_elements];

        let frequencies = compute_frequencies(
            &element_heights, le, bar_width, e_modulus, rho, nu, 5
        );

        println!("Sapele 520x50x25mm bar frequencies:");
        for (i, f) in frequencies.iter().enumerate() {
            println!("  Mode {}: {:.1} Hz", i+1, f);
        }

        // Analytical for free-free Euler-Bernoulli beam:
        // f1 = (4.73^2 / L^2) * sqrt(EI / rhoA) / (2*pi)
        // For this bar: f1 ≈ 411 Hz
        let a = bar_width * h0;
        let i_val = bar_width * h0.powi(3) / 12.0;
        let coeff = (e_modulus * i_val / (rho * a)).sqrt();
        let lambda_l = 4.73;
        let f1_analytical = (lambda_l / bar_length).powi(2) * coeff / (2.0 * PI);
        println!("Analytical f1 (Euler-Bernoulli): {:.1} Hz", f1_analytical);

        // Calculate all Euler-Bernoulli modes for comparison
        let lambdas = [4.730, 7.853, 10.996, 14.137, 17.279];
        println!("\nComparison with Euler-Bernoulli:");
        for (m, &lambda_l) in lambdas.iter().enumerate() {
            let f_eb = (lambda_l / bar_length).powi(2) * coeff / (2.0 * PI);
            if m < frequencies.len() {
                let ratio = frequencies[m] / f_eb;
                println!("  Mode {}: EB={:.1} Hz, FEM={:.1} Hz, ratio={:.3}", m+1, f_eb, frequencies[m], ratio);
            }
        }

        // Check that computed frequency is in the right ballpark
        // Timoshenko should be close to Euler-Bernoulli for slender beams
        // For thicker beams, shear effects reduce frequencies
        assert!(frequencies[0] > 200.0, "f1 should be > 200 Hz, got {}", frequencies[0]);
        assert!(frequencies[0] < 600.0, "f1 should be < 600 Hz, got {}", frequencies[0]);
    }
}
