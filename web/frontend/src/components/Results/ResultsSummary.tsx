import { useOptimizationStore } from '../../stores/optimizationStore';

export function ResultsSummary() {
  const { result, barDimensions, numCuts } = useOptimizationStore();

  if (!result) {
    return null;
  }

  // Convert to mm for display
  const toMm = (m: number) => (m * 1000).toFixed(2);

  return (
    <div className="results-summary">
      <h3>Optimization Results</h3>

      <div className="result-section">
        <h4>Cut Geometry</h4>
        <table className="result-table">
          <thead>
            <tr>
              <th>Cut</th>
              <th>Position (mm from center)</th>
              <th>Depth (mm)</th>
            </tr>
          </thead>
          <tbody>
            {result.cut_positions.map((pos, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{toMm(pos)}</td>
                <td>{toMm(barDimensions.h0 - result.cut_depths[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="result-section">
        <h4>Manufacturing Specifications</h4>
        <div className="spec-list">
          {result.length_adjustment !== undefined && result.length_adjustment !== 0 ? (
            <>
              <div className="spec-item">
                <span className="spec-label">Original Bar Length:</span>
                <span className="spec-value">{toMm(result.original_bar_length || barDimensions.L)} mm</span>
              </div>
              <div className="spec-item highlight">
                <span className="spec-label">Final Bar Length:</span>
                <span className="spec-value">{toMm(result.final_bar_length || barDimensions.L)} mm</span>
              </div>
              <div className="spec-item">
                <span className="spec-label">Length Adjustment:</span>
                <span className="spec-value">
                  {result.length_adjustment > 0 ? 'Trim' : 'Extend'} {toMm(Math.abs(result.length_adjustment))} mm from each end
                </span>
              </div>
            </>
          ) : (
            <div className="spec-item">
              <span className="spec-label">Bar Length:</span>
              <span className="spec-value">{toMm(barDimensions.L)} mm</span>
            </div>
          )}
          <div className="spec-item">
            <span className="spec-label">Bar Width:</span>
            <span className="spec-value">{toMm(barDimensions.b)} mm</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Bar Height:</span>
            <span className="spec-value">{toMm(barDimensions.h0)} mm</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Number of Cuts:</span>
            <span className="spec-value">{numCuts}</span>
          </div>
        </div>
      </div>

      <div className="result-section">
        <h4>Optimization Summary</h4>
        <div className="spec-list">
          <div className="spec-item">
            <span className="spec-label">Generations Run:</span>
            <span className="spec-value">{result.generations_run}</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Final Error:</span>
            <span className="spec-value">{result.tuning_error.toFixed(4)} cents</span>
          </div>
        </div>
      </div>

      <div className="result-actions">
        <button
          type="button"
          onClick={() => {
            // Export results as JSON
            const dataStr = JSON.stringify(result, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'optimization-result.json';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export JSON
        </button>
      </div>
    </div>
  );
}
