import { useOptimizationStore } from '../../stores/optimizationStore';

function getErrorColor(cents: number): string {
  const absCents = Math.abs(cents);
  if (absCents < 1) return '#22c55e'; // green - excellent
  if (absCents < 5) return '#84cc16'; // lime - good
  if (absCents < 10) return '#eab308'; // yellow - acceptable
  if (absCents < 20) return '#f97316'; // orange - poor
  return '#ef4444'; // red - bad
}

function getErrorLabel(cents: number): string {
  const absCents = Math.abs(cents);
  if (absCents < 1) return 'Excellent';
  if (absCents < 5) return 'Good';
  if (absCents < 10) return 'Acceptable';
  if (absCents < 20) return 'Poor';
  return 'Bad';
}

export function ErrorDisplay() {
  const { errorsCents, computedFrequencies, result, presetTargetModes } = useOptimizationStore();

  const errors = result?.errors_cents || errorsCents;
  const frequencies = result?.computed_frequencies || computedFrequencies;

  if (errors.length === 0) {
    return (
      <div className="error-display empty">
        <p>No error data yet</p>
      </div>
    );
  }

  return (
    <div className="error-display">
      <h4>Tuning Errors</h4>
      <table className="error-table">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Frequency</th>
            <th>Error</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((error, i) => (
            <tr key={i}>
              <td>{presetTargetModes && presetTargetModes[i] ? presetTargetModes[i] : `f${i + 1}`}</td>
              <td>{frequencies[i]?.toFixed(2) || '--'} Hz</td>
              <td style={{ color: getErrorColor(error) }}>
                {error >= 0 ? '+' : ''}{error.toFixed(2)} cents
              </td>
              <td style={{ color: getErrorColor(error) }}>
                {getErrorLabel(error)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {result && (
        <div className="total-error">
          <strong>Total Error:</strong>{' '}
          <span style={{ color: getErrorColor(result.tuning_error) }}>
            {result.tuning_error.toFixed(4)} cents
          </span>
        </div>
      )}
    </div>
  );
}
