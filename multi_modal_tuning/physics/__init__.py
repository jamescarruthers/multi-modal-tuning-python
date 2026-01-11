"""Physics module for Timoshenko beam FEM and frequency computation."""

from .bar_profile import (
    compute_height,
    generate_element_heights,
    genes_to_cuts,
    cuts_to_genes,
    count_effective_cuts,
    validate_cuts,
    generate_profile_points,
)

from .timoshenko import (
    compute_element_stiffness,
    compute_element_mass,
)

from .fem_assembly import (
    assemble_global_matrices,
    solve_generalized_eigenvalue,
)

from .frequencies import (
    compute_frequencies,
    compute_frequencies_from_genes,
    batch_compute_fitness,
)

__all__ = [
    # Bar profile
    "compute_height",
    "generate_element_heights",
    "genes_to_cuts",
    "cuts_to_genes",
    "count_effective_cuts",
    "validate_cuts",
    "generate_profile_points",
    # Timoshenko
    "compute_element_stiffness",
    "compute_element_mass",
    # FEM assembly
    "assemble_global_matrices",
    "solve_generalized_eigenvalue",
    # Frequencies
    "compute_frequencies",
    "compute_frequencies_from_genes",
    "batch_compute_fitness",
]
