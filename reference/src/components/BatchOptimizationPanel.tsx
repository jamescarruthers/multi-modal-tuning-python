/**
 * Batch Optimization Panel Component
 *
 * Manages batch optimization of multiple bars with a queue system.
 * Runs optimizations sequentially using the existing optimization worker.
 * Uses shared optimization settings from parent - no local config UI.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  BarLengthResult,
  BatchOptimizationItem,
  OptimizationParams,
  WorkerMessage,
  WorkerResponse,
  ProgressUpdate,
  Material,
  Individual,
  Cut
} from '../types';
import { TUNING_PRESETS, calculateTargetFrequencies } from '../data/tuningPresets';
import { genesToCuts } from '../physics/barProfile';
import { BarProfileSVG } from './BarProfileSVG';
import { FrequencyTable } from './FrequencyTable';
import { ResultsSummary } from './ResultsSummary';
import { OptimizationSettings } from './SharedSettingsPanel';

// Live progress state for currently running bar
interface LiveProgress {
  barIndex: number;
  generation: number;
  bestFitness: number;
  bestIndividual: Individual | null;
  computedFrequencies: number[];
  errorsInCents: number[];
  lengthTrim: number;
  cuts: Cut[];
}

// Import worker
import OptimizationWorker from '../workers/optimizationWorker?worker';

interface BatchOptimizationPanelProps {
  selectedBars: BarLengthResult[];
  barWidth: number;
  barThickness: number;
  material: Material;
  optimizationSettings: OptimizationSettings;
  onClose: () => void;
  onComplete: (results: BatchOptimizationItem[]) => void;
  onLoadBar?: (item: BatchOptimizationItem) => void;
}

export function BatchOptimizationPanel({
  selectedBars,
  barWidth,
  barThickness,
  material,
  optimizationSettings,
  onClose,
  onComplete,
  onLoadBar
}: BatchOptimizationPanelProps) {
  // View state
  const [selectedResultIndex, setSelectedResultIndex] = useState<number | null>(null);

  // Batch state
  const [isRunning, setIsRunning] = useState(false);
  const [queue, setQueue] = useState<BatchOptimizationItem[]>(() =>
    selectedBars.map(bar => ({
      barResult: bar,
      status: 'pending' as const
    }))
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [shouldStop, setShouldStop] = useState(false);

  // Live progress for currently running bar
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null);

  // Worker ref
  const workerRef = useRef<Worker | null>(null);

  // Get target frequencies for a bar
  const getTargetFrequencies = useCallback((fundamentalFreq: number): number[] => {
    const preset = TUNING_PRESETS.find(p => p.name === optimizationSettings.tuningPreset);
    if (preset) {
      return calculateTargetFrequencies(preset.ratios, fundamentalFreq);
    }
    return [fundamentalFreq];
  }, [optimizationSettings.tuningPreset]);

  // Run optimization for a single bar
  const runSingleOptimization = useCallback((item: BatchOptimizationItem, index: number) => {
    const worker = new OptimizationWorker();
    workerRef.current = worker;

    // Update status to running
    setQueue(prev => prev.map((q, i) =>
      i === index ? { ...q, status: 'running' as const, currentGeneration: 0, maxGenerations: optimizationSettings.maxGenerations } : q
    ));

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      switch (response.type) {
        case 'PROGRESS':
          const progress = response.data as ProgressUpdate;
          setQueue(prev => prev.map((q, i) =>
            i === index ? { ...q, currentGeneration: progress.generation } : q
          ));
          // Update live progress with all details
          setLiveProgress({
            barIndex: index,
            generation: progress.generation,
            bestFitness: progress.bestFitness,
            bestIndividual: progress.bestIndividual,
            computedFrequencies: progress.computedFrequencies || [],
            errorsInCents: progress.errorsInCents || [],
            lengthTrim: progress.lengthTrim || 0,
            cuts: progress.bestIndividual ? genesToCuts(progress.bestIndividual.genes) : []
          });
          break;

        case 'COMPLETE':
          setQueue(prev => prev.map((q, i) =>
            i === index ? {
              ...q,
              status: 'complete' as const,
              optimizationResult: response.result
            } : q
          ));
          setLiveProgress(null);
          worker.terminate();
          workerRef.current = null;
          setCurrentIndex(prev => prev + 1);
          break;

        case 'ERROR':
          setQueue(prev => prev.map((q, i) =>
            i === index ? {
              ...q,
              status: 'error' as const,
              error: response.message
            } : q
          ));
          setLiveProgress(null);
          worker.terminate();
          workerRef.current = null;
          setCurrentIndex(prev => prev + 1);
          break;

        case 'STOPPED':
          setQueue(prev => prev.map((q, i) =>
            i === index ? { ...q, status: 'skipped' as const } : q
          ));
          setLiveProgress(null);
          worker.terminate();
          workerRef.current = null;
          break;
      }
    };

    // Build optimization params
    const targetFreqs = getTargetFrequencies(item.barResult.targetFrequency);

    const params: OptimizationParams = {
      bar: {
        L: item.barResult.optimalLength / 1000,
        b: barWidth / 1000,
        h0: barThickness / 1000,
        hMin: barThickness / 10000
      },
      material,
      targetFrequencies: targetFreqs,
      numCuts: optimizationSettings.numCuts,
      penaltyType: optimizationSettings.penaltyType,
      penaltyWeight: optimizationSettings.penaltyWeight,
      eaParams: {
        populationSize: optimizationSettings.populationSize,
        elitismPercent: 10,
        crossoverPercent: 30,
        mutationPercent: 60,
        mutationStrength: 0.1,
        maxGenerations: optimizationSettings.maxGenerations,
        targetError: optimizationSettings.targetError,
        numElements: optimizationSettings.numElements,
        f1Priority: optimizationSettings.f1Priority,
        minCutWidth: optimizationSettings.minCutWidth / 1000,
        maxCutWidth: optimizationSettings.maxCutWidth / 1000,
        minCutDepth: optimizationSettings.minCutDepth / 1000,
        maxCutDepth: optimizationSettings.maxCutDepth / 1000,
        maxLengthTrim: optimizationSettings.maxLengthTrim / 1000,
        maxLengthExtend: optimizationSettings.maxLengthExtend / 1000,
        maxCores: optimizationSettings.maxCores
      }
    };

    const message: WorkerMessage = { type: 'START', params };
    worker.postMessage(message);
  }, [
    barWidth, barThickness, material, optimizationSettings, getTargetFrequencies
  ]);

  // Effect to process queue
  useEffect(() => {
    if (!isRunning || shouldStop) return;

    if (currentIndex >= queue.length) {
      setIsRunning(false);
      return;
    }

    const currentItem = queue[currentIndex];
    if (currentItem.status === 'pending') {
      runSingleOptimization(currentItem, currentIndex);
    }
  }, [isRunning, currentIndex, queue, shouldStop, runSingleOptimization]);

  // Start batch optimization
  const handleStart = () => {
    setIsRunning(true);
    setShouldStop(false);
    setCurrentIndex(0);
    setSelectedResultIndex(null);
    setQueue(selectedBars.map(bar => ({
      barResult: bar,
      status: 'pending' as const
    })));
  };

  // Stop batch optimization
  const handleStop = () => {
    setShouldStop(true);
    if (workerRef.current) {
      const message: WorkerMessage = { type: 'STOP' };
      workerRef.current.postMessage(message);
    }
    setQueue(prev => prev.map((q, i) =>
      i >= currentIndex && q.status === 'pending' ? { ...q, status: 'skipped' as const } : q
    ));
    setIsRunning(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Calculate progress
  const completedCount = queue.filter(q => q.status === 'complete').length;
  const errorCount = queue.filter(q => q.status === 'error').length;
  const hasStarted = queue.some(q => q.status !== 'pending');

  // Get status class
  const getStatusClass = (status: BatchOptimizationItem['status']) => {
    switch (status) {
      case 'complete': return 'status-complete';
      case 'error': return 'status-error';
      case 'running': return 'status-running';
      case 'skipped': return 'status-skipped';
      default: return 'status-pending';
    }
  };

  // Get status text
  const getStatusText = (item: BatchOptimizationItem) => {
    switch (item.status) {
      case 'complete':
        if (item.optimizationResult) {
          const maxErr = item.optimizationResult.maxErrorCents;
          return `Done (max ${Math.abs(maxErr).toFixed(1)}¢)`;
        }
        return 'Complete';
      case 'error':
        return `Error: ${item.error || 'Unknown'}`;
      case 'running':
        return `Gen ${item.currentGeneration || 0}/${item.maxGenerations || optimizationSettings.maxGenerations}`;
      case 'skipped':
        return 'Skipped';
      default:
        return 'Pending';
    }
  };

  // Get selected result for viewing
  const selectedResult = selectedResultIndex !== null ? queue[selectedResultIndex] : null;

  return (
    <div className="panel batch-optimization-panel">
      <div className="batch-header">
        <h3>Batch Optimization - {selectedBars.length} Bars</h3>
        <button type="button" className="btn btn-sm" onClick={onClose} disabled={isRunning}>
          ✕
        </button>
      </div>

      <div className="batch-content">
        {/* Queue List */}
        <div className="batch-queue-panel">
          <div className="batch-queue-header">
            <span className="batch-queue-title">
              {isRunning ? 'Optimizing...' : hasStarted ? 'Results' : 'Ready'}
            </span>
            <span className="batch-queue-progress">
              {completedCount}/{queue.length} complete
              {errorCount > 0 && `, ${errorCount} errors`}
            </span>
          </div>

          <div className="batch-queue-list">
            {queue.map((item, index) => (
              <div
                key={item.barResult.note.midiNumber}
                className={`batch-queue-item ${getStatusClass(item.status)} ${selectedResultIndex === index ? 'selected' : ''}`}
                onClick={() => item.status === 'complete' && setSelectedResultIndex(index)}
                style={{ cursor: item.status === 'complete' ? 'pointer' : 'default' }}
              >
                <div className="batch-item-note">{item.barResult.note.name}</div>
                <div className="batch-item-length">{item.barResult.optimalLength.toFixed(1)} mm</div>
                <div className="batch-item-status">{getStatusText(item)}</div>
                {item.status === 'running' && (
                  <div className="batch-item-progress">
                    <div
                      className="batch-item-progress-bar"
                      style={{ width: `${((item.currentGeneration || 0) / (item.maxGenerations || optimizationSettings.maxGenerations)) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="batch-actions-bar">
            {!hasStarted ? (
              <button type="button" className="btn btn-primary" onClick={handleStart}>
                Start Optimization
              </button>
            ) : isRunning ? (
              <button type="button" className="btn btn-danger" onClick={handleStop}>
                Stop
              </button>
            ) : (
              <>
                <button type="button" className="btn" onClick={handleStart}>
                  Restart
                </button>
                <button type="button" className="btn btn-primary" onClick={() => onComplete(queue)}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>

        {/* Result Viewer */}
        <div className="batch-result-viewer">
          {/* Show live progress during optimization */}
          {isRunning && liveProgress && liveProgress.bestIndividual ? (
            <>
              <h4 className="result-viewer-title live-progress-title">
                <span className="live-indicator"></span>
                {queue[liveProgress.barIndex]?.barResult.note.name} - Generation {liveProgress.generation}/{optimizationSettings.maxGenerations}
              </h4>

              <BarProfileSVG
                length={queue[liveProgress.barIndex]?.barResult.optimalLength || 0}
                thickness={barThickness}
                cuts={liveProgress.cuts}
                showDimensions={true}
                effectiveLength={(queue[liveProgress.barIndex]?.barResult.optimalLength || 0) - liveProgress.lengthTrim * 1000}
              />

              {liveProgress.computedFrequencies.length > 0 && (
                <FrequencyTable
                  targetFrequencies={getTargetFrequencies(queue[liveProgress.barIndex]?.barResult.targetFrequency || 0)}
                  computedFrequencies={liveProgress.computedFrequencies}
                  errorsInCents={liveProgress.errorsInCents}
                />
              )}

              <div className="live-progress-stats">
                <div className="live-stat">
                  <span className="live-stat-label">Best Fitness</span>
                  <span className="live-stat-value">{liveProgress.bestFitness.toFixed(6)}</span>
                </div>
                {liveProgress.errorsInCents.length > 0 && (
                  <div className="live-stat">
                    <span className="live-stat-label">Max Error</span>
                    <span className="live-stat-value">
                      {Math.max(...liveProgress.errorsInCents.map(Math.abs)).toFixed(1)} cents
                    </span>
                  </div>
                )}
                {liveProgress.lengthTrim !== 0 && (
                  <div className="live-stat">
                    <span className="live-stat-label">Length Trim</span>
                    <span className="live-stat-value">{(liveProgress.lengthTrim * 1000).toFixed(2)} mm</span>
                  </div>
                )}
              </div>
            </>
          ) : selectedResult && selectedResult.optimizationResult ? (
            <>
              <div className="result-viewer-header">
                <h4 className="result-viewer-title">
                  {selectedResult.barResult.note.name} - {selectedResult.barResult.optimalLength.toFixed(1)} mm
                </h4>
                {onLoadBar && (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => onLoadBar(selectedResult)}
                    title="Open this bar in Single Bar Optimizer for further refinement"
                  >
                    Open in Single Bar
                  </button>
                )}
              </div>

              <BarProfileSVG
                length={selectedResult.barResult.optimalLength}
                thickness={barThickness}
                cuts={selectedResult.optimizationResult.cuts}
                showDimensions={true}
                effectiveLength={selectedResult.optimizationResult.effectiveLength * 1000}
              />

              <FrequencyTable
                targetFrequencies={selectedResult.optimizationResult.targetFrequencies}
                computedFrequencies={selectedResult.optimizationResult.computedFrequencies}
                errorsInCents={selectedResult.optimizationResult.errorsInCents}
              />

              <ResultsSummary
                tuningError={selectedResult.optimizationResult.tuningError}
                maxErrorCents={selectedResult.optimizationResult.maxErrorCents}
                volumePercent={selectedResult.optimizationResult.volumePercent}
                generations={selectedResult.optimizationResult.generations}
                cuts={selectedResult.optimizationResult.cuts}
                lengthTrim={selectedResult.optimizationResult.lengthTrim}
                effectiveLength={selectedResult.optimizationResult.effectiveLength}
                genes={selectedResult.optimizationResult.bestIndividual.genes}
              />
            </>
          ) : (
            <div className="result-viewer-empty">
              <p>
                {isRunning
                  ? 'Starting optimization...'
                  : hasStarted
                    ? 'Click on a completed bar to view its results'
                    : 'Click "Start Optimization" to begin'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
