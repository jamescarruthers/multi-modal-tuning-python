#!/usr/bin/env python3
"""
Benchmark Script: Serial vs Parallel Performance

Compares the performance of serial and parallel implementations for:
1. Evolutionary Algorithm (batch fitness evaluation, crossover, mutation)
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
    EAParameters,
    Individual,
    VariableBounds,
    AnalysisMode,
)
from multi_modal_tuning.physics.frequencies import batch_compute_fitness
from multi_modal_tuning.physics.fem_3d import (
    generate_bar_mesh_3d,
    assemble_global_matrices_3d,
    compute_hex8_matrices,
)
from multi_modal_tuning.optimization.crossover import (
    heuristic_crossover,
    perform_crossover,
)
from multi_modal_tuning.optimization.mutation import (
    uniform_mutation,
    perform_mutation,
)
from multi_modal_tuning.optimization.surrogate import (
    SurrogateConfig,
    run_surrogate_optimization,
    _objective_function,
)
from multi_modal_tuning.optimization.population import create_bounds, BoundsConstraints
import numpy as np


@dataclass
class BenchmarkResult:
    """Result of a benchmark run."""
    name: str
    serial_time: float
    parallel_time: float
    speedup: float
    iterations: int

    def __str__(self) -> str:
        return (
            f"{self.name}:\n"
            f"  Serial:   {self.serial_time:.4f}s\n"
            f"  Parallel: {self.parallel_time:.4f}s\n"
            f"  Speedup:  {self.speedup:.2f}x\n"
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
    bar = BarParameters(
        L=0.175,  # 175mm xylophone bar
        b=0.038,  # 38mm width
        h0=0.019,  # 19mm height
        hMin=0.005  # 5mm minimum
    )
    material = Material(
        E=11.5e9,  # Honduras Rosewood
        rho=800.0,
        nu=0.3
    )
    return bar, material


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
    print(f"\n=== Benchmarking Batch Fitness Evaluation ===")
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

    # Parallel (auto workers)
    def run_parallel():
        batch_compute_fitness(
            genes_array, bar, material, target_frequencies,
            num_elements, 1.0, num_cuts, max_workers=0
        )

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running parallel...")
    parallel_time = time_function(run_parallel, iterations)

    speedup = serial_time / parallel_time if parallel_time > 0 else 0

    return BenchmarkResult(
        name="Batch Fitness Evaluation",
        serial_time=serial_time,
        parallel_time=parallel_time,
        speedup=speedup,
        iterations=iterations
    )


def benchmark_crossover(
    num_pairs: int = 100,
    num_cuts: int = 3,
    iterations: int = 10
) -> BenchmarkResult:
    """Benchmark crossover operations."""
    print(f"\n=== Benchmarking Crossover Operations ===")
    print(f"  Num pairs: {num_pairs}")
    print(f"  Num cuts: {num_cuts}")

    bar, _ = create_test_bar()
    bounds = create_test_bounds(bar, num_cuts)
    population = create_test_population(num_pairs * 2, num_cuts, bounds)

    # Create pairs
    pairs = [(population[i], population[i + 1]) for i in range(0, num_pairs * 2, 2)]

    # Serial
    def run_serial():
        perform_crossover(pairs, bounds, 'heuristic', max_workers=1, use_parallel=False)

    # Parallel
    def run_parallel():
        perform_crossover(pairs, bounds, 'heuristic', max_workers=0, use_parallel=True)

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running parallel...")
    parallel_time = time_function(run_parallel, iterations)

    speedup = serial_time / parallel_time if parallel_time > 0 else 0

    return BenchmarkResult(
        name="Crossover Operations",
        serial_time=serial_time,
        parallel_time=parallel_time,
        speedup=speedup,
        iterations=iterations
    )


def benchmark_mutation(
    num_individuals: int = 100,
    num_cuts: int = 3,
    iterations: int = 10
) -> BenchmarkResult:
    """Benchmark mutation operations."""
    print(f"\n=== Benchmarking Mutation Operations ===")
    print(f"  Num individuals: {num_individuals}")
    print(f"  Num cuts: {num_cuts}")

    bar, _ = create_test_bar()
    bounds = create_test_bounds(bar, num_cuts)
    population = create_test_population(num_individuals, num_cuts, bounds)

    # Serial
    def run_serial():
        perform_mutation(population, bounds, 'uniform', 0.1, max_workers=1, use_parallel=False)

    # Parallel
    def run_parallel():
        perform_mutation(population, bounds, 'uniform', 0.1, max_workers=0, use_parallel=True)

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running parallel...")
    parallel_time = time_function(run_parallel, iterations)

    speedup = serial_time / parallel_time if parallel_time > 0 else 0

    return BenchmarkResult(
        name="Mutation Operations",
        serial_time=serial_time,
        parallel_time=parallel_time,
        speedup=speedup,
        iterations=iterations
    )


def benchmark_fem_3d_assembly(
    nx: int = 50,
    ny: int = 4,
    nz: int = 4,
    iterations: int = 3
) -> BenchmarkResult:
    """Benchmark 3D FEM element assembly."""
    print(f"\n=== Benchmarking 3D FEM Assembly ===")
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

    # Parallel
    def run_parallel():
        assemble_global_matrices_3d(
            nodes, elements, material.E, material.nu, material.rho,
            use_sparse=True, max_workers=0, use_parallel=True
        )

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running parallel...")
    parallel_time = time_function(run_parallel, iterations)

    speedup = serial_time / parallel_time if parallel_time > 0 else 0

    return BenchmarkResult(
        name="3D FEM Assembly",
        serial_time=serial_time,
        parallel_time=parallel_time,
        speedup=speedup,
        iterations=iterations
    )


def benchmark_surrogate_sampling(
    initial_points: int = 20,
    iterations: int = 2
) -> BenchmarkResult:
    """Benchmark surrogate initial sampling."""
    print(f"\n=== Benchmarking Surrogate Initial Sampling ===")
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

    config_parallel = SurrogateConfig(
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
    )

    # Serial
    def run_serial():
        run_surrogate_optimization(config_serial)

    # Parallel
    def run_parallel():
        run_surrogate_optimization(config_parallel)

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running parallel...")
    parallel_time = time_function(run_parallel, iterations)

    speedup = serial_time / parallel_time if parallel_time > 0 else 0

    return BenchmarkResult(
        name="Surrogate Initial Sampling",
        serial_time=serial_time,
        parallel_time=parallel_time,
        speedup=speedup,
        iterations=iterations
    )


def benchmark_evolutionary_algorithm(
    population_size: int = 30,
    generations: int = 5,
    num_cuts: int = 3,
    iterations: int = 1
) -> BenchmarkResult:
    """Benchmark full evolutionary algorithm."""
    print(f"\n=== Benchmarking Evolutionary Algorithm ===")
    print(f"  Population size: {population_size}")
    print(f"  Generations: {generations}")
    print(f"  Num cuts: {num_cuts}")

    from multi_modal_tuning.optimization.algorithm import run_evolutionary_algorithm, EAConfig

    bar, material = create_test_bar()
    target_frequencies = [440.0, 1760.0, 3960.0]

    # Serial config
    ea_params_serial = EAParameters(
        population_size=population_size,
        max_generations=generations,
        num_elements=50,
        max_workers=1,  # Force serial
    )

    # Parallel config
    ea_params_parallel = EAParameters(
        population_size=population_size,
        max_generations=generations,
        num_elements=50,
        max_workers=0,  # Auto-detect
    )

    config_serial = EAConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        ea_params=ea_params_serial,
    )

    config_parallel = EAConfig(
        bar=bar,
        material=material,
        target_frequencies=target_frequencies,
        num_cuts=num_cuts,
        ea_params=ea_params_parallel,
    )

    # Serial
    def run_serial():
        run_evolutionary_algorithm(config_serial)

    # Parallel
    def run_parallel():
        run_evolutionary_algorithm(config_parallel)

    print("  Running serial...")
    serial_time = time_function(run_serial, iterations)

    print("  Running parallel...")
    parallel_time = time_function(run_parallel, iterations)

    speedup = serial_time / parallel_time if parallel_time > 0 else 0

    return BenchmarkResult(
        name="Evolutionary Algorithm (Full)",
        serial_time=serial_time,
        parallel_time=parallel_time,
        speedup=speedup,
        iterations=iterations
    )


def print_summary(results: List[BenchmarkResult]):
    """Print benchmark summary."""
    print("\n" + "=" * 60)
    print("BENCHMARK SUMMARY")
    print("=" * 60)

    print(f"\nCPU Count: {os.cpu_count()}")
    print("\nResults:\n")

    for result in results:
        print(result)
        print()

    # Calculate overall average speedup
    avg_speedup = sum(r.speedup for r in results) / len(results)
    print(f"Average Speedup: {avg_speedup:.2f}x")

    # Best and worst
    best = max(results, key=lambda r: r.speedup)
    worst = min(results, key=lambda r: r.speedup)

    print(f"\nBest Speedup:  {best.name} ({best.speedup:.2f}x)")
    print(f"Worst Speedup: {worst.name} ({worst.speedup:.2f}x)")


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

    # Crossover
    results.append(benchmark_crossover(
        num_pairs=50,
        num_cuts=3,
        iterations=5
    ))

    # Mutation
    results.append(benchmark_mutation(
        num_individuals=50,
        num_cuts=3,
        iterations=5
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

    # Crossover - many pairs
    results.append(benchmark_crossover(
        num_pairs=200,
        num_cuts=5,
        iterations=10
    ))

    # Mutation - many individuals
    results.append(benchmark_mutation(
        num_individuals=200,
        num_cuts=5,
        iterations=10
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

    # Full EA
    results.append(benchmark_evolutionary_algorithm(
        population_size=50,
        generations=10,
        num_cuts=3,
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
