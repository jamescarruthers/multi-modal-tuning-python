"""Mesh generation service for Three.js visualization."""

import sys
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))

import numpy as np
from multi_modal_tuning.types import Cut
from multi_modal_tuning.physics.bar_profile import (
    genes_to_cuts,
    generate_element_heights,
)
from multi_modal_tuning.physics.fem_3d import (
    generate_bar_mesh_3d,
    assemble_global_matrices_3d,
    solve_eigenvalue_3d_with_vectors,
    compute_hex8_matrices,
    classify_all_modes,
)
from multi_modal_tuning.data.materials import MATERIALS


def hex_to_triangles(elements: np.ndarray, nodes: np.ndarray) -> List[int]:
    """
    Convert hex8 elements to triangle indices for Three.js.

    Each hex8 element has 6 faces, each face = 2 triangles = 12 triangles per hex.

    Args:
        elements: (num_elements, 8) array of node indices
        nodes: (num_nodes, 3) array of coordinates (unused but kept for signature)

    Returns:
        Flat list of triangle indices
    """
    # Face definitions (node indices within hex)
    # Standard hex8 node ordering:
    # Bottom face (z-): 0,1,2,3
    # Top face (z+): 4,5,6,7
    faces = [
        [0, 3, 2, 1],  # bottom (z-) - reversed for outward normal
        [4, 5, 6, 7],  # top (z+)
        [0, 1, 5, 4],  # front (y-)
        [2, 3, 7, 6],  # back (y+)
        [0, 4, 7, 3],  # left (x-)
        [1, 2, 6, 5],  # right (x+)
    ]

    triangles = []
    for elem in elements:
        for face in faces:
            # Each quad face -> 2 triangles
            # Triangle 1: face[0], face[1], face[2]
            # Triangle 2: face[0], face[2], face[3]
            # Convert to native Python int for JSON serialization
            triangles.extend([int(elem[face[0]]), int(elem[face[1]]), int(elem[face[2]])])
            triangles.extend([int(elem[face[0]]), int(elem[face[2]]), int(elem[face[3]])])

    return triangles


def generate_threejs_mesh(
    L: float,
    b: float,
    h0: float,
    hMin: Optional[float] = None,
    genes: Optional[List[float]] = None,
    num_cuts: int = 2,
    num_elements_x: int = 80,
    num_elements_y: int = 3,
    num_elements_z: int = 3,
) -> Dict[str, Any]:
    """
    Generate mesh data for Three.js BufferGeometry.

    Args:
        L: Bar length (m)
        b: Bar width (m)
        h0: Bar height (m)
        hMin: Minimum cut height (m), defaults to 10% of h0
        genes: Cut genes [pos1, depth1, pos2, depth2, ..., length_adjust?], or None for uncut bar
        num_cuts: Number of cuts (used to infer from genes)
        num_elements_x: Number of elements along length
        num_elements_y: Number of elements along width
        num_elements_z: Number of elements along height

    Returns:
        Dictionary with vertices, indices, heights for Three.js
    """
    if hMin is None:
        hMin = h0 * 0.1

    # Handle length adjustment if present in genes
    bar_length = L
    expected_cut_genes = num_cuts * 2
    if genes and len(genes) > expected_cut_genes:
        length_adjust = genes[expected_cut_genes]
        bar_length = L - 2 * length_adjust

    # Convert genes to cuts or create uncut bar
    if genes is None or len(genes) == 0 or num_cuts == 0:
        # Uncut bar - uniform height
        element_heights = [h0] * num_elements_x
    else:
        # Parse genes to cuts (only the cut genes, not length adjustment)
        cut_genes = genes[:expected_cut_genes]
        cuts = genes_to_cuts(cut_genes)
        # Generate element heights using the profile function
        element_heights = generate_element_heights(cuts, bar_length, h0, num_elements_x)

    # Generate 3D mesh with adjusted bar length
    nodes, elements, heights_per_element = generate_bar_mesh_3d(
        length=bar_length,
        width=b,
        element_heights=element_heights,
        nx=num_elements_x,
        ny=num_elements_y,
        nz=num_elements_z,
    )

    # Convert to Three.js format
    # Vertices: flatten (N, 3) to [x1, y1, z1, x2, y2, z2, ...]
    # Explicitly convert to Python floats for JSON serialization
    vertices = [float(v) for v in nodes.flatten()]

    # Indices: convert hex8 elements to triangles
    indices = hex_to_triangles(elements, nodes)

    # Heights for coloring - explicitly convert to Python floats
    heights = [float(h) for h in heights_per_element]

    return {
        "vertices": vertices,
        "indices": indices,
        "heights": heights,
        "bar_length": float(bar_length),
        "bar_width": float(b),
        "bar_height": float(h0),
    }


def generate_profile_mesh(
    L: float,
    h0: float,
    genes: Optional[List[float]] = None,
    num_points: int = 200,
) -> Dict[str, Any]:
    """
    Generate 2D profile line data for visualization.

    Args:
        L: Bar length (m)
        h0: Bar height (m)
        genes: Cut genes, or None for uncut bar
        num_points: Number of points along profile

    Returns:
        Dictionary with x and y arrays for the profile line
    """
    from multi_modal_tuning.physics.bar_profile import generate_profile_points

    if genes is None or len(genes) == 0:
        # Uncut bar - flat profile
        x = [0, L]
        y_top = [h0, h0]
        y_bottom = [0, 0]
    else:
        cuts = genes_to_cuts(genes)
        points = generate_profile_points(cuts, L, h0, num_points)

        x = [p[0] for p in points]
        y_top = [p[1] for p in points]
        y_bottom = [0.0] * len(points)  # Undercut from bottom

    return {
        "x": x,
        "y_top": y_top,
        "y_bottom": y_bottom,
        "bar_length": L,
        "bar_height": h0,
    }


def compute_mode_shapes(
    L: float,
    b: float,
    h0: float,
    hMin: Optional[float] = None,
    genes: Optional[List[float]] = None,
    num_cuts: int = 2,
    material_name: str = "rosewood",
    num_elements_x: int = 40,
    num_elements_y: int = 2,
    num_elements_z: int = 2,
    num_modes: int = 3,
) -> Dict[str, Any]:
    """
    Compute mode shapes and strain energy for visualization.

    Args:
        L: Bar length (m)
        b: Bar width (m)
        h0: Bar height (m)
        hMin: Minimum cut height (m), defaults to 10% of h0
        genes: Cut genes [pos1, depth1, ...], or None for uncut bar
        num_cuts: Number of cuts
        material_name: Material name from materials database
        num_elements_x: Number of elements along length
        num_elements_y: Number of elements along width
        num_elements_z: Number of elements along height
        num_modes: Number of vibration modes to compute

    Returns:
        Dictionary with frequencies, mode shapes (nodal displacements), and strain energy per element
    """
    if hMin is None:
        hMin = h0 * 0.1

    # Get material properties
    material = MATERIALS.get(material_name)
    if material is None:
        raise ValueError(f"Unknown material: {material_name}")

    E = material.E
    nu = material.nu
    rho = material.rho

    # Handle length adjustment if present in genes
    bar_length = L
    expected_cut_genes = num_cuts * 2
    if genes and len(genes) > expected_cut_genes:
        length_adjust = genes[expected_cut_genes]
        bar_length = L - 2 * length_adjust

    # Convert genes to element heights
    if genes is None or len(genes) == 0 or num_cuts == 0:
        element_heights = [h0] * num_elements_x
    else:
        cut_genes = genes[:expected_cut_genes]
        cuts = genes_to_cuts(cut_genes)
        element_heights = generate_element_heights(cuts, bar_length, h0, num_elements_x)

    # Generate 3D mesh
    nodes, elements, heights_per_element = generate_bar_mesh_3d(
        length=bar_length,
        width=b,
        element_heights=element_heights,
        nx=num_elements_x,
        ny=num_elements_y,
        nz=num_elements_z,
    )

    # Assemble global matrices
    K, M = assemble_global_matrices_3d(
        nodes=nodes,
        elements=elements,
        E=E,
        nu=nu,
        rho=rho,
        use_sparse=True,
    )

    # Solve eigenvalue problem with mode shapes
    # Request more modes to ensure we find enough bending modes after filtering
    num_request = num_modes * 4 + 6
    all_frequencies, all_mode_shapes = solve_eigenvalue_3d_with_vectors(
        K=K,
        M=M,
        num_modes=num_request,
        use_sparse=True,
    )

    # Classify modes to filter only vertical bending modes
    # This ensures we show the same modes that the optimization targets
    classified = classify_all_modes(all_frequencies, all_mode_shapes, nodes)
    bending_modes = classified['vertical_bending']

    # Extract only the vertical bending modes (up to num_modes)
    selected_modes = bending_modes[:num_modes]

    # Compute strain energy per element for each bending mode
    mode_data = []
    num_elements = len(elements)
    frequencies = []

    for bending_mode in selected_modes:
        mode_idx = bending_mode['mode_index']
        freq = bending_mode['frequency']
        frequencies.append(freq)
        mode_vector = all_mode_shapes[:, mode_idx]  # (num_dof,)

        # Compute strain energy per element: SE_e = 0.5 * u_e^T * Ke * u_e
        strain_energy = []
        for elem_idx in range(num_elements):
            elem_nodes = elements[elem_idx]
            node_coords = nodes[elem_nodes]

            # Get element stiffness matrix
            Ke, _ = compute_hex8_matrices(node_coords, E, nu, rho)

            # Extract element DOFs from global mode vector
            elem_dofs = []
            for node_idx in elem_nodes:
                elem_dofs.extend([3 * node_idx, 3 * node_idx + 1, 3 * node_idx + 2])
            u_e = mode_vector[elem_dofs]

            # Compute strain energy for this element
            se = 0.5 * float(u_e @ Ke @ u_e)
            strain_energy.append(se)

        # Normalize strain energy to 0-1 range
        max_se = max(strain_energy) if strain_energy else 1.0
        if max_se > 0:
            strain_energy_normalized = [se / max_se for se in strain_energy]
        else:
            strain_energy_normalized = strain_energy

        # Compute max displacement for scaling
        num_nodes = len(nodes)
        displacement_magnitudes = []
        for node_idx in range(num_nodes):
            dx = mode_vector[3 * node_idx]
            dy = mode_vector[3 * node_idx + 1]
            dz = mode_vector[3 * node_idx + 2]
            mag = float(np.sqrt(dx**2 + dy**2 + dz**2))
            displacement_magnitudes.append(mag)
        max_displacement = max(displacement_magnitudes) if displacement_magnitudes else 1.0

        mode_data.append({
            "mode_index": len(mode_data),  # Sequential index for the bending modes
            "frequency": float(freq),
            "displacements": [float(v) for v in mode_vector],
            "strain_energy": strain_energy_normalized,
            "max_displacement": float(max_displacement),
        })

    # Also generate the mesh data for Three.js visualization
    # This ensures the mesh matches the mode shape displacements
    vertices = [float(v) for v in nodes.flatten()]
    indices = hex_to_triangles(elements, nodes)
    heights = [float(h) for h in heights_per_element]

    mesh_data = {
        "vertices": vertices,
        "indices": indices,
        "heights": heights,
        "bar_length": float(bar_length),
        "bar_width": float(b),
        "bar_height": float(h0),
    }

    return {
        "frequencies": [float(f) for f in frequencies],
        "mode_shapes": mode_data,
        "num_nodes": len(nodes),
        "num_elements": num_elements,
        "mesh": mesh_data,
    }
