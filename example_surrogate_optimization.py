"""
Example: Surrogate Optimization with RBF Interpolation

This example demonstrates the surrogate-based global optimization approach
from Soares et al. (2021) "Tuning of bending and torsional modes of bars
used in mallet percussion instruments", JASA 150(4), pp.2757-2769.

The surrogate optimization uses:
1. Radial Basis Function (RBF) interpolation to build a surrogate model
2. The surrogate to guide search for promising candidates
3. Differential evolution for final refinement

This approach is more efficient than pure evolutionary algorithms when
the objective function is expensive (e.g., 3D FEM analysis).

Usage:
    python example_surrogate_optimization.py
"""

import time
from multi_modal_tuning import (
    # Types
    BarParameters,
    AnalysisMode,
    # Data
    MATERIALS,
    get_preset,
    calculate_target_frequencies,
    # Surrogate optimization
    run_surrogate_optimization,
    SurrogateConfig,
    # For comparison
    run_evolutionary_algorithm,
    EAConfig,
    EAParameters,
    # Utils
    note_to_frequency,
    frequency_error_cents,
)
from multi_modal_tuning.optimization.population import create_bounds


def demo_surrogate_vs_evolutionary():
    """Compare surrogate and evolutionary optimization approaches."""

    print("=" * 70)
    print("SURROGATE OPTIMIZATION DEMO")
    print("Using RBF Interpolation (Soares et al. 2021)")
    print("=" * 70)

    # Setup: A4 xylophone bar
    note = "A4"
    fundamental = note_to_frequency(note)

    # Material and geometry
    material = MATERIALS["aluminum"]
    bar = BarParameters(
        L=0.25,           # 250mm length
        b=0.038,          # 38mm width
        h0=0.019,         # 19mm thickness
        hMin=0.0019       # 10% minimum thickness
    )

    # Tuning preset (xylophone 1:3:6)
    preset = get_preset("1:3:6")
    target_frequencies = calculate_target_frequencies(preset.ratios, fundamental)

    num_cuts = 2

    print(f"\nConfiguration:")
    print(f"  Note: {note} ({fundamental:.2f} Hz)")
    print(f"  Material: {material.name}")
    print(f"  Bar: {bar.L*1000:.0f}mm x {bar.b*1000:.0f}mm x {bar.h0*1000:.0f}mm")
    print(f"  Tuning: {preset.name} ({preset.description})")
    print(f"  Targets: {', '.join(f'{f:.1f} Hz' for f in target_frequencies)}")
    print(f"  Number of cuts: {num_cuts}")

    # Create bounds for optimization
    bounds = create_bounds(bar, num_cuts)

    # -------------------------------------------------------------------------
    # Method 1: Surrogate Optimization (RBF-based)
    # -------------------------------------------------------------------------
    print(f"\n{'-'*70}")
    print("Method 1: SURROGATE OPTIMIZATION (RBF + Differential Evolution)")
    print(f"{'-'*70}")

    def on_progress_surrogate(update):
        if update.generation % 50 == 0 or update.best_fitness < 0.1:
            freqs = update.computed_frequencies or []
            freq_str = ', '.join(f'{f:.1f}' for f in freqs[:3]) if freqs else 'N/A'
            print(f"  Eval {update.generation:4d}: fitness={update.best_fitness:.6f}, freqs=[{freq_str}]")

    surrogate_config = SurrogateConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        bounds=bounds,
        max_evaluations=200,        # Max objective function evaluations
        initial_points=30,          # Initial random sampling points
        penalty_type='none',
        penalty_weight=0.0,
        f1_priority=1.5,
        num_elements=100,           # FEM elements
        target_error=0.01,          # Stop if error below 0.01%
        analysis_mode=AnalysisMode.BEAM_2D,
        on_progress=on_progress_surrogate,
    )

    print(f"\nSettings:")
    print(f"  Max evaluations: {surrogate_config.max_evaluations}")
    print(f"  Initial sampling: {surrogate_config.initial_points} points")
    print(f"  FEM elements: {surrogate_config.num_elements}")
    print(f"  Analysis mode: {surrogate_config.analysis_mode.value}")

    print(f"\nRunning surrogate optimization...")
    start_time = time.time()

    result_surrogate = run_surrogate_optimization(surrogate_config)

    surrogate_time = time.time() - start_time

    print(f"\nSurrogate Results:")
    print(f"  Evaluations: {result_surrogate.generations}")
    print(f"  Time: {surrogate_time:.2f}s")
    print(f"  Tuning error: {result_surrogate.tuning_error:.6f}%")
    print(f"  Max error: {result_surrogate.max_error_cents:.1f} cents")
    print(f"  Frequencies:")
    for i, (f, t, e) in enumerate(zip(
        result_surrogate.computed_frequencies,
        target_frequencies,
        result_surrogate.errors_in_cents
    )):
        print(f"    f{i+1}: {f:.2f} Hz (target: {t:.2f} Hz, {e:+.1f} cents)")
    print(f"  Cuts:")
    for i, cut in enumerate(result_surrogate.cuts):
        print(f"    Cut {i+1}: lambda={cut.lambda_*1000:.2f}mm, h={cut.h*1000:.2f}mm")

    # -------------------------------------------------------------------------
    # Method 2: Evolutionary Algorithm (for comparison)
    # -------------------------------------------------------------------------
    print(f"\n{'-'*70}")
    print("Method 2: EVOLUTIONARY ALGORITHM (for comparison)")
    print(f"{'-'*70}")

    ea_params = EAParameters(
        population_size=30,
        max_generations=50,         # Comparable total evaluations: 30*50 = 1500
        target_error=0.01,
        num_elements=100,
        elitism_percent=10,
        crossover_percent=30,
        mutation_percent=60,
        mutation_strength=0.12,
        f1_priority=1.5,
        analysis_mode=AnalysisMode.BEAM_2D,
    )

    def on_progress_ea(update):
        if update.generation % 10 == 0:
            freqs = update.computed_frequencies or []
            freq_str = ', '.join(f'{f:.1f}' for f in freqs[:3]) if freqs else 'N/A'
            print(f"  Gen {update.generation:4d}: fitness={update.best_fitness:.6f}, freqs=[{freq_str}]")

    ea_config = EAConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        ea_params=ea_params,
        on_progress=on_progress_ea,
    )

    print(f"\nSettings:")
    print(f"  Population: {ea_params.population_size}")
    print(f"  Max generations: {ea_params.max_generations}")
    print(f"  Total evaluations: ~{ea_params.population_size * ea_params.max_generations}")

    print(f"\nRunning evolutionary algorithm...")
    start_time = time.time()

    result_ea = run_evolutionary_algorithm(ea_config)

    ea_time = time.time() - start_time

    print(f"\nEvolutionary Results:")
    print(f"  Generations: {result_ea.generations}")
    print(f"  Time: {ea_time:.2f}s")
    print(f"  Tuning error: {result_ea.tuning_error:.6f}%")
    print(f"  Max error: {result_ea.max_error_cents:.1f} cents")
    print(f"  Frequencies:")
    for i, (f, t, e) in enumerate(zip(
        result_ea.computed_frequencies,
        target_frequencies,
        result_ea.errors_in_cents
    )):
        print(f"    f{i+1}: {f:.2f} Hz (target: {t:.2f} Hz, {e:+.1f} cents)")

    # -------------------------------------------------------------------------
    # Comparison Summary
    # -------------------------------------------------------------------------
    print(f"\n{'='*70}")
    print("COMPARISON SUMMARY")
    print(f"{'='*70}")

    print(f"\n{'Method':<25} {'Evaluations':>12} {'Time':>10} {'Error %':>12} {'Max Cents':>12}")
    print(f"{'-'*70}")
    print(f"{'Surrogate (RBF)':<25} {result_surrogate.generations:>12} {surrogate_time:>9.2f}s {result_surrogate.tuning_error:>11.6f}% {result_surrogate.max_error_cents:>11.1f}")
    print(f"{'Evolutionary':<25} {result_ea.generations * ea_params.population_size:>12} {ea_time:>9.2f}s {result_ea.tuning_error:>11.6f}% {result_ea.max_error_cents:>11.1f}")

    print(f"\nNote: Surrogate optimization is particularly advantageous for expensive")
    print(f"objective functions like 3D FEM analysis, where it can find good solutions")
    print(f"with far fewer function evaluations than evolutionary approaches.")


def demo_surrogate_3d():
    """Demo surrogate optimization with 3D FEM (more expensive)."""

    print("\n" + "=" * 70)
    print("SURROGATE OPTIMIZATION WITH 3D FEM")
    print("=" * 70)

    # Setup
    fundamental = note_to_frequency("C5")
    material = MATERIALS["rosewood"]

    bar = BarParameters(
        L=0.20,           # 200mm
        b=0.030,          # 30mm width
        h0=0.018,         # 18mm thickness
        hMin=0.0018
    )

    preset = get_preset("1:3:6")
    target_frequencies = calculate_target_frequencies(preset.ratios, fundamental)
    num_cuts = 2

    print(f"\nConfiguration:")
    print(f"  Note: C5 ({fundamental:.2f} Hz)")
    print(f"  Material: {material.name}")
    print(f"  Analysis: 3D Solid FEM")
    print(f"  Targets: {', '.join(f'{f:.1f} Hz' for f in target_frequencies)}")

    bounds = create_bounds(bar, num_cuts)

    def on_progress(update):
        if update.generation % 20 == 0 or update.best_fitness < 0.1:
            print(f"  Eval {update.generation:4d}: fitness={update.best_fitness:.6f}")

    config = SurrogateConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        bounds=bounds,
        max_evaluations=100,        # Fewer evals for expensive 3D
        initial_points=20,
        num_elements=60,            # 3D mesh resolution (x-direction)
        ny=2,                       # y-direction elements
        nz=2,                       # z-direction elements
        target_error=0.05,
        analysis_mode=AnalysisMode.SOLID_3D,
        on_progress=on_progress,
    )

    print(f"\n3D FEM Settings:")
    print(f"  Mesh: {config.num_elements} x {config.ny} x {config.nz} elements")
    print(f"  Max evaluations: {config.max_evaluations}")

    print(f"\nRunning 3D surrogate optimization...")
    start_time = time.time()

    result = run_surrogate_optimization(config)

    elapsed = time.time() - start_time

    print(f"\n3D Surrogate Results:")
    print(f"  Evaluations: {result.generations}")
    print(f"  Time: {elapsed:.2f}s ({elapsed/result.generations:.2f}s per eval)")
    print(f"  Tuning error: {result.tuning_error:.4f}%")
    print(f"  Max error: {result.max_error_cents:.1f} cents")
    print(f"  Frequencies:")
    for i, (f, t, e) in enumerate(zip(
        result.computed_frequencies,
        target_frequencies,
        result.errors_in_cents
    )):
        print(f"    f{i+1}: {f:.2f} Hz (target: {t:.2f} Hz, {e:+.1f} cents)")


if __name__ == "__main__":
    # Run the 2D comparison demo
    demo_surrogate_vs_evolutionary()

    # Uncomment to run 3D demo (slower)
    # demo_surrogate_3d()

    print("\n" + "=" * 70)
    print("Demo complete!")
    print("=" * 70)
