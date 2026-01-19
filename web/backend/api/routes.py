"""REST API routes for the multi-modal tuning web interface."""

import sys
from pathlib import Path
from typing import List
from fastapi import APIRouter, HTTPException

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from multi_modal_tuning.data.materials import MATERIALS, get_materials_by_category
from multi_modal_tuning.data.presets import TUNING_PRESETS

from models.schemas import (
    MaterialResponse,
    MaterialsListResponse,
    PresetResponse,
    PresetsListResponse,
    MeshRequest,
    MeshResponse,
    OptimizationConfig,
    ValidationResponse,
    ModeShapeRequest,
    ModeShapeResponse,
)
from services.mesh import generate_threejs_mesh, compute_mode_shapes

router = APIRouter()


@router.get("/materials", response_model=MaterialsListResponse)
async def get_materials():
    """Get all materials grouped by category."""
    grouped = get_materials_by_category()

    result = {}
    for category, materials in grouped.items():
        result[category] = [
            MaterialResponse(
                key=key,
                name=m.name,
                E=m.E,
                rho=m.rho,
                nu=m.nu,
                category=m.category,
            )
            for key, m in materials
        ]

    return MaterialsListResponse(materials=result)


@router.get("/materials/{material_key}", response_model=MaterialResponse)
async def get_material(material_key: str):
    """Get a specific material by key."""
    if material_key not in MATERIALS:
        raise HTTPException(status_code=404, detail=f"Material '{material_key}' not found")

    m = MATERIALS[material_key]
    return MaterialResponse(
        key=material_key,
        name=m.name,
        E=m.E,
        rho=m.rho,
        nu=m.nu,
        category=m.category,
    )


@router.get("/material-keys", response_model=List[str])
async def get_material_keys():
    """Get all material keys."""
    return list(MATERIALS.keys())


@router.get("/presets", response_model=PresetsListResponse)
async def get_presets():
    """Get all tuning presets."""
    presets = [
        PresetResponse(
            name=p.name,
            ratios=p.ratios,
            description=p.description or "",
            target_modes=p.target_modes,
        )
        for p in TUNING_PRESETS
    ]
    return PresetsListResponse(presets=presets)


@router.post("/mesh", response_model=MeshResponse)
async def generate_mesh(request: MeshRequest):
    """Generate mesh data for Three.js visualization."""
    try:
        mesh_data = generate_threejs_mesh(
            L=request.bar.L,
            b=request.bar.b,
            h0=request.bar.h0,
            hMin=request.bar.hMin,
            genes=request.genes,
            num_cuts=request.num_cuts,
            num_elements_x=request.num_elements_x,
            num_elements_y=request.num_elements_y if request.mode_3d else 1,
            num_elements_z=request.num_elements_z if request.mode_3d else 1,
        )
        return MeshResponse(**mesh_data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/validate-config", response_model=ValidationResponse)
async def validate_config(config: OptimizationConfig):
    """Validate optimization configuration."""
    errors = []
    warnings = []

    # Check material exists
    if config.material not in MATERIALS:
        errors.append(f"Unknown material: {config.material}")

    # Check preset or custom ratios
    if config.preset is None and config.custom_ratios is None:
        errors.append("Must specify either preset or custom_ratios")
    elif config.custom_ratios is not None:
        if len(config.custom_ratios) < 2:
            errors.append("custom_ratios must have at least 2 values")
        if config.custom_ratios[0] != 1.0:
            warnings.append("First ratio should typically be 1.0 (fundamental)")

    # Check algorithm
    if config.algorithm not in ["evolutionary", "surrogate"]:
        errors.append(f"Unknown algorithm: {config.algorithm}")

    # Check analysis mode
    if config.analysis_mode not in ["2d", "3d"]:
        errors.append(f"Unknown analysis_mode: {config.analysis_mode}")

    # Check bar dimensions
    if config.bar.hMin is not None and config.bar.hMin >= config.bar.h0:
        errors.append("hMin must be less than h0")

    # Warnings for potentially long runs
    if config.analysis_mode == "3d":
        if config.num_elements_y > 5 or config.num_elements_z > 5:
            warnings.append("High 3D mesh resolution will significantly increase computation time")

    if config.algorithm == "evolutionary" and config.ea_params:
        if config.ea_params.max_generations > 500:
            warnings.append("High max_generations may result in long computation time")

    return ValidationResponse(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
    )


@router.post("/mode-shapes", response_model=ModeShapeResponse)
async def get_mode_shapes(request: ModeShapeRequest):
    """
    Compute mode shapes and strain energy for 3D visualization.

    This endpoint performs a 3D FEM modal analysis and returns:
    - Natural frequencies for each mode
    - Nodal displacements (mode shapes) for animation
    - Per-element strain energy for heatmap visualization
    """
    try:
        # Check material exists
        if request.material not in MATERIALS:
            raise HTTPException(status_code=400, detail=f"Unknown material: {request.material}")

        result = compute_mode_shapes(
            L=request.bar.L,
            b=request.bar.b,
            h0=request.bar.h0,
            hMin=request.bar.hMin,
            genes=request.genes,
            num_cuts=request.num_cuts,
            material_name=request.material,
            num_elements_x=request.num_elements_x,
            num_elements_y=request.num_elements_y,
            num_elements_z=request.num_elements_z,
            num_modes=request.num_modes,
        )

        return ModeShapeResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Mode shape computation failed: {str(e)}")
