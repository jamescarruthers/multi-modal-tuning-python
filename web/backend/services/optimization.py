"""Optimization service wrapper for web interface."""

import sys
from pathlib import Path
from typing import Callable, Optional, List, Dict, Any
import asyncio
import math

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

from multi_modal_tuning.types import (
    Material,
    BarParameters,
    EAParameters,
    ProgressUpdate,
    BatchProgressState,
    OptimizationResult,
    VariableBounds,
    AnalysisMode,
)
from multi_modal_tuning.data.materials import MATERIALS
from multi_modal_tuning.data.presets import TUNING_PRESETS, get_preset, calculate_target_frequencies
from multi_modal_tuning.optimization.algorithm import EAConfig, run_evolutionary_algorithm
from multi_modal_tuning.optimization.surrogate import SurrogateConfig, run_surrogate_optimization
from multi_modal_tuning.optimization.population import create_bounds, BoundsConstraints

from models.schemas import OptimizationConfig, EAParamsConfig, SurrogateParamsConfig, PenaltyConfig, LengthAdjustConfig
from services.mesh import generate_threejs_mesh


def config_to_ea_params(config: OptimizationConfig, use_3d: bool, target_modes: Optional[List[str]] = None) -> EAParameters:
    """Convert API config to EAParameters.

    Args:
        config: Optimization configuration
        use_3d: Whether to use 3D analysis
        target_modes: Pre-resolved target modes (from preset or explicit config)
    """
    analysis_mode = AnalysisMode.SOLID_3D if use_3d else AnalysisMode.BEAM_2D

    # Get length adjust config
    length_adjust = config.length_adjust or LengthAdjustConfig()
    max_length_trim = length_adjust.max_trim
    max_length_extend = length_adjust.max_extend

    if config.ea_params:
        return EAParameters(
            population_size=config.ea_params.population_size,
            max_generations=config.ea_params.max_generations,
            target_error=config.ea_params.target_error,
            num_elements=config.ea_params.num_elements,
            elitism_percent=config.ea_params.elitism_percent,
            crossover_percent=config.ea_params.crossover_percent,
            mutation_percent=config.ea_params.mutation_percent,
            mutation_strength=config.ea_params.mutation_strength,
            f1_priority=config.ea_params.f1_priority,
            max_length_trim=max_length_trim,
            max_length_extend=max_length_extend,
            analysis_mode=analysis_mode,
            num_elements_y=config.num_elements_y if use_3d else 2,
            num_elements_z=config.num_elements_z if use_3d else 2,
            target_modes=target_modes if use_3d else None,
        )
    else:
        return EAParameters(
            population_size=100,
            max_generations=200,
            target_error=0.1,
            num_elements=80,
            elitism_percent=10,
            crossover_percent=30,
            mutation_percent=60,
            mutation_strength=0.12,
            f1_priority=1.5,
            max_length_trim=max_length_trim,
            max_length_extend=max_length_extend,
            analysis_mode=analysis_mode,
            num_elements_y=config.num_elements_y if use_3d else 2,
            num_elements_z=config.num_elements_z if use_3d else 2,
            target_modes=target_modes if use_3d else None,
        )


async def run_optimization_with_progress(
    config: OptimizationConfig,
    progress_callback: Callable[[Dict[str, Any]], None],
    generation_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    stop_event: Optional[asyncio.Event] = None,
) -> Dict[str, Any]:
    """
    Run optimization with progress callbacks for WebSocket updates.

    Args:
        config: Optimization configuration from API
        progress_callback: Called with progress updates each generation
        generation_callback: Called with full generation data for playback
        stop_event: Event to signal early stopping

    Returns:
        Final optimization result as dictionary
    """
    # Get material
    material = MATERIALS.get(config.material)
    if material is None:
        raise ValueError(f"Unknown material: {config.material}")

    # Create bar parameters
    h_min = config.bar.hMin if config.bar.hMin else config.bar.h0 * 0.1
    bar = BarParameters(
        L=config.bar.L,
        b=config.bar.b,
        h0=config.bar.h0,
        hMin=h_min,
    )

    # Get target frequencies and target modes from preset
    preset_target_modes = None
    if config.preset:
        preset = get_preset(config.preset)
        if preset is None:
            raise ValueError(f"Unknown preset: {config.preset}")
        ratios = preset.ratios
        preset_target_modes = preset.target_modes
    elif config.custom_ratios:
        ratios = config.custom_ratios
    else:
        raise ValueError("Must specify either preset or custom_ratios")

    target_frequencies = calculate_target_frequencies(ratios, config.fundamental_hz)

    # Determine if using 3D analysis
    use_3d = config.analysis_mode == "3d"

    # Determine target_modes for 3D analysis
    # Priority: explicit params > preset > default (V1, V2, V3, ...)
    target_modes_3d = None
    if use_3d:
        # Check if explicitly set in params
        if config.algorithm == "evolutionary" and config.ea_params and config.ea_params.target_modes:
            target_modes_3d = config.ea_params.target_modes
        elif config.algorithm == "surrogate" and config.surrogate_params and config.surrogate_params.target_modes:
            target_modes_3d = config.surrogate_params.target_modes
        elif preset_target_modes:
            # Use preset's target_modes
            target_modes_3d = preset_target_modes
        else:
            # Default to V1, V2, V3, ... (all vertical bending)
            target_modes_3d = [f'V{i+1}' for i in range(len(ratios))]

    # Track last mesh update for throttling - store both metadata and actual mesh
    last_mesh_state = {'gen': -10, 'fitness': float('inf'), 'mesh': None}
    mesh_update_interval = config.mesh_update_interval  # How often to update mesh

    # Create progress wrapper that also generates mesh
    def wrapped_progress_callback(update: ProgressUpdate):
        try:
            # Check for stop signal
            if stop_event and stop_event.is_set():
                return

            # Get genes from best individual
            best_genes = update.best_individual.genes if update.best_individual else []

            # Generate mesh for current best (throttled based on config)
            # Update mesh every N generations OR when fitness improves significantly
            gen_diff = update.generation - last_mesh_state['gen']
            fitness_improved = update.best_fitness < last_mesh_state['fitness'] * 0.95
            should_update_mesh = gen_diff >= mesh_update_interval or fitness_improved or update.generation <= 1

            if best_genes and should_update_mesh:
                try:
                    new_mesh = generate_threejs_mesh(
                        L=bar.L,
                        b=bar.b,
                        h0=bar.h0,
                        hMin=bar.hMin,
                        genes=list(best_genes),
                        num_cuts=config.num_cuts,
                        num_elements_x=80,
                        num_elements_y=config.num_elements_y if use_3d else 1,
                        num_elements_z=config.num_elements_z if use_3d else 1,
                    )
                    last_mesh_state['gen'] = update.generation
                    last_mesh_state['fitness'] = update.best_fitness
                    last_mesh_state['mesh'] = new_mesh
                except Exception:
                    pass  # Keep previous mesh on error

            # Use the last generated mesh (either new or cached)
            mesh_data = last_mesh_state['mesh']

            # Use errors from update if available, otherwise calculate
            errors_cents = []
            if update.errors_in_cents:
                errors_cents = list(update.errors_in_cents)
            elif update.computed_frequencies and len(update.computed_frequencies) == len(target_frequencies):
                for computed, target in zip(update.computed_frequencies, target_frequencies):
                    if target > 0 and computed > 0:
                        errors_cents.append(1200 * math.log2(computed / target))
                    else:
                        errors_cents.append(0.0)

            # Ensure all numpy types are converted to native Python types for JSON serialization
            # Handle infinity values that can't be serialized to JSON
            best_fitness_val = float(update.best_fitness) if update.best_fitness is not None else 0.0
            if math.isinf(best_fitness_val):
                best_fitness_val = None  # Will be handled as Infinity on frontend

            progress_data = {
                "type": "progress",
                "generation": int(update.generation),
                "best_fitness": best_fitness_val,
                "computed_frequencies": [float(f) for f in update.computed_frequencies] if update.computed_frequencies else [],
                "errors_cents": [float(e) for e in errors_cents],
                "best_genes": [float(g) for g in best_genes],
                "mesh": mesh_data,
            }

            # Add batch progress if available
            if update.batch_progress is not None:
                bp = update.batch_progress
                # Handle infinity in best_fitness_so_far
                best_so_far = None
                if bp.best_fitness_so_far is not None:
                    best_so_far = float(bp.best_fitness_so_far)
                    if math.isinf(best_so_far):
                        best_so_far = None
                progress_data["batch_progress"] = {
                    "completed": bp.completed,
                    "total": bp.total,
                    "best_fitness_so_far": best_so_far,
                    "message": bp.message,
                }

            # Add FEM progress if available
            if update.fem_progress is not None:
                fp = update.fem_progress
                progress_data["fem_progress"] = {
                    "stage": fp.stage,
                    "percent": float(fp.percent),
                    "message": fp.message,
                }

            progress_callback(progress_data)
        except Exception:
            pass

    # Get penalty config
    penalty = config.penalty or PenaltyConfig()
    penalty_type = penalty.penalty_type
    penalty_weight = penalty.penalty_weight

    # Run optimization based on algorithm choice
    if config.algorithm == "evolutionary":
        ea_params = config_to_ea_params(config, use_3d, target_modes_3d)

        ea_config = EAConfig(
            bar=bar,
            material=material,
            target_frequencies=target_frequencies,
            num_cuts=config.num_cuts,
            penalty_type=penalty_type,
            penalty_weight=penalty_weight,
            ea_params=ea_params,
            on_progress=wrapped_progress_callback,
        )

        # Run in executor to avoid blocking
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            run_evolutionary_algorithm,
            ea_config,
        )

    elif config.algorithm == "surrogate":
        surrogate_params = config.surrogate_params or SurrogateParamsConfig()
        analysis_mode = AnalysisMode.SOLID_3D if use_3d else AnalysisMode.BEAM_2D

        # Get length adjust config for bounds
        length_adjust = config.length_adjust or LengthAdjustConfig()
        bounds_constraints = BoundsConstraints(
            max_length_trim=length_adjust.max_trim,
            max_length_extend=length_adjust.max_extend,
        )

        # Create bounds for surrogate optimization
        bounds = create_bounds(bar, config.num_cuts, bounds_constraints)

        surrogate_config = SurrogateConfig(
            bar=bar,
            material=material,
            target_frequencies=target_frequencies,
            num_cuts=config.num_cuts,
            bounds=bounds,
            max_evaluations=surrogate_params.max_iterations,
            initial_points=surrogate_params.initial_samples,
            target_error=surrogate_params.target_error,
            num_elements=surrogate_params.num_elements,
            penalty_type=penalty_type,
            penalty_weight=penalty_weight,
            f1_priority=surrogate_params.f1_priority,
            analysis_mode=analysis_mode,
            ny=config.num_elements_y if use_3d else 2,
            nz=config.num_elements_z if use_3d else 2,
            target_modes=target_modes_3d,
            on_progress=wrapped_progress_callback,
        )

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            run_surrogate_optimization,
            surrogate_config,
        )
    else:
        raise ValueError(f"Unknown algorithm: {config.algorithm}")

    # Extract data from result
    best_genes = list(result.best_individual.genes) if result.best_individual else []
    cut_positions = [cut.lambda_ for cut in result.cuts]
    cut_depths = [cut.h for cut in result.cuts]

    # Calculate final bar length (accounting for length adjustment)
    # Length adjust gene is at position num_cuts * 2 (after all cut genes)
    expected_cut_genes = config.num_cuts * 2
    length_adjustment = 0.0
    if len(best_genes) > expected_cut_genes:
        length_adjustment = best_genes[expected_cut_genes]
    final_bar_length = bar.L - 2 * length_adjustment  # Trim from both ends

    # Generate final mesh
    final_mesh = generate_threejs_mesh(
        L=bar.L,
        b=bar.b,
        h0=bar.h0,
        hMin=bar.hMin,
        genes=best_genes,
        num_cuts=config.num_cuts,
        num_elements_x=80,
        num_elements_y=config.num_elements_y if use_3d else 1,
        num_elements_z=config.num_elements_z if use_3d else 1,
    )

    # Use errors from result
    errors_cents = list(result.errors_in_cents) if result.errors_in_cents else []

    # Use mode shapes from optimization result (computed during final evaluation)
    # This guarantees identical frequencies since it's from the same FEM computation
    mode_shapes_data = None
    if result.mode_shapes_result is not None:
        ms = result.mode_shapes_result
        # Convert ModeShapeData objects to dicts for JSON serialization
        mode_shapes_list = []
        for mode_shape in ms.mode_shapes:
            mode_shapes_list.append({
                "mode_index": mode_shape.mode_index,
                "frequency": mode_shape.frequency,
                "mode_type": mode_shape.mode_type,
                "mode_number": mode_shape.mode_number,
                "displacements": mode_shape.displacements,
                "strain_energy": mode_shape.strain_energy,
                "max_displacement": mode_shape.max_displacement,
            })

        mode_shapes_data = {
            "frequencies": ms.frequencies,
            "classified_modes": ms.classified_modes,
            "mode_shapes": mode_shapes_list,
            "num_nodes": ms.num_nodes,
            "num_elements": ms.num_elements,
            "mesh": {
                "vertices": ms.mesh_vertices,
                "indices": ms.mesh_indices,
                "heights": ms.mesh_heights,
                "bar_length": ms.bar_length,
                "bar_width": ms.bar_width,
                "bar_height": ms.bar_height,
            },
        }

    return {
        "type": "complete",
        "result": {
            "cut_positions": cut_positions,
            "cut_depths": cut_depths,
            "computed_frequencies": list(result.computed_frequencies),
            "target_frequencies": list(result.target_frequencies),
            "errors_cents": errors_cents,
            "tuning_error": result.tuning_error,
            "generations_run": result.generations,
            "best_genes": best_genes,
            "original_bar_length": bar.L,
            "final_bar_length": final_bar_length,
            "length_adjustment": length_adjustment,
        },
        "final_mesh": final_mesh,
        "mode_shapes": mode_shapes_data,
    }
