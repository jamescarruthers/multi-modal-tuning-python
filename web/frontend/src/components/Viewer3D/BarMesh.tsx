import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { MeshData, ModeShape } from '../../types';

interface BarMeshProps {
  meshData: MeshData;
  modeShape?: ModeShape | null;
  animationPhase?: number;
  deformationScale?: number;
  showStrainEnergy?: boolean;
}

// Cool-to-hot colormap: blue -> cyan -> green -> yellow -> red
function strainEnergyToColor(value: number): [number, number, number] {
  // value is 0-1 (normalized strain energy)
  const t = Math.max(0, Math.min(1, value));

  if (t < 0.25) {
    // Blue to Cyan
    const s = t / 0.25;
    return [0, s, 1];
  } else if (t < 0.5) {
    // Cyan to Green
    const s = (t - 0.25) / 0.25;
    return [0, 1, 1 - s];
  } else if (t < 0.75) {
    // Green to Yellow
    const s = (t - 0.5) / 0.25;
    return [s, 1, 0];
  } else {
    // Yellow to Red
    const s = (t - 0.75) / 0.25;
    return [1, 1 - s, 0];
  }
}

export function BarMesh({
  meshData,
  modeShape,
  animationPhase = 0,
  deformationScale = 10,
  showStrainEnergy = false,
}: BarMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);

  // Create geometry with optional mode shape deformation
  const geometry = useMemo(() => {
    // Dispose old geometry if it exists
    if (geometryRef.current) {
      geometryRef.current.dispose();
    }

    const geo = new THREE.BufferGeometry();

    // Apply mode shape deformation if available
    let vertices: Float32Array;
    if (modeShape && modeShape.displacements.length > 0) {
      // node_pos + scale * sin(phase) * displacement
      const scale = deformationScale * Math.sin(animationPhase) / modeShape.max_displacement;
      vertices = new Float32Array(meshData.vertices.length);

      for (let i = 0; i < meshData.vertices.length; i += 3) {
        vertices[i] = meshData.vertices[i] + scale * modeShape.displacements[i];
        vertices[i + 1] = meshData.vertices[i + 1] + scale * modeShape.displacements[i + 1];
        vertices[i + 2] = meshData.vertices[i + 2] + scale * modeShape.displacements[i + 2];
      }
    } else {
      vertices = new Float32Array(meshData.vertices);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    // Set indices
    const indices = new Uint32Array(meshData.indices);
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    // Add vertex colors for strain energy heatmap
    if (showStrainEnergy && modeShape && modeShape.strain_energy.length > 0) {
      // Create vertex colors based on strain energy
      // Each triangle face gets colored based on its element's strain energy
      // Since we're using indexed geometry, we need to map element strain energy to vertices
      const numVertices = meshData.vertices.length / 3;
      const colors = new Float32Array(numVertices * 3);

      // Initialize with base color
      for (let i = 0; i < numVertices; i++) {
        colors[i * 3] = 0.5;
        colors[i * 3 + 1] = 0.5;
        colors[i * 3 + 2] = 0.5;
      }

      // Map element strain energy to vertices
      // Each hex8 element has 12 triangles (6 faces * 2 triangles)
      // So every 36 indices (12 triangles * 3 vertices) belong to one element
      const trianglesPerElement = 12;
      const indicesPerElement = trianglesPerElement * 3; // 36

      for (let elemIdx = 0; elemIdx < modeShape.strain_energy.length; elemIdx++) {
        const se = modeShape.strain_energy[elemIdx];
        const [r, g, b] = strainEnergyToColor(se);

        // Get all vertex indices for this element's triangles
        const startIdx = elemIdx * indicesPerElement;
        const endIdx = Math.min(startIdx + indicesPerElement, meshData.indices.length);

        for (let i = startIdx; i < endIdx; i++) {
          const vertIdx = meshData.indices[i];
          // Average the colors if a vertex is shared
          colors[vertIdx * 3] = r;
          colors[vertIdx * 3 + 1] = g;
          colors[vertIdx * 3 + 2] = b;
        }
      }

      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    // Compute normals for proper lighting
    geo.computeVertexNormals();

    geometryRef.current = geo;
    return geo;
  }, [meshData, modeShape, animationPhase, deformationScale, showStrainEnergy]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (geometryRef.current) {
        geometryRef.current.dispose();
      }
      if (materialRef.current) {
        materialRef.current.dispose();
      }
    };
  }, []);

  // Create material - use vertex colors when showing strain energy
  const material = useMemo(() => {
    if (materialRef.current) {
      materialRef.current.dispose();
    }

    const mat = new THREE.MeshStandardMaterial({
      color: showStrainEnergy ? '#ffffff' : '#8B4513', // White for vertex colors, wood otherwise
      flatShading: true,
      metalness: 0.1,
      roughness: 0.8,
      vertexColors: showStrainEnergy && modeShape !== null,
    });

    materialRef.current = mat;
    return mat;
  }, [showStrainEnergy, modeShape]);

  // Center the bar at origin
  const position: [number, number, number] = useMemo(() => {
    return [
      -meshData.bar_length / 2,
      -meshData.bar_width / 2,
      -meshData.bar_height / 2,
    ];
  }, [meshData.bar_length, meshData.bar_width, meshData.bar_height]);

  // Create edges geometry that updates with main geometry
  const edgesGeometry = useMemo(() => {
    return new THREE.EdgesGeometry(geometry, 15);
  }, [geometry]);

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} position={position}>
      {/* Edges for better visibility */}
      <lineSegments geometry={edgesGeometry}>
        <lineBasicMaterial color="#3a2410" linewidth={1} />
      </lineSegments>
    </mesh>
  );
}
