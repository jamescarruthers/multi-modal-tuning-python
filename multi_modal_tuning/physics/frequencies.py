"""
Frequency Computation Module

Main functions for computing natural frequencies of undercut bars
using the FEM model. Supports both 2D Timoshenko beam and 3D solid
element analysis.
"""

from typing import List, Optional, Literal, Callable
import math
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
import os

from ..types import BarParameters, Material, AnalysisMode, BatchProgressState
from .bar_profile import genes_to_cuts
from .fem_assembly import assemble_global_matrices, solve_generalized_eigenvalue
from .fem_3d import (
    compute_frequencies_3d,
    get_bending_frequencies_3d,
    compute_frequencies_3d_classified,
)


def compute_frequencies(
    element_heights: List[float],
    le: float,
    b: float,
    E: float,
    rho: float,
    nu: float,
    num_modes: int,
    analysis_mode: AnalysisMode = AnalysisMode.BEAM_2D,
    ny: int = 2,
    nz: int = 2,
    target_modes: Optional[List[str]] = None,
) -> List[float]:
    """
    Compute natural frequencies for a bar with given element heights.

    Args:
        element_heights: Height of each finite element (m)
        le: Length of each element (m)
        b: Bar width (m)
        E: Young's modulus (Pa)
        rho: Density (kg/m^3)
        nu: Poisson's ratio
        num_modes: Number of modes to extract
        analysis_mode: BEAM_2D (fast) or SOLID_3D (accurate)
        ny: Number of elements in width direction (3D only)
        nz: Number of elements in thickness direction (3D only)
        target_modes: List of target mode identifiers like ['V1', 'V2', 'V3'] or ['V1', 'V2', 'T1'].
                     Only used for 3D analysis. If None, returns first N modes (unclassified).
                     V=vertical_bending, T=torsional, L=lateral, A=axial

    Returns:
        List of natural frequencies in Hz
    """
    if analysis_mode == AnalysisMode.SOLID_3D:
        # 3D solid element analysis
        length = le * len(element_heights)

        if target_modes is not None:
            # Use classified mode extraction
            return compute_frequencies_for_target_modes(
                element_heights, length, b, E, rho, nu, target_modes, ny, nz
            )
        else:
            # Legacy behavior: return first N modes (unclassified)
            return compute_frequencies_3d(
                element_heights, length, b, E, rho, nu, num_modes, ny, nz
            )
    else:
        # 2D Timoshenko beam analysis (default)
        # 2D only computes bending modes, so target_modes is ignored
        K, M = assemble_global_matrices(element_heights, le, b, E, rho, nu)
        return solve_generalized_eigenvalue(K, M, num_modes)


def compute_frequencies_for_target_modes(
    element_heights: List[float],
    length: float,
    width: float,
    E: float,
    rho: float,
    nu: float,
    target_modes: List[str],
    ny: int = 2,
    nz: int = 2,
) -> List[float]:
    """
    Compute frequencies for specific target modes using 3D FEM with classification.

    Args:
        element_heights: Height of each element along bar length (m)
        length: Bar length (m)
        width: Bar width (m)
        E: Young's modulus (Pa)
        rho: Density (kg/m^3)
        nu: Poisson's ratio
        target_modes: List of mode identifiers like ['V1', 'V2', 'V3'] or ['V1', 'T1', 'V2']
                     V=vertical_bending, T=torsional, L=lateral, A=axial
        ny: Number of elements in width direction
        nz: Number of elements in thickness direction

    Returns:
        List of frequencies in Hz, one per target mode (in order specified)
    """
    # Parse target modes to determine how many of each type we need
    mode_type_map = {
        'V': 'vertical_bending',
        'T': 'torsional',
        'L': 'lateral',
        'A': 'axial',
    }

    # Count max mode number needed per type
    max_per_type = {'vertical_bending': 0, 'torsional': 0, 'lateral': 0, 'axial': 0}
    parsed_targets = []
    for mode_str in target_modes:
        if len(mode_str) >= 2:
            type_char = mode_str[0].upper()
            mode_num = int(mode_str[1:])
            mode_type = mode_type_map.get(type_char)
            if mode_type:
                parsed_targets.append((mode_type, mode_num))
                max_per_type[mode_type] = max(max_per_type[mode_type], mode_num)

    # Request enough modes to find all needed
    total_modes_needed = sum(max_per_type.values())
    num_request = max(total_modes_needed * 2 + 6, 12)  # Request extra for safety

    # Compute classified frequencies
    all_frequencies, classified, _ = compute_frequencies_3d_classified(
        element_heights, length, width, E, rho, nu, num_request, ny, nz
    )

    # Extract frequencies in the order specified by target_modes
    result = []
    for mode_type, mode_num in parsed_targets:
        family_modes = classified.get(mode_type, [])
        # mode_number is 1-indexed in the classification
        matching = [m for m in family_modes if m['mode_number'] == mode_num]
        if matching:
            result.append(matching[0]['frequency'])
        else:
            # Mode not found - return a very high frequency to penalize
            result.append(float('inf'))

    return result


def compute_frequencies_from_genes(
    genes: List[float],
    bar: BarParameters,
    material: Material,
    num_modes: int,
    num_elements: int,
    num_cuts: int = 0,
    analysis_mode: AnalysisMode = AnalysisMode.BEAM_2D,
    ny: int = 2,
    nz: int = 2,
    target_modes: Optional[List[str]] = None,
) -> List[float]:
    """
    Compute frequencies directly from cut parameters (genes).
    Combines profile generation and frequency computation.

    Args:
        genes: Flat array [lambda_1, h_1, lambda_2, h_2, ..., length_adjust?]
        bar: Bar parameters
        material: Material properties
        num_modes: Number of modes to extract
        num_elements: Number of finite elements
        num_cuts: Number of cuts (for determining length adjustment gene)
        analysis_mode: BEAM_2D (fast) or SOLID_3D (accurate)
        ny: Number of elements in width direction (3D only)
        nz: Number of elements in thickness direction (3D only)
        target_modes: List of target mode identifiers like ['V1', 'V2', 'V3'] or ['V1', 'V2', 'T1'].
                     Only used for 3D analysis. If None, returns first N modes (unclassified).

    Returns:
        List of natural frequencies in Hz
    """
    # Handle length adjustment if present
    # Length adjust gene is at position num_cuts * 2 (after all cut genes)
    bar_length = bar.L
    expected_cut_genes = num_cuts * 2
    if len(genes) > expected_cut_genes:
        length_adjust = genes[expected_cut_genes]
        bar_length = bar.L - 2 * length_adjust

    # Parse genes into cuts
    cut_genes = genes[:expected_cut_genes] if num_cuts > 0 else []
    cuts = genes_to_cuts(cut_genes)

    # Sort by lambda descending (largest first)
    cuts = sorted(cuts, key=lambda c: c.lambda_, reverse=True)

    # Generate element heights
    le = bar_length / num_elements
    center_x = bar_length / 2

    element_heights: List[float] = []
    for e in range(num_elements):
        x_mid = (e + 0.5) * le
        dist_from_center = abs(x_mid - center_x)

        # Find all cuts that contain this point, return the innermost one's height
        innermost_h = bar.h0
        for cut in cuts:
            if cut.lambda_ > 0 and dist_from_center <= cut.lambda_:
                innermost_h = cut.h

        element_heights.append(innermost_h)

    return compute_frequencies(
        element_heights,
        le,
        bar.b,
        material.E,
        material.rho,
        material.nu,
        num_modes,
        analysis_mode,
        ny,
        nz,
        target_modes,
    )


def _compute_single_fitness(
    genes: List[float],
    bar_length: float,
    bar_width: float,
    h0: float,
    num_elements: int,
    E: float,
    rho: float,
    nu: float,
    target_frequencies: List[float],
    f1_priority: float,
    num_cuts: int,
    analysis_mode: AnalysisMode = AnalysisMode.BEAM_2D,
    ny: int = 2,
    nz: int = 2,
    target_modes: Optional[List[str]] = None,
) -> float:
    """
    Compute fitness for a single individual.
    Internal function used by batch_compute_fitness.

    Args:
        target_modes: For 3D analysis, specifies which modes to tune (e.g., ['V1', 'V2', 'V3']).
                     If None, uses first N modes by frequency (unclassified).
    """
    # Handle length adjustment if present
    # Length adjust gene is at position num_cuts * 2 (after all cut genes)
    effective_length = bar_length
    expected_cut_genes = num_cuts * 2
    if len(genes) > expected_cut_genes:
        length_adjust = genes[expected_cut_genes]
        effective_length = bar_length - 2 * length_adjust

    # Parse genes into cuts
    cut_genes = genes[:expected_cut_genes] if num_cuts > 0 else []
    cuts = genes_to_cuts(cut_genes)
    cuts = sorted(cuts, key=lambda c: c.lambda_, reverse=True)

    # Generate element heights
    le = effective_length / num_elements
    center_x = effective_length / 2

    element_heights: List[float] = []
    for e in range(num_elements):
        x_mid = (e + 0.5) * le
        dist_from_center = abs(x_mid - center_x)

        innermost_h = h0
        for cut in cuts:
            if cut.lambda_ > 0 and dist_from_center <= cut.lambda_:
                innermost_h = cut.h

        element_heights.append(innermost_h)

    # Compute frequencies
    try:
        frequencies = compute_frequencies(
            element_heights,
            le,
            bar_width,
            E,
            rho,
            nu,
            len(target_frequencies),
            analysis_mode,
            ny,
            nz,
            target_modes,
        )
    except Exception:
        return float('inf')

    # Compute weighted tuning error
    num_modes = len(target_frequencies)
    if len(frequencies) < num_modes:
        return float('inf')

    weighted_sum_sq_error = 0.0
    total_weight = 0.0
    for m in range(num_modes):
        weight = f1_priority if m == 0 else 1.0
        rel_error = (frequencies[m] - target_frequencies[m]) / target_frequencies[m]
        weighted_sum_sq_error += weight * rel_error * rel_error
        total_weight += weight

    if total_weight > 0:
        return 100.0 * weighted_sum_sq_error / total_weight
    else:
        return float('inf')


def batch_compute_fitness(
    genes_array: List[List[float]],
    bar: BarParameters,
    material: Material,
    target_frequencies: List[float],
    num_elements: int,
    f1_priority: float = 1.0,
    num_cuts: int = 1,
    max_workers: int = 0,
    analysis_mode: AnalysisMode = AnalysisMode.BEAM_2D,
    ny: int = 2,
    nz: int = 2,
    parallel_mode: Literal['threading', 'multiprocessing', 'auto'] = 'auto',
    target_modes: Optional[List[str]] = None,
    on_batch_progress: Optional[Callable[[BatchProgressState], None]] = None,
    progress_interval: int = 10,
) -> List[float]:
    """
    Batch compute fitness for entire population using parallel execution.

    Args:
        genes_array: List of gene arrays, one per individual
        bar: Bar parameters
        material: Material properties
        target_frequencies: Target frequencies (Hz)
        num_elements: Number of FEM elements
        f1_priority: Weight multiplier for f1 (>1 prioritizes f1)
        num_cuts: Number of cuts per individual
        max_workers: Maximum number of workers (0 = auto)
        analysis_mode: BEAM_2D (fast) or SOLID_3D (accurate)
        ny: Number of elements in width direction (3D only)
        nz: Number of elements in thickness direction (3D only)
        parallel_mode: 'threading' (lower overhead, good for NumPy),
                      'multiprocessing' (bypasses GIL), or 'auto'
        target_modes: For 3D analysis, specifies which modes to tune (e.g., ['V1', 'V2', 'V3']).
                     If None, uses first N modes by frequency (unclassified).
        on_batch_progress: Optional callback for batch progress updates
        progress_interval: How often to report progress (every N completions)

    Returns:
        List of fitness values for each individual
    """
    if max_workers <= 0:
        max_workers = min(os.cpu_count() or 4, len(genes_array))

    # Auto mode: use threading (NumPy releases GIL, lower overhead)
    if parallel_mode == 'auto':
        parallel_mode = 'threading'

    # Select executor based on mode
    if parallel_mode == 'multiprocessing':
        Executor = ProcessPoolExecutor
    else:
        Executor = ThreadPoolExecutor

    fitness_values = [float('inf')] * len(genes_array)
    total = len(genes_array)
    completed_count = 0
    best_fitness_so_far = float('inf')

    with Executor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_idx = {
            executor.submit(
                _compute_single_fitness,
                genes,
                bar.L,
                bar.b,
                bar.h0,
                num_elements,
                material.E,
                material.rho,
                material.nu,
                target_frequencies,
                f1_priority,
                num_cuts,
                analysis_mode,
                ny,
                nz,
                target_modes,
            ): idx
            for idx, genes in enumerate(genes_array)
        }

        # Collect results with progress reporting
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                fitness = future.result()
                fitness_values[idx] = fitness
                if fitness < best_fitness_so_far:
                    best_fitness_so_far = fitness
            except Exception:
                fitness_values[idx] = float('inf')

            completed_count += 1

            # Report progress periodically
            if on_batch_progress and (completed_count % progress_interval == 0 or completed_count == total):
                progress = BatchProgressState(
                    completed=completed_count,
                    total=total,
                    best_fitness_so_far=best_fitness_so_far if best_fitness_so_far < float('inf') else None,
                    message=f"Evaluating: {completed_count}/{total}"
                )
                on_batch_progress(progress)

    return fitness_values
