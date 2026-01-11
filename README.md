# Multi-Modal Bar Tuning Optimization

A Python library for optimizing percussion bar undercuts to achieve target harmonic frequencies using evolutionary algorithms and Timoshenko beam FEM.

## Overview

This library implements the multi-modal tuning optimization algorithm for percussion instruments (marimbas, vibraphones, xylophones). It uses:

- **Timoshenko beam theory** for accurate frequency computation (including shear deformation effects)
- **Finite Element Method (FEM)** for solving the generalized eigenvalue problem
- **Evolutionary Algorithm** with elitism, crossover, and mutation for optimization
- **Multithreading** for parallel fitness evaluation

## Features

- Optimize rectangular undercuts to achieve target frequency ratios
- Support for 17+ materials (metals and woods)
- Common tuning presets (1:4:10 marimba, 1:3:6 xylophone, etc.)
- Customizable penalty functions (volume, roughness)
- Bar length finder utility for instrument design
- Note/frequency conversion utilities

## Installation

```bash
pip install -r requirements.txt
```

Or install in development mode:

```bash
pip install -e .
```

## Quick Start

```python
from multi_modal_tuning import (
    BarParameters,
    run_evolutionary_algorithm,
    get_default_ea_parameters,
    EAConfig,
    MATERIALS,
    get_preset,
    calculate_target_frequencies,
)

# Define bar parameters (500mm x 50mm x 20mm)
bar = BarParameters(
    L=0.5,      # 500mm length
    b=0.05,     # 50mm width
    h0=0.02,    # 20mm thickness
    hMin=0.002  # 2mm minimum thickness
)

# Select material and tuning
material = MATERIALS["rosewood"]
preset = get_preset("1:4:10")
target_frequencies = calculate_target_frequencies(preset.ratios, fundamental_hz=220)

# Configure and run optimization
ea_params = get_default_ea_parameters(num_cuts=3)
config = EAConfig(
    bar=bar,
    material=material,
    target_frequencies=target_frequencies,
    num_cuts=3,
    ea_params=ea_params,
)

result = run_evolutionary_algorithm(config)
print(f"Tuning error: {result.tuning_error:.4f}%")
```

## API Reference

### Types

- `Material` - Material properties (E, rho, nu)
- `BarParameters` - Bar geometry (L, b, h0, hMin)
- `Cut` - Single rectangular cut (lambda, h)
- `EAParameters` - Evolutionary algorithm parameters
- `OptimizationResult` - Results from optimization

### Functions

- `run_evolutionary_algorithm(config)` - Main optimization function
- `run_adaptive_evolution(config)` - Variant with self-adaptive mutation
- `get_default_ea_parameters(num_cuts)` - Get default EA parameters
- `compute_frequencies(...)` - Compute natural frequencies via FEM
- `find_optimal_length(...)` - Find bar length for target frequency

### Data

- `MATERIALS` - Dictionary of material properties
- `TUNING_PRESETS` - Common tuning ratio presets

## Algorithm Details

The optimization uses a population-based evolutionary algorithm:

1. **Initialization**: Random population with optional seeding
2. **Evaluation**: Batch FEM frequency computation (multithreaded)
3. **Selection**: Roulette wheel or tournament selection
4. **Crossover**: Heuristic crossover (Eq. 16)
5. **Mutation**: Uniform or self-adaptive Gaussian mutation (Eq. 17-18)
6. **Elitism**: Best individuals preserved each generation

### Physics Model

- Timoshenko beam elements (4 DOF per element)
- Free-free boundary conditions
- Quadratic interpolation at discontinuities
- Generalized eigenvalue problem: K*φ = λ*M*φ

## License

MIT License - see LICENSE file for details.

## References

Based on the multi-modal tuning optimization research for percussion instruments.
