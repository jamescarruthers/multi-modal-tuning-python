"""
Surrogate Optimization for Expensive 3D FEM Evaluations

Implements surrogate-based global optimization using radial basis function
interpolation, based on:

Soares et al. (2021) "Tuning of bending and torsional modes of bars used in
mallet percussion instruments", JASA 150(4), pp.2757-2769.

Key references for the surrogate algorithm:
- Gutmann (2001) "A radial basis function method for global optimization"
- Regis & Shoemaker (2007) "A stochastic radial basis function method..."

The surrogate approach is more efficient than evolutionary algorithms for
expensive objective functions (like 3D FEM) because it:
1. Builds an interpolating surrogate function from evaluated points
2. Uses the surrogate to guide search for promising new candidates
3. Balances exploitation (minimizing surrogate) and exploration (distance)
"""

from typing import List, Optional, Callable, Tuple, Literal
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
import os
import numpy as np

from ..types import (
    Individual,
    BarParameters,
    Material,
    EAParameters,
    OptimizationResult,
    ProgressUpdate,
    BatchProgressState,
    AnalysisMode,
    VariableBounds,
)
from ..physics.frequencies import compute_frequencies_from_genes
from ..physics.bar_profile import genes_to_cuts
from .population import create_bounds, get_length_adjust_from_genes, BoundsConstraints
from .penalties import compute_volume_penalty, compute_roughness_penalty
from .objective import compute_tuning_error, evaluate_detailed


@dataclass
class SurrogateConfig:
    """Configuration for surrogate optimization."""
    bar: BarParameters
    material: Material
    target_frequencies: List[float]
    num_cuts: int
    bounds: VariableBounds
    max_evaluations: int = 500
    initial_points: int = 20
    penalty_type: str = 'none'
    penalty_weight: float = 0.0
    f1_priority: float = 1.0
    num_elements: int = 150
    target_error: float = 0.01
    analysis_mode: AnalysisMode = AnalysisMode.BEAM_2D
    ny: int = 2
    nz: int = 2
    target_modes: Optional[List[str]] = None  # Target modes for 3D analysis
    max_workers: int = 0  # 0 = auto-detect
    use_parallel: bool = True
    parallel_mode: Literal['threading', 'multiprocessing', 'auto'] = 'auto'
    on_progress: Optional[Callable[[ProgressUpdate], None]] = None
    should_stop: Optional[Callable[[], bool]] = None


def _objective_function(
    genes: List[float],
    config: SurrogateConfig
) -> float:
    """
    Objective function for surrogate optimization.

    Returns tuning error (optionally combined with penalties).
    """
    try:
        computed_freq = compute_frequencies_from_genes(
            genes,
            config.bar,
            config.material,
            len(config.target_frequencies),
            config.num_elements,
            config.num_cuts,
            config.analysis_mode,
            config.ny,
            config.nz,
            config.target_modes
        )

        tuning_error = compute_tuning_error(
            computed_freq,
            config.target_frequencies,
            config.f1_priority
        )

        if config.penalty_type != 'none' and config.penalty_weight > 0:
            cuts = genes_to_cuts(genes[:config.num_cuts * 2])
            length_adjust = get_length_adjust_from_genes(genes, config.num_cuts)
            effective_L = config.bar.L - 2 * length_adjust

            if config.penalty_type == 'volume':
                penalty = compute_volume_penalty(cuts, effective_L, config.bar.h0)
            else:
                penalty = compute_roughness_penalty(cuts, config.bar.h0)

            return (1 - config.penalty_weight) * tuning_error + config.penalty_weight * penalty

        return tuning_error

    except Exception:
        return 1e10


def run_surrogate_optimization(config: SurrogateConfig) -> OptimizationResult:
    """
    Run surrogate-based global optimization.

    Uses scipy.optimize.minimize with RBF surrogate guidance when available,
    falls back to differential evolution otherwise.

    Args:
        config: Surrogate optimization configuration

    Returns:
        OptimizationResult with best solution found
    """
    try:
        from scipy.optimize import differential_evolution, minimize
        from scipy.interpolate import RBFInterpolator
    except ImportError:
        raise ImportError("scipy is required for surrogate optimization")

    bounds = config.bounds
    num_cuts = config.num_cuts
    has_length_adjust = bounds.max_length_trim > 0 or bounds.max_length_extend > 0
    num_genes = num_cuts * 2 + (1 if has_length_adjust else 0)

    # Build bounds list for scipy
    scipy_bounds = []
    for i in range(num_cuts):
        scipy_bounds.append((bounds.lambda_min, bounds.lambda_max))  # lambda
        scipy_bounds.append((bounds.h_min, bounds.h_max))  # h
    if has_length_adjust:
        scipy_bounds.append((-bounds.max_length_extend, bounds.max_length_trim))

    # Track evaluated points
    evaluated_points: List[np.ndarray] = []
    evaluated_values: List[float] = []
    best_genes: Optional[List[float]] = None
    best_fitness = float('inf')
    evaluations = 0

    def wrapped_objective(x: np.ndarray) -> float:
        """Wrapper that tracks evaluations and updates best."""
        nonlocal evaluations, best_genes, best_fitness

        if config.should_stop and config.should_stop():
            return best_fitness

        genes = x.tolist()
        fitness = _objective_function(genes, config)

        evaluated_points.append(x.copy())
        evaluated_values.append(fitness)
        evaluations += 1

        if fitness < best_fitness:
            best_fitness = fitness
            best_genes = genes.copy()

            # Report progress
            if config.on_progress:
                try:
                    computed_freq = compute_frequencies_from_genes(
                        genes, config.bar, config.material,
                        len(config.target_frequencies),
                        config.num_elements, config.num_cuts,
                        config.analysis_mode, config.ny, config.nz,
                        config.target_modes
                    )
                    errors_cents = []
                    for i, comp in enumerate(computed_freq):
                        target = config.target_frequencies[i] if i < len(config.target_frequencies) else 0
                        if target > 0:
                            import math
                            errors_cents.append(1200 * math.log2(comp / target))
                        else:
                            errors_cents.append(0.0)
                except Exception:
                    computed_freq = []
                    errors_cents = []

                config.on_progress(ProgressUpdate(
                    generation=evaluations,
                    best_fitness=best_fitness,
                    best_individual=Individual(genes=genes, fitness=best_fitness),
                    average_fitness=best_fitness,
                    computed_frequencies=computed_freq,
                    errors_in_cents=errors_cents,
                    length_trim=get_length_adjust_from_genes(genes, config.num_cuts)
                ))

        return fitness

    # Phase 1: Initial sampling with Latin Hypercube or random
    np.random.seed(42)  # Reproducibility
    initial_samples = np.random.uniform(
        low=[b[0] for b in scipy_bounds],
        high=[b[1] for b in scipy_bounds],
        size=(config.initial_points, num_genes)
    )

    # Parallel initial sampling
    if config.use_parallel and config.initial_points >= 4:
        max_workers = config.max_workers if config.max_workers > 0 else (os.cpu_count() or 4)
        max_workers = min(max_workers, config.initial_points)

        def evaluate_sample(sample: np.ndarray) -> Tuple[np.ndarray, float]:
            """Evaluate a single sample and return (sample, fitness)."""
            genes = sample.tolist()
            fitness = _objective_function(genes, config)
            return sample, fitness

        # Auto mode: use threading (NumPy releases GIL, lower overhead)
        parallel_mode = config.parallel_mode
        if parallel_mode == 'auto':
            parallel_mode = 'threading'

        # Select executor based on mode
        if parallel_mode == 'multiprocessing':
            Executor = ProcessPoolExecutor
        else:
            Executor = ThreadPoolExecutor

        # Track batch progress for initial sampling
        initial_completed = 0
        total_initial = config.initial_points

        with Executor(max_workers=max_workers) as executor:
            futures = [executor.submit(evaluate_sample, sample) for sample in initial_samples]

            for future in as_completed(futures):
                if config.should_stop and config.should_stop():
                    break
                if best_fitness <= config.target_error:
                    break

                try:
                    sample, fitness = future.result()
                    evaluated_points.append(sample.copy())
                    evaluated_values.append(fitness)
                    evaluations += 1
                    initial_completed += 1

                    if fitness < best_fitness:
                        best_fitness = fitness
                        best_genes = sample.tolist()

                    # Report progress with batch info for 3D analysis
                    if config.on_progress:
                        try:
                            if best_genes:
                                computed_freq = compute_frequencies_from_genes(
                                    best_genes, config.bar, config.material,
                                    len(config.target_frequencies),
                                    config.num_elements, config.num_cuts,
                                    config.analysis_mode, config.ny, config.nz,
                                    config.target_modes
                                )
                                errors_cents = []
                                for i, comp in enumerate(computed_freq):
                                    target = config.target_frequencies[i] if i < len(config.target_frequencies) else 0
                                    if target > 0:
                                        import math
                                        errors_cents.append(1200 * math.log2(comp / target))
                                    else:
                                        errors_cents.append(0.0)
                            else:
                                computed_freq = []
                                errors_cents = []
                        except Exception:
                            computed_freq = []
                            errors_cents = []

                        # Create batch progress for 3D analysis
                        batch_progress = None
                        if config.analysis_mode == AnalysisMode.SOLID_3D:
                            batch_progress = BatchProgressState(
                                completed=initial_completed,
                                total=total_initial,
                                best_fitness_so_far=best_fitness if best_fitness < float('inf') else None,
                                message=f"Initial sampling: {initial_completed}/{total_initial}"
                            )

                        config.on_progress(ProgressUpdate(
                            generation=evaluations,
                            best_fitness=best_fitness,
                            best_individual=Individual(genes=best_genes or [], fitness=best_fitness),
                            average_fitness=best_fitness,
                            computed_frequencies=computed_freq,
                            errors_in_cents=errors_cents,
                            length_trim=get_length_adjust_from_genes(best_genes, config.num_cuts) if best_genes else 0.0,
                            batch_progress=batch_progress,
                        ))
                except Exception:
                    pass
    else:
        # Serial fallback
        for sample in initial_samples:
            if evaluations >= config.max_evaluations:
                break
            if best_fitness <= config.target_error:
                break
            wrapped_objective(sample)

    # Phase 2: Surrogate-guided optimization
    # Use differential evolution with the surrogate as a guide
    if evaluations < config.max_evaluations and best_fitness > config.target_error:
        try:
            # Build RBF surrogate from evaluated points
            if len(evaluated_points) >= 10:
                X = np.array(evaluated_points)
                y = np.array(evaluated_values)

                # Fit RBF interpolator
                rbf = RBFInterpolator(X, y, kernel='cubic')

                # Use surrogate to find promising starting point
                def surrogate_objective(x):
                    return rbf(x.reshape(1, -1))[0]

                # Quick local search on surrogate - parallelized multi-start
                best_surrogate_point = None
                best_surrogate_value = float('inf')

                num_starts = min(100, config.max_evaluations - evaluations)

                # Generate all starting points upfront
                start_points = [
                    np.random.uniform(
                        low=[b[0] for b in scipy_bounds],
                        high=[b[1] for b in scipy_bounds]
                    )
                    for _ in range(num_starts)
                ]

                def run_local_optimization(x0: np.ndarray) -> Tuple[float, np.ndarray]:
                    """Run L-BFGS-B from starting point on surrogate."""
                    try:
                        result = minimize(
                            surrogate_objective,
                            x0,
                            method='L-BFGS-B',
                            bounds=scipy_bounds,
                            options={'maxiter': 50}
                        )
                        return result.fun, result.x
                    except Exception:
                        return float('inf'), x0

                if config.use_parallel and num_starts >= 4:
                    max_workers = config.max_workers if config.max_workers > 0 else (os.cpu_count() or 4)
                    max_workers = min(max_workers, num_starts)

                    # Auto mode: use threading (SciPy L-BFGS-B releases GIL)
                    parallel_mode = config.parallel_mode
                    if parallel_mode == 'auto':
                        parallel_mode = 'threading'

                    # Select executor based on mode
                    if parallel_mode == 'multiprocessing':
                        Executor = ProcessPoolExecutor
                    else:
                        Executor = ThreadPoolExecutor

                    with Executor(max_workers=max_workers) as executor:
                        futures = [executor.submit(run_local_optimization, x0) for x0 in start_points]

                        for future in as_completed(futures):
                            try:
                                val, point = future.result()
                                if val < best_surrogate_value:
                                    best_surrogate_value = val
                                    best_surrogate_point = point
                            except Exception:
                                pass
                else:
                    # Serial fallback
                    for x0 in start_points:
                        try:
                            val, point = run_local_optimization(x0)
                            if val < best_surrogate_value:
                                best_surrogate_value = val
                                best_surrogate_point = point
                        except Exception:
                            pass

                # Evaluate surrogate-suggested point
                if best_surrogate_point is not None:
                    wrapped_objective(best_surrogate_point)

        except Exception:
            pass  # Fall through to differential evolution

        # Phase 3: Final refinement with differential evolution
        remaining_evals = config.max_evaluations - evaluations
        if remaining_evals > 10 and best_fitness > config.target_error:
            try:
                result = differential_evolution(
                    wrapped_objective,
                    scipy_bounds,
                    maxiter=remaining_evals // 10,
                    popsize=min(15, remaining_evals // 5),
                    tol=config.target_error / 100,
                    seed=42,
                    polish=True,
                    x0=best_genes if best_genes else None
                )
                if result.fun < best_fitness:
                    best_genes = result.x.tolist()
                    best_fitness = result.fun
            except Exception:
                pass

    # Build final result
    if best_genes is None:
        # Fallback: use uniform bar
        best_genes = []
        for i in range(num_cuts):
            best_genes.append(bounds.lambda_max * (num_cuts - i) / num_cuts)
            best_genes.append(config.bar.h0)
        if has_length_adjust:
            best_genes.append(0.0)
        best_fitness = wrapped_objective(np.array(best_genes))

    length_adjust = get_length_adjust_from_genes(best_genes, num_cuts)
    effective_length = config.bar.L - 2 * length_adjust

    effective_bar = BarParameters(
        L=effective_length,
        b=config.bar.b,
        h0=config.bar.h0,
        hMin=config.bar.hMin
    ) if length_adjust != 0 else config.bar

    cut_genes = best_genes[:num_cuts * 2]

    # For 3D analysis, also compute mode shapes for visualization
    is_3d = config.analysis_mode == AnalysisMode.SOLID_3D
    detailed = evaluate_detailed(
        cut_genes,
        effective_bar,
        config.material,
        config.target_frequencies,
        config.penalty_type,
        config.penalty_weight,
        config.num_elements,
        num_cuts,
        config.analysis_mode,
        config.ny,
        config.nz,
        config.target_modes,
        compute_mode_shapes=is_3d,
        num_modes_for_shapes=12,
    )

    return OptimizationResult(
        best_individual=Individual(genes=best_genes, fitness=best_fitness),
        cuts=genes_to_cuts(cut_genes),
        computed_frequencies=detailed.computed_frequencies,
        target_frequencies=config.target_frequencies,
        tuning_error=detailed.tuning_error,
        max_error_cents=detailed.max_cents_error,
        errors_in_cents=detailed.cents_errors,
        volume_percent=detailed.volume_penalty,
        roughness_percent=detailed.roughness_penalty,
        generations=evaluations,
        length_trim=length_adjust,
        effective_length=effective_length,
        mode_shapes_result=detailed.mode_shapes_result,
    )
