#!/usr/bin/env python3
"""
Benchmark Script: Serial vs Threading vs Multiprocessing

Compares the performance of different parallelization strategies:
1. Serial (baseline)
2. Threading (ThreadPoolExecutor) - lower overhead, works when NumPy releases GIL
3. Multiprocessing (ProcessPoolExecutor) - higher overhead, bypasses GIL completely

Tests:
1. Evolutionary Algorithm (batch fitness evaluation)
2. Surrogate Optimization (initial sampling, multi-start search)
3. 3D FEM Element Assembly

Usage:
    python benchmark_parallel.py [--full]

Options:
    --full    Run full benchmark (takes longer but more comprehensive)
"""

import sys
import time
import os
from dataclasses import dataclass
from typing import List, Tuple, Callable
import random

# Add the module to path if needed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from multi_modal_tuning.types import (
    BarParameters,
    Material,
    Individual,
    VariableBounds,
    EAParameters,
)
from multi_modal_tuning.physics.frequencies import batch_compute_fitness
from multi_modal_tuning.physics.fem_3d import (
    generate_bar_mesh_3d,
    assemble_global_matrices_3d,
)
from multi_modal_tuning.optimization.surrogate import (
    SurrogateConfig,
    run_surrogate_optimization,
)
from multi_modal_tuning.optimization.population import create_bounds, BoundsConstraints
from multi_modal_tuning.optimization.algorithm import EAConfig, run_evolutionary_algorithm


@dataclass
class BenchmarkResult:
    """Result of a benchmark run."""
    name: str
    serial_time: float
    threading_time: float
    multiprocessing_time: float
    threading_speedup: float
    multiprocessing_speedup: float
    iterations: int

    def __str__(self) -> str:
        return (
            f"{self.name}:\n"
            f"  Serial:          {self.serial_time:.4f}s\n"
            f"  Threading:       {self.threading_time:.4f}s  ({self.threading_speedup:.2f}x)\n"
            f"  Multiprocessing: {self.multiprocessing_time:.4f}s  ({self.multiprocessing_speedup:.2f}x)\n"
            f"  Iterations: {self.iterations}"
        )


def time_function(func: Callable, iterations: int = 1) -> float:
    """Time a function over multiple iterations."""
    start = time.perf_counter()
    for _ in range(iterations):
        func()
    end = time.perf_counter()
    return end - start


def create_test_bar() -> Tuple[BarParameters, Material]:
    """Create test bar and material."""
    test_bar = BarParameters(
        L=0.175,  # 175mm xylophone bar
        b=0.038,  # 38mm width
        h0=0.019,  # 19mm height
        hMin=0.005  # 5mm minimum
    )
    material = Material(
        name="Honduras Rosewood",
        E=11.5e9,
        rho=800.0,
        nu=0.3,
        category='wood'
    )
    return test_bar, material


def create_test_bounds(bar: BarParameters, num_cuts: int) -> VariableBounds:
    """Create test bounds."""
    bounds_constraints = BoundsConstraints(
        min_cut_width=0.01,
        max_cut_width=bar.L * 0.4,
        min_cut_depth=bar.hMin,
        max_cut_depth=bar.h0 * 0.9,
        max_length_trim=0.0,
        max_length_extend=0.0
    )
    return create_bounds(bar, num_cuts, bounds_constraints)


def create_test_population(
    size: int,
    num_cuts: int,
    bounds: VariableBounds
) -> List[Individual]:
    """Create random test population."""
    population = []
    for _ in range(size):
        genes = []
        for i in range(num_cuts):
            # Lambda (cut position)
            genes.append(random.uniform(bounds.lambda_min, bounds.lambda_max))
            # Height
            genes.append(random.uniform(bounds.h_min, bounds.h_max))
        population.append(Individual(genes=genes, fitness=float('inf')))
    return population


def benchmark_batch_fitness(
    population_size: int = 50,
    num_cuts: int = 3,
    num_elements: int = 100,
    iterations: int = 3
) -> BenchmarkResult:
    """Benchmark batch fitness evaluation."""
    print("\n=== Benchmarking Batch Fitness Evaluation ===")
    print(f"  Population size: {population_size}")
    print(f"  Num cuts: {num_cuts}")
    print(f"  Num elements: {num_elements}")

    bar, material = create_test_bar()
    bounds = create_test_bounds(bar, num_cuts)
    population = create_test_population(population_size, num_cuts, bounds)
    target_frequencies = [440.0, 1760.0, 3960.0]

    genes_array = [ind.genes for ind in population]

    # Serial (1 worker)
    def run_serial():
        batch_compute_fitness(
            genes_array, bar, material, target_frequencies,
            num_elements, 1.0, num_cuts, max_workers=1
        )

    # Threading
    def run_threading():
        batch_compute_fitness(
            genes_array, bar, material, target_frequencies,
            num_elements, 1.0, num_cuts, max_workers=0, parallel_mode='threading'
        )

    # Multiprocessing
    def run_multiprocessing():
        batch_compute_fitness(
            genes_array, bar, material, target_frequencies,
            num_elements, 1.0, num_cuts, max_workers=0, parallel_mode='multiprocessing'
        )

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running threading...")
    threading_time = time_function(run_threading, iterations)

    print("  Running multiprocessing...")
    multiprocessing_time = time_function(run_multiprocessing, iterations)

    threading_speedup = serial_time / threading_time if threading_time > 0 else 0
    multiprocessing_speedup = serial_time / multiprocessing_time if multiprocessing_time > 0 else 0

    return BenchmarkResult(
        name="Batch Fitness Evaluation",
        serial_time=serial_time,
        threading_time=threading_time,
        multiprocessing_time=multiprocessing_time,
        threading_speedup=threading_speedup,
        multiprocessing_speedup=multiprocessing_speedup,
        iterations=iterations
    )


def benchmark_fem_3d_assembly(
    nx: int = 50,
    ny: int = 4,
    nz: int = 4,
    iterations: int = 3
) -> BenchmarkResult:
    """Benchmark 3D FEM element assembly."""
    print("\n=== Benchmarking 3D FEM Assembly ===")
    print(f"  Elements: {nx} x {ny} x {nz} = {nx * ny * nz}")

    bar, material = create_test_bar()

    # Create element heights (uniform for simplicity)
    element_heights = [bar.h0] * nx

    # Generate mesh
    nodes, elements, _ = generate_bar_mesh_3d(
        bar.L, bar.b, element_heights, nx, ny, nz
    )

    print(f"  Nodes: {len(nodes)}, Elements: {len(elements)}")

    # Serial
    def run_serial():
        assemble_global_matrices_3d(
            nodes, elements, material.E, material.nu, material.rho,
            use_sparse=True, max_workers=1, use_parallel=False
        )

    # Threading
    def run_threading():
        assemble_global_matrices_3d(
            nodes, elements, material.E, material.nu, material.rho,
            use_sparse=True, max_workers=0, use_parallel=True, parallel_mode='threading'
        )

    # Multiprocessing
    def run_multiprocessing():
        assemble_global_matrices_3d(
            nodes, elements, material.E, material.nu, material.rho,
            use_sparse=True, max_workers=0, use_parallel=True, parallel_mode='multiprocessing'
        )

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running threading...")
    threading_time = time_function(run_threading, iterations)

    print("  Running multiprocessing...")
    multiprocessing_time = time_function(run_multiprocessing, iterations)

    threading_speedup = serial_time / threading_time if threading_time > 0 else 0
    multiprocessing_speedup = serial_time / multiprocessing_time if multiprocessing_time > 0 else 0

    return BenchmarkResult(
        name="3D FEM Assembly",
        serial_time=serial_time,
        threading_time=threading_time,
        multiprocessing_time=multiprocessing_time,
        threading_speedup=threading_speedup,
        multiprocessing_speedup=multiprocessing_speedup,
        iterations=iterations
    )


def benchmark_surrogate_sampling(
    initial_points: int = 20,
    iterations: int = 2
) -> BenchmarkResult:
    """Benchmark surrogate initial sampling."""
    print("\n=== Benchmarking Surrogate Initial Sampling ===")
    print(f"  Initial points: {initial_points}")

    bar, material = create_test_bar()
    num_cuts = 3
    bounds = create_test_bounds(bar, num_cuts)
    target_frequencies = [440.0, 1760.0, 3960.0]

    # Create configs
    config_serial = SurrogateConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        bounds=bounds,
        max_evaluations=initial_points,  # Only do initial sampling
        initial_points=initial_points,
        num_elements=50,
        max_workers=1,
        use_parallel=False,
    )

    config_threading = SurrogateConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        bounds=bounds,
        max_evaluations=initial_points,
        initial_points=initial_points,
        num_elements=50,
        max_workers=0,
        use_parallel=True,
        parallel_mode='threading',
    )

    config_multiprocessing = SurrogateConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        bounds=bounds,
        max_evaluations=initial_points,
        initial_points=initial_points,
        num_elements=50,
        max_workers=0,
        use_parallel=True,
        parallel_mode='multiprocessing',
    )

    # Serial
    def run_serial():
        run_surrogate_optimization(config_serial)

    # Threading
    def run_threading():
        run_surrogate_optimization(config_threading)

    # Multiprocessing
    def run_multiprocessing():
        run_surrogate_optimization(config_multiprocessing)

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running threading...")
    threading_time = time_function(run_threading, iterations)

    print("  Running multiprocessing...")
    multiprocessing_time = time_function(run_multiprocessing, iterations)

    threading_speedup = serial_time / threading_time if threading_time > 0 else 0
    multiprocessing_speedup = serial_time / multiprocessing_time if multiprocessing_time > 0 else 0

    return BenchmarkResult(
        name="Surrogate Initial Sampling",
        serial_time=serial_time,
        threading_time=threading_time,
        multiprocessing_time=multiprocessing_time,
        threading_speedup=threading_speedup,
        multiprocessing_speedup=multiprocessing_speedup,
        iterations=iterations
    )


def _optimize_single_bar(args: Tuple) -> float:
    """
    Run a simplified single-bar optimization.
    Top-level function for multiprocessing pickling.

    Returns the best fitness found.
    """
    target_f1, bar_params, material_params, num_cuts = args

    # Reconstruct objects (needed for multiprocessing)
    test_bar = BarParameters(
        L=bar_params['L'],
        b=bar_params['b'],
        h0=bar_params['h0'],
        hMin=bar_params['hMin']
    )
    material = Material(
        name=material_params['name'],
        E=material_params['E'],
        rho=material_params['rho'],
        nu=material_params['nu'],
        category=material_params['category']
    )

    # Target frequencies: 1:4:10 ratio (standard xylophone)
    target_frequencies = [target_f1, target_f1 * 4, target_f1 * 10]

    ea_params = EAParameters(
        population_size=30,
        max_generations=20,  # Moderate for benchmark - each bar takes ~5-10s
        target_error=0.1,
        num_elements=80,
        elitism_percent=10,
        crossover_percent=30,
        mutation_percent=60,
        mutation_strength=0.12,
        f1_priority=1.5,
    )

    config = EAConfig(
        bar=test_bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        ea_params=ea_params,
    )

    result = run_evolutionary_algorithm(config)
    return result.tuning_error


def benchmark_multi_bar_optimization(
    num_bars: int = 4,
    iterations: int = 1
) -> BenchmarkResult:
    """
    Benchmark multi-bar optimization (coarse-grained parallelism).

    This tests if multiprocessing is beneficial when parallelizing at
    the bar level, where each process handles a complete optimization.
    """
    print("\n=== Benchmarking Multi-Bar Optimization ===")
    print(f"  Number of bars: {num_bars}")

    # Create test parameters (serializable for multiprocessing)
    bar_params = {
        'L': 0.175,
        'b': 0.038,
        'h0': 0.019,
        'hMin': 0.005
    }
    material_params = {
        'name': 'Honduras Rosewood',
        'E': 11.5e9,
        'rho': 800.0,
        'nu': 0.3,
        'category': 'wood'
    }
    num_cuts = 2

    # Different target frequencies for each bar (like xylophone range)
    # F4=349Hz, G4=392Hz, A4=440Hz, B4=494Hz
    target_f1_list = [349.0, 392.0, 440.0, 494.0][:num_bars]

    # Build task arguments
    tasks = [
        (f1, bar_params, material_params, num_cuts)
        for f1 in target_f1_list
    ]

    # Serial
    def run_serial():
        results = []
        for task in tasks:
            results.append(_optimize_single_bar(task))
        return results

    # Threading
    def run_threading():
        from concurrent.futures import ThreadPoolExecutor, as_completed
        max_workers = min(os.cpu_count() or 4, num_bars)
        results = [None] * len(tasks)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_idx = {
                executor.submit(_optimize_single_bar, task): idx
                for idx, task in enumerate(tasks)
            }
            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                results[idx] = future.result()
        return results

    # Multiprocessing
    def run_multiprocessing():
        from concurrent.futures import ProcessPoolExecutor, as_completed
        max_workers = min(os.cpu_count() or 4, num_bars)
        results = [None] * len(tasks)
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            future_to_idx = {
                executor.submit(_optimize_single_bar, task): idx
                for idx, task in enumerate(tasks)
            }
            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                results[idx] = future.result()
        return results

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running threading...")
    threading_time = time_function(run_threading, iterations)

    print("  Running multiprocessing...")
    multiprocessing_time = time_function(run_multiprocessing, iterations)

    threading_speedup = serial_time / threading_time if threading_time > 0 else 0
    mp_speedup = serial_time / multiprocessing_time if multiprocessing_time > 0 else 0

    return BenchmarkResult(
        name="Multi-Bar Optimization (Coarse-Grained)",
        serial_time=serial_time,
        threading_time=threading_time,
        multiprocessing_time=multiprocessing_time,
        threading_speedup=threading_speedup,
        multiprocessing_speedup=mp_speedup,
        iterations=iterations
    )


def print_summary(results: List[BenchmarkResult]):
    """Print benchmark summary."""
    print("\n" + "=" * 60)
    print("BENCHMARK SUMMARY")
    print("=" * 60)

    cpu_count = os.cpu_count()
    print(f"\nCPU Count: {cpu_count}")
    print("\nResults:\n")

    for result in results:
        print(result)
        print()

    # Calculate overall average speedups
    avg_threading = sum(r.threading_speedup for r in results) / len(results)
    avg_multiprocessing = sum(r.multiprocessing_speedup for r in results) / len(results)

    print(f"Average Threading Speedup:       {avg_threading:.2f}x")
    print(f"Average Multiprocessing Speedup: {avg_multiprocessing:.2f}x")

    # Best for each mode
    best_threading = max(results, key=lambda r: r.threading_speedup)
    best_multiprocessing = max(results, key=lambda r: r.multiprocessing_speedup)

    print(f"\nBest Threading:       {best_threading.name} ({best_threading.threading_speedup:.2f}x)")
    print(f"Best Multiprocessing: {best_multiprocessing.name} ({best_multiprocessing.multiprocessing_speedup:.2f}x)")

    # Recommendation
    print("\n" + "-" * 60)
    print("RECOMMENDATION")
    print("-" * 60)
    if avg_threading > avg_multiprocessing:
        print("Threading is generally faster for this workload.")
        print("This is expected when NumPy/SciPy release the GIL during computation.")
    else:
        print("Multiprocessing is generally faster for this workload.")
        print("This may indicate GIL contention in pure Python code.")


def run_quick_benchmark():
    """Run quick benchmark with smaller parameters."""
    print("Running QUICK benchmark (use --full for comprehensive test)")
    print("=" * 60)

    results = []

    # Batch fitness is the most important
    results.append(benchmark_batch_fitness(
        population_size=30,
        num_cuts=3,
        num_elements=50,
        iterations=2
    ))

    # 3D FEM
    results.append(benchmark_fem_3d_assembly(
        nx=30,
        ny=3,
        nz=3,
        iterations=2
    ))

    # Surrogate sampling
    results.append(benchmark_surrogate_sampling(
        initial_points=10,
        iterations=1
    ))

    # Multi-bar optimization (coarse-grained parallelism)
    results.append(benchmark_multi_bar_optimization(
        num_bars=4,
        iterations=1
    ))

    return results


def run_full_benchmark():
    """Run comprehensive benchmark."""
    print("Running FULL benchmark (this may take a while)")
    print("=" * 60)

    results = []

    # Batch fitness - large population
    results.append(benchmark_batch_fitness(
        population_size=100,
        num_cuts=5,
        num_elements=150,
        iterations=3
    ))

    # 3D FEM - large mesh
    results.append(benchmark_fem_3d_assembly(
        nx=80,
        ny=5,
        nz=5,
        iterations=3
    ))

    # Surrogate sampling
    results.append(benchmark_surrogate_sampling(
        initial_points=30,
        iterations=2
    ))

    # Multi-bar optimization (coarse-grained parallelism)
    results.append(benchmark_multi_bar_optimization(
        num_bars=4,
        iterations=1
    ))

    return results


def main():
    """Main entry point."""
    full_mode = '--full' in sys.argv

    print("\n" + "=" * 60)
    print("PARALLEL PERFORMANCE BENCHMARK")
    print("Multi-Modal Tuning Python")
    print("=" * 60)

    if full_mode:
        results = run_full_benchmark()
    else:
        results = run_quick_benchmark()

    print_summary(results)


if __name__ == "__main__":
    main()
