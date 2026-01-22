import { useOptimizationStore } from '../../stores/optimizationStore';

export function GenerationDisplay() {
  const {
    isRunning,
    currentGeneration,
    bestFitness,
    eaParams,
    surrogateParams,
    algorithm,
    analysisMode,
    batchProgress,
    femProgress,
  } = useOptimizationStore();

  const isEA = algorithm === 'evolutionary';
  const is3D = analysisMode === '3d';
  const maxValue = isEA ? eaParams.max_generations : surrogateParams.max_iterations;
  const progress = maxValue > 0 ? (currentGeneration / maxValue) * 100 : 0;

  // Debug logging for batch progress
  console.log('[GenerationDisplay] isRunning:', isRunning, 'is3D:', is3D, 'batchProgress:', batchProgress);

  // Different labels for EA vs Surrogate
  const counterLabel = isEA ? 'Generation' : 'Evaluation';

  // Determine current status message
  const getStatusMessage = () => {
    if (!isRunning) {
      return currentGeneration > 0 ? 'Complete' : 'Ready';
    }

    // Show detailed progress for 3D FEM
    if (is3D && femProgress) {
      return femProgress.message;
    }

    if (batchProgress) {
      return batchProgress.message;
    }

    return 'Running...';
  };

  // Calculate batch progress percentage
  const getBatchProgressPercent = () => {
    if (!batchProgress || batchProgress.total === 0) return 0;
    return (batchProgress.completed / batchProgress.total) * 100;
  };

  return (
    <div className="generation-display">
      <div className="generation-header">
        <span className="generation-label">{getStatusMessage()}</span>
        <span className="generation-number">
          {counterLabel} {currentGeneration} / {maxValue}
        </span>
      </div>

      {/* Main progress bar (generations/evaluations) */}
      <div className="progress-bar-container">
        <div
          className="progress-bar"
          style={{ width: `${Math.min(100, progress)}%` }}
        />
      </div>

      {/* Batch progress bar (for 3D FEM population evaluation) */}
      {isRunning && batchProgress && batchProgress.total > 0 && (
        <div className="batch-progress">
          <div className="batch-progress-label">
            <span>Population: {batchProgress.completed}/{batchProgress.total}</span>
            {batchProgress.best_fitness_so_far != null && (
              <span className="batch-best">
                Best: {batchProgress.best_fitness_so_far.toFixed(2)}
              </span>
            )}
          </div>
          <div className="progress-bar-container progress-bar-secondary">
            <div
              className="progress-bar progress-bar-batch"
              style={{ width: `${getBatchProgressPercent()}%` }}
            />
          </div>
        </div>
      )}

      {/* FEM stage indicator (for 3D analysis) */}
      {isRunning && is3D && femProgress && (
        <div className="fem-progress">
          <div className="fem-stage">
            <span className="fem-stage-label">FEM Stage:</span>
            <span className={`fem-stage-name stage-${femProgress.stage}`}>
              {femProgress.stage.charAt(0).toUpperCase() + femProgress.stage.slice(1)}
            </span>
            {femProgress.percent > 0 && femProgress.percent < 100 && (
              <span className="fem-stage-percent">{femProgress.percent.toFixed(0)}%</span>
            )}
          </div>
        </div>
      )}

      <div className="fitness-display">
        <span className="fitness-label">Best Error (cents):</span>
        <span className="fitness-value">
          {bestFitness === Infinity ? '--' : bestFitness.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
