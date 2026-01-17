"""
Objective Function for Optimization

Implements the tuning error objective function from the paper (Eq. 7)
and combined objective functions with penalties (Eq. 11, 13).

Extended with torsional mode tuning based on:
Soares et al. (2021) "Tuning of bending and torsional modes of bars used in
mallet percussion instruments", JASA 150(4), pp.2757-2769.

Equation 4 from Soares:
ε(λ,h) = 100/(R+M) × [Σ((f̃_B,m - f*_B,m)/f*_B,m)² + Σ((f̃_T,r - f*_T,r)/f*_T,r)²]

where:
- f̃_B,m = computed bending frequencies
- f*_B,m = target bending frequencies
- f̃_T,r = computed torsional frequencies
- f*_T,r = target torsional frequencies
- M = number of bending mode targets
- R = number of torsional mode targets
"""

from typing import List, Literal, Optional
import math

from ..types import Individual, BarParameters, Material, DetailedEvaluation
from ..physics.frequencies import compute_frequencies_from_genes
from ..physics.bar_profile import genes_to_cuts
from .penalties import compute_volume_penalty, compute_roughness_penalty


def compute_tuning_error(
    computed_freq: List[float],
    target_freq: List[float],
    f1_priority: float = 1.0
) -> float:
    """
    Compute the weighted squared tuning error (modified Eq. 7 from paper).

    epsilon = 100 * sum(w_m * ((omega_bar_m - omega_star_m) / omega_star_m)^2) / sum(w_m)

    With f1_priority > 1, f1 is weighted more heavily than higher modes.
    This helps ensure the fundamental frequency is well-tuned.

    Args:
        computed_freq: Computed frequencies from FEM
        target_freq: Target frequencies
        f1_priority: Weight multiplier for f1 (default 1 = equal weighting)

    Returns:
        Weighted average squared error as percentage
    """
    M = min(len(computed_freq), len(target_freq))
    if M == 0:
        return float('inf')

    weighted_sum_squared_error = 0.0
    total_weight = 0.0

    for m in range(M):
        computed = computed_freq[m]
        target = target_freq[m]

        if target == 0:
            continue

        # Weight: f1 gets f1_priority, other modes get 1
        weight = f1_priority if m == 0 else 1.0

        relative_error = (computed - target) / target
        weighted_sum_squared_error += weight * relative_error * relative_error
        total_weight += weight

    # Return as percentage
    return 100.0 * (weighted_sum_squared_error / total_weight) if total_weight > 0 else float('inf')


def compute_max_tuning_error(
    computed_freq: List[float],
    target_freq: List[float]
) -> float:
    """
    Compute the maximum squared error (Eq. 8 from paper).

    epsilon = 100 * max((omega_bar_m - omega_star_m) / omega_star_m)^2

    Args:
        computed_freq: Computed frequencies
        target_freq: Target frequencies

    Returns:
        Maximum squared error as percentage
    """
    M = min(len(computed_freq), len(target_freq))
    if M == 0:
        return float('inf')

    max_squared_error = 0.0

    for m in range(M):
        computed = computed_freq[m]
        target = target_freq[m]

        if target == 0:
            continue

        relative_error = (computed - target) / target
        squared_error = relative_error * relative_error

        if squared_error > max_squared_error:
            max_squared_error = squared_error

    return 100.0 * max_squared_error


def compute_torsional_error(
    computed_torsional: List[float],
    target_torsional: List[float],
    flexible: bool = False,
    allowed_targets: Optional[List[float]] = None
) -> float:
    """
    Compute torsional mode tuning error (from Soares et al. 2021 Eq. 4).

    Args:
        computed_torsional: Computed torsional frequencies from 3D FEM
        target_torsional: Target torsional frequencies
        flexible: If True, use flexible torsional tuning (snap to nearest)
        allowed_targets: For flexible mode, list of allowed target frequencies

    Returns:
        Average squared relative error for torsional modes as percentage
    """
    R = min(len(computed_torsional), len(target_torsional))
    if R == 0:
        return 0.0

    sum_squared_error = 0.0
    count = 0

    for r in range(R):
        computed = computed_torsional[r]
        target = target_torsional[r]

        # For flexible torsional tuning, snap to nearest allowed target
        if flexible and allowed_targets:
            target = min(allowed_targets, key=lambda t: abs(t - computed))

        if target == 0:
            continue

        relative_error = (computed - target) / target
        sum_squared_error += relative_error * relative_error
        count += 1

    return 100.0 * (sum_squared_error / count) if count > 0 else 0.0


def compute_combined_tuning_error(
    computed_bending: List[float],
    target_bending: List[float],
    computed_torsional: Optional[List[float]] = None,
    target_torsional: Optional[List[float]] = None,
    torsional_weight: float = 1.0,
    f1_priority: float = 1.0,
    flexible_torsional: bool = False,
    allowed_torsional_targets: Optional[List[float]] = None
) -> float:
    """
    Compute combined bending + torsional tuning error (Soares et al. 2021 Eq. 4).

    ε = 100/(R+M) × [Σ w_m((f̃_B,m - f*_B,m)/f*_B,m)² + Σ((f̃_T,r - f*_T,r)/f*_T,r)²]

    Args:
        computed_bending: Computed bending mode frequencies
        target_bending: Target bending mode frequencies
        computed_torsional: Computed torsional frequencies (optional)
        target_torsional: Target torsional frequencies (optional)
        torsional_weight: Weight for torsional errors relative to bending (default 1.0)
        f1_priority: Extra weight for fundamental bending mode
        flexible_torsional: If True, torsional modes snap to nearest allowed target
        allowed_torsional_targets: For flexible mode, list of allowed frequencies

    Returns:
        Combined tuning error as percentage
    """
    M = min(len(computed_bending), len(target_bending))
    R = 0
    if computed_torsional and target_torsional:
        R = min(len(computed_torsional), len(target_torsional))

    if M == 0:
        return float('inf')

    # Bending mode error (with f1 priority weighting)
    bending_weighted_sum = 0.0
    bending_total_weight = 0.0

    for m in range(M):
        computed = computed_bending[m]
        target = target_bending[m]

        if target == 0:
            continue

        weight = f1_priority if m == 0 else 1.0
        relative_error = (computed - target) / target
        bending_weighted_sum += weight * relative_error * relative_error
        bending_total_weight += weight

    # Torsional mode error
    torsional_sum = 0.0
    torsional_count = 0

    if R > 0 and computed_torsional and target_torsional:
        for r in range(R):
            computed = computed_torsional[r]
            target = target_torsional[r]

            # For flexible torsional tuning, snap to nearest allowed target
            if flexible_torsional and allowed_torsional_targets:
                target = min(allowed_torsional_targets, key=lambda t: abs(t - computed))

            if target == 0:
                continue

            relative_error = (computed - target) / target
            torsional_sum += relative_error * relative_error
            torsional_count += 1

    # Combined error (Eq. 4 from Soares)
    # Weight torsional modes according to torsional_weight parameter
    total_modes = bending_total_weight + torsional_weight * torsional_count

    if total_modes == 0:
        return float('inf')

    combined_sum = bending_weighted_sum + torsional_weight * torsional_sum
    return 100.0 * (combined_sum / total_modes)


def combined_objective_volume(
    tuning_error: float,
    volume_penalty: float,
    alpha: float
) -> float:
    """
    Combined objective function with volumetric penalty (Eq. 11).

    E = (1 - alpha) * epsilon + alpha * V

    Args:
        tuning_error: Tuning error epsilon (%)
        volume_penalty: Volume penalty V (%)
        alpha: Weighting factor (0-1)

    Returns:
        Combined objective value
    """
    return (1 - alpha) * tuning_error + alpha * volume_penalty


def combined_objective_roughness(
    tuning_error: float,
    roughness_penalty: float,
    alpha: float
) -> float:
    """
    Combined objective function with roughness penalty (Eq. 13).

    E = (1 - alpha) * epsilon + alpha * S

    Args:
        tuning_error: Tuning error epsilon (%)
        roughness_penalty: Roughness penalty S (%)
        alpha: Weighting factor (0-1)

    Returns:
        Combined objective value
    """
    return (1 - alpha) * tuning_error + alpha * roughness_penalty


def evaluate_fitness(
    individual: Individual,
    bar: BarParameters,
    material: Material,
    target_freq: List[float],
    penalty_type: Literal['volume', 'roughness', 'none'],
    alpha: float,
    num_elements: int = 150,
    f1_priority: float = 1.0,
    num_cuts: int = 1
) -> float:
    """
    Evaluate fitness of an individual.
    Lower fitness is better (we're minimizing).

    Args:
        individual: Individual with genes
        bar: Bar parameters
        material: Material properties
        target_freq: Target frequencies
        penalty_type: Type of penalty ('volume', 'roughness', or 'none')
        alpha: Penalty weight (0-1)
        num_elements: Number of FEM elements
        f1_priority: Weight multiplier for f1 (default 1 = equal)
        num_cuts: Number of cuts

    Returns:
        Fitness value (lower is better)
    """
    genes = individual.genes

    try:
        # Compute frequencies
        computed_freq = compute_frequencies_from_genes(
            genes,
            bar,
            material,
            len(target_freq),
            num_elements,
            num_cuts
        )

        # Compute tuning error (with f1 priority weighting)
        tuning_error = compute_tuning_error(computed_freq, target_freq, f1_priority)

        # If no penalty, return tuning error
        if penalty_type == 'none' or alpha == 0:
            return tuning_error

        # Convert genes to cuts for penalty calculation
        cuts = genes_to_cuts(genes)

        # Compute penalty based on type
        if penalty_type == 'volume':
            volume_penalty = compute_volume_penalty(cuts, bar.L, bar.h0)
            return combined_objective_volume(tuning_error, volume_penalty, alpha)
        else:
            roughness_penalty = compute_roughness_penalty(cuts, bar.h0)
            return combined_objective_roughness(tuning_error, roughness_penalty, alpha)

    except Exception:
        # Return high fitness if computation fails
        return 1e10


def evaluate_population(
    population: List[Individual],
    bar: BarParameters,
    material: Material,
    target_freq: List[float],
    penalty_type: Literal['volume', 'roughness', 'none'],
    alpha: float,
    num_elements: int = 150,
    num_cuts: int = 1
) -> List[Individual]:
    """
    Evaluate an entire population.

    Args:
        population: Array of individuals
        bar: Bar parameters
        material: Material properties
        target_freq: Target frequencies
        penalty_type: Type of penalty
        alpha: Penalty weight
        num_elements: Number of FEM elements
        num_cuts: Number of cuts

    Returns:
        Population with updated fitness values
    """
    return [
        Individual(
            genes=ind.genes.copy(),
            fitness=evaluate_fitness(ind, bar, material, target_freq, penalty_type, alpha, num_elements, 1.0, num_cuts),
            sigmas=ind.sigmas.copy() if ind.sigmas else None
        )
        for ind in population
    ]


def evaluate_detailed(
    genes: List[float],
    bar: BarParameters,
    material: Material,
    target_freq: List[float],
    penalty_type: Literal['volume', 'roughness', 'none'],
    alpha: float,
    num_elements: int = 150,
    num_cuts: int = 1
) -> DetailedEvaluation:
    """
    Get detailed evaluation results for an individual.
    Used for displaying results to user.
    """
    cuts = genes_to_cuts(genes)

    # Compute frequencies
    computed_frequencies = compute_frequencies_from_genes(
        genes,
        bar,
        material,
        len(target_freq),
        num_elements,
        num_cuts
    )

    # Compute tuning error
    tuning_error = compute_tuning_error(computed_frequencies, target_freq)

    # Compute penalties
    volume_penalty = compute_volume_penalty(cuts, bar.L, bar.h0)
    roughness_penalty = compute_roughness_penalty(cuts, bar.h0)

    # Compute combined fitness
    combined_fitness = tuning_error
    if penalty_type == 'volume' and alpha > 0:
        combined_fitness = combined_objective_volume(tuning_error, volume_penalty, alpha)
    elif penalty_type == 'roughness' and alpha > 0:
        combined_fitness = combined_objective_roughness(tuning_error, roughness_penalty, alpha)

    # Compute cents errors
    cents_errors = []
    for i, comp in enumerate(computed_frequencies):
        target = target_freq[i] if i < len(target_freq) else 0
        if target and target > 0:
            cents_errors.append(1200 * math.log2(comp / target))
        else:
            cents_errors.append(0.0)

    max_cents_error = max(abs(e) for e in cents_errors) if cents_errors else 0.0

    return DetailedEvaluation(
        computed_frequencies=computed_frequencies,
        target_frequencies=target_freq,
        tuning_error=tuning_error,
        volume_penalty=volume_penalty,
        roughness_penalty=roughness_penalty,
        combined_fitness=combined_fitness,
        cents_errors=cents_errors,
        max_cents_error=max_cents_error
    )
