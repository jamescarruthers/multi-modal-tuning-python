"""
Example: Xylophone Range Optimization

This example demonstrates a complete workflow for generating a range of xylophone bars:
1. Takes a note range (e.g., F4 to F5), bar dimensions, material, and tuning ratio
2. Finds optimal bar lengths using the 3D FEM solver
3. Runs multi-stage optimization: 2D fast -> 3D correction -> 2D refined -> 3D final
4. Generates both 2D profile and 3D isometric diagrams for each bar

Usage:
    python example_xylophone_range.py

Output:
    output/
    ├── F4/
    │   ├── F4_2d_profile.png
    │   ├── F4_3d_isometric.png
    │   └── F4_results.txt
    ├── Fs4/  (F#4)
    │   └── ...
    └── summary.txt
"""

import os
import time
import math
from dataclasses import dataclass
from typing import List, Optional

from multi_modal_tuning import (
    # Types
    BarParameters,
    EAParameters,
    EAConfig,
    OptimizationResult,
    Cut,
    # Data
    MATERIALS,
    get_preset,
    calculate_target_frequencies,
    # Algorithm
    run_evolutionary_algorithm,
    # Utils
    note_to_frequency,
    generate_notes_in_range,
    frequency_error_cents,
    find_optimal_length,
    # Physics
    compute_frequencies_from_genes,
    genes_to_cuts,
    # Visualization
    generate_bar_diagrams,
)


# ============================================================================
# CONFIGURATION - Modify these parameters for your instrument
# ============================================================================

START_NOTE = "F4"           # First note in range
END_NOTE = "F5"             # Last note in range
BAR_WIDTH = 32              # mm
BAR_HEIGHT = 24             # mm
MATERIAL_NAME = "sapele"    # Material from materials database
TUNING_RATIO = "1:3:6"      # Tuning preset (xylophone)
NUM_CUTS = 2                # Number of undercuts
OUTPUT_DIR = "output"       # Output directory for diagrams

# Length search bounds (mm)
MIN_BAR_LENGTH = 100        # Minimum bar length to search
MAX_BAR_LENGTH = 600        # Maximum bar length to search

# Optimization parameters
POPULATION_SIZE = 50
MAX_GENERATIONS = 100
TARGET_ERROR = 0.05         # Target tuning error (%)

# FEM discretization - keep these similar so 2D/3D offset is meaningful
NUM_ELEMENTS_2D = 120       # For optimization (matches example_sapele_xylophone)
NUM_ELEMENTS_3D = 320       # For verification (same resolution for accurate offset)


# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class BarResult:
    """Result for a single optimized bar."""
    note_name: str
    note_frequency: float
    bar_length: float               # mm (final optimized length)
    initial_length: float           # mm (length from initial search)
    target_frequencies: List[float]
    computed_frequencies_2d: List[float]
    computed_frequencies_3d: List[float]
    frequency_offset: List[float]   # 3D - 2D for each mode
    final_frequencies: List[float]
    errors_cents: List[float]
    tuning_error: float
    cuts: List[Cut]
    optimization_time: float        # seconds
    success: bool
    error_message: Optional[str] = None


# ============================================================================
# CORE FUNCTIONS
# ============================================================================

def process_single_bar(
    note_name: str,
    note_frequency: float,
    width_mm: float,
    height_mm: float,
    material,
    preset,
    num_cuts: int,
    output_dir: str,
    verbose: bool = True
) -> BarResult:
    """
    Process a single bar through the full multi-stage optimization pipeline.

    Pipeline:
    1. Find optimal length using 3D FEM
    2. Run fast 2D optimization
    3. Compute 3D frequencies to get offset
    4. Run corrected 2D optimization
    5. Final 3D verification
    6. Generate diagrams
    """
    start_time = time.time()

    try:
        # Calculate target frequencies from preset
        target_frequencies = calculate_target_frequencies(preset.ratios, note_frequency)
        num_modes = len(target_frequencies)

        if verbose:
            print(f"\n{'='*60}")
            print(f"Processing {note_name} ({note_frequency:.2f} Hz)")
            print(f"{'='*60}")
            print(f"Target frequencies: {', '.join(f'{f:.1f} Hz' for f in target_frequencies)}")

        # ----------------------------------------------------------------
        # Stage 1: Find optimal bar length using 3D FEM
        # ----------------------------------------------------------------
        if verbose:
            print(f"\n[1/5] Finding optimal bar length...")

        length_result = find_optimal_length(
            target_frequency=note_frequency,
            width=width_mm,
            thickness=height_mm,
            material=material,
            min_length=MIN_BAR_LENGTH,
            max_length=MAX_BAR_LENGTH,
            tolerance_cents=2.0,
            max_iterations=30,
            num_elements=NUM_ELEMENTS_3D
        )

        initial_length_mm = length_result.length
        bar_length_mm = initial_length_mm
        if verbose:
            print(f"    Optimal length: {bar_length_mm:.1f} mm (f1 = {length_result.computed_freq:.2f} Hz, {length_result.error_cents:+.1f} cents)")

        # Create bar parameters (convert mm to m)
        bar = BarParameters(
            L=bar_length_mm / 1000,
            b=width_mm / 1000,
            h0=height_mm / 1000,
            hMin=height_mm / 10000  # 10% of thickness
        )

        # ----------------------------------------------------------------
        # Stage 2: Fast 2D optimization
        # ----------------------------------------------------------------
        if verbose:
            print(f"\n[2/5] Running 2D optimization (fast)...")

        ea_params_2d = EAParameters(
            population_size=POPULATION_SIZE,
            max_generations=MAX_GENERATIONS,
            target_error=TARGET_ERROR * 2,  # Looser tolerance for speed
            num_elements=NUM_ELEMENTS_2D,
            elitism_percent=10,
            crossover_percent=30,
            mutation_percent=60,
            mutation_strength=0.12,
            f1_priority=1.5,
            max_length_trim=0.02,    # Allow up to 20mm trim from each end
            max_length_extend=0.02,  # Allow up to 20mm extension from each end
        )

        config_2d = EAConfig(
            bar=bar,
            material=material,
            target_frequencies=target_frequencies,
            num_cuts=num_cuts,
            ea_params=ea_params_2d,
            on_progress=lambda u: None,  # Silent
        )

        result_2d = run_evolutionary_algorithm(config_2d)

        # Update bar length if optimizer trimmed/extended it
        if result_2d.effective_length > 0:
            bar_length_mm = result_2d.effective_length * 1000
            bar = BarParameters(
                L=result_2d.effective_length,
                b=width_mm / 1000,
                h0=height_mm / 1000,
                hMin=height_mm / 10000
            )

        if verbose:
            print(f"    2D result: {result_2d.tuning_error:.4f}% error, {result_2d.generations} generations")
            if result_2d.length_trim != 0:
                print(f"    Length adjustment: {result_2d.length_trim*1000:+.1f} mm (new length: {bar_length_mm:.1f} mm)")
            for i, f in enumerate(result_2d.computed_frequencies):
                print(f"      f{i+1}: {f:.1f} Hz (target: {target_frequencies[i]:.1f} Hz)")

        # ----------------------------------------------------------------
        # Stage 3: 3D analysis to compute offset
        # ----------------------------------------------------------------
        if verbose:
            print(f"\n[3/5] Computing 3D frequency offset...")

        # Compute frequencies using 3D FEM with the 2D-optimized genes
        freqs_3d_check = compute_frequencies_from_genes(
            result_2d.best_individual.genes,
            bar,
            material,
            num_modes,
            NUM_ELEMENTS_3D,
            num_cuts
        )

        # Calculate offset: how much 3D differs from 2D
        frequency_offset = [f3d - f2d for f3d, f2d in zip(freqs_3d_check, result_2d.computed_frequencies)]

        if verbose:
            print(f"    Frequency offset (3D - 2D):")
            for i, offset in enumerate(frequency_offset):
                print(f"      f{i+1}: {offset:+.2f} Hz")

        # ----------------------------------------------------------------
        # Stage 4: Corrected 2D optimization
        # ----------------------------------------------------------------
        if verbose:
            print(f"\n[4/5] Running corrected 2D optimization...")

        # Adjust target frequencies to compensate for the offset
        # If 3D is higher than 2D, we need to aim lower in 2D
        corrected_targets = [ft - offset for ft, offset in zip(target_frequencies, frequency_offset)]

        if verbose:
            print(f"    Corrected targets: {', '.join(f'{f:.1f} Hz' for f in corrected_targets)}")

        ea_params_corrected = EAParameters(
            population_size=POPULATION_SIZE,
            max_generations=MAX_GENERATIONS,
            target_error=TARGET_ERROR,
            num_elements=NUM_ELEMENTS_2D,
            elitism_percent=10,
            crossover_percent=30,
            mutation_percent=60,
            mutation_strength=0.10,
            f1_priority=1.5,
        )

        config_corrected = EAConfig(
            bar=bar,
            material=material,
            target_frequencies=corrected_targets,
            num_cuts=num_cuts,
            ea_params=ea_params_corrected,
            on_progress=lambda u: None,
            seed_genes=result_2d.best_individual.genes,  # Seed from previous result
        )

        result_corrected = run_evolutionary_algorithm(config_corrected)

        if verbose:
            print(f"    Corrected 2D result: {result_corrected.tuning_error:.4f}% error")

        # ----------------------------------------------------------------
        # Stage 5: Final 3D verification
        # ----------------------------------------------------------------
        if verbose:
            print(f"\n[5/5] Final 3D verification...")

        final_freqs = compute_frequencies_from_genes(
            result_corrected.best_individual.genes,
            bar,
            material,
            num_modes,
            NUM_ELEMENTS_3D,
            num_cuts
        )

        # Calculate final errors
        errors_cents = [frequency_error_cents(f, ft) for f, ft in zip(final_freqs, target_frequencies)]
        max_error = max(abs(e) for e in errors_cents)

        # Compute overall tuning error
        weights = [1.5 if i == 0 else 1.0 for i in range(num_modes)]
        tuning_error = 100 * sum(w * ((f - ft) / ft) ** 2 for w, f, ft in zip(weights, final_freqs, target_frequencies)) / sum(weights)

        if verbose:
            print(f"    Final 3D frequencies:")
            for i, (f, ft, e) in enumerate(zip(final_freqs, target_frequencies, errors_cents)):
                sign = '+' if e >= 0 else ''
                print(f"      f{i+1}: {f:.1f} Hz (target: {ft:.1f} Hz, {sign}{e:.1f} cents)")
            print(f"    Tuning error: {tuning_error:.4f}%, max error: {max_error:.1f} cents")

        # Get the cuts
        cuts = genes_to_cuts(result_corrected.best_individual.genes)

        # ----------------------------------------------------------------
        # Generate diagrams
        # ----------------------------------------------------------------
        if verbose:
            print(f"\n    Generating diagrams...")

        safe_note_name = note_name.replace('#', 's').replace('b', 'b')
        note_output_dir = os.path.join(output_dir, safe_note_name)
        os.makedirs(note_output_dir, exist_ok=True)

        generate_bar_diagrams(
            bar=bar,
            cuts=cuts,
            note_name=note_name,
            frequencies=final_freqs,
            target_frequencies=target_frequencies,
            output_dir=note_output_dir
        )

        # Write results file
        results_path = os.path.join(note_output_dir, f'{safe_note_name}_results.txt')
        with open(results_path, 'w') as f:
            f.write(f"Bar Optimization Results: {note_name}\n")
            f.write(f"{'='*50}\n\n")
            f.write(f"Note: {note_name} ({note_frequency:.2f} Hz)\n")
            f.write(f"Material: {material.name}\n")
            f.write(f"Tuning ratio: {preset.name}\n\n")
            f.write(f"Bar Dimensions:\n")
            f.write(f"  Length: {bar_length_mm:.1f} mm\n")
            f.write(f"  Width: {width_mm:.1f} mm\n")
            f.write(f"  Height: {height_mm:.1f} mm\n\n")
            f.write(f"Frequencies:\n")
            for i, (f_val, ft, e) in enumerate(zip(final_freqs, target_frequencies, errors_cents)):
                sign = '+' if e >= 0 else ''
                f.write(f"  f{i+1}: {f_val:.2f} Hz (target: {ft:.2f} Hz, {sign}{e:.1f} cents)\n")
            f.write(f"\nTuning Error: {tuning_error:.4f}%\n")
            f.write(f"Max Error: {max_error:.1f} cents\n\n")
            f.write(f"Cut Geometry (symmetric about center):\n")
            for i, cut in enumerate(cuts):
                depth_mm = (bar.h0 - cut.h) * 1000
                width_cut = cut.lambda_ * 2 * 1000
                f.write(f"  Cut {i+1}: lambda = {cut.lambda_*1000:.2f} mm, h = {cut.h*1000:.2f} mm\n")
                f.write(f"          (width = {width_cut:.1f} mm, depth = {depth_mm:.2f} mm)\n")

        elapsed = time.time() - start_time

        if verbose:
            print(f"    Saved to: {note_output_dir}/")
            print(f"    Time: {elapsed:.1f}s")

        return BarResult(
            note_name=note_name,
            note_frequency=note_frequency,
            bar_length=bar_length_mm,
            initial_length=initial_length_mm,
            target_frequencies=target_frequencies,
            computed_frequencies_2d=result_2d.computed_frequencies,
            computed_frequencies_3d=freqs_3d_check,
            frequency_offset=frequency_offset,
            final_frequencies=final_freqs,
            errors_cents=errors_cents,
            tuning_error=tuning_error,
            cuts=cuts,
            optimization_time=elapsed,
            success=True
        )

    except Exception as e:
        elapsed = time.time() - start_time
        if verbose:
            print(f"    ERROR: {str(e)}")

        return BarResult(
            note_name=note_name,
            note_frequency=note_frequency,
            bar_length=0,
            initial_length=0,
            target_frequencies=[],
            computed_frequencies_2d=[],
            computed_frequencies_3d=[],
            frequency_offset=[],
            final_frequencies=[],
            errors_cents=[],
            tuning_error=float('inf'),
            cuts=[],
            optimization_time=elapsed,
            success=False,
            error_message=str(e)
        )


def main():
    """Main entry point."""
    print("=" * 70)
    print("XYLOPHONE RANGE OPTIMIZATION")
    print("=" * 70)

    # Load material and preset
    material = MATERIALS[MATERIAL_NAME]
    preset = get_preset(TUNING_RATIO)

    print(f"\nConfiguration:")
    print(f"  Note range: {START_NOTE} to {END_NOTE}")
    print(f"  Bar dimensions: {BAR_WIDTH}mm x {BAR_HEIGHT}mm (W x H)")
    print(f"  Material: {material.name}")
    print(f"    Young's modulus: {material.E / 1e9:.1f} GPa")
    print(f"    Density: {material.rho:.0f} kg/m³")
    print(f"  Tuning ratio: {preset.name} ({preset.description})")
    print(f"  Number of cuts: {NUM_CUTS}")
    print(f"  Output directory: {OUTPUT_DIR}/")

    # Generate notes in range
    notes = generate_notes_in_range(START_NOTE, END_NOTE, scale_type='chromatic')

    print(f"\nNotes to process: {len(notes)}")
    for note in notes:
        print(f"  {note.name}: {note.frequency:.2f} Hz")

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Process each bar
    results: List[BarResult] = []
    total_start = time.time()

    for i, note in enumerate(notes):
        print(f"\n[{i+1}/{len(notes)}] ", end="")

        result = process_single_bar(
            note_name=note.name,
            note_frequency=note.frequency,
            width_mm=BAR_WIDTH,
            height_mm=BAR_HEIGHT,
            material=material,
            preset=preset,
            num_cuts=NUM_CUTS,
            output_dir=OUTPUT_DIR,
            verbose=True
        )

        results.append(result)

    total_time = time.time() - total_start

    # Generate summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)

    successful = [r for r in results if r.success]
    failed = [r for r in results if not r.success]

    print(f"\nTotal bars: {len(results)}")
    print(f"Successful: {len(successful)}")
    print(f"Failed: {len(failed)}")
    print(f"Total time: {total_time:.1f}s ({total_time/len(results):.1f}s per bar)")

    if successful:
        print(f"\nBar Summary:")
        print(f"{'Note':<6} {'Length':>8} {'f1':>8} {'f2':>8} {'f3':>8} {'Error':>8} {'Max Cents':>10}")
        print("-" * 70)

        for r in successful:
            f1 = r.final_frequencies[0] if len(r.final_frequencies) > 0 else 0
            f2 = r.final_frequencies[1] if len(r.final_frequencies) > 1 else 0
            f3 = r.final_frequencies[2] if len(r.final_frequencies) > 2 else 0
            max_cents = max(abs(e) for e in r.errors_cents) if r.errors_cents else 0
            print(f"{r.note_name:<6} {r.bar_length:>7.1f}mm {f1:>7.1f}Hz {f2:>7.1f}Hz {f3:>7.1f}Hz {r.tuning_error:>7.4f}% {max_cents:>9.1f}¢")

    if failed:
        print(f"\nFailed bars:")
        for r in failed:
            print(f"  {r.note_name}: {r.error_message}")

    # Write summary file
    summary_path = os.path.join(OUTPUT_DIR, 'summary.txt')
    with open(summary_path, 'w') as f:
        f.write("XYLOPHONE RANGE OPTIMIZATION SUMMARY\n")
        f.write("=" * 60 + "\n\n")
        f.write(f"Configuration:\n")
        f.write(f"  Note range: {START_NOTE} to {END_NOTE}\n")
        f.write(f"  Bar dimensions: {BAR_WIDTH}mm x {BAR_HEIGHT}mm (W x H)\n")
        f.write(f"  Material: {material.name}\n")
        f.write(f"  Tuning ratio: {preset.name}\n")
        f.write(f"  Number of cuts: {NUM_CUTS}\n\n")

        f.write(f"Results:\n")
        f.write(f"  Total bars: {len(results)}\n")
        f.write(f"  Successful: {len(successful)}\n")
        f.write(f"  Failed: {len(failed)}\n")
        f.write(f"  Total time: {total_time:.1f}s\n\n")

        if successful:
            f.write("Bar Details:\n")
            f.write("-" * 60 + "\n")
            for r in successful:
                f.write(f"\n{r.note_name} ({r.note_frequency:.2f} Hz):\n")
                f.write(f"  Length: {r.bar_length:.1f} mm\n")
                f.write(f"  Frequencies:\n")
                for i, (freq, target, cents) in enumerate(zip(r.final_frequencies, r.target_frequencies, r.errors_cents)):
                    sign = '+' if cents >= 0 else ''
                    f.write(f"    f{i+1}: {freq:.1f} Hz (target: {target:.1f} Hz, {sign}{cents:.1f} cents)\n")
                f.write(f"  Tuning error: {r.tuning_error:.4f}%\n")
                f.write(f"  Cuts:\n")
                for i, cut in enumerate(r.cuts):
                    f.write(f"    {i+1}: lambda = {cut.lambda_*1000:.2f} mm, h = {cut.h*1000:.2f} mm\n")

    print(f"\nSummary saved to: {summary_path}")
    print(f"Diagrams saved to: {OUTPUT_DIR}/<note>/")


if __name__ == "__main__":
    main()
