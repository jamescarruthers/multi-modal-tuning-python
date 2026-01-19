import { usePlayback } from '../../hooks/usePlayback';
import { useOptimizationStore } from '../../stores/optimizationStore';

export function PlaybackControls() {
  const { isRunning, algorithm } = useOptimizationStore();
  const {
    play,
    pause,
    toggle,
    goToStart,
    goToEnd,
    goTo,
    isPlaying,
    canPlay,
    totalGenerations,
    currentIndex,
  } = usePlayback({ speed: 2, interval: 150 });

  if (totalGenerations === 0) {
    return null;
  }

  // Use "Step" as a generic term that works for both algorithms
  const stepLabel = algorithm === 'evolutionary' ? 'Gen' : 'Eval';

  return (
    <div className="playback-controls">
      <div className="playback-buttons">
        <button
          type="button"
          onClick={goToStart}
          disabled={isRunning || currentIndex <= 0}
          title="Go to start"
        >
          |&lt;
        </button>

        <button
          type="button"
          onClick={toggle}
          disabled={isRunning || !canPlay}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '||' : '>'}
        </button>

        <button
          type="button"
          onClick={goToEnd}
          disabled={isRunning || currentIndex >= totalGenerations - 1}
          title="Go to end"
        >
          &gt;|
        </button>
      </div>

      <div className="playback-slider">
        <input
          type="range"
          min={0}
          max={totalGenerations - 1}
          value={currentIndex >= 0 ? currentIndex : 0}
          onChange={(e) => goTo(parseInt(e.target.value))}
          disabled={isRunning}
        />
        <span className="generation-label">
          {stepLabel} {currentIndex >= 0 ? currentIndex + 1 : 0} / {totalGenerations}
        </span>
      </div>
    </div>
  );
}
