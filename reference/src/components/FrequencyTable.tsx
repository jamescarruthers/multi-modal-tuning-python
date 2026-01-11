interface FrequencyTableProps {
  targetFrequencies: number[];
  computedFrequencies: number[];
  errorsInCents: number[];
}

export function FrequencyTable({
  targetFrequencies,
  computedFrequencies,
  errorsInCents
}: FrequencyTableProps) {
  const formatFreq = (freq: number): string => {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(2)} kHz`;
    }
    return `${freq.toFixed(1)} Hz`;
  };

  const formatCents = (cents: number): string => {
    const sign = cents >= 0 ? '+' : '';
    return `${sign}${cents.toFixed(1)}`;
  };

  const getErrorClass = (cents: number): string => {
    const absCents = Math.abs(cents);
    if (absCents <= 5) return 'error-excellent';
    if (absCents <= 15) return 'error-good';
    if (absCents <= 50) return 'error-ok';
    return 'error-bad';
  };

  return (
    <div className="panel">
      <h3 className="panel-title">Frequencies</h3>
      <table className="frequency-table">
        <thead>
          <tr>
            <th>Mode</th>
            <th>Target</th>
            <th>Computed</th>
            <th>Error (cents)</th>
          </tr>
        </thead>
        <tbody>
          {targetFrequencies.map((target, i) => (
            <tr key={i}>
              <td>f{i + 1}</td>
              <td>{formatFreq(target)}</td>
              <td>{computedFrequencies[i] ? formatFreq(computedFrequencies[i]) : '—'}</td>
              <td className={errorsInCents[i] !== undefined ? getErrorClass(errorsInCents[i]) : ''}>
                {errorsInCents[i] !== undefined ? formatCents(errorsInCents[i]) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
