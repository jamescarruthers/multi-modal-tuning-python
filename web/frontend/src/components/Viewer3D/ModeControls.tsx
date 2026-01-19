import { useCallback } from 'react';
import { useOptimizationStore } from '../../stores/optimizationStore';

export function ModeControls() {
  const {
    material,
    barDimensions,
    numCuts,
    result,
    modeShapes,
    selectedModeIndex,
    showModeAnimation,
    showStrainEnergy,
    deformationScale,
    isLoadingModeShapes,
    setModeShapes,
    setSelectedModeIndex,
    setShowModeAnimation,
    setShowStrainEnergy,
    setDeformationScale,
    setIsLoadingModeShapes,
  } = useOptimizationStore();

  const fetchModeShapes = useCallback(async () => {
    if (!result) return;

    setIsLoadingModeShapes(true);
    try {
      const response = await fetch('/api/mode-shapes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bar: barDimensions,
          genes: result.best_genes,
          num_cuts: numCuts,
          material: material,
          num_elements_x: 40, // Reduced for speed
          num_elements_y: 2,
          num_elements_z: 2,
          num_modes: 3,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setModeShapes(data);
      setSelectedModeIndex(0);
    } catch (error) {
      console.error('Failed to load mode shapes:', error);
      setModeShapes(null);
    } finally {
      setIsLoadingModeShapes(false);
    }
  }, [
    result,
    barDimensions,
    numCuts,
    material,
    setModeShapes,
    setSelectedModeIndex,
    setIsLoadingModeShapes,
  ]);

  // Only show controls if optimization is complete
  if (!result) {
    return null;
  }

  return (
    <div className="mode-controls">
      <h4>Mode Shapes</h4>

      {!modeShapes && (
        <button
          className="load-modes-button"
          onClick={fetchModeShapes}
          disabled={isLoadingModeShapes}
        >
          {isLoadingModeShapes ? 'Computing...' : 'Load Mode Shapes'}
        </button>
      )}

      {modeShapes && (
        <>
          <div className="mode-select-row">
            <label htmlFor="modeSelect">Mode:</label>
            <select
              id="modeSelect"
              value={selectedModeIndex}
              onChange={(e) => setSelectedModeIndex(parseInt(e.target.value))}
            >
              {modeShapes.mode_shapes.map((mode, i) => {
                // Format mode type for display
                const typeLabel = mode.mode_type === 'vertical_bending' ? 'V'
                  : mode.mode_type === 'torsional' ? 'T'
                  : mode.mode_type === 'lateral' ? 'L'
                  : mode.mode_type === 'axial' ? 'A'
                  : '?';
                const modeLabel = mode.mode_number > 0 ? `${typeLabel}${mode.mode_number}` : `Mode ${i + 1}`;
                return (
                  <option key={i} value={i}>
                    {modeLabel} ({mode.frequency.toFixed(1)} Hz)
                  </option>
                );
              })}
            </select>
          </div>

          <div className="mode-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={showModeAnimation}
                onChange={(e) => setShowModeAnimation(e.target.checked)}
              />
              Animate Mode Shape
            </label>
          </div>

          <div className="mode-checkbox-row">
            <label>
              <input
                type="checkbox"
                checked={showStrainEnergy}
                onChange={(e) => setShowStrainEnergy(e.target.checked)}
              />
              Strain Energy Heatmap
            </label>
          </div>

          {showModeAnimation && (
            <div className="scale-slider-row">
              <label htmlFor="deformationScale">
                Deformation: {deformationScale.toFixed(0)}
              </label>
              <input
                id="deformationScale"
                type="range"
                min={1}
                max={100}
                value={deformationScale}
                onChange={(e) => setDeformationScale(parseFloat(e.target.value))}
              />
            </div>
          )}

          <div className="mode-type-legend">
            <small>
              V = Vertical Bending, T = Torsional, L = Lateral, A = Axial
            </small>
          </div>

          <button
            className="reload-modes-button"
            onClick={fetchModeShapes}
            disabled={isLoadingModeShapes}
          >
            {isLoadingModeShapes ? 'Computing...' : 'Recompute'}
          </button>
        </>
      )}
    </div>
  );
}
