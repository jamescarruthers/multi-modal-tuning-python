import { useState, useEffect, useRef, useMemo } from 'react';
import { MATERIALS, getMaterialsByCategory } from '../data/materials';
import { TUNING_PRESETS, calculateTargetFrequencies } from '../data/tuningPresets';
import { Material } from '../types';
import { isValidGeneCode } from '../optimization/geneCodec';

// Note name to frequency conversion (A4 = 440 Hz)
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function noteToFrequency(noteName: string): number | null {
  // Parse note name like "C4", "A#3", "Bb5"
  const match = noteName.match(/^([A-Ga-g])([#b]?)(\d)$/);
  if (!match) return null;

  const [, note, accidental, octaveStr] = match;
  const octave = parseInt(octaveStr);

  let noteIndex = NOTE_NAMES.indexOf(note.toUpperCase());
  if (noteIndex === -1) return null;

  if (accidental === '#') noteIndex += 1;
  if (accidental === 'b') noteIndex -= 1;

  // Handle wrap-around
  if (noteIndex < 0) noteIndex += 12;
  if (noteIndex >= 12) noteIndex -= 12;

  // Calculate semitones from A4 (A4 = 440 Hz, MIDI note 69)
  // A4 is note index 9 in octave 4
  const semitonesFromA4 = (octave - 4) * 12 + (noteIndex - 9);

  // Frequency = 440 * 2^(semitones/12)
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

function frequencyToNote(freq: number): string {
  // Convert frequency to nearest note name
  const semitonesFromA4 = 12 * Math.log2(freq / 440);
  const midiNote = Math.round(69 + semitonesFromA4);

  const noteIndex = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;

  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

// Generate list of common notes for autocomplete (C2 to C7)
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

interface InputPanelProps {
  // Bar dimensions
  barLength: number;
  barWidth: number;
  barThickness: number;
  onBarLengthChange: (value: number) => void;
  onBarWidthChange: (value: number) => void;
  onBarThicknessChange: (value: number) => void;

  // Material
  selectedMaterial: string;
  onMaterialChange: (key: string) => void;

  // Tuning
  tuningMode: 'preset' | 'custom';
  selectedPreset: string;
  customRatios: string;
  fundamentalFrequency: number;
  onTuningModeChange: (mode: 'preset' | 'custom') => void;
  onPresetChange: (preset: string) => void;
  onCustomRatiosChange: (ratios: string) => void;
  onFundamentalChange: (freq: number) => void;

  // Optimization params
  numCuts: number;
  penaltyType: 'volume' | 'roughness' | 'none';
  penaltyWeight: number;
  populationSize: number;
  maxGenerations: number;
  f1Priority: number;
  numElements: number;
  minCutWidth: number;
  maxCutWidth: number;
  minCutDepth: number;
  maxCutDepth: number;
  maxLengthTrim: number;
  maxLengthExtend: number;
  maxCores: number;
  targetError: number;
  seedGeneCode: string;
  onNumCutsChange: (n: number) => void;
  onPenaltyTypeChange: (type: 'volume' | 'roughness' | 'none') => void;
  onPenaltyWeightChange: (weight: number) => void;
  onPopulationSizeChange: (size: number) => void;
  onMaxGenerationsChange: (gen: number) => void;
  onF1PriorityChange: (priority: number) => void;
  onNumElementsChange: (elements: number) => void;
  onMinCutWidthChange: (width: number) => void;
  onMaxCutWidthChange: (width: number) => void;
  onMinCutDepthChange: (depth: number) => void;
  onMaxCutDepthChange: (depth: number) => void;
  onMaxLengthTrimChange: (trim: number) => void;
  onMaxLengthExtendChange: (extend: number) => void;
  onMaxCoresChange: (cores: number) => void;
  onTargetErrorChange: (error: number) => void;
  onSeedGeneCodeChange: (code: string) => void;
}

export function InputPanel(props: InputPanelProps) {
  const { metals, woods } = getMaterialsByCategory();
  const material = MATERIALS[props.selectedMaterial];

  // Note autocomplete state
  const [noteInput, setNoteInput] = useState('');
  const [showNoteSuggestions, setShowNoteSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const noteInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Generate note list once
  const allNotes = useMemo(() => generateNoteList(), []);

  // Filter notes based on input
  const filteredNotes = useMemo(() => {
    if (!noteInput) return allNotes.slice(0, 12); // Show first octave by default
    const search = noteInput.toUpperCase();
    return allNotes.filter(n =>
      n.note.toUpperCase().startsWith(search) ||
      n.note.toUpperCase().includes(search)
    ).slice(0, 12);
  }, [noteInput, allNotes]);

  // Update note input when frequency changes externally
  useEffect(() => {
    const nearestNote = frequencyToNote(props.fundamentalFrequency);
    const noteFreq = noteToFrequency(nearestNote);
    // Only update if close to a note (within 5 cents)
    if (noteFreq && Math.abs(1200 * Math.log2(props.fundamentalFrequency / noteFreq)) < 5) {
      setNoteInput(nearestNote);
    }
  }, [props.fundamentalFrequency]);

  const handleNoteSelect = (note: string, freq: number) => {
    setNoteInput(note);
    props.onFundamentalChange(Math.round(freq * 10) / 10);
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

    // Try to parse as note and update frequency
    const freq = noteToFrequency(value);
    if (freq && freq >= 20 && freq <= 4000) {
      props.onFundamentalChange(Math.round(freq * 10) / 10);
    }
  };

  // Calculate target frequencies for display
  const getTargetFrequencies = (): number[] => {
    if (props.tuningMode === 'preset') {
      const preset = TUNING_PRESETS.find(p => p.name === props.selectedPreset);
      if (preset) {
        return calculateTargetFrequencies(preset.ratios, props.fundamentalFrequency);
      }
    } else {
      const ratios = props.customRatios.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      return calculateTargetFrequencies(ratios, props.fundamentalFrequency);
    }
    return [];
  };

  const targetFreqs = getTargetFrequencies();

  return (
    <div className="sidebar">
      {/* Bar Dimensions */}
      <div className="panel">
        <h3 className="panel-title">Bar Dimensions</h3>
        <div className="input-row">
          <div className="form-group">
            <label className="form-label">Length</label>
            <div className="input-unit">
              <input
                type="number"
                className="form-input"
                value={props.barLength}
                onChange={e => props.onBarLengthChange(parseFloat(e.target.value) || 0)}
                min={50}
                max={1000}
              />
              <span>mm</span>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Width</label>
            <div className="input-unit">
              <input
                type="number"
                className="form-input"
                value={props.barWidth}
                onChange={e => props.onBarWidthChange(parseFloat(e.target.value) || 0)}
                min={10}
                max={200}
              />
              <span>mm</span>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Thickness</label>
            <div className="input-unit">
              <input
                type="number"
                className="form-input"
                value={props.barThickness}
                onChange={e => props.onBarThicknessChange(parseFloat(e.target.value) || 0)}
                min={5}
                max={50}
              />
              <span>mm</span>
            </div>
          </div>
        </div>
      </div>

      {/* Material Selection */}
      <div className="panel">
        <h3 className="panel-title">Material</h3>
        <select
          className="form-select"
          value={props.selectedMaterial}
          onChange={e => props.onMaterialChange(e.target.value)}
        >
          <optgroup label="Metals">
            {metals.map(([key, mat]) => (
              <option key={key} value={key}>{mat.name}</option>
            ))}
          </optgroup>
          <optgroup label="Woods">
            {woods.map(([key, mat]) => (
              <option key={key} value={key}>{mat.name}</option>
            ))}
          </optgroup>
        </select>
        {material && (
          <div className="material-props">
            <div className="material-prop">
              <div className="label">E</div>
              <div className="value">{(material.E / 1e9).toFixed(1)} GPa</div>
            </div>
            <div className="material-prop">
              <div className="label">ρ</div>
              <div className="value">{material.rho} kg/m³</div>
            </div>
            <div className="material-prop">
              <div className="label">ν</div>
              <div className="value">{material.nu}</div>
            </div>
          </div>
        )}
      </div>

      {/* Tuning Target */}
      <div className="panel">
        <h3 className="panel-title">Tuning Target</h3>

        <div className="tuning-mode-toggle">
          <button
            className={`tuning-mode-btn ${props.tuningMode === 'preset' ? 'active' : ''}`}
            onClick={() => props.onTuningModeChange('preset')}
          >
            Preset
          </button>
          <button
            className={`tuning-mode-btn ${props.tuningMode === 'custom' ? 'active' : ''}`}
            onClick={() => props.onTuningModeChange('custom')}
          >
            Custom
          </button>
        </div>

        {props.tuningMode === 'preset' ? (
          <select
            className="form-select"
            value={props.selectedPreset}
            onChange={e => props.onPresetChange(e.target.value)}
          >
            {TUNING_PRESETS.map(preset => (
              <option key={preset.name} value={preset.name}>
                {preset.name} - {preset.description}
              </option>
            ))}
          </select>
        ) : (
          <div className="form-group">
            <label className="form-label">Ratios (comma-separated)</label>
            <input
              type="text"
              className="form-input"
              value={props.customRatios}
              onChange={e => props.onCustomRatiosChange(e.target.value)}
              placeholder="1, 4, 10"
            />
          </div>
        )}

        <div className="form-group" style={{ marginTop: 12 }}>
          <label className="form-label">Fundamental Frequency (f₁)</label>
          <div className="frequency-input-row">
            {/* Note name input with autocomplete */}
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
                <div className="note-suggestions" ref={suggestionsRef}>
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
            {/* Frequency number input */}
            <div className="input-unit">
              <input
                type="number"
                className="form-input"
                value={props.fundamentalFrequency}
                onChange={e => props.onFundamentalChange(parseFloat(e.target.value) || 0)}
                min={20}
                max={4000}
                step={0.1}
                title="Frequency in Hz"
                aria-label="Frequency in Hz"
              />
              <span>Hz</span>
            </div>
          </div>
        </div>

        <div className="target-frequencies">
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            Target Frequencies:
          </div>
          {targetFreqs.map((freq, i) => (
            <div key={i} className="freq-item">
              <span>f{i + 1}</span>
              <span>{freq.toFixed(1)} Hz</span>
            </div>
          ))}
        </div>
      </div>

      {/* Optimization Parameters */}
      <div className="panel">
        <h3 className="panel-title">Optimization</h3>

        <div className="form-group">
          <label className="form-label">Number of Cuts</label>
          <input
            type="number"
            className="form-input"
            min={1}
            max={20}
            value={props.numCuts}
            onChange={e => {
              const val = parseInt(e.target.value);
              if (!isNaN(val) && val >= 1) {
                props.onNumCutsChange(val);
              }
            }}
            aria-label="Number of cuts"
          />
          <div className="input-hint">
            Typical: 1-5 cuts. More cuts = finer tuning control but slower optimization.
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Penalty Type</label>
          <select
            className="form-select"
            value={props.penaltyType}
            onChange={e => props.onPenaltyTypeChange(e.target.value as 'volume' | 'roughness' | 'none')}
          >
            <option value="none">None</option>
            <option value="volume">Volume (minimize material removal)</option>
            <option value="roughness">Roughness (smooth profile)</option>
          </select>
        </div>

        {props.penaltyType !== 'none' && (
          <div className="slider-group">
            <div className="slider-header">
              <span className="slider-label">Penalty Weight (α)</span>
              <span className="slider-value">{props.penaltyWeight.toFixed(2)}</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={0.3}
              step={0.01}
              value={props.penaltyWeight}
              onChange={e => props.onPenaltyWeightChange(parseFloat(e.target.value))}
            />
          </div>
        )}

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">f₁ Priority</span>
            <span className="slider-value">{props.f1Priority.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            className="slider"
            min={1}
            max={5}
            step={0.5}
            value={props.f1Priority}
            onChange={e => props.onF1PriorityChange(parseFloat(e.target.value))}
            title="f1 Priority - weight multiplier for fundamental frequency"
            aria-label="f1 Priority"
          />
          <div className="slider-hint">
            Higher = prioritize fundamental frequency tuning
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">FEM Elements</span>
            <span className="slider-value">{props.numElements}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={40}
            max={400}
            step={10}
            value={props.numElements}
            onChange={e => props.onNumElementsChange(parseInt(e.target.value))}
            title="Number of finite elements for mesh discretization"
            aria-label="FEM Elements"
          />
          <div className="slider-hint">
            Element size: {(props.barLength / props.numElements).toFixed(2)} mm
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">Min Step Width</span>
            <span className="slider-value">{props.minCutWidth} mm</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0.5}
            max={20}
            step={0.5}
            value={props.minCutWidth}
            onChange={e => props.onMinCutWidthChange(parseFloat(e.target.value))}
            title="Minimum step width"
            aria-label="Minimum Step Width"
          />
          <div className="slider-hint">
            Min width of each tier/step
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">Max Step Width</span>
            <span className="slider-value">{props.maxCutWidth === 0 ? 'No limit' : `${props.maxCutWidth} mm`}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0}
            max={props.barLength / 2}
            step={5}
            value={props.maxCutWidth}
            onChange={e => props.onMaxCutWidthChange(parseFloat(e.target.value))}
            title="Maximum step width (0 = no limit)"
            aria-label="Maximum Step Width"
          />
          <div className="slider-hint">
            Max width of each tier/step (0 = no limit)
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">Min Cut Depth</span>
            <span className="slider-value">{props.minCutDepth === 0 ? 'No limit' : `${props.minCutDepth} mm`}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0}
            max={props.barThickness * 0.9}
            step={0.5}
            value={props.minCutDepth}
            onChange={e => props.onMinCutDepthChange(parseFloat(e.target.value))}
            title="Minimum cut depth (0 = no minimum)"
            aria-label="Minimum Cut Depth"
          />
          <div className="slider-hint">
            Min material removed (0 = no min)
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">Max Cut Depth</span>
            <span className="slider-value">{props.maxCutDepth === 0 ? 'No limit' : `${props.maxCutDepth} mm`}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0}
            max={props.barThickness * 0.9}
            step={0.5}
            value={props.maxCutDepth}
            onChange={e => props.onMaxCutDepthChange(parseFloat(e.target.value))}
            title="Maximum cut depth (0 = 90% of thickness)"
            aria-label="Maximum Cut Depth"
          />
          <div className="slider-hint">
            Max material removed (0 = 90% of h₀)
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">Max Length Trim</span>
            <span className="slider-value">{props.maxLengthTrim === 0 ? 'Disabled' : `${props.maxLengthTrim} mm`}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0}
            max={props.barLength * 0.2}
            step={1}
            value={props.maxLengthTrim}
            onChange={e => props.onMaxLengthTrimChange(parseFloat(e.target.value))}
            title="Maximum trim from each end (0 = no trimming)"
            aria-label="Maximum Length Trim"
          />
          <div className="slider-hint">
            Optimizer can shorten bar by up to 2×{props.maxLengthTrim} mm total
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">Max Length Extend</span>
            <span className="slider-value">{props.maxLengthExtend === 0 ? 'Disabled' : `${props.maxLengthExtend} mm`}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0}
            max={props.barLength * 0.2}
            step={1}
            value={props.maxLengthExtend}
            onChange={e => props.onMaxLengthExtendChange(parseFloat(e.target.value))}
            title="Maximum extension from each end (0 = no extension)"
            aria-label="Maximum Length Extend"
          />
          <div className="slider-hint">
            Optimizer can lengthen bar by up to 2×{props.maxLengthExtend} mm total
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">CPU Cores</span>
            <span className="slider-value">{props.maxCores === 0 ? 'Auto (max)' : props.maxCores}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0}
            max={navigator.hardwareConcurrency || 8}
            step={1}
            value={props.maxCores}
            onChange={e => props.onMaxCoresChange(parseInt(e.target.value))}
            title="Maximum CPU cores for WASM threading (0 = auto/max available)"
            aria-label="Maximum CPU Cores"
          />
          <div className="slider-hint">
            {props.maxCores === 0
              ? `Use all available cores (${navigator.hardwareConcurrency || 'unknown'})`
              : `Limit to ${props.maxCores} core${props.maxCores > 1 ? 's' : ''}`
            }
          </div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">Target Error</span>
            <span className="slider-value">{props.targetError < 0.01 ? props.targetError.toFixed(3) : props.targetError.toFixed(2)}%</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0.001}
            max={1}
            step={0.001}
            value={props.targetError}
            onChange={e => props.onTargetErrorChange(parseFloat(e.target.value))}
            title="Stop optimization when fitness reaches this error percentage"
            aria-label="Target Error"
          />
          <div className="slider-hint">
            Stop early when tuning error falls below this threshold
          </div>
        </div>

        <div className="input-row" style={{ marginTop: 12 }}>
          <div className="form-group">
            <label className="form-label">Population</label>
            <input
              type="number"
              className="form-input"
              value={props.populationSize}
              onChange={e => props.onPopulationSizeChange(parseInt(e.target.value) || 30)}
              min={20}
              max={200}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Generations</label>
            <input
              type="number"
              className="form-input"
              value={props.maxGenerations}
              onChange={e => props.onMaxGenerationsChange(parseInt(e.target.value) || 50)}
              min={10}
              max={500}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Seed Gene Code (optional)</label>
          <input
            type="text"
            className={`form-input seed-input ${props.seedGeneCode && !isValidGeneCode(props.seedGeneCode) ? 'input-error' : ''}`}
            value={props.seedGeneCode}
            onChange={e => props.onSeedGeneCodeChange(e.target.value)}
            placeholder="Paste gene code to resume optimization"
          />
          <div className="input-hint">
            {props.seedGeneCode
              ? isValidGeneCode(props.seedGeneCode)
                ? 'Valid gene code - will seed initial population'
                : 'Invalid gene code format'
              : 'Paste a gene code from a previous run to continue refining'}
          </div>
        </div>
      </div>

      {/* Attribution */}
      <div className="attribution">
        Based on{' '}
        <a
          href="https://hal.science/hal-04240657v1/file/soares2020.pdf"
          target="_blank"
          rel="noopener noreferrer"
        >
          Soares et al. (2020)
        </a>
      </div>
    </div>
  );
}
