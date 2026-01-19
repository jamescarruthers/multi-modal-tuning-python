import { MaterialSelector } from './MaterialSelector';
import { DimensionInputs } from './DimensionInputs';
import { PresetSelector } from './PresetSelector';
import { AlgorithmConfig } from './AlgorithmConfig';
import { useOptimization } from '../../hooks/useOptimization';
import { useOptimizationStore } from '../../stores/optimizationStore';

export function ConfigPanel() {
  const { startOptimization, stopOptimization } = useOptimization();
  const { isRunning, reset } = useOptimizationStore();

  return (
    <div className="config-panel">
      <h3>Configuration</h3>

      <MaterialSelector />
      <DimensionInputs />
      <PresetSelector />
      <AlgorithmConfig />

      <div className="config-actions">
        {isRunning ? (
          <button type="button" className="btn-stop" onClick={stopOptimization}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn-start" onClick={startOptimization}>
            Start Optimization
          </button>
        )}

        <button type="button" className="btn-reset" onClick={reset} disabled={isRunning}>
          Reset
        </button>
      </div>
    </div>
  );
}
