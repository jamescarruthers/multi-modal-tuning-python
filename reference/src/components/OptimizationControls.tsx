interface OptimizationControlsProps {
  isRunning: boolean;
  currentGeneration: number;
  maxGenerations: number;
  bestFitness: number;
  onStart: () => void;
  onStop: () => void;
}

export function OptimizationControls({
  isRunning,
  currentGeneration,
  maxGenerations,
  bestFitness,
  onStart,
  onStop
}: OptimizationControlsProps) {
  const progress = maxGenerations > 0 ? (currentGeneration / maxGenerations) * 100 : 0;

  return (
    <div className="panel">
      <h3 className="panel-title">Optimization Controls</h3>

      <div className="btn-group">
        <button
          className="btn btn-primary"
          onClick={onStart}
          disabled={isRunning}
          style={{ flex: 1 }}
        >
          {isRunning ? 'Running...' : '▶ Start Optimization'}
        </button>
        <button
          className="btn btn-danger"
          onClick={onStop}
          disabled={!isRunning}
        >
          ■ Stop
        </button>
      </div>

      {(isRunning || currentGeneration > 0) && (
        <div className="progress-container">
          <div className="progress-bar-wrapper">
            <div
              className="progress-bar"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="progress-stats">
            <span>Generation: {currentGeneration} / {maxGenerations}</span>
            <span>Best: {bestFitness < Infinity ? bestFitness.toFixed(4) : '—'}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
