import { useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Grid, Environment } from '@react-three/drei';
import { useOptimizationStore } from '../../stores/optimizationStore';
import { BarMesh } from './BarMesh';
import { PlaybackControls } from './PlaybackControls';
import { ModeControls } from './ModeControls';

function AnimatedBar() {
  const {
    currentMesh,
    finalMesh,
    barDimensions,
    modeShapes,
    selectedModeIndex,
    showModeAnimation,
    showStrainEnergy,
    deformationScale,
  } = useOptimizationStore();

  const [animationPhase, setAnimationPhase] = useState(0);

  // Animation speed in radians per second (1 Hz = 2π rad/s)
  const animationSpeed = 2 * Math.PI;

  // Animation loop
  useFrame((_, delta) => {
    if (showModeAnimation && modeShapes) {
      setAnimationPhase((prev) => (prev + delta * animationSpeed) % (2 * Math.PI));
    }
  });

  // Get the selected mode shape
  const selectedModeShape =
    modeShapes && modeShapes.mode_shapes.length > selectedModeIndex
      ? modeShapes.mode_shapes[selectedModeIndex]
      : null;

  // Use mode shape mesh when visualizing mode shapes, otherwise use current/final mesh
  // This ensures the mesh vertices match the mode shape displacements
  const meshToRender =
    (showModeAnimation || showStrainEnergy) && modeShapes?.mesh
      ? modeShapes.mesh
      : currentMesh || finalMesh;

  // Scale factor to make the bar visible (bars are typically ~0.1-0.3m)
  const scale = 10;

  return (
    <>
      {/* Bar mesh with mode shape visualization */}
      {meshToRender && (
        <group scale={[scale, scale, scale]}>
          <BarMesh
            meshData={meshToRender}
            modeShape={showModeAnimation || showStrainEnergy ? selectedModeShape : null}
            animationPhase={showModeAnimation ? animationPhase : 0}
            deformationScale={deformationScale * 0.001} // Convert to appropriate scale
            showStrainEnergy={showStrainEnergy}
          />
        </group>
      )}

      {/* Placeholder when no mesh */}
      {!meshToRender && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry
            args={[
              barDimensions.L * scale,
              barDimensions.h0 * scale,
              barDimensions.b * scale,
            ]}
          />
          <meshStandardMaterial color="#8B4513" opacity={0.5} transparent />
        </mesh>
      )}
    </>
  );
}

function SceneContent() {
  const { barDimensions } = useOptimizationStore();

  // Scale factor to make the bar visible
  const scale = 10;

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0.3 * scale, 0.5 * scale]} fov={50} />
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        target={[0, 0, 0]}
      />

      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      <directionalLight position={[-5, 5, -5]} intensity={0.3} />

      {/* Environment for reflections */}
      <Environment preset="studio" />

      {/* Grid for reference */}
      <Grid
        position={[0, -barDimensions.h0 * scale / 2 - 0.01, 0]}
        args={[10, 10]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#6f6f6f"
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor="#9d4b4b"
        fadeDistance={25}
        fadeStrength={1}
        followCamera={false}
      />

      {/* Animated bar mesh */}
      <AnimatedBar />
    </>
  );
}

export function Scene() {
  return (
    <div className="viewer-container">
      <Canvas shadows>
        <SceneContent />
      </Canvas>
      <PlaybackControls />
      <ModeControls />
    </div>
  );
}
