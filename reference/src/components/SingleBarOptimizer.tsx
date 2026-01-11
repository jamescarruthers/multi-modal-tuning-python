/**
 * Single Bar Optimizer Component
 *
 * Main content area for single bar optimization mode.
 * Contains bar length input, frequency input, optimization controls,
 * and result visualization.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { BarProfileSVG } from './BarProfileSVG';
import { FrequencyTable } from './FrequencyTable';
import { ResultsSummary } from './ResultsSummary';
import { OptimizationControls } from './OptimizationControls';
import { GenerationLog, GenerationEntry } from './GenerationLog';
import { BatchQueuePanel } from './BatchQueuePanel';
import { OptimizationSettings } from './SharedSettingsPanel';
import { MATERIALS } from '../data/materials';
import { TUNING_PRESETS, calculateTargetFrequencies } from '../data/tuningPresets';
import {
  OptimizationParams,
  OptimizationResult,
  WorkerMessage,
  WorkerResponse,
  ProgressUpdate,
  Cut,
  Individual,
  BatchOptimizationItem,
  BatchProgressData
} from '../types';
import { genesToCuts } from '../physics/barProfile';
import { decodeGenes } from '../optimization/geneCodec';

// Import worker
import OptimizationWorker from '../workers/optimizationWorker?worker';

// Note utilities
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToFrequency(noteName: string): number | null {
  const match = noteName.match(/^([A-Ga-g])([#b]?)(\d)$/);
  if (!match) return null;

  const [, note, accidental, octaveStr] = match;
  const octave = parseInt(octaveStr);

  let noteIndex = NOTE_NAMES.indexOf(note.toUpperCase());
  if (noteIndex === -1) return null;

  if (accidental === '#') noteIndex += 1;
  if (accidental === 'b') noteIndex -= 1;

  if (noteIndex < 0) noteIndex += 12;
  if (noteIndex >= 12) noteIndex -= 12;

  const semitonesFromA4 = (octave - 4) * 12 + (noteIndex - 9);
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

function frequencyToNote(freq: number): string {
  const semitonesFromA4 = 12 * Math.log2(freq / 440);
  const midiNote = Math.round(69 + semitonesFromA4);
  const noteIndex = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function generateNoteList(): { note: string; freq: number }[] {
  const notes: { note: string; freq: number }[] = [];
  for (let octave = 2; octave <= 7; octave++) {
    for (let i = 0; i < NOTE_NAMES.length; i++) {
      const note = `${NOTE_NAMES[i]}${octave}`;
      const freq = noteToFrequency(note);
      if (freq && freq >= 20 && freq <= 4000) {
        notes.push({ note, freq: Math.round(freq * 10) / 10 });
      }
    }
  }
  return notes;
}

interface SingleBarOptimizerProps {
  barLength: number;
  barWidth: number;
  barThickness: number;
  onBarLengthChange: (length: number) => void;
  selectedMaterial: string;
  tuningPreset: string;
  onTuningPresetChange: (preset: string) => void;
  fundamentalFrequency: number;
  onFundamentalChange: (freq: number) => void;
  optimizationSettings: OptimizationSettings;
  seedGeneCode: string;
  isRunning: boolean;
  onRunningChange: (running: boolean) => void;
  // Batch optimization
  batchItems: BatchOptimizationItem[];
  onBatchItemsChange: (items: BatchOptimizationItem[]) => void;
}

export function SingleBarOptimizer({
  barLength,
  barWidth,
  barThickness,
  onBarLengthChange,
  selectedMaterial,
  tuningPreset,
  onTuningPresetChange,
  fundamentalFrequency,
  onFundamentalChange,
  optimizationSettings,
  seedGeneCode,
  isRunning,
  onRunningChange,
  batchItems,
  onBatchItemsChange
}: SingleBarOptimizerProps) {
  // Batch optimization state
  const [selectedBatchIndex, setSelectedBatchIndex] = useState<number | null>(null);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchGenerationLog, setBatchGenerationLog] = useState<GenerationEntry[]>([]);
  const [selectedBatchLogGeneration, setSelectedBatchLogGeneration] = useState<number | null>(null);

  // Note input state
  const [noteInput, setNoteInput] = useState('');
  const [showNoteSuggestions, setShowNoteSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const noteInputRef = useRef<HTMLInputElement>(null);

  // Optimization state
  const [currentGeneration, setCurrentGeneration] = useState(0);
  const [bestFitness, setBestFitness] = useState(Infinity);
  const [currentBestIndividual, setCurrentBestIndividual] = useState<Individual | null>(null);
  const [currentComputedFreqs, setCurrentComputedFreqs] = useState<number[]>([]);
  const [currentErrorsInCents, setCurrentErrorsInCents] = useState<number[]>([]);
  const [currentLengthTrim, setCurrentLengthTrim] = useState(0);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [generationLog, setGenerationLog] = useState<GenerationEntry[]>([]);
  const [selectedLogGeneration, setSelectedLogGeneration] = useState<number | null>(null);

  // Worker ref
  const workerRef = useRef<Worker | null>(null);

  // Note list for autocomplete
  const allNotes = useMemo(() => generateNoteList(), []);
  const filteredNotes = useMemo(() => {
    if (!noteInput) return allNotes.slice(0, 12);
    const search = noteInput.toUpperCase();
    return allNotes.filter(n =>
      n.note.toUpperCase().startsWith(search) ||
      n.note.toUpperCase().includes(search)
    ).slice(0, 12);
  }, [noteInput, allNotes]);

  // Update note input when frequency changes
  useEffect(() => {
    const nearestNote = frequencyToNote(fundamentalFrequency);
    const noteFreq = noteToFrequency(nearestNote);
    if (noteFreq && Math.abs(1200 * Math.log2(fundamentalFrequency / noteFreq)) < 5) {
      setNoteInput(nearestNote);
    }
  }, [fundamentalFrequency]);

  // Calculate target frequencies
  const getTargetFrequencies = useCallback((): number[] => {
    const preset = TUNING_PRESETS.find(p => p.name === tuningPreset);
    if (preset) {
      return calculateTargetFrequencies(preset.ratios, fundamentalFrequency);
    }
    return [fundamentalFrequency];
  }, [tuningPreset, fundamentalFrequency]);

  const targetFreqs = getTargetFrequencies();
  const material = MATERIALS[selectedMaterial];

  // Note selection handlers
  const handleNoteSelect = (note: string, freq: number) => {
    setNoteInput(note);
    onFundamentalChange(Math.round(freq * 10) / 10);
    setShowNoteSuggestions(false);
  };

  const handleNoteInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex(i => Math.min(i + 1, filteredNotes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filteredNotes.length > 0) {
      e.preventDefault();
      const selected = filteredNotes[selectedSuggestionIndex];
      handleNoteSelect(selected.note, selected.freq);
    } else if (e.key === 'Escape') {
      setShowNoteSuggestions(false);
    }
  };

  const handleNoteInputChange = (value: string) => {
    setNoteInput(value);
    setSelectedSuggestionIndex(0);
    setShowNoteSuggestions(true);

    const freq = noteToFrequency(value);
    if (freq && freq >= 20 && freq <= 4000) {
      onFundamentalChange(Math.round(freq * 10) / 10);
    }
  };

  // Start optimization
  const handleStart = useCallback(() => {
    const worker = new OptimizationWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      switch (response.type) {
        case 'PROGRESS':
          const progress = response.data as ProgressUpdate;
          setCurrentGeneration(progress.generation);
          setBestFitness(progress.bestFitness);
          setCurrentBestIndividual(progress.bestIndividual);
          if (progress.computedFrequencies) {
            setCurrentComputedFreqs(progress.computedFrequencies);
          }
          if (progress.errorsInCents) {
            setCurrentErrorsInCents(progress.errorsInCents);
          }
          if (progress.lengthTrim !== undefined) {
            setCurrentLengthTrim(progress.lengthTrim);
          }
          if (progress.computedFrequencies && progress.errorsInCents) {
            setGenerationLog(prev => [...prev, {
              generation: progress.generation,
              fitness: progress.bestFitness,
              errorsInCents: progress.errorsInCents!,
              computedFrequencies: progress.computedFrequencies!,
              genes: [...progress.bestIndividual.genes]
            }]);
          }
          break;

        case 'COMPLETE':
          setResult(response.result);
          onRunningChange(false);
          break;

        case 'ERROR':
          console.error('Optimization error:', response.message);
          onRunningChange(false);
          break;

        case 'STOPPED':
          onRunningChange(false);
          break;
      }
    };

    const seedGenes = seedGeneCode ? decodeGenes(seedGeneCode) : undefined;

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
      },
      seedGenes: seedGenes || undefined
    };

    const message: WorkerMessage = { type: 'START', params };
    worker.postMessage(message);

    onRunningChange(true);
    setCurrentGeneration(0);
    setBestFitness(Infinity);
    setCurrentBestIndividual(null);
    setCurrentComputedFreqs([]);
    setCurrentErrorsInCents([]);
    setCurrentLengthTrim(0);
    setResult(null);
    setGenerationLog([]);
    setSelectedLogGeneration(null);
  }, [
    barLength, barWidth, barThickness, material, targetFreqs,
    optimizationSettings, seedGeneCode, onRunningChange
  ]);

  // Stop optimization
  const handleStop = useCallback(() => {
    if (workerRef.current) {
      const message: WorkerMessage = { type: 'STOP' };
      workerRef.current.postMessage(message);
    }
  }, []);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Handle clearing batch queue
  const handleClearBatch = useCallback(() => {
    onBatchItemsChange([]);
    setSelectedBatchIndex(null);
    setIsBatchMode(false);
    setBatchGenerationLog([]);
    setSelectedBatchLogGeneration(null);
  }, [onBatchItemsChange]);

  // Handle batch progress updates for generation log
  const handleBatchProgressUpdate = useCallback((progress: BatchProgressData | null) => {
    if (progress === null) {
      // Optimization finished/stopped for current item - clear the log for next item
      setBatchGenerationLog([]);
      setSelectedBatchLogGeneration(null);
    } else {
      // Add entry to batch generation log
      setBatchGenerationLog(prev => [...prev, {
        generation: progress.generation,
        fitness: progress.bestFitness,
        errorsInCents: progress.errorsInCents,
        computedFrequencies: progress.computedFrequencies,
        genes: progress.genes
      }]);
    }
  }, []);

  // Handle adding current bar to batch queue
  const handleAddToBatch = useCallback(() => {
    // Create a new batch item from current bar settings
    const newItem: BatchOptimizationItem = {
      barResult: {
        note: {
          name: noteInput || frequencyToNote(fundamentalFrequency),
          frequency: fundamentalFrequency,
          midiNumber: Math.round(69 + 12 * Math.log2(fundamentalFrequency / 440))
        },
        targetFrequency: fundamentalFrequency,
        optimalLength: barLength,
        computedFrequency: fundamentalFrequency, // Will be updated during optimization
        errorCents: 0,
        searchIterations: 0,
        selected: true
      },
      status: 'pending'
    };

    // Add to batch, avoiding duplicates (by note name and length)
    const isDuplicate = batchItems.some(
      item => item.barResult.note.name === newItem.barResult.note.name &&
              Math.abs(item.barResult.optimalLength - newItem.barResult.optimalLength) < 0.1
    );

    if (!isDuplicate) {
      onBatchItemsChange([...batchItems, newItem]);
    }
  }, [noteInput, fundamentalFrequency, barLength, batchItems, onBatchItemsChange]);

  // Handle batch item selection - load its data for display
  const handleSelectBatchItem = useCallback((index: number | null) => {
    setSelectedBatchIndex(index);
    if (index !== null && batchItems[index]) {
      const item = batchItems[index];
      // Update bar length and frequency to match selected batch item
      onBarLengthChange(item.barResult.optimalLength);
      onFundamentalChange(item.barResult.targetFrequency);
      // If this item has been optimized, show its result
      if (item.optimizationResult) {
        setResult(item.optimizationResult);
      } else {
        setResult(null);
      }
      setGenerationLog([]);
      setSelectedLogGeneration(null);
    }
  }, [batchItems, onBarLengthChange, onFundamentalChange]);

  // Detect when batch mode should activate
  useEffect(() => {
    if (batchItems.length > 0 && !isBatchMode) {
      setIsBatchMode(true);
    } else if (batchItems.length === 0 && isBatchMode) {
      setIsBatchMode(false);
    }
  }, [batchItems.length, isBatchMode]);

  // Get selected batch item
  const selectedBatchItem = selectedBatchIndex !== null ? batchItems[selectedBatchIndex] : null;
  // Find the currently running batch item
  const runningBatchItem = batchItems.find(item => item.status === 'running');
  // Find the index of the running item
  const runningBatchIndex = batchItems.findIndex(item => item.status === 'running');

  // Auto-select the running item when batch optimization starts or moves to next item
  useEffect(() => {
    if (runningBatchIndex !== -1 && selectedBatchIndex !== runningBatchIndex) {
      setSelectedBatchIndex(runningBatchIndex);
      // Update display to match running item
      const item = batchItems[runningBatchIndex];
      onBarLengthChange(item.barResult.optimalLength);
      onFundamentalChange(item.barResult.targetFrequency);
    }
  }, [runningBatchIndex, selectedBatchIndex, batchItems, onBarLengthChange, onFundamentalChange]);

  // Get display data - prefer batch item result if selected
  const activeResult = selectedBatchItem?.optimizationResult ?? result;

  // Get selected log entry from either single mode log or batch mode log
  const selectedLogEntry = batchItems.length > 0
    ? (selectedBatchLogGeneration !== null
        ? batchGenerationLog.find(e => e.generation === selectedBatchLogGeneration)
        : null)
    : (selectedLogGeneration !== null
        ? generationLog.find(e => e.generation === selectedLogGeneration)
        : null);

  // Get current progress - use selected item's progress if it's running, otherwise use running item's progress
  const batchCurrentProgress = selectedBatchItem?.currentProgress ?? runningBatchItem?.currentProgress;

  const displayCuts: Cut[] = selectedLogEntry
    ? genesToCuts(selectedLogEntry.genes)
    : activeResult?.cuts ?? (batchCurrentProgress?.genes
        ? genesToCuts(batchCurrentProgress.genes)
        : (currentBestIndividual ? genesToCuts(currentBestIndividual.genes) : []));

  const computedFreqs = selectedLogEntry?.computedFrequencies
    ?? activeResult?.computedFrequencies
    ?? batchCurrentProgress?.computedFrequencies
    ?? currentComputedFreqs;
  const errorsInCents = selectedLogEntry?.errorsInCents
    ?? activeResult?.errorsInCents
    ?? batchCurrentProgress?.errorsInCents
    ?? currentErrorsInCents;

  const displayLength = selectedBatchItem ? selectedBatchItem.barResult.optimalLength : barLength;
  const effectiveLength = activeResult?.effectiveLength
    ? activeResult.effectiveLength * 1000
    : batchCurrentProgress?.lengthTrim
      ? displayLength - 2 * batchCurrentProgress.lengthTrim * 1000
      : currentLengthTrim !== 0
        ? displayLength - 2 * currentLengthTrim * 1000
        : displayLength;

  // Get target frequencies for display (may differ in batch mode)
  const displayTargetFreqs = selectedBatchItem
    ? (() => {
        const preset = TUNING_PRESETS.find(p => p.name === optimizationSettings.tuningPreset);
        if (preset) {
          return calculateTargetFrequencies(preset.ratios, selectedBatchItem.barResult.targetFrequency);
        }
        return [selectedBatchItem.barResult.targetFrequency];
      })()
    : targetFreqs;

  return (
    <>
      {/* Bar Length & Frequency Input */}
      <div className="panel single-bar-inputs">
        <div className="single-bar-input-row">
          <div className="form-group">
            <label className="form-label">Bar Length</label>
            <div className="input-unit">
              <input
                type="number"
                className="form-input"
                value={barLength}
                onChange={e => onBarLengthChange(parseFloat(e.target.value) || 0)}
                min={50}
                max={1000}
              />
              <span>mm</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Fundamental (f₁)</label>
            <div className="frequency-input-row">
              <div className="note-input-container">
                <input
                  ref={noteInputRef}
                  type="text"
                  className="form-input note-input"
                  value={noteInput}
                  onChange={e => handleNoteInputChange(e.target.value)}
                  onFocus={() => setShowNoteSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowNoteSuggestions(false), 150)}
                  onKeyDown={handleNoteInputKeyDown}
                  placeholder="C4"
                />
                {showNoteSuggestions && filteredNotes.length > 0 && (
                  <div className="note-suggestions">
                    {filteredNotes.map((n, i) => (
                      <div
                        key={n.note}
                        className={`note-suggestion ${i === selectedSuggestionIndex ? 'selected' : ''}`}
                        onMouseDown={() => handleNoteSelect(n.note, n.freq)}
                        onMouseEnter={() => setSelectedSuggestionIndex(i)}
                      >
                        <span className="note-name">{n.note}</span>
                        <span className="note-freq">{n.freq} Hz</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="input-unit">
                <input
                  type="number"
                  className="form-input"
                  value={fundamentalFrequency}
                  onChange={e => onFundamentalChange(parseFloat(e.target.value) || 0)}
                  min={20}
                  max={4000}
                  step={0.1}
                />
                <span>Hz</span>
              </div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="tuning-preset-select">Tuning Ratios</label>
            <select
              id="tuning-preset-select"
              className="form-select"
              value={tuningPreset}
              onChange={e => onTuningPresetChange(e.target.value)}
            >
              {TUNING_PRESETS.map(preset => (
                <option key={preset.name} value={preset.name}>
                  {preset.name} ({preset.instrument})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group target-frequencies-group">
            <label className="form-label">Target Frequencies (Hz)</label>
            <div className="target-frequencies-inputs">
              {targetFreqs.map((freq, i) => (
                <div key={i} className="target-freq-input">
                  <span className="target-freq-label">f{i + 1}</span>
                  <input
                    type="text"
                    className="form-input"
                    value={freq.toFixed(1)}
                    readOnly
                    title={`Target frequency f${i + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Add to Batch button */}
          <div className="form-group add-to-batch-group">
            <label className="form-label">&nbsp;</label>
            <button
              type="button"
              className="btn btn-secondary add-to-batch-btn"
              onClick={handleAddToBatch}
              disabled={isRunning}
              title="Add this bar to the batch queue"
            >
              + Add to Batch
            </button>
          </div>
        </div>
      </div>

      {/* Batch Queue Panel (shown when batch items exist) */}
      {batchItems.length > 0 && (
        <BatchQueuePanel
          batchItems={batchItems}
          barWidth={barWidth}
          barThickness={barThickness}
          material={material}
          optimizationSettings={optimizationSettings}
          selectedItemIndex={selectedBatchIndex}
          onSelectItem={handleSelectBatchItem}
          onBatchUpdate={onBatchItemsChange}
          onClearBatch={handleClearBatch}
          isRunning={isRunning}
          onRunningChange={onRunningChange}
          onProgressUpdate={handleBatchProgressUpdate}
        />
      )}

      {/* Single Bar Optimization Controls (hidden when batch mode active) */}
      {batchItems.length === 0 && (
        <OptimizationControls
          isRunning={isRunning}
          currentGeneration={currentGeneration}
          maxGenerations={optimizationSettings.maxGenerations}
          bestFitness={bestFitness}
          onStart={handleStart}
          onStop={handleStop}
        />
      )}

      {/* Bar Profile Visualization */}
      <BarProfileSVG
        length={displayLength}
        thickness={barThickness}
        cuts={displayCuts}
        showDimensions={displayCuts.length > 0}
        effectiveLength={effectiveLength}
      />

      {/* Frequency Table */}
      <FrequencyTable
        targetFrequencies={displayTargetFreqs}
        computedFrequencies={computedFreqs}
        errorsInCents={errorsInCents}
      />

      {/* Generation Log - show for both single bar and batch mode */}
      {batchItems.length === 0 ? (
        <GenerationLog
          entries={generationLog}
          targetFrequencies={targetFreqs}
          selectedGeneration={selectedLogGeneration}
          onSelectGeneration={setSelectedLogGeneration}
        />
      ) : (
        <GenerationLog
          entries={batchGenerationLog}
          targetFrequencies={displayTargetFreqs}
          selectedGeneration={selectedBatchLogGeneration}
          onSelectGeneration={setSelectedBatchLogGeneration}
        />
      )}

      {/* Results Summary */}
      {activeResult && (
        <ResultsSummary
          tuningError={activeResult.tuningError}
          maxErrorCents={activeResult.maxErrorCents}
          volumePercent={activeResult.volumePercent}
          generations={activeResult.generations}
          cuts={activeResult.cuts}
          lengthTrim={activeResult.lengthTrim}
          effectiveLength={activeResult.effectiveLength}
          genes={activeResult.bestIndividual.genes}
        />
      )}
    </>
  );
}
