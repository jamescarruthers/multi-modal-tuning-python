"""
Bar Length Finder Utility

Uses binary search to find optimal bar length for a target fundamental frequency.
The physics relationship: f1 is proportional to h/L^2 for a uniform bar.
Longer bars -> lower frequencies, shorter bars -> higher frequencies.
"""

from typing import List, Optional, Callable
from dataclasses import dataclass
import math

from ..types import Material, BarParameters
from ..physics.frequencies import compute_frequencies_from_genes
from .note_utils import NoteInfo, frequency_error_cents


@dataclass
class LengthSearchResult:
    """Result of binary search for optimal bar length."""
    length: float           # Optimal length in mm
    computed_freq: float    # f1 at optimal length (Hz)
    iterations: int         # Number of search iterations
    error_cents: float      # Error in cents


@dataclass
class BarLengthResult:
    """Result of finding optimal bar length for a note."""
    note_name: str
    note_frequency: float
    note_midi_number: int
    target_frequency: float
    optimal_length: float       # mm
    computed_frequency: float   # Hz
    error_cents: float
    search_iterations: int
    selected: bool = False


def compute_f1_for_uniform_bar(
    length: float,
    width: float,
    thickness: float,
    material: Material,
    num_elements: int = 80
) -> float:
    """
    Compute f1 for a uniform bar (no cuts) at given length.

    Args:
        length: Bar length in mm
        width: Bar width in mm
        thickness: Bar thickness in mm
        material: Material properties
        num_elements: Number of FEM elements (default: 80)

    Returns:
        Fundamental frequency f1 in Hz
    """
    # Convert mm to meters for physics calculations
    bar = BarParameters(
        L=length / 1000,
        b=width / 1000,
        h0=thickness / 1000,
        hMin=thickness / 10000  # 10% of thickness
    )

    # Empty genes = uniform bar with no cuts
    genes: List[float] = []

    frequencies = compute_frequencies_from_genes(
        genes,
        bar,
        material,
        1,              # Only need f1
        num_elements,
        0               # 0 cuts
    )

    return frequencies[0] if frequencies else 0.0


def find_optimal_length(
    target_frequency: float,
    width: float,
    thickness: float,
    material: Material,
    min_length: float,
    max_length: float,
    tolerance_cents: float = 1.0,
    max_iterations: int = 50,
    num_elements: int = 80
) -> LengthSearchResult:
    """
    Find optimal bar length for a target frequency using binary search.

    Uses the fact that f1 decreases monotonically with length:
    - If computed f1 is too high, need a longer bar (search upper half)
    - If computed f1 is too low, need a shorter bar (search lower half)

    Args:
        target_frequency: Target fundamental frequency in Hz
        width: Bar width in mm
        thickness: Bar thickness in mm
        material: Material properties
        min_length: Minimum bar length to search (mm)
        max_length: Maximum bar length to search (mm)
        tolerance_cents: Stop search when within this tolerance (cents)
        max_iterations: Maximum search iterations
        num_elements: Number of FEM elements

    Returns:
        Search result with optimal length and computed frequency
    """
    low = min_length
    high = max_length
    iterations = 0
    best_length = (low + high) / 2
    best_freq = 0.0
    best_error = float('inf')

    # Check bounds first
    f_at_min = compute_f1_for_uniform_bar(min_length, width, thickness, material, num_elements)
    f_at_max = compute_f1_for_uniform_bar(max_length, width, thickness, material, num_elements)

    # f1 decreases with length, so f_at_min > f_at_max
    if target_frequency >= f_at_min:
        return LengthSearchResult(
            length=min_length,
            computed_freq=f_at_min,
            iterations=1,
            error_cents=frequency_error_cents(f_at_min, target_frequency)
        )
    if target_frequency <= f_at_max:
        return LengthSearchResult(
            length=max_length,
            computed_freq=f_at_max,
            iterations=1,
            error_cents=frequency_error_cents(f_at_max, target_frequency)
        )

    # Binary search
    while iterations < max_iterations and high - low > 0.01:  # 0.01mm precision
        iterations += 1
        mid = (low + high) / 2
        f1 = compute_f1_for_uniform_bar(mid, width, thickness, material, num_elements)

        error_cents = frequency_error_cents(f1, target_frequency)

        if abs(error_cents) < abs(best_error):
            best_length = mid
            best_freq = f1
            best_error = error_cents

        # Check if within tolerance
        if abs(error_cents) <= tolerance_cents:
            break

        # f1 decreases with length, so:
        # If computed f1 is too high, need longer bar -> search upper half
        # If computed f1 is too low, need shorter bar -> search lower half
        if f1 > target_frequency:
            low = mid  # Need longer bar (lower frequency)
        else:
            high = mid  # Need shorter bar (higher frequency)

    return LengthSearchResult(
        length=best_length,
        computed_freq=best_freq,
        iterations=iterations,
        error_cents=best_error
    )


def find_lengths_for_notes(
    notes: List[NoteInfo],
    width: float,
    thickness: float,
    material: Material,
    min_length: float,
    max_length: float,
    tolerance_cents: float = 1.0,
    num_elements: int = 80,
    on_progress: Optional[Callable[[str, int, int], None]] = None
) -> List[BarLengthResult]:
    """
    Find optimal lengths for all notes in a range.

    Args:
        notes: Array of notes to find lengths for
        width: Bar width in mm
        thickness: Bar thickness in mm
        material: Material properties
        min_length: Minimum bar length to search (mm)
        max_length: Maximum bar length to search (mm)
        tolerance_cents: Acceptable frequency error in cents
        num_elements: Number of FEM elements
        on_progress: Callback for progress updates

    Returns:
        Array of results for each note
    """
    results: List[BarLengthResult] = []

    for i, note in enumerate(notes):
        if on_progress:
            on_progress(note.name, i, len(notes))

        result = find_optimal_length(
            note.frequency,
            width,
            thickness,
            material,
            min_length,
            max_length,
            tolerance_cents,
            50,
            num_elements
        )

        results.append(BarLengthResult(
            note_name=note.name,
            note_frequency=note.frequency,
            note_midi_number=note.midi_number,
            target_frequency=note.frequency,
            optimal_length=result.length,
            computed_frequency=result.computed_freq,
            error_cents=result.error_cents,
            search_iterations=result.iterations,
            selected=False
        ))

    return results


def estimate_length_from_theory(
    target_frequency: float,
    width: float,
    thickness: float,
    material: Material
) -> float:
    """
    Estimate bar length from Euler-Bernoulli beam theory.
    This is an approximation - actual frequency depends on exact boundary conditions
    and Timoshenko corrections for thick bars.

    f1 = (beta^2 / (2*pi)) * sqrt(E*I / (rho*A*L^4))
    where beta ≈ 4.73 for first mode of free-free beam

    Rearranging for L:
    L = ((beta^2 / (2*pi*f1))^2 * E*I / (rho*A))^0.25

    For rectangular cross-section: I = b*h^3/12, A = b*h

    Args:
        target_frequency: Target f1 in Hz
        width: Bar width in mm
        thickness: Bar thickness in mm
        material: Material properties

    Returns:
        Estimated bar length in mm
    """
    beta1 = 4.73004074  # First mode eigenvalue for free-free beam
    E = material.E      # Pa
    rho = material.rho  # kg/m^3

    # Convert mm to m
    b = width / 1000
    h = thickness / 1000

    # Second moment of area for rectangular cross-section
    I = (b * h**3) / 12  # m^4
    A = b * h            # m^2

    # From Euler-Bernoulli: f = (beta^2 / (2*pi*L^2)) * sqrt(E*I / (rho*A))
    # Rearranging: L^2 = (beta^2 / (2*pi*f)) * sqrt(E*I / (rho*A))
    # L = sqrt((beta^2 / (2*pi*f)) * sqrt(E*I / (rho*A)))

    factor = (beta1**2) / (2 * math.pi * target_frequency)
    stiffness_term = math.sqrt((E * I) / (rho * A))
    L = math.sqrt(factor * stiffness_term)

    # Convert back to mm
    return L * 1000
