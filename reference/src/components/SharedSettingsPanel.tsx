/**
 * Shared Settings Panel Component
 *
 * Contains settings shared between Single Bar Optimizer and Bar Range Finder:
 * - Bar cross-section dimensions (width, thickness)
 * - Material selection
 * - Simulation settings (FEM resolution)
 * - Cut constraints (search space)
 * - Fitness settings (how solutions are scored)
 * - Evolution settings (how search is conducted)
 *
 * Mode-specific settings (bar length, frequency, note range) are handled by parent.
 */

import { MATERIALS, getMaterialsByCategory } from '../data/materials';
import { isValidGeneCode } from '../optimization/geneCodec';

export interface OptimizationSettings {
  tuningPreset: string;
  numCuts: number;
  penaltyType: 'volume' | 'roughness' | 'none';
  penaltyWeight: number;
  populationSize: number;
  maxGenerations: number;
  targetError: number;
  f1Priority: number;
  numElements: number;
  minCutWidth: number;
  maxCutWidth: number;
  minCutDepth: number;
  maxCutDepth: number;
  maxLengthTrim: number;
  maxLengthExtend: number;
  maxCores: number;
}

interface SharedSettingsPanelProps {
  // Bar cross-section (shared across modes)
  barWidth: number;
  barThickness: number;
  onBarWidthChange: (value: number) => void;
  onBarThicknessChange: (value: number) => void;

  // Material
  selectedMaterial: string;
  onMaterialChange: (key: string) => void;

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

  // Reference length for slider calculations (max bar length in current context)
  referenceLength: number;

  // Optional: show seed gene input (only for single bar mode)
  showSeedInput?: boolean;

  // Mode: affects which settings are enabled
  // 'optimizer' = all settings active
  // 'rangeFinder' = only bar dimensions, material, and simulation active (optimization settings dimmed)
  // 'tuner' = settings not shown (sidebar hidden in tuner mode)
  mode?: 'optimizer' | 'rangeFinder' | 'tuner';

  // Disabled: when true, all settings are disabled (e.g., during batch optimization)
  disabled?: boolean;
}

export function SharedSettingsPanel(props: SharedSettingsPanelProps) {
  const { metals, woods } = getMaterialsByCategory();
  const material = MATERIALS[props.selectedMaterial];

  // All controls disabled when running
  const isDisabled = props.disabled ?? false;

  // In rangeFinder mode, optimization-specific settings are disabled
  const isOptimizationDisabled = props.mode === 'rangeFinder' || isDisabled;

  return (
    <>
      {/* Bar Cross-Section */}
      <div className={`panel ${isDisabled ? 'panel-disabled' : ''}`}>
        <h3 className="panel-title">Bar Dimensions</h3>
        {isDisabled && (
          <div className="panel-disabled-hint">Locked during optimization</div>
        )}
        <div className="input-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
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
                disabled={isDisabled}
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
                disabled={isDisabled}
              />
              <span>mm</span>
            </div>
          </div>
        </div>
      </div>

      {/* Material Selection */}
      <div className={`panel ${isDisabled ? 'panel-disabled' : ''}`}>
        <h3 className="panel-title">Material</h3>
        <select
          className="form-select"
          value={props.selectedMaterial}
          onChange={e => props.onMaterialChange(e.target.value)}
          disabled={isDisabled}
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

      {/* Simulation Settings */}
      <div className={`panel ${isDisabled ? 'panel-disabled' : ''}`}>
        <h3 className="panel-title">Simulation</h3>
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
            disabled={isDisabled}
          />
          <div className="slider-hint">Higher = more accurate but slower</div>
        </div>
      </div>

      {/* Cut Constraints */}
      <div className={`panel ${isOptimizationDisabled ? 'panel-disabled' : ''}`}>
        <h3 className="panel-title">Cut Constraints</h3>
        {isOptimizationDisabled && (
          <div className="panel-disabled-hint">Used during optimization only</div>
        )}

        <div className="form-group">
          <label className="form-label">Number of Cuts</label>
          <input
            type="number"
            className="form-input"
            min={1}
            max={20}
            value={props.numCuts}
            disabled={isOptimizationDisabled}
            onChange={e => {
              const val = parseInt(e.target.value);
              if (!isNaN(val) && val >= 1) {
                props.onNumCutsChange(val);
              }
            }}
          />
        </div>

        <div className="settings-subsection">
          <div className="subsection-label">Width</div>
          <div className="slider-group">
            <div className="slider-header">
              <span className="slider-label">Min</span>
              <span className="slider-value">{props.minCutWidth} mm</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0.5}
              max={20}
              step={0.5}
              value={props.minCutWidth}
              disabled={isOptimizationDisabled}
              onChange={e => props.onMinCutWidthChange(parseFloat(e.target.value))}
            />
          </div>

          <div className="slider-group">
            <div className="slider-header">
              <span className="slider-label">Max</span>
              <span className="slider-value">{props.maxCutWidth === 0 ? 'No limit' : `${props.maxCutWidth} mm`}</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={props.referenceLength / 2}
              step={5}
              value={props.maxCutWidth}
              disabled={isOptimizationDisabled}
              onChange={e => props.onMaxCutWidthChange(parseFloat(e.target.value))}
            />
          </div>
        </div>

        <div className="settings-subsection">
          <div className="subsection-label">Depth</div>
          <div className="slider-group">
            <div className="slider-header">
              <span className="slider-label">Min</span>
              <span className="slider-value">{props.minCutDepth === 0 ? 'No limit' : `${props.minCutDepth} mm`}</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={props.barThickness * 0.9}
              step={0.5}
              value={props.minCutDepth}
              disabled={isOptimizationDisabled}
              onChange={e => props.onMinCutDepthChange(parseFloat(e.target.value))}
            />
          </div>

          <div className="slider-group">
            <div className="slider-header">
              <span className="slider-label">Max</span>
              <span className="slider-value">{props.maxCutDepth === 0 ? 'No limit' : `${props.maxCutDepth} mm`}</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={props.barThickness * 0.9}
              step={0.5}
              value={props.maxCutDepth}
              disabled={isOptimizationDisabled}
              onChange={e => props.onMaxCutDepthChange(parseFloat(e.target.value))}
            />
          </div>
        </div>

        <div className="settings-subsection">
          <div className="subsection-label">Length Adjustment</div>
          <div className="slider-group">
            <div className="slider-header">
              <span className="slider-label">Max Trim</span>
              <span className="slider-value">{props.maxLengthTrim === 0 ? 'Disabled' : `${props.maxLengthTrim} mm`}</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={props.referenceLength * 0.2}
              step={1}
              value={props.maxLengthTrim}
              disabled={isOptimizationDisabled}
              onChange={e => props.onMaxLengthTrimChange(parseFloat(e.target.value))}
            />
          </div>

          <div className="slider-group">
            <div className="slider-header">
              <span className="slider-label">Max Extend</span>
              <span className="slider-value">{props.maxLengthExtend === 0 ? 'Disabled' : `${props.maxLengthExtend} mm`}</span>
            </div>
            <input
              type="range"
              className="slider"
              min={0}
              max={props.referenceLength * 0.2}
              step={1}
              value={props.maxLengthExtend}
              disabled={isOptimizationDisabled}
              onChange={e => props.onMaxLengthExtendChange(parseFloat(e.target.value))}
            />
          </div>
        </div>
      </div>

      {/* Fitness Settings */}
      <div className={`panel ${isOptimizationDisabled ? 'panel-disabled' : ''}`}>
        <h3 className="panel-title">Fitness</h3>
        {isOptimizationDisabled && (
          <div className="panel-disabled-hint">Used during optimization only</div>
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
            disabled={isOptimizationDisabled}
            onChange={e => props.onF1PriorityChange(parseFloat(e.target.value))}
          />
          <div className="slider-hint">Weight fundamental frequency errors higher</div>
        </div>

        <div className="form-group">
          <label className="form-label">Penalty Type</label>
          <select
            className="form-select"
            value={props.penaltyType}
            disabled={isOptimizationDisabled}
            onChange={e => props.onPenaltyTypeChange(e.target.value as 'volume' | 'roughness' | 'none')}
          >
            <option value="none">None</option>
            <option value="volume">Volume (minimize removal)</option>
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
              disabled={isOptimizationDisabled}
              onChange={e => props.onPenaltyWeightChange(parseFloat(e.target.value))}
            />
          </div>
        )}
      </div>

      {/* Evolution Settings */}
      <div className={`panel ${isOptimizationDisabled ? 'panel-disabled' : ''}`}>
        <h3 className="panel-title">Evolution</h3>
        {isOptimizationDisabled && (
          <div className="panel-disabled-hint">Used during optimization only</div>
        )}

        <div className="input-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="form-group">
            <label className="form-label">Population</label>
            <input
              type="number"
              className="form-input"
              value={props.populationSize}
              disabled={isOptimizationDisabled}
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
              disabled={isOptimizationDisabled}
              onChange={e => props.onMaxGenerationsChange(parseInt(e.target.value) || 50)}
              min={10}
              max={500}
            />
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
            disabled={isOptimizationDisabled}
            onChange={e => props.onTargetErrorChange(parseFloat(e.target.value))}
          />
          <div className="slider-hint">Stop early if error below this threshold</div>
        </div>

        <div className="slider-group">
          <div className="slider-header">
            <span className="slider-label">CPU Cores</span>
            <span className="slider-value">{props.maxCores === 0 ? 'Auto' : props.maxCores}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={0}
            max={navigator.hardwareConcurrency || 8}
            step={1}
            value={props.maxCores}
            disabled={isOptimizationDisabled}
            onChange={e => props.onMaxCoresChange(parseInt(e.target.value))}
          />
        </div>

        {props.showSeedInput && (
          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label">Seed Gene Code</label>
            <input
              type="text"
              className={`form-input seed-input ${props.seedGeneCode && !isValidGeneCode(props.seedGeneCode) ? 'input-error' : ''}`}
              value={props.seedGeneCode}
              disabled={isOptimizationDisabled}
              onChange={e => props.onSeedGeneCodeChange(e.target.value)}
              placeholder="Paste gene code to resume"
            />
            <div className="input-hint">
              {props.seedGeneCode
                ? isValidGeneCode(props.seedGeneCode)
                  ? 'Valid gene code'
                  : 'Invalid format'
                : 'Optional: continue from previous result'}
            </div>
          </div>
        )}
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
    </>
  );
}
