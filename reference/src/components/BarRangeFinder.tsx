/**
 * Bar Range Finder Component
 *
 * Allows users to find optimal bar lengths for a range of musical notes.
 * Users can then select bars and run batch optimization.
 * Uses shared settings from parent (material, optimization params).
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { MATERIALS } from '../data/materials';
import { BarLengthResult, BatchOptimizationItem } from '../types';
import {
  noteToFrequency,
  generateNoteList,
  generateNotesInRange,
  ScaleType
} from '../utils/noteUtils';
import { findLengthsForNotes, estimateLengthFromTheory } from '../utils/barLengthFinder';
import { initWasm, isWasmReady } from '../physics/frequencies';
import { OptimizationSettings } from './SharedSettingsPanel';

interface BarRangeFinderProps {
  barWidth: number;
  barThickness: number;
  selectedMaterial: string;
  optimizationSettings: OptimizationSettings;
  onLoadBar?: (item: BatchOptimizationItem) => void;
  onAddToBatch?: (items: BatchOptimizationItem[]) => void;
}

export function BarRangeFinder({
  barWidth,
  barThickness,
  selectedMaterial,
  optimizationSettings,
  onLoadBar,
  onAddToBatch
}: BarRangeFinderProps) {
  const material = MATERIALS[selectedMaterial];

  // Note range state
  const [startNote, setStartNote] = useState('C4');
  const [endNote, setEndNote] = useState('C5');
  const [scaleType, setScaleType] = useState<ScaleType>('natural');

  // Search parameters
  const [minLength, setMinLength] = useState(100);  // mm
  const [maxLength, setMaxLength] = useState(500);  // mm
  const [toleranceCents, setToleranceCents] = useState(1);

  // Results state
  const [results, setResults] = useState<BarLengthResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState({ note: '', index: 0, total: 0 });
  const stopSearchRef = useRef(false);


  // Note autocomplete state for start note
  const [startNoteInput, setStartNoteInput] = useState('C4');
  const [showStartSuggestions, setShowStartSuggestions] = useState(false);
  const [startSuggestionIndex, setStartSuggestionIndex] = useState(0);
  const startInputRef = useRef<HTMLInputElement>(null);

  // Note autocomplete state for end note
  const [endNoteInput, setEndNoteInput] = useState('C5');
  const [showEndSuggestions, setShowEndSuggestions] = useState(false);
  const [endSuggestionIndex, setEndSuggestionIndex] = useState(0);
  const endInputRef = useRef<HTMLInputElement>(null);

  // Generate note list for autocomplete
  const allNotes = useMemo(() => generateNoteList(), []);

  // Filter notes for start input
  const filteredStartNotes = useMemo(() => {
    if (!startNoteInput) return allNotes.slice(0, 12);
    const search = startNoteInput.toUpperCase();
    return allNotes.filter(n =>
      n.note.toUpperCase().startsWith(search) ||
      n.note.toUpperCase().includes(search)
    ).slice(0, 12);
  }, [startNoteInput, allNotes]);

  // Filter notes for end input
  const filteredEndNotes = useMemo(() => {
    if (!endNoteInput) return allNotes.slice(0, 12);
    const search = endNoteInput.toUpperCase();
    return allNotes.filter(n =>
      n.note.toUpperCase().startsWith(search) ||
      n.note.toUpperCase().includes(search)
    ).slice(0, 12);
  }, [endNoteInput, allNotes]);

  // Preview notes in range
  const previewNotes = useMemo(() => {
    return generateNotesInRange(startNote, endNote, scaleType);
  }, [startNote, endNote, scaleType]);

  // Handle start note selection
  const handleStartNoteSelect = (note: string) => {
    setStartNoteInput(note);
    setStartNote(note);
    setShowStartSuggestions(false);
  };

  // Handle end note selection
  const handleEndNoteSelect = (note: string) => {
    setEndNoteInput(note);
    setEndNote(note);
    setShowEndSuggestions(false);
  };

  // Handle start note input change
  const handleStartNoteInputChange = (value: string) => {
    setStartNoteInput(value);
    setStartSuggestionIndex(0);
    setShowStartSuggestions(true);
    const freq = noteToFrequency(value);
    if (freq) {
      setStartNote(value);
    }
  };

  // Handle end note input change
  const handleEndNoteInputChange = (value: string) => {
    setEndNoteInput(value);
    setEndSuggestionIndex(0);
    setShowEndSuggestions(true);
    const freq = noteToFrequency(value);
    if (freq) {
      setEndNote(value);
    }
  };

  // Keyboard navigation for start note
  const handleStartNoteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setStartSuggestionIndex(i => Math.min(i + 1, filteredStartNotes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setStartSuggestionIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filteredStartNotes.length > 0) {
      e.preventDefault();
      handleStartNoteSelect(filteredStartNotes[startSuggestionIndex].note);
    } else if (e.key === 'Escape') {
      setShowStartSuggestions(false);
    }
  };

  // Keyboard navigation for end note
  const handleEndNoteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setEndSuggestionIndex(i => Math.min(i + 1, filteredEndNotes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setEndSuggestionIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filteredEndNotes.length > 0) {
      e.preventDefault();
      handleEndNoteSelect(filteredEndNotes[endSuggestionIndex].note);
    } else if (e.key === 'Escape') {
      setShowEndSuggestions(false);
    }
  };

  // Run the search
  const handleFindBars = useCallback(async () => {
    if (!material || previewNotes.length === 0) return;

    setIsSearching(true);
    setResults([]);
    stopSearchRef.current = false;

    // Initialize WASM if needed
    if (!isWasmReady()) {
      await initWasm();
    }

    // Process notes one at a time so we can interrupt
    const processNextNote = (index: number, accumulated: BarLengthResult[]) => {
      // Check if stopped
      if (stopSearchRef.current) {
        setResults(accumulated);
        setIsSearching(false);
        return;
      }

      // Check if done
      if (index >= previewNotes.length) {
        setResults(accumulated);
        setIsSearching(false);
        return;
      }

      const note = previewNotes[index];
      setSearchProgress({ note: note.name, index, total: previewNotes.length });

      // Process this note
      const result = findLengthsForNotes(
        [note],
        barWidth,
        barThickness,
        material,
        minLength,
        maxLength,
        toleranceCents,
        optimizationSettings.numElements
      );

      const newAccumulated = [...accumulated, ...result];
      setResults(newAccumulated);

      // Schedule next note (use setTimeout to allow UI updates and stop checks)
      setTimeout(() => processNextNote(index + 1, newAccumulated), 0);
    };

    // Start processing
    setTimeout(() => processNextNote(0, []), 50);
  }, [material, previewNotes, barWidth, barThickness, minLength, maxLength, toleranceCents, optimizationSettings.numElements]);

  // Stop search
  const handleStopSearch = useCallback(() => {
    stopSearchRef.current = true;
  }, []);

  // Toggle selection for a result
  const toggleSelection = (index: number) => {
    setResults(prev => prev.map((r, i) =>
      i === index ? { ...r, selected: !r.selected } : r
    ));
  };

  // Select all / deselect all
  const toggleSelectAll = () => {
    const allSelected = results.every(r => r.selected);
    setResults(prev => prev.map(r => ({ ...r, selected: !allSelected })));
  };

  // Count selected bars
  const selectedCount = results.filter(r => r.selected).length;

  // Get error class for coloring
  const getErrorClass = (cents: number): string => {
    const abs = Math.abs(cents);
    if (abs <= 5) return 'error-excellent';
    if (abs <= 15) return 'error-good';
    if (abs <= 50) return 'error-ok';
    return 'error-bad';
  };

  // Auto-estimate length bounds based on note range
  useEffect(() => {
    if (previewNotes.length > 0 && material) {
      const lowestFreq = Math.min(...previewNotes.map(n => n.frequency));
      const highestFreq = Math.max(...previewNotes.map(n => n.frequency));

      const estMaxLen = estimateLengthFromTheory(lowestFreq, barWidth, barThickness, material) * 1.2;
      const estMinLen = estimateLengthFromTheory(highestFreq, barWidth, barThickness, material) * 0.8;

      setMinLength(Math.max(50, Math.floor(estMinLen / 10) * 10));
      setMaxLength(Math.min(1000, Math.ceil(estMaxLen / 10) * 10));
    }
  }, [previewNotes, material, barWidth, barThickness]);

  return (
    <>
      {/* Note Range Panel */}
      <div className="panel">
        <h3 className="panel-title">Note Range</h3>

        <div className="input-row">
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label">Start Note</label>
            <input
              ref={startInputRef}
              type="text"
              className="form-input"
              value={startNoteInput}
              onChange={e => handleStartNoteInputChange(e.target.value)}
              onFocus={() => setShowStartSuggestions(true)}
              onBlur={() => setTimeout(() => setShowStartSuggestions(false), 150)}
              onKeyDown={handleStartNoteKeyDown}
              placeholder="e.g., C4"
            />
            {showStartSuggestions && filteredStartNotes.length > 0 && (
              <div className="note-suggestions">
                {filteredStartNotes.map((n, i) => (
                  <div
                    key={n.note}
                    className={`note-suggestion ${i === startSuggestionIndex ? 'selected' : ''}`}
                    onMouseDown={() => handleStartNoteSelect(n.note)}
                  >
                    <span className="note-name">{n.note}</span>
                    <span className="note-freq">{n.freq} Hz</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label">End Note</label>
            <input
              ref={endInputRef}
              type="text"
              className="form-input"
              value={endNoteInput}
              onChange={e => handleEndNoteInputChange(e.target.value)}
              onFocus={() => setShowEndSuggestions(true)}
              onBlur={() => setTimeout(() => setShowEndSuggestions(false), 150)}
              onKeyDown={handleEndNoteKeyDown}
              placeholder="e.g., C5"
            />
            {showEndSuggestions && filteredEndNotes.length > 0 && (
              <div className="note-suggestions">
                {filteredEndNotes.map((n, i) => (
                  <div
                    key={n.note}
                    className={`note-suggestion ${i === endSuggestionIndex ? 'selected' : ''}`}
                    onMouseDown={() => handleEndNoteSelect(n.note)}
                  >
                    <span className="note-name">{n.note}</span>
                    <span className="note-freq">{n.freq} Hz</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Scale Type */}
        <div className="form-group">
          <label className="form-label">Scale Type</label>
          <select
            className="form-select"
            value={scaleType}
            onChange={e => setScaleType(e.target.value as ScaleType)}
          >
            <option value="chromatic">Chromatic (all semitones)</option>
            <option value="natural">Natural notes only</option>
          </select>
        </div>

        {/* Preview */}
        <div className="note-preview">
          <span className="preview-label">Notes to find:</span>
          <span className="preview-count">{previewNotes.length} notes</span>
          <div className="preview-notes">
            {previewNotes.slice(0, 12).map(n => (
              <span key={n.midiNumber} className="preview-note">{n.name}</span>
            ))}
            {previewNotes.length > 12 && (
              <span className="preview-more">+{previewNotes.length - 12} more</span>
            )}
          </div>
        </div>
      </div>

      {/* Search Parameters */}
      <div className="panel">
        <h3 className="panel-title">Search Parameters</h3>
        <div className="input-row">
          <div className="form-group">
            <label className="form-label">Min Length</label>
            <div className="input-unit">
              <input
                type="number"
                className="form-input"
                value={minLength}
                onChange={e => setMinLength(parseFloat(e.target.value) || 50)}
                min={50}
                max={maxLength - 10}
              />
              <span>mm</span>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Max Length</label>
            <div className="input-unit">
              <input
                type="number"
                className="form-input"
                value={maxLength}
                onChange={e => setMaxLength(parseFloat(e.target.value) || 500)}
                min={minLength + 10}
                max={1000}
              />
              <span>mm</span>
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Tolerance</label>
          <div className="input-unit">
            <input
              type="number"
              className="form-input"
              value={toleranceCents}
              onChange={e => setToleranceCents(parseFloat(e.target.value) || 1)}
              min={0.1}
              max={50}
              step={0.5}
            />
            <span>cents</span>
          </div>
        </div>
      </div>

      {/* Find/Stop Buttons */}
      {isSearching ? (
        <div className="search-buttons">
          <button
            type="button"
            className="btn btn-danger btn-block"
            onClick={handleStopSearch}
          >
            Stop ({searchProgress.index + 1}/{searchProgress.total})
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={handleFindBars}
          disabled={previewNotes.length === 0}
        >
          Find Optimal Bar Lengths
        </button>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="panel results-panel">
          <div className="results-header">
            <h3 className="panel-title">Results</h3>
            <div className="results-actions">
              <button className="btn btn-sm" onClick={toggleSelectAll}>
                {results.every(r => r.selected) ? 'Deselect All' : 'Select All'}
              </button>
              <span className="selected-count">
                {selectedCount} of {results.length} selected
              </span>
            </div>
          </div>

          <div className="results-table-container">
            <table className="results-table">
              <thead>
                <tr>
                  <th className="col-select"></th>
                  <th className="col-note">Note</th>
                  <th className="col-freq">Target (Hz)</th>
                  <th className="col-length">Length (mm)</th>
                  <th className="col-computed">Computed (Hz)</th>
                  <th className="col-error">Error</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr
                    key={result.note.midiNumber}
                    className={result.selected ? 'selected' : ''}
                    onClick={() => toggleSelection(index)}
                  >
                    <td className="col-select">
                      <input
                        type="checkbox"
                        checked={result.selected}
                        onChange={() => toggleSelection(index)}
                        onClick={e => e.stopPropagation()}
                      />
                    </td>
                    <td className="col-note">{result.note.name}</td>
                    <td className="col-freq">{result.targetFrequency.toFixed(2)}</td>
                    <td className="col-length">{result.optimalLength.toFixed(2)}</td>
                    <td className="col-computed">{result.computedFrequency.toFixed(2)}</td>
                    <td className={`col-error ${getErrorClass(result.errorCents)}`}>
                      {result.errorCents >= 0 ? '+' : ''}{result.errorCents.toFixed(1)}¢
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedCount > 0 && (
            <div className="batch-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  // Convert selected results to batch items and transfer
                  const selectedResults = results.filter(r => r.selected);
                  const batchItems: BatchOptimizationItem[] = selectedResults.map(r => ({
                    barResult: r,
                    status: 'pending' as const
                  }));
                  if (onAddToBatch) {
                    onAddToBatch(batchItems);
                  }
                }}
              >
                Optimize {selectedCount} Bar{selectedCount !== 1 ? 's' : ''}
              </button>
              <span className="batch-info">
                Transfer to batch queue in optimizer
              </span>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && !isSearching && (
        <div className="panel empty-results">
          <div className="empty-message">
            <h3>Find Optimal Bar Lengths</h3>
            <p>
              Select a note range above and click "Find Optimal Bar Lengths"
              to search for the bar length that produces each target frequency.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
