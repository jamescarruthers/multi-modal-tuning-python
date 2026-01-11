"""
Multi-Modal Bar Tuning Optimization

A Python library for optimizing percussion bar undercuts to achieve target
harmonic frequencies using evolutionary algorithms and FEM analysis.

Supports both 2D Timoshenko beam elements (fast) and 3D solid hexahedral
elements (more accurate) for frequency computation.

Ported from the TypeScript/Rust reference implementation.
"""

from .types import (
    Material,
    BarParameters,
    Cut,
    TuningPreset,
    EAParameters,
    Individual,
    OptimizationResult,
    ProgressUpdate,
    VariableBounds,
    DetailedEvaluation,
    AnalysisMode,
)

from .data.materials import MATERIALS, get_material, get_materials_by_category, KAPPA
from .data.presets import (
    TUNING_PRESETS,
    get_preset,
    calculate_target_frequencies,
    frequency_to_cents,
    UNIFORM_BAR_BETAS,
    UNIFORM_BAR_RATIOS,
)

from .optimization.algorithm import (
    run_evolutionary_algorithm,
    run_adaptive_evolution,
    get_default_ea_parameters,
    EAConfig,
)

from .utils.note_utils import (
    note_to_frequency,
    frequency_to_note,
    note_to_midi_number,
    midi_number_to_note,
    generate_notes_in_range,
    frequency_error_cents,
)

from .utils.bar_length_finder import (
    find_optimal_length,
    find_lengths_for_notes,
    compute_f1_for_uniform_bar,
    estimate_length_from_theory,
    LengthSearchResult,
    BarLengthResult,
)

from .visualization.bar_diagrams import (
    generate_2d_profile_diagram,
    generate_3d_isometric_diagram,
    generate_bar_diagrams,
)

from .physics.frequencies import compute_frequencies_from_genes
from .physics.bar_profile import genes_to_cuts, generate_profile_points

__version__ = "1.0.0"
__all__ = [
    # Types
    "Material",
    "BarParameters",
    "Cut",
    "TuningPreset",
    "EAParameters",
    "Individual",
    "OptimizationResult",
    "ProgressUpdate",
    "VariableBounds",
    "DetailedEvaluation",
    "AnalysisMode",
    # Data
    "MATERIALS",
    "get_material",
    "get_materials_by_category",
    "KAPPA",
    "TUNING_PRESETS",
    "get_preset",
    "calculate_target_frequencies",
    "frequency_to_cents",
    "UNIFORM_BAR_BETAS",
    "UNIFORM_BAR_RATIOS",
    # Algorithm
    "run_evolutionary_algorithm",
    "run_adaptive_evolution",
    "get_default_ea_parameters",
    "EAConfig",
    # Utils
    "note_to_frequency",
    "frequency_to_note",
    "note_to_midi_number",
    "midi_number_to_note",
    "generate_notes_in_range",
    "frequency_error_cents",
    # Bar length finder
    "find_optimal_length",
    "find_lengths_for_notes",
    "compute_f1_for_uniform_bar",
    "estimate_length_from_theory",
    "LengthSearchResult",
    "BarLengthResult",
    # Visualization
    "generate_2d_profile_diagram",
    "generate_3d_isometric_diagram",
    "generate_bar_diagrams",
    # Physics
    "compute_frequencies_from_genes",
    "genes_to_cuts",
    "generate_profile_points",
]
