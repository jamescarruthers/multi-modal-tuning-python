#!/usr/bin/env python3
"""
Calibrated Optimization Example

Demonstrates iterative 2D/3D calibration workflow:
1. Optimize using 2D beam analysis
2. Validate with 3D solid analysis
3. Calculate frequency offset (3D/2D ratio)
4. Re-optimize with offset applied
5. Repeat until 3D frequencies match targets

This achieves accurate 3D results while using fast 2D optimization.
"""

import argparse
import math
import time
import os
import sys

from multi_modal_tuning import (
    run_evolutionary_algorithm,
    BarParameters,
    Material,
    EAParameters,
    calculate_target_frequencies,
    note_to_frequency,
    get_preset,
    AnalysisMode,
)
from multi_modal_tuning.optimization.algorithm import EAConfig
from multi_modal_tuning.physics.fem_3d import compute_frequencies_3d_adaptive
from multi_modal_tuning.physics.bar_profile import generate_adaptive_mesh_1d, genes_to_cuts


def compute_offset(freqs_2d: list, freqs_3d: list) -> float:
    """
    Compute the frequency offset needed so 3D results match targets.

    If 3D/2D = ratio (e.g., 1.05), then to get 3D = target:
      2D should hit target/ratio
      So effective_target = target * (1 + offset) where offset = 1/ratio - 1

    Returns offset such that: target * (1 + offset) = 2D frequency needed
    """
    if len(freqs_2d) != len(freqs_3d):
        raise ValueError("Frequency lists must have same length")

    # Calculate ratio for each mode: 3D/2D
    ratios = [f3d / f2d for f2d, f3d in zip(freqs_2d, freqs_3d)]

    # Average ratio - this is how much higher 3D is than 2D
    avg_ratio = sum(ratios) / len(ratios)

    # To get 3D = target, we need 2D = target / ratio
    # So effective_target = target * (1/ratio) = target * (1 + offset)
    # Therefore: offset = 1/ratio - 1 (negative, meaning aim lower)
    return (1.0 / avg_ratio) - 1


def run_calibrated_optimization(
    bar: BarParameters,
    material: Material,
    target_frequencies: list,
    num_cuts: int = 2,
    max_iterations: int = 5,
    convergence_threshold: float = 0.01,  # 1% change in offset
    ea_params: EAParameters = None,
    verbose: bool = True
):
    """
    Run iterative 2D/3D calibrated optimization.

    Args:
        bar: Bar geometry parameters
        material: Material properties
        target_frequencies: Target frequencies in Hz
        num_cuts: Number of cuts
        max_iterations: Maximum calibration iterations
        convergence_threshold: Stop when offset changes less than this
        ea_params: EA parameters (frequency_offset will be updated)
        verbose: Print progress

    Returns:
        Final optimization result with calibrated geometry
    """
    if ea_params is None:
        ea_params = EAParameters(
            population_size=60,
            max_generations=100,
            target_error=0.001,
            num_elements=60
        )

    offset = 0.0
    prev_offset = None
    best_result = None

    for iteration in range(max_iterations):
        if verbose:
            print(f"\n{'='*70}")
            print(f"CALIBRATION ITERATION {iteration + 1}")
            print(f"{'='*70}")
            print(f"Current offset: {offset*100:+.2f}%")

        # Update offset in EA parameters
        ea_params.frequency_offset = offset

        # Run 2D optimization
        if verbose:
            print(f"\nRunning 2D optimization...")

        start = time.time()
        config = EAConfig(
            bar=bar,
            material=material,
            target_frequencies=target_frequencies,
            num_cuts=num_cuts,
            ea_params=ea_params
        )
        result = run_evolutionary_algorithm(config)
        opt_time = time.time() - start

        if verbose:
            print(f"  Completed in {opt_time:.1f}s")
            print(f"  2D frequencies: {', '.join(f'{f:.1f}' for f in result.computed_frequencies)} Hz")

        # Run 3D validation
        if verbose:
            print(f"\nRunning 3D validation...")

        cuts = genes_to_cuts(result.best_individual.genes[:num_cuts*2])
        x_pos, heights = generate_adaptive_mesh_1d(
            cuts, bar.L, bar.h0,
            base_elements=60,
            refinement_factor=4
        )

        start = time.time()
        _, classified, _, _ = compute_frequencies_3d_adaptive(
            x_pos, heights, bar.L, bar.b,
            material.E, material.rho, material.nu,
            num_modes=15, ny=2, nz=3
        )
        val_time = time.time() - start

        freqs_3d = [m['frequency'] for m in classified['vertical_bending'][:len(target_frequencies)]]

        if verbose:
            print(f"  Completed in {val_time:.1f}s")
            print(f"  3D frequencies: {', '.join(f'{f:.1f}' for f in freqs_3d)} Hz")

        # Calculate errors
        errors_2d = [(f - t) / t * 100 for f, t in zip(result.computed_frequencies, target_frequencies)]
        errors_3d = [(f - t) / t * 100 for f, t in zip(freqs_3d, target_frequencies)]

        if verbose:
            print(f"\nFrequency errors vs target:")
            print(f"  {'Mode':<6} {'Target':>10} {'2D':>10} {'3D':>10} {'2D Err':>10} {'3D Err':>10}")
            print(f"  {'-'*56}")
            for i, (t, f2, f3, e2, e3) in enumerate(zip(
                target_frequencies, result.computed_frequencies, freqs_3d, errors_2d, errors_3d
            )):
                print(f"  {i+1:<6} {t:>10.1f} {f2:>10.1f} {f3:>10.1f} {e2:>+9.2f}% {e3:>+9.2f}%")

        # Calculate new offset from 3D/2D ratio
        new_offset = compute_offset(result.computed_frequencies, freqs_3d)

        if verbose:
            print(f"\n3D/2D ratio: {1 + new_offset:.4f} (offset: {new_offset*100:+.2f}%)")

        # Check convergence
        if prev_offset is not None:
            offset_change = abs(new_offset - prev_offset)
            if verbose:
                print(f"Offset change: {offset_change*100:.3f}%")

            if offset_change < convergence_threshold:
                if verbose:
                    print(f"\nConverged! Offset stable within {convergence_threshold*100:.1f}%")
                break

        # Update for next iteration
        # Cumulative offset: we want 2D to aim for target * (1 + total_offset)
        # where total_offset accounts for the 3D/2D difference
        prev_offset = new_offset
        offset = new_offset  # Use the measured 3D/2D ratio as the new offset
        best_result = result

    # Final summary
    if verbose:
        print(f"\n{'='*70}")
        print("FINAL RESULTS")
        print(f"{'='*70}")
        print(f"\nFinal calibration offset: {offset*100:+.2f}%")
        print(f"\nOptimized cut geometry:")
        for i, cut in enumerate(best_result.cuts):
            depth = (bar.h0 - cut.h) * 1000
            print(f"  Cut {i+1}: λ = {cut.lambda_*1000:.2f} mm, h = {cut.h*1000:.2f} mm (depth = {depth:.2f} mm)")

        print(f"\n3D Bending frequencies (final):")
        for i, (t, f) in enumerate(zip(target_frequencies, freqs_3d)):
            error = (f - t) / t * 100
            cents = 1200 * math.log2(f / t) if t > 0 else 0
            print(f"  Mode {i+1}: {f:.1f} Hz (target: {t:.1f} Hz, error: {error:+.2f}%, {cents:+.1f} cents)")

    return best_result, freqs_3d, offset


def main():
    parser = argparse.ArgumentParser(description="Calibrated 2D/3D Optimization")
    parser.add_argument("--iterations", type=int, default=3,
                        help="Maximum calibration iterations (default: 3)")
    parser.add_argument("--note", type=str, default="F4",
                        help="Target note (default: F4)")
    args = parser.parse_args()

    # Bar dimensions (convert mm to meters)
    bar = BarParameters(
        L=0.450,      # 450mm length
        b=0.032,      # 32mm width
        h0=0.024,     # 24mm thickness
        hMin=0.0024   # 2.4mm minimum (10% of h0)
    )

    # Sapele wood properties
    material = Material(
        name="Sapele",
        E=12.0e9,     # 12 GPa
        rho=640,      # 640 kg/m³
        nu=0.35,
        category='wood'
    )

    # Target frequencies (xylophone tuning 1:3:6)
    f1 = note_to_frequency(args.note)
    xylophone = get_preset("1:3:6")
    target_frequencies = calculate_target_frequencies(xylophone.ratios, f1)

    print(f"Target note: {args.note} ({f1:.2f} Hz)")
    print(f"Target frequencies: {', '.join(f'{f:.1f}' for f in target_frequencies)} Hz")
    print(f"Tuning ratio: 1:3:6 (Xylophone)")

    # Run calibrated optimization
    result, final_3d_freqs, final_offset = run_calibrated_optimization(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=2,
        max_iterations=args.iterations,
        verbose=True
    )

    print(f"\nOptimized genes (for seeding future runs):")
    print(f"  {result.best_individual.genes}")
    print(f"\nCalibration offset for this material/geometry: {final_offset*100:+.2f}%")


if __name__ == "__main__":
    main()
