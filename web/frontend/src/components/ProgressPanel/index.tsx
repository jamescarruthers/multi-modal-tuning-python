import { GenerationDisplay } from './GenerationDisplay';
import { ConvergenceChart } from './ConvergenceChart';
import { FrequencyChart } from './FrequencyChart';
import { ErrorDisplay } from './ErrorDisplay';

export function ProgressPanel() {
  return (
    <div className="progress-panel">
      <h3>Progress</h3>
      <GenerationDisplay />
      <ConvergenceChart />
      <FrequencyChart />
      <ErrorDisplay />
    </div>
  );
}
