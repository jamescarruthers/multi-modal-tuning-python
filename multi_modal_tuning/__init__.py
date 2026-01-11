"""
Multi-Modal Bar Tuning Optimization

A Python library for optimizing percussion bar undercuts to achieve target
harmonic frequencies using evolutionary algorithms and Timoshenko beam FEM.

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
]
