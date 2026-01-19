"""Pydantic models for API request/response schemas."""

from typing import List, Dict, Optional, Any, Literal
from pydantic import BaseModel, Field


# Material schemas
class MaterialResponse(BaseModel):
    """Single material response."""

    key: str = Field(description="Material key for API calls")
    name: str
    E: float = Field(description="Young's modulus (Pa)")
    rho: float = Field(description="Density (kg/m³)")
    nu: float = Field(description="Poisson's ratio")
    category: str


class MaterialsListResponse(BaseModel):
    """List of materials grouped by category."""

    materials: Dict[str, List[MaterialResponse]]


# Preset schemas
class PresetResponse(BaseModel):
    """Single tuning preset response."""

    name: str
    ratios: List[float] = Field(description="Frequency ratios [1, r2, r3, ...]")
    description: str
    target_modes: Optional[List[str]] = Field(
        default=None,
        description="Target modes for 3D analysis (e.g., ['V1', 'V2', 'V3', 'T1'])"
    )


class PresetsListResponse(BaseModel):
    """List of tuning presets."""

    presets: List[PresetResponse]


# Bar and mesh schemas
class BarDimensions(BaseModel):
    """Bar dimensions in meters."""

    L: float = Field(description="Length (m)", gt=0)
    b: float = Field(description="Width (m)", gt=0)
    h0: float = Field(description="Height (m)", gt=0)
    hMin: Optional[float] = Field(default=None, description="Minimum height (m)")


class MeshRequest(BaseModel):
    """Request to generate a mesh for Three.js."""

    bar: BarDimensions
    genes: Optional[List[float]] = Field(
        default=None, description="Cut genes [pos1, depth1, pos2, depth2, ...]"
    )
    num_cuts: int = Field(default=2, ge=0, le=5)
    num_elements_x: int = Field(default=80, ge=20, le=200)
    num_elements_y: int = Field(default=3, ge=1, le=10)
    num_elements_z: int = Field(default=3, ge=1, le=10)
    mode_3d: bool = Field(default=False)


class MeshResponse(BaseModel):
    """Mesh data for Three.js BufferGeometry."""

    vertices: List[float] = Field(description="Flat array [x1,y1,z1, x2,y2,z2, ...]")
    indices: List[int] = Field(description="Triangle indices")
    heights: List[float] = Field(description="Per-element heights for coloring")
    bar_length: float
    bar_width: float
    bar_height: float


# Optimization config schemas
class EAParamsConfig(BaseModel):
    """Evolutionary algorithm parameters."""

    population_size: int = Field(default=100, ge=10, le=500)
    max_generations: int = Field(default=200, ge=10, le=2000)
    target_error: float = Field(default=0.1, ge=0.001, le=10.0)
    num_elements: int = Field(default=80, ge=20, le=200)
    elitism_percent: int = Field(default=10, ge=0, le=50)
    crossover_percent: int = Field(default=30, ge=0, le=100)
    mutation_percent: int = Field(default=60, ge=0, le=100)
    mutation_strength: float = Field(default=0.12, ge=0.01, le=0.5)
    f1_priority: float = Field(default=1.5, ge=1.0, le=5.0)
    target_modes: Optional[List[str]] = Field(
        default=None,
        description="Target modes for 3D analysis (e.g., ['V1', 'V2', 'V3'] or ['V1', 'T1', 'V2']). "
                    "V=vertical_bending, T=torsional, L=lateral, A=axial. "
                    "If None, uses first N modes by frequency (unclassified)."
    )


class SurrogateParamsConfig(BaseModel):
    """Surrogate (RBF) optimization parameters."""

    max_iterations: int = Field(default=100, ge=10, le=10000)
    initial_samples: int = Field(default=50, ge=10, le=5000)
    target_error: float = Field(default=0.1, ge=0.001, le=10.0)
    num_elements: int = Field(default=80, ge=20, le=200)
    f1_priority: float = Field(default=1.5, ge=1.0, le=5.0)
    target_modes: Optional[List[str]] = Field(
        default=None,
        description="Target modes for 3D analysis (e.g., ['V1', 'V2', 'V3'] or ['V1', 'T1', 'V2']). "
                    "V=vertical_bending, T=torsional, L=lateral, A=axial. "
                    "If None, uses preset's target_modes or defaults to V1, V2, V3, ..."
    )


class PenaltyConfig(BaseModel):
    """Penalty configuration for optimization."""

    penalty_type: Literal["none", "volume", "roughness"] = Field(
        default="none", description="Type of penalty to apply"
    )
    penalty_weight: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Weight of penalty (alpha)"
    )


class LengthAdjustConfig(BaseModel):
    """Length trim/extend configuration for optimization."""

    max_trim: float = Field(
        default=0.0, ge=0.0, le=0.15, description="Max trim from each end (m)"
    )
    max_extend: float = Field(
        default=0.0, ge=0.0, le=0.15, description="Max extension from each end (m)"
    )


class OptimizationConfig(BaseModel):
    """Full optimization configuration."""

    material: str = Field(description="Material name from materials list")
    bar: BarDimensions
    preset: Optional[str] = Field(default=None, description="Preset name or custom")
    custom_ratios: Optional[List[float]] = Field(
        default=None, description="Custom frequency ratios if not using preset"
    )
    fundamental_hz: float = Field(description="Target fundamental frequency (Hz)", gt=0)
    num_cuts: int = Field(default=2, ge=0, le=5)
    algorithm: str = Field(
        default="evolutionary", description="'evolutionary' or 'surrogate'"
    )
    analysis_mode: str = Field(default="2d", description="'2d' or '3d'")
    ea_params: Optional[EAParamsConfig] = None
    surrogate_params: Optional[SurrogateParamsConfig] = None
    penalty: Optional[PenaltyConfig] = None
    length_adjust: Optional[LengthAdjustConfig] = None
    # 3D specific
    num_elements_y: int = Field(default=3, ge=1, le=10)
    num_elements_z: int = Field(default=3, ge=1, le=10)
    # Mesh update frequency
    mesh_update_interval: int = Field(
        default=1, ge=1, le=50, description="Update mesh every N generations (1 = every generation)"
    )


class ValidationResponse(BaseModel):
    """Response from config validation."""

    valid: bool
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


# WebSocket message schemas
class ProgressMessage(BaseModel):
    """Progress update during optimization."""

    type: str = "progress"
    generation: int
    best_fitness: float
    computed_frequencies: List[float]
    errors_cents: List[float]
    best_genes: List[float]
    mesh: Optional[MeshResponse] = None


class IndividualData(BaseModel):
    """Individual in population."""

    genes: List[float]
    fitness: float
    frequencies: Optional[List[float]] = None


class GenerationMessage(BaseModel):
    """Complete generation data for playback."""

    type: str = "generation"
    generation: int
    population: List[IndividualData]
    best_individual: IndividualData


class OptimizationResultData(BaseModel):
    """Final optimization result."""

    cut_positions: List[float]
    cut_depths: List[float]
    computed_frequencies: List[float]
    target_frequencies: List[float]
    errors_cents: List[float]
    tuning_error: float
    generations_run: int
    best_genes: List[float]


class CompleteMessage(BaseModel):
    """Optimization complete message."""

    type: str = "complete"
    result: OptimizationResultData
    final_mesh: MeshResponse
    mode_shapes: Optional[Any] = Field(default=None, description="Mode shapes data (for 3D analysis)")


# Mode shape visualization schemas
class ModeShapeRequest(BaseModel):
    """Request to compute mode shapes for visualization."""

    bar: BarDimensions
    genes: Optional[List[float]] = Field(
        default=None, description="Cut genes [pos1, depth1, pos2, depth2, ...]"
    )
    num_cuts: int = Field(default=2, ge=0, le=5)
    material: str = Field(default="rosewood", description="Material name")
    num_elements_x: int = Field(default=40, ge=10, le=100, description="Elements along length (reduced for speed)")
    num_elements_y: int = Field(default=2, ge=1, le=5, description="Elements along width")
    num_elements_z: int = Field(default=2, ge=1, le=5, description="Elements along height")
    num_modes: int = Field(default=3, ge=1, le=10, description="Number of modes to compute")


class ModeShapeData(BaseModel):
    """Single mode shape data."""

    mode_index: int
    frequency: float = Field(description="Natural frequency (Hz)")
    mode_type: str = Field(default="unknown", description="Mode type: vertical_bending, torsional, lateral, axial")
    mode_number: int = Field(default=0, description="Mode number within its type (1, 2, 3...)")
    displacements: List[float] = Field(description="Nodal displacements [dx1,dy1,dz1, dx2,dy2,dz2, ...]")
    strain_energy: List[float] = Field(description="Normalized strain energy per element (0-1)")
    max_displacement: float = Field(description="Maximum displacement magnitude for scaling")


class ClassifiedModeEntry(BaseModel):
    """A single entry in the classified modes dict."""

    frequency: float
    mode_index: int
    mode_number: int


class ClassifiedModes(BaseModel):
    """Modes classified by type."""

    vertical_bending: List[ClassifiedModeEntry] = Field(default_factory=list)
    torsional: List[ClassifiedModeEntry] = Field(default_factory=list)
    lateral: List[ClassifiedModeEntry] = Field(default_factory=list)
    axial: List[ClassifiedModeEntry] = Field(default_factory=list)


class ModeShapeResponse(BaseModel):
    """Response with computed mode shapes."""

    frequencies: List[float] = Field(description="Natural frequencies (Hz)")
    classified_modes: Optional[ClassifiedModes] = Field(default=None, description="Modes classified by type")
    mode_shapes: List[ModeShapeData]
    num_nodes: int
    num_elements: int
    mesh: MeshResponse = Field(description="Mesh data matching the mode shape computation")
