/**
 * Tuner Tab Component
 *
 * Provides a spectrum analyzer view for tuning bars.
 * Shows three frequency windows (f1, f2, f3) with +/- 100 cents range.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { TUNING_PRESETS, calculateTargetFrequencies } from '../data/tuningPresets';
import { noteToFrequency, frequencyToNote, generateNoteList } from '../utils/noteUtils';

interface TunerTabProps {
  tuningPreset: string;
  fundamentalFrequency: number;
  onTuningPresetChange: (preset: string) => void;
  onFundamentalChange: (freq: number) => void;
}

type DisplayMode = 'linear' | 'log' | 'peaks';

interface FrequencyWindowProps {
  targetFrequency: number;
  label: string;
  analyserNode: AnalyserNode | null;
  sampleRate: number;
  isListening: boolean;
  windowCents: number;
  minDecibels: number;
  maxDecibels: number;
  displayMode: DisplayMode;
}

// Convert cents to frequency ratio
function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

// Convert frequency difference to cents
function frequencyToCents(measured: number, target: number): number {
  if (target <= 0 || measured <= 0) return 0;
  return 1200 * Math.log2(measured / target);
}

// Find the dominant frequency in a range using parabolic interpolation
function findPeakFrequency(
  frequencyData: Float32Array,
  sampleRate: number,
  fftSize: number,
  minFreq: number,
  maxFreq: number
): { frequency: number; magnitude: number } | null {
  const binWidth = sampleRate / fftSize;
  const minBin = Math.max(0, Math.floor(minFreq / binWidth));
  const maxBin = Math.min(frequencyData.length - 1, Math.ceil(maxFreq / binWidth));

  // Find the bin with maximum magnitude in the range
  let maxMagnitude = -Infinity;
  let maxBinIndex = minBin;

  for (let i = minBin; i <= maxBin; i++) {
    if (frequencyData[i] > maxMagnitude) {
      maxMagnitude = frequencyData[i];
      maxBinIndex = i;
    }
  }

  // Need at least -60dB to consider it a valid peak
  if (maxMagnitude < -60) {
    return null;
  }

  // Parabolic interpolation for more accurate frequency
  if (maxBinIndex > 0 && maxBinIndex < frequencyData.length - 1) {
    const alpha = frequencyData[maxBinIndex - 1];
    const beta = frequencyData[maxBinIndex];
    const gamma = frequencyData[maxBinIndex + 1];

    const denom = alpha - 2 * beta + gamma;
    if (Math.abs(denom) > 0.0001) {
      const p = 0.5 * (alpha - gamma) / denom;
      const interpolatedBin = maxBinIndex + p;
      const frequency = interpolatedBin * binWidth;
      return { frequency, magnitude: maxMagnitude };
    }
  }

  return { frequency: maxBinIndex * binWidth, magnitude: maxMagnitude };
}

// Frequency Window Component - shows one target frequency with spectrum
function FrequencyWindow({ targetFrequency, label, analyserNode, sampleRate, isListening, windowCents, minDecibels, maxDecibels, displayMode }: FrequencyWindowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const [detectedFreq, setDetectedFreq] = useState<number | null>(null);
  const [centsError, setCentsError] = useState<number>(0);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 200 });

  // Calculate frequency range (+/- windowCents)
  const minFreq = targetFrequency * centsToRatio(-windowCents);
  const maxFreq = targetFrequency * centsToRatio(windowCents);

  // Handle canvas resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          // Use device pixel ratio for sharp rendering
          const dpr = window.devicePixelRatio || 1;
          setCanvasSize({
            width: Math.floor(width * dpr),
            height: Math.floor(height * dpr)
          });
        }
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserNode || !isListening) {
      // Clear canvas when not listening
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#1a1a2e';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fftSize = analyserNode.fftSize;
    const frequencyData = new Float32Array(analyserNode.frequencyBinCount);
    const binWidth = sampleRate / fftSize;

    // Calculate bin range for our frequency window
    const minBin = Math.max(0, Math.floor(minFreq / binWidth));
    const maxBin = Math.min(frequencyData.length - 1, Math.ceil(maxFreq / binWidth));
    const binRange = maxBin - minBin;

    let isRunning = true;

    const draw = () => {
      if (!isRunning) return;

      const width = canvas.width;
      const height = canvas.height;
      const dpr = window.devicePixelRatio || 1;

      // Scale context for device pixel ratio
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const displayWidth = width / dpr;
      const displayHeight = height / dpr;

      // Get frequency data
      analyserNode.getFloatFrequencyData(frequencyData);

      // Clear canvas
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, displayWidth, displayHeight);

      // Draw grid lines for cents
      ctx.strokeStyle = '#333355';
      ctx.lineWidth = 1;

      // Generate cents marks based on window width
      const centsMarks: number[] = [0]; // Always include center
      const step = windowCents <= 50 ? 10 : windowCents <= 100 ? 25 : windowCents <= 200 ? 50 : 100;
      for (let c = step; c <= windowCents; c += step) {
        centsMarks.push(-c);
        centsMarks.push(c);
      }
      centsMarks.sort((a, b) => a - b);

      ctx.font = '12px monospace';
      ctx.textAlign = 'center';

      for (const cents of centsMarks) {
        const freq = targetFrequency * centsToRatio(cents);
        const x = ((freq - minFreq) / (maxFreq - minFreq)) * displayWidth;

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, displayHeight - 25);
        ctx.stroke();

        // Label
        ctx.fillStyle = cents === 0 ? '#4ade80' : '#666688';
        ctx.fillText(`${cents > 0 ? '+' : ''}${cents}`, x, displayHeight - 8);
      }

      // Draw spectrum bars
      const spectrumBarWidth = displayWidth / binRange;
      const dbRange = maxDecibels - minDecibels;

      // For peaks mode, find max magnitude first
      let maxMag = -Infinity;
      if (displayMode === 'peaks') {
        for (let i = minBin; i <= maxBin && i < frequencyData.length; i++) {
          if (frequencyData[i] > maxMag) maxMag = frequencyData[i];
        }
      }

      for (let i = minBin; i <= maxBin && i < frequencyData.length; i++) {
        const magnitude = frequencyData[i];

        // Normalize magnitude based on display mode
        let normalizedMagnitude: number;
        if (displayMode === 'linear') {
          // Linear mapping from minDecibels..maxDecibels to 0..1
          normalizedMagnitude = Math.max(0, Math.min(1, (magnitude - minDecibels) / dbRange));
        } else if (displayMode === 'log') {
          // Logarithmic scaling - compress loud signals, expand quiet ones
          const linearMag = Math.max(0, Math.min(1, (magnitude - minDecibels) / dbRange));
          // Apply log curve: more sensitive to quiet sounds
          normalizedMagnitude = Math.pow(linearMag, 0.5);
        } else {
          // Peaks mode - normalize relative to current max, with power curve
          const linearMag = Math.max(0, Math.min(1, (magnitude - minDecibels) / dbRange));
          // Raise to power to accentuate peaks (higher values = more accentuation)
          normalizedMagnitude = Math.pow(linearMag, 3);
          // Also scale relative to current max for auto-gain effect
          if (maxMag > minDecibels) {
            const maxNorm = Math.max(0, Math.min(1, (maxMag - minDecibels) / dbRange));
            if (maxNorm > 0.01) {
              normalizedMagnitude = normalizedMagnitude / Math.pow(maxNorm, 2);
            }
          }
          normalizedMagnitude = Math.min(1, normalizedMagnitude);
        }

        const barHeight = normalizedMagnitude * (displayHeight - 35);

        const x = (i - minBin) * spectrumBarWidth;
        const freq = i * binWidth;

        // Color based on how close to target
        const cents = frequencyToCents(freq, targetFrequency);
        const absCents = Math.abs(cents);

        let color: string;
        if (absCents < 5) {
          color = '#4ade80'; // Green - excellent
        } else if (absCents < 15) {
          color = '#22c55e'; // Light green - good
        } else if (absCents < 30) {
          color = '#fbbf24'; // Yellow - ok
        } else {
          color = '#3b82f6'; // Blue - out of tune
        }

        ctx.fillStyle = color;
        ctx.fillRect(x, displayHeight - 30 - barHeight, Math.max(1, spectrumBarWidth - 1), barHeight);
      }

      // Find peak frequency in this range
      const peak = findPeakFrequency(frequencyData, sampleRate, fftSize, minFreq, maxFreq);

      if (peak && peak.magnitude > -50) {
        setDetectedFreq(peak.frequency);
        setCentsError(frequencyToCents(peak.frequency, targetFrequency));

        // Draw peak indicator
        const peakX = ((peak.frequency - minFreq) / (maxFreq - minFreq)) * displayWidth;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(peakX, 0);
        ctx.lineTo(peakX, displayHeight - 30);
        ctx.stroke();

        // Draw peak frequency label
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${peak.frequency.toFixed(1)} Hz`, peakX, 20);
      } else {
        setDetectedFreq(null);
        setCentsError(0);
      }

      // Draw center target line (dashed) - calculate position from target frequency
      const centerX = ((targetFrequency - minFreq) / (maxFreq - minFreq)) * displayWidth;
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, displayHeight - 30);
      ctx.stroke();
      ctx.setLineDash([]);

      animationRef.current = requestAnimationFrame(draw);
    };

    // Start the animation
    draw();

    return () => {
      isRunning = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [analyserNode, sampleRate, targetFrequency, minFreq, maxFreq, isListening, canvasSize, windowCents, minDecibels, maxDecibels, displayMode]);

  // Determine error color class
  const getErrorClass = (cents: number): string => {
    const absCents = Math.abs(cents);
    if (absCents < 5) return 'error-excellent';
    if (absCents < 15) return 'error-good';
    if (absCents < 30) return 'error-ok';
    return 'error-bad';
  };

  return (
    <div className="tuner-frequency-window">
      <div className="tuner-window-header">
        <span className="tuner-window-label">{label}</span>
        <span className="tuner-window-target">{targetFrequency.toFixed(1)} Hz</span>
        {detectedFreq !== null && isListening && (
          <span className={`tuner-window-error ${getErrorClass(centsError)}`}>
            {centsError > 0 ? '+' : ''}{centsError.toFixed(0)}¢
          </span>
        )}
      </div>
      <div ref={containerRef} className="tuner-canvas-container">
        <canvas
          ref={canvasRef}
          className="tuner-canvas"
          width={canvasSize.width}
          height={canvasSize.height}
        />
      </div>
    </div>
  );
}

// FFT Size presets with labels
const FFT_SIZE_OPTIONS = [
  { value: 2048, label: 'Very Fast (2048)' },
  { value: 4096, label: 'Fast (4096)' },
  { value: 8192, label: 'Balanced (8192)' },
  { value: 16384, label: 'Accurate (16384)' },
  { value: 32768, label: 'Maximum (32768)' }
];

export function TunerTab({
  tuningPreset,
  fundamentalFrequency,
  onTuningPresetChange,
  onFundamentalChange
}: TunerTabProps) {
  const [isListening, setIsListening] = useState(false);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // FFT settings - good defaults for bar tuning
  const [fftSize, setFftSize] = useState(8192);
  const [smoothing, setSmoothing] = useState(0.2); // Low smoothing for percussive sounds
  const [minDecibels, setMinDecibels] = useState(-100);
  const [maxDecibels, setMaxDecibels] = useState(-10);
  const [windowCents, setWindowCents] = useState(100); // +/- cents range for each window
  const [displayMode, setDisplayMode] = useState<DisplayMode>('peaks'); // Display mode for spectrum

  // Note input state
  const [noteInput, setNoteInput] = useState('');
  const [showNoteSuggestions, setShowNoteSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const noteInputRef = useRef<HTMLInputElement>(null);

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

  // Get target frequencies from preset
  const preset = TUNING_PRESETS.find(p => p.name === tuningPreset);
  const ratios = preset?.ratios ?? [1, 4, 10];
  const targetFrequencies = calculateTargetFrequencies(ratios, fundamentalFrequency);

  // Start listening to microphone
  const startListening = useCallback(async () => {
    try {
      setError(null);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      streamRef.current = stream;

      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = smoothing;
      analyser.minDecibels = minDecibels;
      analyser.maxDecibels = maxDecibels;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      setAudioContext(ctx);
      setAnalyserNode(analyser);
      setIsListening(true);

      console.log('Tuner started:', {
        sampleRate: ctx.sampleRate,
        fftSize: analyser.fftSize,
        frequencyBinCount: analyser.frequencyBinCount
      });
    } catch (err) {
      console.error('Failed to access microphone:', err);
      setError('Failed to access microphone. Please ensure microphone permissions are granted.');
    }
  }, [fftSize, smoothing, minDecibels, maxDecibels]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContext) {
      audioContext.close();
      setAudioContext(null);
    }

    setAnalyserNode(null);
    setIsListening(false);
  }, [audioContext]);

  // Update analyser settings when they change (while listening)
  useEffect(() => {
    if (analyserNode) {
      analyserNode.smoothingTimeConstant = smoothing;
      analyserNode.minDecibels = minDecibels;
      analyserNode.maxDecibels = maxDecibels;
    }
  }, [analyserNode, smoothing, minDecibels, maxDecibels]);

  // Restart audio when fftSize changes while listening
  useEffect(() => {
    if (isListening && audioContext) {
      // Stop current and restart with new fftSize
      stopListening();
      // Small delay to ensure cleanup completes
      const timer = setTimeout(() => {
        startListening();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [fftSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContext) {
        audioContext.close();
      }
    };
  }, []);

  return (
    <div className="tuner-tab">
      {/* Controls */}
      <div className="tuner-controls panel">
        <div className="tuner-controls-row">
          <div className="form-group">
            <label className="form-label" htmlFor="tuner-note">Note</label>
            <div className="note-input-container">
              <input
                ref={noteInputRef}
                id="tuner-note"
                type="text"
                className="form-input note-input"
                value={noteInput}
                onChange={e => handleNoteInputChange(e.target.value)}
                onFocus={() => setShowNoteSuggestions(true)}
                onBlur={() => setTimeout(() => setShowNoteSuggestions(false), 150)}
                onKeyDown={handleNoteInputKeyDown}
                placeholder="F4"
                aria-label="Note name"
              />
              {showNoteSuggestions && filteredNotes.length > 0 && (
                <div className="note-suggestions">
                  {filteredNotes.map((n, idx) => (
                    <div
                      key={n.note}
                      className={`note-suggestion ${idx === selectedSuggestionIndex ? 'selected' : ''}`}
                      onMouseDown={() => handleNoteSelect(n.note, n.freq)}
                    >
                      <span className="note-name">{n.note}</span>
                      <span className="note-freq">{n.freq} Hz</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="tuner-fundamental">Frequency (f1)</label>
            <div className="input-unit">
              <input
                id="tuner-fundamental"
                type="number"
                className="form-input"
                value={fundamentalFrequency}
                onChange={(e) => onFundamentalChange(parseFloat(e.target.value) || 0)}
                min={20}
                max={2000}
                step={0.1}
                aria-label="Fundamental frequency in Hz"
              />
              <span>Hz</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="tuner-preset">Tuning Preset</label>
            <select
              id="tuner-preset"
              className="form-select"
              value={tuningPreset}
              onChange={(e) => onTuningPresetChange(e.target.value)}
              aria-label="Tuning preset"
            >
              {TUNING_PRESETS.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name} - {p.instrument}
                </option>
              ))}
            </select>
          </div>

          <div className="tuner-button-group">
            {!isListening ? (
              <button type="button" className="btn btn-primary" onClick={startListening}>
                Start Tuner
              </button>
            ) : (
              <button type="button" className="btn btn-danger" onClick={stopListening}>
                Stop Tuner
              </button>
            )}
          </div>

          {isListening && (
            <div className="tuner-status">
              <span className="tuner-status-indicator"></span>
              Listening...
            </div>
          )}
        </div>

        {/* FFT Settings Row */}
        <div className="tuner-controls-row tuner-fft-controls">
          <div className="form-group">
            <label className="form-label" htmlFor="tuner-fft-size">
              FFT Size
            </label>
            <select
              id="tuner-fft-size"
              className="form-select"
              value={fftSize}
              onChange={(e) => setFftSize(Number(e.target.value))}
              aria-label="FFT size for frequency analysis"
            >
              {FFT_SIZE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="tuner-smoothing">
              Smoothing: {smoothing.toFixed(2)}
            </label>
            <input
              id="tuner-smoothing"
              type="range"
              className="form-range"
              value={smoothing}
              onChange={(e) => setSmoothing(parseFloat(e.target.value))}
              min={0}
              max={0.99}
              step={0.01}
              aria-label="Smoothing time constant"
            />
            <div className="form-range-labels">
              <span>Responsive</span>
              <span>Smooth</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="tuner-min-db">
              Sensitivity: {minDecibels} dB
            </label>
            <input
              id="tuner-min-db"
              type="range"
              className="form-range"
              value={minDecibels}
              onChange={(e) => setMinDecibels(parseInt(e.target.value))}
              min={-120}
              max={-40}
              step={5}
              aria-label="Minimum decibels threshold"
            />
            <div className="form-range-labels">
              <span>Very Sensitive</span>
              <span>Less Sensitive</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="tuner-max-db">
              Ceiling: {maxDecibels} dB
            </label>
            <input
              id="tuner-max-db"
              type="range"
              className="form-range"
              value={maxDecibels}
              onChange={(e) => setMaxDecibels(parseInt(e.target.value))}
              min={-30}
              max={0}
              step={5}
              aria-label="Maximum decibels ceiling"
            />
            <div className="form-range-labels">
              <span>Quieter</span>
              <span>Louder</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="tuner-window-cents">
              Window: ±{windowCents}¢
            </label>
            <input
              id="tuner-window-cents"
              type="range"
              className="form-range"
              value={windowCents}
              onChange={(e) => setWindowCents(parseInt(e.target.value))}
              min={25}
              max={400}
              step={25}
              aria-label="Frequency window width in cents"
            />
            <div className="form-range-labels">
              <span>Narrow</span>
              <span>Wide</span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="tuner-display-mode">
              Display
            </label>
            <select
              id="tuner-display-mode"
              className="form-select"
              value={displayMode}
              onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}
              aria-label="Display mode for spectrum"
            >
              <option value="peaks">Peaks (auto-gain)</option>
              <option value="log">Logarithmic</option>
              <option value="linear">Linear</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="tuner-error">
            {error}
          </div>
        )}
      </div>

      {/* Frequency Windows */}
      <div className="tuner-windows">
        {targetFrequencies.map((freq, index) => (
          <FrequencyWindow
            key={index}
            targetFrequency={freq}
            label={`f${index + 1} (${ratios[index]}x)`}
            analyserNode={analyserNode}
            sampleRate={audioContext?.sampleRate ?? 44100}
            isListening={isListening}
            windowCents={windowCents}
            minDecibels={minDecibels}
            maxDecibels={maxDecibels}
            displayMode={displayMode}
          />
        ))}
      </div>
    </div>
  );
}
