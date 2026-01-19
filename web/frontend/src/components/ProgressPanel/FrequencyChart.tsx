import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { useOptimizationStore } from '../../stores/optimizationStore';

export function FrequencyChart() {
  const { computedFrequencies, result, presetRatios, presetTargetModes, fundamentalHz } = useOptimizationStore();

  const frequencies = result?.computed_frequencies || computedFrequencies;
  // Use result targets if available, otherwise calculate from fundamentalHz and preset ratios
  const targets = result?.target_frequencies || presetRatios.map((r) => r * fundamentalHz);

  // Debug logging
  console.log('[FrequencyChart] presetRatios:', presetRatios);
  console.log('[FrequencyChart] presetTargetModes:', presetTargetModes);
  console.log('[FrequencyChart] frequencies:', frequencies);
  console.log('[FrequencyChart] targets:', targets);

  if (frequencies.length === 0) {
    return (
      <div className="frequency-chart empty">
        <p>No frequency data yet</p>
      </div>
    );
  }

  // Build chart data - use mode names if available (V1, V2, T1, etc.), otherwise f1, f2, etc.
  const data = frequencies.map((freq, i) => ({
    name: presetTargetModes && presetTargetModes[i] ? presetTargetModes[i] : `f${i + 1}`,
    target: targets[i] || 0,
    computed: freq,
  }));

  return (
    <div className="frequency-chart">
      <h4>Frequencies</h4>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip
            formatter={(value: number) => `${value.toFixed(2)} Hz`}
            labelStyle={{ color: '#333' }}
          />
          <Legend />
          <Bar dataKey="target" fill="#8884d8" name="Target" />
          <Bar dataKey="computed" fill="#82ca9d" name="Computed" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
