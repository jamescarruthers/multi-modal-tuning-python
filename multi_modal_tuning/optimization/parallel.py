"""
Parallel Utilities for Optimization

Provides parallel execution helpers using both threading and multiprocessing.

Threading vs Multiprocessing:
- Threading: Lower overhead (~100μs), works well when NumPy/SciPy release GIL
- Multiprocessing: Higher overhead (~10-100ms), bypasses GIL completely

For FEM computations (NumPy-heavy), threading is preferred due to:
1. NumPy releases GIL during array operations
2. Much lower spawning overhead
3. Shared memory (no serialization needed)
"""

from typing import List, Tuple, Callable, TypeVar, Any, Literal
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
from enum import Enum
import os

from ..types import Individual, VariableBounds


class ParallelMode(Enum):
    """Parallelization mode selection."""
    SERIAL = "serial"           # No parallelization
    THREADING = "threading"     # ThreadPoolExecutor (good for NumPy/SciPy)
    MULTIPROCESSING = "multiprocessing"  # ProcessPoolExecutor (bypasses GIL)
    AUTO = "auto"               # Automatically choose based on task


# Default number of workers (0 = auto-detect)
DEFAULT_MAX_WORKERS = 0


def get_worker_count(max_workers: int = 0, task_count: int = 1) -> int:
    """
    Determine optimal number of workers.

    Args:
        max_workers: Maximum workers (0 = auto-detect based on CPU count)
        task_count: Number of tasks to execute

    Returns:
        Optimal number of workers
    """
    if max_workers <= 0:
        max_workers = os.cpu_count() or 4
    return min(max_workers, task_count)


def get_executor(mode: ParallelMode, max_workers: int):
    """
    Get appropriate executor based on mode.

    Args:
        mode: Parallelization mode
        max_workers: Number of workers

    Returns:
        Executor context manager
    """
    if mode == ParallelMode.THREADING:
        return ThreadPoolExecutor(max_workers=max_workers)
    elif mode == ParallelMode.MULTIPROCESSING:
        return ProcessPoolExecutor(max_workers=max_workers)
    else:
        raise ValueError(f"Invalid mode for executor: {mode}")


T = TypeVar('T')


def parallel_map(
    func: Callable[..., T],
    items: List[Any],
    max_workers: int = 0,
    mode: ParallelMode = ParallelMode.THREADING
) -> List[T]:
    """
    Apply function to items in parallel.

    Args:
        func: Function to apply
        items: List of items to process
        max_workers: Maximum workers (0 = auto)
        mode: Parallelization mode (THREADING or MULTIPROCESSING)

    Returns:
        List of results in same order as items
    """
    if len(items) == 0:
        return []

    if len(items) == 1 or mode == ParallelMode.SERIAL:
        return [func(item) for item in items]

    workers = get_worker_count(max_workers, len(items))

    # For very small workloads, serial may be faster
    if len(items) < 4 or workers < 2:
        return [func(item) for item in items]

    results = [None] * len(items)

    with get_executor(mode, workers) as executor:
        future_to_idx = {
            executor.submit(func, item): idx
            for idx, item in enumerate(items)
        }

        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                raise RuntimeError(f"Parallel execution failed for item {idx}") from e

    return results


# =============================================================================
# Crossover parallelization helpers
# =============================================================================

def _do_heuristic_crossover(args: Tuple) -> Tuple[Individual, Individual]:
    """
    Perform heuristic crossover on a single pair.
    Top-level function for pickling compatibility with multiprocessing.
    """
    parent1, parent2, bounds_dict = args
    from .crossover import heuristic_crossover
    bounds = _dict_to_bounds(bounds_dict)
    return heuristic_crossover(parent1, parent2, bounds)


def _do_single_point_crossover(args: Tuple) -> Tuple[Individual, Individual]:
    """Single-point crossover wrapper."""
    parent1, parent2, bounds_dict = args
    from .crossover import single_point_crossover
    bounds = _dict_to_bounds(bounds_dict)
    return single_point_crossover(parent1, parent2, bounds)


def _do_two_point_crossover(args: Tuple) -> Tuple[Individual, Individual]:
    """Two-point crossover wrapper."""
    parent1, parent2, bounds_dict = args
    from .crossover import two_point_crossover
    bounds = _dict_to_bounds(bounds_dict)
    return two_point_crossover(parent1, parent2, bounds)


def _do_uniform_crossover(args: Tuple) -> Tuple[Individual, Individual]:
    """Uniform crossover wrapper."""
    parent1, parent2, bounds_dict = args
    from .crossover import uniform_crossover
    bounds = _dict_to_bounds(bounds_dict)
    return uniform_crossover(parent1, parent2, bounds)


def _do_blend_crossover(args: Tuple) -> Tuple[Individual, Individual]:
    """Blend crossover wrapper."""
    parent1, parent2, bounds_dict = args
    from .crossover import blend_crossover
    bounds = _dict_to_bounds(bounds_dict)
    return blend_crossover(parent1, parent2, bounds)


def _bounds_to_dict(bounds: VariableBounds) -> dict:
    """Convert VariableBounds to dict for pickling."""
    return {
        'lambda_min': bounds.lambda_min,
        'lambda_max': bounds.lambda_max,
        'h_min': bounds.h_min,
        'h_max': bounds.h_max,
        'max_length_trim': bounds.max_length_trim,
        'max_length_extend': bounds.max_length_extend,
    }


def _dict_to_bounds(d: dict) -> VariableBounds:
    """Convert dict back to VariableBounds."""
    return VariableBounds(
        lambda_min=d['lambda_min'],
        lambda_max=d['lambda_max'],
        h_min=d['h_min'],
        h_max=d['h_max'],
        max_length_trim=d['max_length_trim'],
        max_length_extend=d['max_length_extend'],
    )


def parallel_crossover(
    pairs: List[Tuple[Individual, Individual]],
    bounds: VariableBounds,
    crossover_func: Callable[
        [Individual, Individual, VariableBounds],
        Tuple[Individual, Individual]
    ],
    max_workers: int = 0
) -> List[Individual]:
    """
    Perform crossover on multiple pairs.

    Note: Crossover operations are very fast, so parallelization overhead
    typically exceeds the computation time. This always uses serial execution.

    Args:
        pairs: List of (parent1, parent2) tuples
        bounds: Variable bounds
        crossover_func: Crossover function to use
        max_workers: Ignored (serial only)

    Returns:
        List of children (2 per pair)
    """
    if len(pairs) == 0:
        return []

    # Crossover is too fast for any parallelism overhead - always use serial
    children = []
    for p1, p2 in pairs:
        c1, c2 = crossover_func(p1, p2, bounds)
        children.extend([c1, c2])
    return children


# =============================================================================
# Mutation parallelization helpers
# =============================================================================

def _do_uniform_mutation(args: Tuple) -> Individual:
    """
    Perform uniform mutation on a single individual.
    Top-level function for pickling compatibility.
    """
    individual, sigma, bounds_dict = args
    from .mutation import uniform_mutation
    bounds = _dict_to_bounds(bounds_dict)
    return uniform_mutation(individual, sigma, bounds)


def _do_gaussian_mutation(args: Tuple) -> Individual:
    """Gaussian self-adaptive mutation wrapper."""
    individual, sigma, bounds_dict = args
    from .mutation import gaussian_self_adaptive_mutation
    bounds = _dict_to_bounds(bounds_dict)
    return gaussian_self_adaptive_mutation(individual, sigma, bounds)


def parallel_mutation(
    individuals: List[Individual],
    bounds: VariableBounds,
    mutation_func: Callable[[Individual, float, VariableBounds], Individual],
    sigma: float,
    max_workers: int = 0
) -> List[Individual]:
    """
    Perform mutation on multiple individuals.

    Note: Mutation operations are very fast, so parallelization overhead
    typically exceeds the computation time. This always uses serial execution.

    Args:
        individuals: List of individuals to mutate
        bounds: Variable bounds
        mutation_func: Mutation function to use
        sigma: Mutation strength
        max_workers: Ignored (serial only)

    Returns:
        List of mutated individuals
    """
    if len(individuals) == 0:
        return []

    # Mutation is too fast for any parallelism overhead - always use serial
    return [mutation_func(ind, sigma, bounds) for ind in individuals]
