import { useOptimizationStore } from '../../stores/optimizationStore';

export function GenerationDisplay() {
  const { isRunning, currentGeneration, bestFitness, eaParams, surrogateParams, algorithm } =
    useOptimizationStore();

  const isEA = algorithm === 'evolutionary';
  const maxValue = isEA ? eaParams.max_generations : surrogateParams.max_iterations;
  const progress = maxValue > 0 ? (currentGeneration / maxValue) * 100 : 0;

  // Different labels for EA vs Surrogate
  const counterLabel = isEA ? 'Generation' : 'Evaluation';
  const maxLabel = isEA ? 'generations' : 'evaluations';

  return (
    <div className="generation-display">
      <div className="generation-header">
        <span className="generation-label">
          {isRunning ? 'Running...' : currentGeneration > 0 ? 'Complete' : 'Ready'}
        </span>
        <span className="generation-number">
          {counterLabel} {currentGeneration} / {maxValue}
        </span>
      </div>

      <div className="progress-bar-container">
        <div
          className="progress-bar"
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>

      <div className="fitness-display">
        <span className="fitness-label">Best Error (cents):</span>
        <span className="fitness-value">
          {bestFitness === Infinity ? '--' : bestFitness.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
