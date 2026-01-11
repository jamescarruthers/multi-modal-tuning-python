"""
Example: Sapele Xylophone Bar Optimization

Bar: 450mm x 32mm x 24mm
Material: Sapele
Target note: F4 (349.23 Hz)
Tuning ratio: 1:3:6 (xylophone)

This example:
1. Optimizes the bar geometry using fast 2D beam analysis
2. Visualizes the resulting 3D mesh
3. Compares 2D vs 3D frequency predictions

Usage:
    python example_sapele_xylophone.py              # Run with visualization
    python example_sapele_xylophone.py --no-plot    # Skip visualization
"""

import argparse
import time

from multi_modal_tuning import (
    BarParameters,
    EAParameters,
    run_evolutionary_algorithm,
    EAConfig,
    MATERIALS,
    get_preset,
    calculate_target_frequencies,
    note_to_frequency,
    AnalysisMode,
)
from multi_modal_tuning.physics.fem_3d import generate_bar_mesh_3d, compute_frequencies_3d
from multi_modal_tuning.physics.bar_profile import generate_element_heights, genes_to_cuts
from multi_modal_tuning.physics.visualization import (
    visualize_bar_mesh,
    visualize_bar_profile,
    HAS_MATPLOTLIB,
)


def main():
    parser = argparse.ArgumentParser(description="Sapele Xylophone Bar Optimization")
    parser.add_argument("--no-plot", action="store_true",
                        help="Skip visualization (for headless environments)")
    parser.add_argument("--ny", type=int, default=2,
                        help="Number of elements in width direction for 3D (default: 2)")
    parser.add_argument("--nz", type=int, default=3,
                        help="Number of elements in thickness direction for 3D (default: 3)")
    parser.add_argument("--nx-3d", type=int, default=60,
                        help="Number of elements in length direction for 3D (default: 60)")
    args = parser.parse_args()

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

    print("=" * 70)
    print("Sapele Xylophone Bar Optimization")
    print("=" * 70)
    print(f"\nBar dimensions: {bar.L*1000:.0f}mm x {bar.b*1000:.0f}mm x {bar.h0*1000:.0f}mm")
    print(f"Material: {material.name}")
    print(f"  Young's modulus: {material.E / 1e9:.1f} GPa")
    print(f"  Density: {material.rho:.0f} kg/m³")
    print(f"  Poisson's ratio: {material.nu:.2f}")
    print(f"\nTarget note: F4 ({f4_frequency:.2f} Hz)")
    print(f"Tuning ratio: {preset.name} ({preset.description})")
    print(f"Target frequencies: {', '.join(f'{f:.1f} Hz' for f in target_frequencies)}")

    # =========================================================================
    # STEP 1: Optimize using 2D beam analysis (fast)
    # =========================================================================
    print("\n" + "=" * 70)
    print("STEP 1: Optimize using 2D Timoshenko Beam Analysis")
    print("=" * 70)

    ea_params = EAParameters(
        population_size=60,
        max_generations=100,
        target_error=0.1,      # 0.1% target error
        num_elements=120,
        elitism_percent=10,
        crossover_percent=30,
        mutation_percent=60,
        mutation_strength=0.12,
        f1_priority=1.5,
        analysis_mode=AnalysisMode.BEAM_2D,
    )

    print(f"\nOptimization parameters:")
    print(f"  Analysis mode: 2D Timoshenko Beam")
    print(f"  Number of cuts: 2")
    print(f"  Population size: {ea_params.population_size}")
    print(f"  Max generations: {ea_params.max_generations}")
    print(f"  Target error: {ea_params.target_error}%")

    def on_progress(update):
        if update.generation % 20 == 0:
            freqs = update.computed_frequencies or []
            freq_str = ", ".join(f"{f:.1f}" for f in freqs) if freqs else "N/A"
            print(f"  Gen {update.generation:3d}: Best = {update.best_fitness:.4f}% | {freq_str} Hz")

    config = EAConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=2,
        ea_params=ea_params,
        on_progress=on_progress,
    )

    print("\nOptimizing...")
    start = time.time()
    result = run_evolutionary_algorithm(config)
    elapsed_2d = time.time() - start

    print(f"\n2D Optimization completed in {elapsed_2d:.1f} seconds")
    print(f"  Generations: {result.generations}")
    print(f"  Tuning Error: {result.tuning_error:.4f}%")
    print(f"  Max error: {result.max_error_cents:.1f} cents")

    print("\n2D Frequencies:")
    freqs_2d = result.computed_frequencies
    for i, (comp, target, cents) in enumerate(zip(
        freqs_2d, result.target_frequencies, result.errors_in_cents
    )):
        sign = "+" if cents >= 0 else ""
        print(f"  Mode {i+1}: {comp:7.1f} Hz (target: {target:.1f} Hz, {sign}{cents:.1f} cents)")

    print("\nOptimized Cut Geometry:")
    for i, cut in enumerate(result.cuts):
        depth = (bar.h0 - cut.h) * 1000
        print(f"  Cut {i+1}: λ = {cut.lambda_*1000:.2f} mm, h = {cut.h*1000:.2f} mm (depth = {depth:.2f} mm)")

    # =========================================================================
    # STEP 2: Generate 3D mesh from optimized geometry
    # =========================================================================
    print("\n" + "=" * 70)
    print("STEP 2: Generate 3D Mesh from Optimized Geometry")
    print("=" * 70)

    # Get cut genes from result
    cut_genes = result.best_individual.genes[:4]  # 2 cuts * 2 params
    cuts = genes_to_cuts(cut_genes)

    # Generate element heights for 3D mesh
    nx_3d = args.nx_3d
    element_heights = generate_element_heights(cuts, bar.L, bar.h0, nx_3d)

    print(f"\n3D Mesh parameters:")
    print(f"  Elements in length (nx): {nx_3d}")
    print(f"  Elements in width (ny): {args.ny}")
    print(f"  Elements in thickness (nz): {args.nz}")

    # Generate the 3D mesh
    nodes, elements, _ = generate_bar_mesh_3d(
        bar.L, bar.b, element_heights, nx_3d, args.ny, args.nz
    )

    num_nodes = len(nodes)
    num_elements = len(elements)
    num_dof = num_nodes * 3

    print(f"\nMesh statistics:")
    print(f"  Nodes: {num_nodes}")
    print(f"  Elements: {num_elements}")
    print(f"  Degrees of freedom: {num_dof}")

    # =========================================================================
    # STEP 3: Visualize the mesh
    # =========================================================================
    if not args.no_plot and HAS_MATPLOTLIB:
        print("\n" + "=" * 70)
        print("STEP 3: Visualize Mesh")
        print("=" * 70)

        print("\nDisplaying bar profile (side view)...")
        visualize_bar_profile(
            element_heights,
            bar.L,
            bar.h0,
            title=f"Optimized Bar Profile - F4 Xylophone ({material.name})",
            show=True
        )

        print("Displaying 3D mesh...")
        visualize_bar_mesh(
            nodes,
            elements,
            title=f"3D FEM Mesh - {num_elements} hexahedral elements",
            alpha=0.4,
            show=True
        )
    elif args.no_plot:
        print("\n(Skipping visualization - --no-plot specified)")
    else:
        print("\n(Skipping visualization - matplotlib not available)")

    # =========================================================================
    # STEP 4: Run 3D FEM analysis and compare
    # =========================================================================
    print("\n" + "=" * 70)
    print("STEP 4: Compare 2D vs 3D Frequency Analysis")
    print("=" * 70)

    print(f"\nRunning 3D solid element analysis...")
    print(f"  (This may take a moment...)")

    start = time.time()
    freqs_3d = compute_frequencies_3d(
        element_heights,
        bar.L,
        bar.b,
        material.E,
        material.rho,
        material.nu,
        num_modes=3,
        ny=args.ny,
        nz=args.nz
    )
    elapsed_3d = time.time() - start

    print(f"\n3D Analysis completed in {elapsed_3d:.1f} seconds")

    # =========================================================================
    # STEP 5: Results comparison
    # =========================================================================
    print("\n" + "=" * 70)
    print("RESULTS COMPARISON: 2D Beam vs 3D Solid Elements")
    print("=" * 70)

    print(f"\n{'Mode':<6} {'Target':<12} {'2D Beam':<12} {'3D Solid':<12} {'2D Error':<12} {'3D Error':<12} {'Δ(3D-2D)':<10}")
    print("-" * 76)

    for i in range(min(len(freqs_2d), len(freqs_3d), len(target_frequencies))):
        target = target_frequencies[i]
        f2d = freqs_2d[i]
        f3d = freqs_3d[i]

        cents_2d = 1200 * (f2d / target - 1) if target > 0 else 0
        cents_3d = 1200 * (f3d / target - 1) if target > 0 else 0
        delta = f3d - f2d

        print(f"{i+1:<6} {target:<12.1f} {f2d:<12.1f} {f3d:<12.1f} {cents_2d:>+8.1f} ct  {cents_3d:>+8.1f} ct  {delta:>+8.1f} Hz")

    print("-" * 76)

    # Summary
    print(f"\nTiming:")
    print(f"  2D optimization: {elapsed_2d:.1f} seconds ({result.generations} generations)")
    print(f"  3D single analysis: {elapsed_3d:.1f} seconds")
    print(f"  Speedup factor: {elapsed_3d / (elapsed_2d / result.generations):.1f}x slower per evaluation")

    print(f"\nConclusion:")
    avg_diff = sum(abs(freqs_3d[i] - freqs_2d[i]) for i in range(min(len(freqs_2d), len(freqs_3d)))) / min(len(freqs_2d), len(freqs_3d))
    print(f"  Average |3D - 2D| difference: {avg_diff:.1f} Hz")

    if avg_diff < 20:
        print(f"  The 2D beam model provides a good approximation for this bar geometry.")
    else:
        print(f"  Significant differences - consider using 3D analysis for final verification.")

    print("\nOptimized genes (for seeding future runs):")
    print(f"  {result.best_individual.genes}")


if __name__ == "__main__":
    main()
