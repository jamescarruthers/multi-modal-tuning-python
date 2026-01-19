import { useEffect, useState, useMemo } from 'react';
import { useOptimizationStore } from '../../stores/optimizationStore';
import { NumberInput } from './NumberInput';
import type { Preset } from '../../types';

// Note names and their semitone offset from A4
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const A4_FREQUENCY = 440;
const A4_MIDI = 69;

// Generate all notes from C1 to C7
function generateNotes(): { name: string; frequency: number }[] {
  const notes: { name: string; frequency: number }[] = [];
  for (let octave = 1; octave <= 7; octave++) {
    for (let i = 0; i < NOTE_NAMES.length; i++) {
      const noteName = `${NOTE_NAMES[i]}${octave}`;
      // MIDI note number: C4 = 60, A4 = 69
      const midiNote = (octave + 1) * 12 + i;
      const frequency = A4_FREQUENCY * Math.pow(2, (midiNote - A4_MIDI) / 12);
      notes.push({ name: noteName, frequency: Math.round(frequency * 100) / 100 });
    }
  }
  return notes;
}

// Find closest note to a frequency
function frequencyToNote(freq: number, notes: { name: string; frequency: number }[]): string {
  let closest = notes[0];
  let minDiff = Math.abs(freq - closest.frequency);
  for (const note of notes) {
    const diff = Math.abs(freq - note.frequency);
    if (diff < minDiff) {
      minDiff = diff;
      closest = note;
    }
  }
  return closest.name;
}

export function PresetSelector() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const { preset, fundamentalHz, numCuts, lengthAdjustConfig, setPreset, setFundamentalHz, setNumCuts } =
    useOptimizationStore();

  const hasLengthAdjust = lengthAdjustConfig.max_trim > 0 || lengthAdjustConfig.max_extend > 0;

  // Generate note list once
  const notes = useMemo(() => generateNotes(), []);

  // Find current note based on frequency
  const currentNote = useMemo(() => frequencyToNote(fundamentalHz, notes), [fundamentalHz, notes]);

  // Handle note selection
  const handleNoteChange = (noteName: string) => {
    const note = notes.find((n) => n.name === noteName);
    if (note) {
      setFundamentalHz(note.frequency);
    }
  };

  useEffect(() => {
    async function fetchPresets() {
      try {
        const res = await fetch('/api/presets');
        if (!res.ok) {
          console.error('Presets API error:', res.status, res.statusText);
          return;
        }
        const data = await res.json();
        console.log('Presets response:', data);
        if (data.presets) {
          setPresets(data.presets);
          // Initialize store with the current preset's data
          const currentPreset = data.presets.find((p: Preset) => p.name === preset);
          if (currentPreset) {
            setPreset(currentPreset.name, currentPreset.ratios, currentPreset.target_modes || null);
          }
        } else {
          console.error('Presets response missing presets field:', data);
        }
      } catch (error) {
        console.error('Failed to fetch presets:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchPresets();
  }, []);

  const selectedPreset = presets.find((p) => p.name === preset);

  return (
    <div className="config-section">
      <h4>Tuning</h4>

      <div className="input-row">
        <label htmlFor="preset">Preset</label>
        <select
          id="preset"
          value={preset}
          onChange={(e) => {
            const selected = presets.find((p) => p.name === e.target.value);
            if (selected) {
              setPreset(selected.name, selected.ratios, selected.target_modes || null);
            }
          }}
          disabled={loading}
        >
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {selectedPreset && (
        <div className="preset-info">
          <small>{selectedPreset.description}</small>
          <div className="ratios">
            Ratios: {selectedPreset.ratios.map((r) => r.toFixed(2)).join(' : ')}
          </div>
          {selectedPreset.target_modes && selectedPreset.target_modes.length > 0 && (
            <div className="target-modes">
              Modes: {selectedPreset.target_modes.join(', ')}
            </div>
          )}
        </div>
      )}

      <div className="input-row">
        <label htmlFor="fundamentalNote">Fundamental</label>
        <div className="frequency-inputs">
          <select
            id="fundamentalNote"
            value={currentNote}
            onChange={(e) => handleNoteChange(e.target.value)}
            className="note-select"
          >
            {notes.map((note) => (
              <option key={note.name} value={note.name}>
                {note.name}
              </option>
            ))}
          </select>
          <NumberInput
            id="fundamental"
            value={fundamentalHz}
            onChange={(val) => setFundamentalHz(val ?? 440)}
            min={20}
            max={4000}
          />
          <span className="hz-label">Hz</span>
        </div>
      </div>

      <div className="input-row">
        <label htmlFor="numCuts">Number of Cuts</label>
        <select
          id="numCuts"
          value={numCuts}
          onChange={(e) => setNumCuts(parseInt(e.target.value))}
        >
          <option value={0}>0 cuts (length only)</option>
          <option value={1}>1 cut</option>
          <option value={2}>2 cuts</option>
          <option value={3}>3 cuts</option>
          <option value={4}>4 cuts</option>
          <option value={5}>5 cuts</option>
        </select>
      </div>

      {numCuts === 0 && !hasLengthAdjust && (
        <div className="warning-info">
          <small>Enable Max Trim or Max Extend in Advanced Options to tune by length only.</small>
        </div>
      )}
    </div>
  );
}
