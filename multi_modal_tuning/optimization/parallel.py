"""
Parallel Utilities for Optimization

Provides parallel execution helpers for crossover, mutation, and other
genetic operations using ThreadPoolExecutor for improved performance.
"""

from typing import List, Tuple, Callable, TypeVar, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
import os

from ..types import Individual, VariableBounds


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


T = TypeVar('T')


def parallel_map(
    func: Callable[..., T],
    items: List[Any],
    max_workers: int = 0
) -> List[T]:
    """
    Apply function to items in parallel.

    Args:
        func: Function to apply
        items: List of items to process
        max_workers: Maximum workers (0 = auto)

    Returns:
        List of results in same order as items
    """
    if len(items) == 0:
        return []

    if len(items) == 1:
        return [func(items[0])]

    workers = get_worker_count(max_workers, len(items))

    # For very small workloads, serial may be faster due to thread overhead
    if len(items) < 4 or workers < 2:
        return [func(item) for item in items]

    results = [None] * len(items)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_idx = {
            executor.submit(func, item): idx
            for idx, item in enumerate(items)
        }

        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                # Re-raise with context
                raise RuntimeError(f"Parallel execution failed for item {idx}") from e

    return results


def parallel_map_with_args(
    func: Callable[..., T],
    items: List[Any],
    *args,
    max_workers: int = 0,
    **kwargs
) -> List[T]:
    """
    Apply function to items in parallel with additional arguments.

    Args:
        func: Function to apply (first argument is item, rest are *args, **kwargs)
        items: List of items to process
        *args: Additional positional arguments passed to func
        max_workers: Maximum workers (0 = auto)
        **kwargs: Additional keyword arguments passed to func

    Returns:
        List of results in same order as items
    """
    if len(items) == 0:
        return []

    if len(items) == 1:
        return [func(items[0], *args, **kwargs)]

    workers = get_worker_count(max_workers, len(items))

    if len(items) < 4 or workers < 2:
        return [func(item, *args, **kwargs) for item in items]

    results = [None] * len(items)

    with ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_idx = {
            executor.submit(func, item, *args, **kwargs): idx
            for idx, item in enumerate(items)
        }

        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                results[idx] = future.result()
            except Exception as e:
                raise RuntimeError(f"Parallel execution failed for item {idx}") from e

    return results


def parallel_crossover(
    pairs: List[Tuple[Individual, Individual]],
    bounds: VariableBounds,
    crossover_func: Callable[[Individual, Individual, VariableBounds], Tuple[Individual, Individual]],
    max_workers: int = 0
) -> List[Individual]:
    """
    Perform crossover on multiple pairs in parallel.

    Args:
        pairs: List of (parent1, parent2) tuples
        bounds: Variable bounds
        crossover_func: Crossover function to use
        max_workers: Maximum workers (0 = auto)

    Returns:
        List of children (2 per pair)
    """
    if len(pairs) == 0:
        return []

    def do_crossover(pair: Tuple[Individual, Individual]) -> Tuple[Individual, Individual]:
        return crossover_func(pair[0], pair[1], bounds)

    workers = get_worker_count(max_workers, len(pairs))

    # Serial fallback for small workloads
    if len(pairs) < 4 or workers < 2:
        children = []
        for p1, p2 in pairs:
            c1, c2 = crossover_func(p1, p2, bounds)
            children.extend([c1, c2])
        return children

    results = parallel_map(do_crossover, pairs, max_workers)

    children = []
    for c1, c2 in results:
        children.extend([c1, c2])

    return children


def parallel_mutation(
    individuals: List[Individual],
    bounds: VariableBounds,
    mutation_func: Callable[[Individual, float, VariableBounds], Individual],
    sigma: float,
    max_workers: int = 0
) -> List[Individual]:
    """
    Perform mutation on multiple individuals in parallel.

    Args:
        individuals: List of individuals to mutate
        bounds: Variable bounds
        mutation_func: Mutation function to use
        sigma: Mutation strength
        max_workers: Maximum workers (0 = auto)

    Returns:
        List of mutated individuals
    """
    if len(individuals) == 0:
        return []

    def do_mutation(ind: Individual) -> Individual:
        return mutation_func(ind, sigma, bounds)

    workers = get_worker_count(max_workers, len(individuals))

    if len(individuals) < 4 or workers < 2:
        return [mutation_func(ind, sigma, bounds) for ind in individuals]

    return parallel_map(do_mutation, individuals, max_workers)
