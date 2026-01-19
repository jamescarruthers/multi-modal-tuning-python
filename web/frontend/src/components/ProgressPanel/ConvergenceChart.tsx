import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { useOptimizationStore } from '../../stores/optimizationStore';

export function ConvergenceChart() {
  const { generations, eaParams, surrogateParams, algorithm } = useOptimizationStore();

  const isEA = algorithm === 'evolutionary';
  const targetError = isEA ? eaParams.target_error : surrogateParams.target_error;

  if (generations.length === 0) {
    return (
      <div className="convergence-chart empty">
        <p>No convergence data yet</p>
      </div>
    );
  }

  // Build chart data from generations history
  const data = generations.map((gen) => ({
    generation: gen.generation,
    fitness: gen.best_fitness,
  }));

  // Calculate min/max for Y axis with some padding
  const fitnessValues = data.map((d) => d.fitness).filter((f) => f !== Infinity && f > 0);
  const minFitness = fitnessValues.length > 0 ? Math.min(...fitnessValues) : 0;
  const maxFitness = fitnessValues.length > 0 ? Math.max(...fitnessValues) : 100;

  // Use log scale if range is large
  const useLogScale = maxFitness / Math.max(minFitness, 0.001) > 100;

  // Determine Y domain
  const yMin = useLogScale ? Math.max(0.001, minFitness * 0.5) : 0;
  const yMax = maxFitness * 1.1;

  return (
    <div className="convergence-chart">
      <h4>Convergence</h4>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="generation"
            stroke="#888"
            fontSize={11}
            label={{ value: isEA ? 'Generation' : 'Evaluation', position: 'bottom', offset: -5, fill: '#888', fontSize: 10 }}
          />
          <YAxis
            stroke="#888"
            fontSize={11}
            scale={useLogScale ? 'log' : 'linear'}
            domain={[yMin, yMax]}
            tickFormatter={(value) => value < 1 ? value.toFixed(2) : value.toFixed(0)}
            label={{ value: 'Error (cents)', angle: -90, position: 'insideLeft', fill: '#888', fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #0f3460' }}
            labelStyle={{ color: '#888' }}
            formatter={(value: number) => [`${value.toFixed(4)} cents`, 'Error']}
            labelFormatter={(label) => `${isEA ? 'Gen' : 'Eval'} ${label}`}
          />
          {/* Target error reference line */}
          <ReferenceLine
            y={targetError}
            stroke="#4caf50"
            strokeDasharray="5 5"
            label={{ value: `Target: ${targetError}`, fill: '#4caf50', fontSize: 10, position: 'right' }}
          />
          <Line
            type="monotone"
            dataKey="fitness"
            stroke="#e94560"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
