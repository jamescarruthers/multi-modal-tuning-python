"""
Example: Sapele Xylophone Bar Optimization

Bar: 450mm x 32mm x 24mm
Material: Sapele
Target note: F4 (349.23 Hz)
Tuning ratio: 1:3:6 (xylophone)
"""

from multi_modal_tuning import (
    BarParameters,
    EAParameters,
    run_evolutionary_algorithm,
    EAConfig,
    MATERIALS,
    get_preset,
    calculate_target_frequencies,
    note_to_frequency,
)


def main():
    # Bar dimensions (convert mm to meters)
    bar = BarParameters(
        L=0.450,      # 450mm length
        b=0.032,      # 32mm width
        h0=0.024,     # 24mm thickness
        hMin=0.0024   # 2.4mm minimum (10% of thickness)
    )

    # Material: Sapele
    material = MATERIALS["sapele"]

    # Target note: F4
    f4_frequency = note_to_frequency("F4")
    print(f"F4 frequency: {f4_frequency:.2f} Hz")

    # Tuning ratio: 1:3:6 (xylophone)
    preset = get_preset("1:3:6")
    target_frequencies = calculate_target_frequencies(preset.ratios, f4_frequency)

    print("=" * 60)
    print("Sapele Xylophone Bar Optimization")
    print("=" * 60)
    print(f"\nBar dimensions: 450mm x 32mm x 24mm")
    print(f"Material: {material.name}")
    print(f"  Young's modulus: {material.E / 1e9:.1f} GPa")
    print(f"  Density: {material.rho:.0f} kg/m³")
    print(f"\nTarget note: F4 ({f4_frequency:.2f} Hz)")
    print(f"Tuning ratio: {preset.name} ({preset.description})")
    print(f"Target frequencies: {', '.join(f'{f:.1f} Hz' for f in target_frequencies)}")

    # EA parameters
    ea_params = EAParameters(
        population_size=60,
        max_generations=100,
        target_error=0.1,      # 0.1% target error
        num_elements=120,
        elitism_percent=10,
        crossover_percent=30,
        mutation_percent=60,
        mutation_strength=0.12,
        f1_priority=1.5,       # Slightly prioritize fundamental
    )

    print(f"\nOptimization parameters:")
    print(f"  Number of cuts: 2")
    print(f"  Population size: {ea_params.population_size}")
    print(f"  Max generations: {ea_params.max_generations}")
    print(f"  Target error: {ea_params.target_error}%")

    # Progress callback
    def on_progress(update):
        if update.generation % 10 == 0:
            freqs = update.computed_frequencies or []
            freq_str = ", ".join(f"{f:.1f} Hz" for f in freqs) if freqs else "N/A"
            print(f"Gen {update.generation:3d}: Best = {update.best_fitness:.4f}% | {freq_str}")

    config = EAConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=2,
        ea_params=ea_params,
        on_progress=on_progress,
    )

    print("\nStarting optimization...")
    print("-" * 60)

    import time
    start = time.time()
    result = run_evolutionary_algorithm(config)
    elapsed = time.time() - start

    print("-" * 60)
    print(f"\n{'=' * 60}")
    print("RESULTS")
    print("=" * 60)

    print(f"\nGenerations: {result.generations}")
    print(f"Time: {elapsed:.1f} seconds")
    print(f"\nTuning Error: {result.tuning_error:.4f}%")
    print(f"Max error: {result.max_error_cents:.1f} cents")

    print("\nFrequencies:")
    for i, (comp, target, cents) in enumerate(zip(
        result.computed_frequencies,
        result.target_frequencies,
        result.errors_in_cents
    )):
        sign = "+" if cents >= 0 else ""
        print(f"  Mode {i+1}: {comp:7.1f} Hz (target: {target:.1f} Hz, {sign}{cents:.1f} cents)")

    print("\nCut Geometry (symmetric about center):")
    for i, cut in enumerate(result.cuts):
        print(f"  Cut {i+1}: lambda = {cut.lambda_*1000:.2f} mm, h = {cut.h*1000:.2f} mm")
        depth = (bar.h0 - cut.h) * 1000
        print(f"          (depth = {depth:.2f} mm, width = {cut.lambda_*2*1000:.2f} mm)")

    print(f"\nMaterial removal: {result.volume_percent:.1f}%")

    print("\nGenes for seeding:")
    print(f"  {result.best_individual.genes}")


if __name__ == "__main__":
    main()
