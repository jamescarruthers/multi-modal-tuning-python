/**
 * Note and Frequency Utilities
 *
 * Provides conversion between musical note names and frequencies,
 * and utilities for generating note ranges.
 */

// Standard note names (sharps)
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Note names with flats (for display)
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Natural notes only (white keys)
export const NATURAL_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Convert a note name to frequency (A4 = 440 Hz)
 * Accepts formats: "C4", "A#3", "Bb5", "F#2"
 */
export function noteToFrequency(noteName: string): number | null {
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

/**
 * Convert a frequency to the nearest note name
 */
export function frequencyToNote(freq: number): string {
  // Convert frequency to nearest note name
  const semitonesFromA4 = 12 * Math.log2(freq / 440);
  const midiNote = Math.round(69 + semitonesFromA4);

  const noteIndex = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;

  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Convert a note name to MIDI note number
 * C4 = 60, A4 = 69
 */
export function noteToMidiNumber(noteName: string): number | null {
  const match = noteName.match(/^([A-Ga-g])([#b]?)(\d)$/);
  if (!match) return null;

  const [, note, accidental, octaveStr] = match;
  const octave = parseInt(octaveStr);

  let noteIndex = NOTE_NAMES.indexOf(note.toUpperCase());
  if (noteIndex === -1) return null;

  if (accidental === '#') noteIndex += 1;
  if (accidental === 'b') noteIndex -= 1;

  // Handle wrap-around
  if (noteIndex < 0) {
    noteIndex += 12;
  }
  if (noteIndex >= 12) {
    noteIndex -= 12;
  }

  // MIDI: C4 = 60, so octave 4 starts at 60
  // Formula: (octave + 1) * 12 + noteIndex
  return (octave + 1) * 12 + noteIndex;
}

/**
 * Convert MIDI note number to note name
 */
export function midiNumberToNote(midi: number): string {
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Scale types for note range generation
 */
export type ScaleType = 'chromatic' | 'natural' | 'custom';

/**
 * Information about a musical note
 */
export interface NoteInfo {
  name: string;       // e.g., "C4", "F#5"
  frequency: number;  // Hz
  midiNumber: number; // MIDI note number
}

/**
 * Generate a list of notes within a range
 *
 * @param startNote - Starting note (e.g., "F4")
 * @param endNote - Ending note (e.g., "F5")
 * @param scaleType - Type of scale: 'chromatic', 'natural', or 'custom'
 * @param customNotes - For custom scale, list of note names to include
 * @returns Array of NoteInfo objects
 */
export function generateNotesInRange(
  startNote: string,
  endNote: string,
  scaleType: ScaleType,
  customNotes?: string[]
): NoteInfo[] {
  const startMidi = noteToMidiNumber(startNote);
  const endMidi = noteToMidiNumber(endNote);

  if (startMidi === null || endMidi === null) {
    return [];
  }

  const notes: NoteInfo[] = [];
  const minMidi = Math.min(startMidi, endMidi);
  const maxMidi = Math.max(startMidi, endMidi);

  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const noteIndex = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const noteName = NOTE_NAMES[noteIndex];
    const fullName = `${noteName}${octave}`;

    // Filter based on scale type
    let include = false;

    if (scaleType === 'chromatic') {
      include = true;
    } else if (scaleType === 'natural') {
      // Check if note letter (without accidental) is a natural note
      include = NATURAL_NOTES.includes(noteName);
    } else if (scaleType === 'custom' && customNotes) {
      // Check if note is in custom list (case-insensitive)
      include = customNotes.some(cn =>
        cn.toUpperCase().replace('B', '#').replace(/\s/g, '') ===
        fullName.toUpperCase()
      );
    }

    if (include) {
      const freq = noteToFrequency(fullName);
      if (freq !== null) {
        notes.push({
          name: fullName,
          frequency: freq,
          midiNumber: midi
        });
      }
    }
  }

  return notes;
}

/**
 * Generate list of all notes for autocomplete (C2 to C7)
 */
export function generateNoteList(): { note: string; freq: number }[] {
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

/**
 * Format a frequency with appropriate precision
 */
export function formatFrequency(freq: number): string {
  if (freq >= 1000) {
    return freq.toFixed(1);
  } else if (freq >= 100) {
    return freq.toFixed(2);
  } else {
    return freq.toFixed(3);
  }
}

/**
 * Calculate error in cents between two frequencies
 * Positive = computed is sharp, Negative = computed is flat
 */
export function frequencyErrorCents(computed: number, target: number): number {
  return 1200 * Math.log2(computed / target);
}
