/**
 * Batch Queue Panel Component
 *
 * Displays a queue of bars to optimize, with controls to run batch optimization.
 * Shows in the Single Bar Optimizer when bars are transferred from Range Finder.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { BatchOptimizationItem, WorkerMessage, WorkerResponse, ProgressUpdate, OptimizationParams, BatchProgressData } from '../types';
import { Material } from '../types';
import { OptimizationSettings } from './SharedSettingsPanel';
import { TUNING_PRESETS, calculateTargetFrequencies } from '../data/tuningPresets';

// Import worker
import OptimizationWorker from '../workers/optimizationWorker?worker';

interface BatchQueuePanelProps {
  batchItems: BatchOptimizationItem[];
  barWidth: number;
  barThickness: number;
  material: Material;
  optimizationSettings: OptimizationSettings;
  selectedItemIndex: number | null;
  onSelectItem: (index: number | null) => void;
  onBatchUpdate: (items: BatchOptimizationItem[]) => void;
  onClearBatch: () => void;
  isRunning: boolean;
  onRunningChange: (running: boolean) => void;
  onProgressUpdate?: (progress: BatchProgressData | null) => void;  // Live progress callback
}

export function BatchQueuePanel({
  batchItems,
  barWidth,
  barThickness,
  material,
  optimizationSettings,
  selectedItemIndex,
  onSelectItem,
  onBatchUpdate,
  onClearBatch,
  isRunning,
  onRunningChange,
  onProgressUpdate
}: BatchQueuePanelProps) {
  // Current batch index being optimized
  const [currentBatchIndex, setCurrentBatchIndex] = useState<number | null>(null);
  const [currentGeneration, setCurrentGeneration] = useState(0);

  // Worker ref
  const workerRef = useRef<Worker | null>(null);
  const stopRequestedRef = useRef(false);

  // Get target frequencies for tuning preset
  const getTargetFrequencies = useCallback((fundamentalHz: number): number[] => {
    const preset = TUNING_PRESETS.find(p => p.name === optimizationSettings.tuningPreset);
    if (preset) {
      return calculateTargetFrequencies(preset.ratios, fundamentalHz);
    }
    return [fundamentalHz];
  }, [optimizationSettings.tuningPreset]);

  // Start optimizing a single bar
  const optimizeBar = useCallback((index: number, items: BatchOptimizationItem[]) => {
    if (stopRequestedRef.current || index >= items.length) {
      onRunningChange(false);
      setCurrentBatchIndex(null);
      return;
    }

    const item = items[index];
    const barLength = item.barResult.optimalLength;
    const fundamentalHz = item.barResult.targetFrequency;
    const targetFreqs = getTargetFrequencies(fundamentalHz);

    // Update status to running
    const updatedItems = items.map((it, i) =>
      i === index ? { ...it, status: 'running' as const, currentGeneration: 0, maxGenerations: optimizationSettings.maxGenerations } : it
    );
    onBatchUpdate(updatedItems);
    setCurrentBatchIndex(index);
    setCurrentGeneration(0);

    // Create worker
    const worker = new OptimizationWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      switch (response.type) {
        case 'PROGRESS':
          const progress = response.data as ProgressUpdate;
          setCurrentGeneration(progress.generation);

          // Build progress data for live feedback
          const progressData: BatchProgressData | undefined =
            progress.computedFrequencies && progress.errorsInCents ? {
              generation: progress.generation,
              bestFitness: progress.bestFitness,
              computedFrequencies: progress.computedFrequencies,
              errorsInCents: progress.errorsInCents,
              lengthTrim: progress.lengthTrim,
              genes: [...progress.bestIndividual.genes]
            } : undefined;

          // Update item with current progress
          const progressItems = items.map((it, i) =>
            i === index ? {
              ...it,
              currentGeneration: progress.generation,
              currentProgress: progressData
            } : it
          );
          onBatchUpdate(progressItems);

          // Notify parent of progress for generation log
          if (progressData && onProgressUpdate) {
            onProgressUpdate(progressData);
          }
          break;

        case 'COMPLETE':
          // Clear progress for completed item
          if (onProgressUpdate) {
            onProgressUpdate(null);
          }
          // Mark as complete and move to next
          const completeItems = items.map((it, i) =>
            i === index ? { ...it, status: 'complete' as const, optimizationResult: response.result, currentProgress: undefined } : it
          );
          onBatchUpdate(completeItems);
          worker.terminate();
          workerRef.current = null;

          // Process next bar
          setTimeout(() => optimizeBar(index + 1, completeItems), 100);
          break;

        case 'ERROR':
          if (onProgressUpdate) {
            onProgressUpdate(null);
          }
          const errorItems = items.map((it, i) =>
            i === index ? { ...it, status: 'error' as const, error: response.message, currentProgress: undefined } : it
          );
          onBatchUpdate(errorItems);
          worker.terminate();
          workerRef.current = null;

          // Continue with next bar despite error
          setTimeout(() => optimizeBar(index + 1, errorItems), 100);
          break;

        case 'STOPPED':
          if (onProgressUpdate) {
            onProgressUpdate(null);
          }
          const stoppedItems = items.map((it, i) =>
            i === index ? { ...it, status: 'pending' as const, currentProgress: undefined } : it
          );
          onBatchUpdate(stoppedItems);
          worker.terminate();
          workerRef.current = null;
          onRunningChange(false);
          setCurrentBatchIndex(null);
          break;
      }
    };

    // Build optimization params
    const params: OptimizationParams = {
      bar: {
        L: barLength / 1000,
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
  }, [barWidth, barThickness, material, optimizationSettings, getTargetFrequencies, onBatchUpdate, onRunningChange]);

  // Start batch optimization
  const handleStartBatch = useCallback(() => {
    if (batchItems.length === 0) return;

    stopRequestedRef.current = false;
    onRunningChange(true);

    // Reset all items to pending
    const resetItems = batchItems.map(item => ({
      ...item,
      status: 'pending' as const,
      optimizationResult: undefined,
      error: undefined,
      currentGeneration: undefined
    }));
    onBatchUpdate(resetItems);

    // Start with first item
    optimizeBar(0, resetItems);
  }, [batchItems, onBatchUpdate, onRunningChange, optimizeBar]);

  // Stop batch optimization
  const handleStopBatch = useCallback(() => {
    stopRequestedRef.current = true;
    if (workerRef.current) {
      const message: WorkerMessage = { type: 'STOP' };
      workerRef.current.postMessage(message);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Count stats
  const completedCount = batchItems.filter(item => item.status === 'complete').length;
  const errorCount = batchItems.filter(item => item.status === 'error').length;
  const pendingCount = batchItems.filter(item => item.status === 'pending').length;

  // Get status icon
  const getStatusIcon = (status: BatchOptimizationItem['status']) => {
    switch (status) {
      case 'complete': return '✓';
      case 'running': return '⟳';
      case 'error': return '✗';
      case 'pending': return '○';
      case 'skipped': return '–';
    }
  };

  // Get status class
  const getStatusClass = (status: BatchOptimizationItem['status']) => {
    switch (status) {
      case 'complete': return 'status-complete';
      case 'running': return 'status-running';
      case 'error': return 'status-error';
      case 'pending': return 'status-pending';
      case 'skipped': return 'status-skipped';
    }
  };

  if (batchItems.length === 0) {
    return null;
  }

  return (
    <div className="panel batch-queue-panel">
      <div className="batch-queue-header">
        <h3 className="panel-title">Batch Queue</h3>
        <button
          className="btn btn-sm btn-ghost"
          onClick={onClearBatch}
          disabled={isRunning}
          title="Clear batch queue"
        >
          Clear
        </button>
      </div>

      {/* Queue list */}
      <div className="batch-queue-list">
        {batchItems.map((item, index) => {
          const progressPercent = item.status === 'running' && item.currentGeneration !== undefined && item.maxGenerations
            ? (item.currentGeneration / item.maxGenerations) * 100
            : 0;

          return (
            <div
              key={item.barResult.note.midiNumber}
              className={`batch-queue-item ${selectedItemIndex === index ? 'selected' : ''} ${getStatusClass(item.status)}`}
              onClick={() => onSelectItem(selectedItemIndex === index ? null : index)}
            >
              <span className={`batch-item-status ${getStatusClass(item.status)}`}>
                {getStatusIcon(item.status)}
              </span>
              <span className="batch-item-note">{item.barResult.note.name}</span>
              <span className="batch-item-length">{item.barResult.optimalLength.toFixed(1)} mm</span>
              {item.status === 'running' && item.currentGeneration !== undefined && (
                <span className="batch-item-progress">
                  Gen {item.currentGeneration}/{item.maxGenerations || optimizationSettings.maxGenerations}
                  {item.currentProgress && (
                    <span className="batch-item-live-error">
                      {' '}({Math.max(...item.currentProgress.errorsInCents.map(Math.abs)).toFixed(0)}¢)
                    </span>
                  )}
                </span>
              )}
              {item.status === 'complete' && item.optimizationResult && (
                <span className="batch-item-error">
                  {item.optimizationResult.tuningError.toFixed(2)}%
                </span>
              )}
              {/* Progress bar for running item */}
              {item.status === 'running' && (
                <div className="batch-item-progress-track">
                  <div
                    className="batch-item-progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary stats */}
      <div className="batch-queue-stats">
        <span className="batch-stat">
          <span className="stat-value">{completedCount}</span>
          <span className="stat-label">done</span>
        </span>
        {errorCount > 0 && (
          <span className="batch-stat error">
            <span className="stat-value">{errorCount}</span>
            <span className="stat-label">error</span>
          </span>
        )}
        <span className="batch-stat">
          <span className="stat-value">{pendingCount}</span>
          <span className="stat-label">pending</span>
        </span>
      </div>

      {/* Controls */}
      <div className="batch-queue-controls">
        {isRunning ? (
          <button
            className="btn btn-danger btn-block"
            onClick={handleStopBatch}
          >
            Stop Batch
            {currentBatchIndex !== null && (
              <span className="btn-info">
                ({currentBatchIndex + 1}/{batchItems.length})
              </span>
            )}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-block"
            onClick={handleStartBatch}
            disabled={batchItems.length === 0}
          >
            {completedCount > 0 ? 'Re-run Batch' : 'Start Batch Optimization'}
          </button>
        )}
      </div>
    </div>
  );
}
