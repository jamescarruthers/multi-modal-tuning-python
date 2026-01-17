"""
Example: Surrogate Optimization with 3D FEM

Demonstrates the RBF-based surrogate optimization from Soares et al. (2021)
using 3D solid element FEM analysis.

The surrogate approach is particularly advantageous for expensive 3D FEM
because it builds an interpolating model to guide the search, requiring
far fewer objective function evaluations than evolutionary algorithms.

Usage:
    python example_surrogate_3d.py
"""

import time
from multi_modal_tuning import (
    BarParameters,
    AnalysisMode,
    MATERIALS,
    get_preset,
    calculate_target_frequencies,
    run_surrogate_optimization,
    SurrogateConfig,
    note_to_frequency,
)
from multi_modal_tuning.optimization.population import create_bounds


def main():
    print("=" * 70)
    print("SURROGATE OPTIMIZATION WITH 3D FEM")
    print("RBF Interpolation (Soares et al. 2021)")
    print("=" * 70)

    # Configuration
    note = "F4"
    fundamental = note_to_frequency(note)

    material = MATERIALS["rosewood"]
    bar = BarParameters(
        L=0.45,           # 180mm length
        b=0.032,          # 32mm width
        h0=0.024,         # 20mm thickness
        hMin=0.002        # 2mm minimum
    )

    preset = get_preset("1:3:6")
    target_frequencies = calculate_target_frequencies(preset.ratios, fundamental)
    num_cuts = 2

    print(f"\nConfiguration:")
    print(f"  Note: {note} ({fundamental:.2f} Hz)")
    print(f"  Material: {material.name}")
    print(f"  Bar: {bar.L*1000:.0f}mm x {bar.b*1000:.0f}mm x {bar.h0*1000:.0f}mm")
    print(f"  Tuning: {preset.name}")
    print(f"  Targets: {', '.join(f'{f:.1f} Hz' for f in target_frequencies)}")

    bounds = create_bounds(bar, num_cuts)

    # Progress callback
    def on_progress(update):
        if update.generation % 10 == 0 or update.best_fitness < 0.5:
            freqs = update.computed_frequencies or []
            freq_str = ', '.join(f'{f:.1f}' for f in freqs[:3]) if freqs else 'N/A'
            print(f"  Eval {update.generation:3d}: error={update.best_fitness:.4f}%, freqs=[{freq_str}]")

    # Surrogate config with 3D FEM
    config = SurrogateConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        bounds=bounds,
        max_evaluations=400,         # Limited evals for expensive 3D
        initial_points=15,          # Initial sampling
        num_elements=80,            # 3D mesh: 50 elements in x
        ny=2,                       # 2 elements in y (width)
        nz=4,                       # 4 elements in z (thickness)
        target_error=0.1,           # Stop at 0.1% error
        analysis_mode=AnalysisMode.SOLID_3D,
        on_progress=on_progress,
    )

    print(f"\n3D FEM Settings:")
    print(f"  Mesh: {config.num_elements} x {config.ny} x {config.nz} = {config.num_elements * config.ny * config.nz} elements")
    print(f"  Max evaluations: {config.max_evaluations}")
    print(f"  Initial sampling: {config.initial_points} points")

    print(f"\nRunning optimization...")
    start = time.time()

    result = run_surrogate_optimization(config)

    elapsed = time.time() - start

    print(f"\n{'='*70}")
    print("RESULTS")
    print(f"{'='*70}")
    print(f"  Evaluations: {result.generations}")
    print(f"  Time: {elapsed:.1f}s ({elapsed/max(1,result.generations):.2f}s per eval)")
    print(f"  Tuning error: {result.tuning_error:.4f}%")
    print(f"  Max error: {result.max_error_cents:.1f} cents")

    print(f"\nFrequencies:")
    for i, (f, t, e) in enumerate(zip(
        result.computed_frequencies,
        target_frequencies,
        result.errors_in_cents
    )):
        print(f"  f{i+1}: {f:.2f} Hz (target: {t:.2f} Hz, {e:+.1f} cents)")

    print(f"\nCut geometry:")
    for i, cut in enumerate(result.cuts):
        depth = (bar.h0 - cut.h) * 1000
        print(f"  Cut {i+1}: lambda={cut.lambda_*1000:.2f}mm, h={cut.h*1000:.2f}mm (depth={depth:.2f}mm)")

    print(f"\n{'='*70}")


if __name__ == "__main__":
    main()
