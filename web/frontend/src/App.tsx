import { ConfigPanel } from './components/ConfigPanel';
import { ProgressPanel } from './components/ProgressPanel';
import { Scene } from './components/Viewer3D';
import { ResultsSummary } from './components/Results/ResultsSummary';
import { useOptimizationStore } from './stores/optimizationStore';
import './App.css';

function App() {
  const { result } = useOptimizationStore();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Multi-Modal Bar Tuning</h1>
        <span className="subtitle">Optimization Interface</span>
      </header>

      <main className="app-main">
        <aside className="left-panel">
          <ConfigPanel />
        </aside>

        <section className="center-panel">
          <Scene />
        </section>

        <aside className="right-panel">
          <ProgressPanel />
          {result && <ResultsSummary />}
        </aside>
      </main>
    </div>
  );
}

export default App;
