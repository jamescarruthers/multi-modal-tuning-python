#!/usr/bin/env python3
"""
Multi-Modal Bar Tuning Optimization

Main entry point demonstrating the usage of the optimization library.
This script shows how to optimize a marimba bar for standard 1:4:10 tuning.
"""

import time
from multi_modal_tuning import (
    BarParameters,
    EAParameters,
    run_evolutionary_algorithm,
    get_default_ea_parameters,
    EAConfig,
    MATERIALS,
    get_preset,
    calculate_target_frequencies,
)


def progress_callback(update):
    """Print progress updates during optimization."""
    if update.generation % 10 == 0 or update.generation == 0:
        freqs_str = ""
        if update.computed_frequencies:
            freqs_str = " | Frequencies: " + ", ".join(
                f"{f:.1f} Hz" for f in update.computed_frequencies[:3]
            )
        print(
            f"Gen {update.generation:3d}: "
            f"Best fitness = {update.best_fitness:.6f}%"
            f"{freqs_str}"
        )


def main():
    """Run a sample optimization for a marimba bar."""
    print("=" * 60)
    print("Multi-Modal Bar Tuning Optimization")
    print("=" * 60)
    print()

    # Define bar parameters (500mm x 50mm x 20mm Rosewood bar)
    bar = BarParameters(
        L=0.5,      # 500mm length
        b=0.05,     # 50mm width
        h0=0.02,    # 20mm original thickness
        hMin=0.002  # 2mm minimum thickness
    )

    # Select material
    material = MATERIALS["rosewood"]
    print(f"Material: {material.name}")
    print(f"  Young's modulus: {material.E / 1e9:.1f} GPa")
    print(f"  Density: {material.rho:.0f} kg/m³")
    print()

    # Define target frequencies using 1:4:10 marimba tuning
    # with a fundamental of 220 Hz (A3)
    preset = get_preset("1:4:10")
    fundamental_hz = 220.0  # A3
    target_frequencies = calculate_target_frequencies(preset.ratios, fundamental_hz)

    print(f"Tuning preset: {preset.name} ({preset.description})")
    print(f"Fundamental: {fundamental_hz} Hz")
    print(f"Target frequencies: {', '.join(f'{f:.1f} Hz' for f in target_frequencies)}")
    print()

    # Configure evolutionary algorithm
    num_cuts = 3
    ea_params = get_default_ea_parameters(num_cuts)
    ea_params.population_size = 50
    ea_params.max_generations = 50
    ea_params.target_error = 0.1  # 0.1% error threshold
    ea_params.num_elements = 100
    ea_params.max_workers = 0  # Use all available CPU cores

    print(f"Optimization parameters:")
    print(f"  Number of cuts: {num_cuts}")
    print(f"  Population size: {ea_params.population_size}")
    print(f"  Max generations: {ea_params.max_generations}")
    print(f"  Target error: {ea_params.target_error}%")
    print()

    # Create configuration
    config = EAConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        penalty_type='none',
        penalty_weight=0.0,
        ea_params=ea_params,
        on_progress=progress_callback
    )

    # Run optimization
    print("Starting optimization...")
    print("-" * 60)
    start_time = time.time()

    result = run_evolutionary_algorithm(config)

    elapsed_time = time.time() - start_time
    print("-" * 60)
    print()

    # Display results
    print("=" * 60)
    print("OPTIMIZATION RESULTS")
    print("=" * 60)
    print()
    print(f"Generations: {result.generations}")
    print(f"Elapsed time: {elapsed_time:.2f} seconds")
    print()

    print("Tuning Error:")
    print(f"  Total: {result.tuning_error:.4f}%")
    print(f"  Max error: {result.max_error_cents:.1f} cents")
    print()

    print("Computed Frequencies:")
    for i, (target, computed, error) in enumerate(zip(
        result.target_frequencies,
        result.computed_frequencies,
        result.errors_in_cents
    )):
        sign = "+" if error >= 0 else ""
        print(f"  Mode {i+1}: {computed:8.2f} Hz (target: {target:.2f} Hz, {sign}{error:.1f} cents)")
    print()

    print("Cut Geometry (symmetric about center):")
    for i, cut in enumerate(result.cuts):
        print(f"  Cut {i+1}: lambda = {cut.lambda_ * 1000:.2f} mm, h = {cut.h * 1000:.2f} mm")
    print()

    print("Material Removal:")
    print(f"  Volume removed: {result.volume_percent:.1f}%")
    print(f"  Roughness: {result.roughness_percent:.1f}%")
    print()

    # Print genes for reproducibility
    print("Best genes (for seeding future runs):")
    genes_str = ", ".join(f"{g:.6f}" for g in result.best_individual.genes)
    print(f"  [{genes_str}]")

    return result


if __name__ == "__main__":
    main()
