"""
Type definitions for the multi-modal bar tuning optimization.

Uses dataclasses for clean, typed structures that mirror the TypeScript interfaces.
"""

from dataclasses import dataclass, field
from typing import List, Optional, Literal, Dict
from enum import Enum
import math


class AnalysisMode(Enum):
    """FEM analysis mode selection."""
    BEAM_2D = "2d"      # Timoshenko beam elements (fast, good for slender bars)
    SOLID_3D = "3d"     # 3D hexahedral elements (accurate, slower)


@dataclass
class Material:
    """Material properties for bar tuning."""
    name: str
    E: float        # Young's modulus (Pa)
    rho: float      # Density (kg/m^3)
    nu: float       # Poisson's ratio
    category: Literal['metal', 'wood']


@dataclass
class BarParameters:
    """Bar geometry parameters."""
    L: float        # Length (m)
    b: float        # Width (m)
    h0: float       # Original thickness (m)
    hMin: float     # Minimum thickness (m) - typically 10% of h0


@dataclass
class Cut:
    """Single rectangular cut."""
    lambda_: float  # Length from center (m) - using lambda_ to avoid Python keyword
    h: float        # Height at cut (m)


@dataclass
class Weight:
    """Single point weight attached to the bar."""
    position: float  # Distance from center (m), symmetric like cuts
    mass: float      # Mass to add (kg)


@dataclass
class TuningPreset:
    """
    Tuning preset with frequency ratios for bending and optionally torsional modes.

    Based on Soares et al. (2021) "Tuning of bending and torsional modes of bars
    used in mallet percussion instruments", JASA 150(4), pp.2757-2769.

    Notation: (B1:B2:B3:B4 | T1:T2) where B = bending, T = torsional
    e.g., "1:4:10:16|5:20" means bending modes at 1,4,10,16× and torsional at 5,20×
    """
    name: str
    ratios: List[float]  # Bending mode ratios (required)
    description: str
    instrument: str
    torsional_ratios: Optional[List[float]] = None  # Torsional mode ratios (optional)
    flexible_torsional: bool = False  # If True, torsional modes can snap to nearest harmonic
    # Target modes specify which mode each ratio corresponds to for 3D analysis
    # e.g., ['V1', 'V2', 'V3'] for 3 bending modes, or ['V1', 'T1', 'V2'] for mixed
    # If None, defaults to V1, V2, V3, ... (all vertical bending)
    target_modes: Optional[List[str]] = None


@dataclass
class EAParameters:
    """
    Evolutionary algorithm parameters.

    Extended to support torsional mode tuning based on Soares et al. (2021).
    """
    population_size: int = 50         # Npop
    elitism_percent: float = 10.0     # Pe (0-100)
    crossover_percent: float = 30.0   # Pc (0-100)
    mutation_percent: float = 60.0    # Pm (0-100, Pe + Pc + Pm = 100)
    mutation_strength: float = 0.1    # sigma for uniform mutation (0.05-0.2)
    max_generations: int = 100
    target_error: float = 0.01        # Stopping criterion (percentage)
    num_elements: int = 150           # Ne for FEM discretization (x-direction for 3D)
    f1_priority: float = 1.0          # Weight multiplier for f1
    min_cut_width: float = 0.0        # Minimum width between cut boundaries (m)
    max_cut_width: float = 0.0        # Maximum cut width (2*lambda) (m), 0 = no limit
    min_cut_depth: float = 0.0        # Minimum cut depth (h0 - h) (m), 0 = no limit
    max_cut_depth: float = 0.0        # Maximum cut depth (h0 - h) (m), 0 = no limit
    max_length_trim: float = 0.0      # Max trim from each end (m), 0 = no trimming
    max_length_extend: float = 0.0    # Max extension from each end (m), 0 = no extension
    max_workers: int = 0              # Max worker threads (0 = auto)
    # Analysis mode selection
    analysis_mode: AnalysisMode = AnalysisMode.BEAM_2D
    # 3D mesh parameters (only used when analysis_mode is SOLID_3D)
    num_elements_y: int = 2           # Elements in width direction
    num_elements_z: int = 2           # Elements in thickness direction
    # Frequency offset for 2D/3D calibration (e.g., 0.05 = target 5% higher)
    # Applied as: effective_target = target * (1 + offset)
    frequency_offset: float = 0.0
    # Torsional mode tuning (Soares et al. 2021)
    # Weight for torsional mode errors in combined objective (0 = ignore torsional)
    torsional_weight: float = 0.0
    # If True, allow torsional modes to snap to nearest target in set
    flexible_torsional: bool = False
    # Optimization algorithm: 'evolutionary' or 'surrogate'
    optimizer: Literal['evolutionary', 'surrogate'] = 'evolutionary'
    # Modification mode: 'cuts' (remove material) or 'weights' (add point masses)
    modification_mode: Literal['cuts', 'weights'] = 'cuts'
    # Weight-specific parameters (only used when modification_mode is 'weights')
    num_weights: int = 3              # Number of weight positions
    min_weight_mass: float = 0.0      # Minimum mass per weight (kg)
    max_weight_mass: float = 0.1      # Maximum mass per weight (kg)
    # Surrogate optimization parameters
    surrogate_max_evals: int = 500    # Max function evaluations for surrogate
    surrogate_initial_points: int = 20  # Initial random sampling points
    # Target modes for 3D analysis (e.g., ['V1', 'V2', 'V3'] or ['V1', 'T1', 'V2'])
    # V=vertical_bending, T=torsional, L=lateral, A=axial
    # If None, uses first N modes sorted by frequency (unclassified)
    target_modes: Optional[List[str]] = None


@dataclass
class Individual:
    """Individual in EA population."""
    genes: List[float]                # [lambda_1, h_1, lambda_2, h_2, ..., length_adjust?]
    fitness: float = math.inf
    sigmas: Optional[List[float]] = None  # For self-adaptive Gaussian mutation


@dataclass
class OptimizationResult:
    """Result of optimization."""
    best_individual: Individual
    cuts: List[Cut]
    computed_frequencies: List[float]
    target_frequencies: List[float]
    tuning_error: float               # epsilon (%)
    max_error_cents: float
    errors_in_cents: List[float]
    volume_percent: float
    roughness_percent: float
    generations: int
    length_trim: float = 0.0          # How much trimmed from each end (m)
    effective_length: float = 0.0     # L - 2*length_trim (m)
    # Weight optimization results (when modification_mode is 'weights')
    weights: Optional[List['Weight']] = None
    total_added_mass: float = 0.0     # Total mass added (kg)
    # Torsional mode results (Soares et al. 2021)
    torsional_frequencies: Optional[List[float]] = None
    target_torsional_frequencies: Optional[List[float]] = None
    torsional_errors_cents: Optional[List[float]] = None
    # Classified modes from 3D analysis
    classified_modes: Optional[Dict[str, List[dict]]] = None
    # Mode shapes for 3D visualization (computed during final evaluation)
    mode_shapes_result: Optional['ModeShapesResult'] = None


@dataclass
class FEMProgressState:
    """Progress state for FEM computation stages."""
    stage: Literal['mesh', 'assembly', 'eigenvalue', 'classification', 'complete']
    percent: float  # 0-100
    message: str  # Human-readable message


@dataclass
class BatchProgressState:
    """Progress state for batch population evaluation."""
    completed: int
    total: int
    best_fitness_so_far: Optional[float] = None
    message: str = ""


@dataclass
class ProgressUpdate:
    """Progress update during optimization."""
    generation: int
    best_fitness: float
    best_individual: Individual
    average_fitness: float
    computed_frequencies: Optional[List[float]] = None
    errors_in_cents: Optional[List[float]] = None
    length_trim: float = 0.0
    # Granular progress for slow operations
    fem_progress: Optional[FEMProgressState] = None
    batch_progress: Optional[BatchProgressState] = None


@dataclass
class VariableBounds:
    """Bounds for optimization variables."""
    lambda_min: float
    lambda_max: float
    h_min: float
    h_max: float
    min_cut_width: float = 0.0        # Minimum distance between cut boundaries
    max_cut_width: float = 0.0        # Maximum cut width (2*lambda), 0 = use lambda_max
    min_cut_depth: float = 0.0        # Minimum depth (constrains h_max = h0 - min_depth)
    max_cut_depth: float = 0.0        # Maximum depth (constrains h_min = h0 - max_depth)
    max_length_trim: float = 0.0      # Maximum trim from each end, 0 = no trimming
    max_length_extend: float = 0.0    # Maximum extension from each end, 0 = no extension


@dataclass
class ModeShapeData:
    """Single mode shape data for visualization."""
    mode_index: int
    frequency: float
    mode_type: str  # 'vertical_bending', 'torsional', 'lateral', 'axial', 'unknown'
    mode_number: int  # 1, 2, 3... within the mode type
    displacements: List[float]  # Flat array [dx1,dy1,dz1, dx2,dy2,dz2, ...]
    strain_energy: List[float]  # Per-element normalized strain energy (0-1)
    max_displacement: float  # For scaling animation


@dataclass
class ModeShapesResult:
    """Complete mode shapes data for visualization."""
    frequencies: List[float]  # All frequencies
    classified_modes: Dict[str, List[dict]]  # Modes organized by type
    mode_shapes: List[ModeShapeData]  # Full mode shape data for each mode
    num_nodes: int
    num_elements: int
    mesh_vertices: List[float]  # Flat array [x1,y1,z1, x2,y2,z2, ...]
    mesh_indices: List[int]  # Triangle indices for visualization
    mesh_heights: List[float]  # Per-element heights
    bar_length: float
    bar_width: float
    bar_height: float


@dataclass
class DetailedEvaluation:
    """Detailed evaluation results for an individual."""
    computed_frequencies: List[float]
    target_frequencies: List[float]
    tuning_error: float
    volume_penalty: float
    roughness_penalty: float
    combined_fitness: float
    cents_errors: List[float]
    max_cents_error: float
    # Torsional mode results (Soares et al. 2021)
    torsional_frequencies: Optional[List[float]] = None
    target_torsional_frequencies: Optional[List[float]] = None
    torsional_cents_errors: Optional[List[float]] = None
    torsional_error: float = 0.0  # Torsional tuning error component
    # Mode shapes for 3D visualization (only populated when requested)
    mode_shapes_result: Optional[ModeShapesResult] = None
