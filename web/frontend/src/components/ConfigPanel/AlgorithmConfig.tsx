import { useState } from 'react';
import { useOptimizationStore } from '../../stores/optimizationStore';
import { NumberInput } from './NumberInput';
import type { PenaltyType } from '../../types';

export function AlgorithmConfig() {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const {
    algorithm,
    analysisMode,
    eaParams,
    surrogateParams,
    penaltyConfig,
    lengthAdjustConfig,
    numElementsY,
    numElementsZ,
    meshUpdateInterval,
    setAlgorithm,
    setAnalysisMode,
    setEAParams,
    setSurrogateParams,
    setPenaltyConfig,
    setLengthAdjustConfig,
    setNumElementsY,
    setNumElementsZ,
    setMeshUpdateInterval,
  } = useOptimizationStore();

  return (
    <div className="config-section">
      <h4>Algorithm</h4>

      <div className="input-row">
        <label htmlFor="algorithm">Optimization</label>
        <select
          id="algorithm"
          value={algorithm}
          onChange={(e) => setAlgorithm(e.target.value as 'evolutionary' | 'surrogate')}
        >
          <option value="evolutionary">Evolutionary (EA)</option>
          <option value="surrogate">Surrogate (RBF)</option>
        </select>
      </div>

      <div className="input-row">
        <label htmlFor="analysisMode">Analysis</label>
        <select
          id="analysisMode"
          value={analysisMode}
          onChange={(e) => setAnalysisMode(e.target.value as '2d' | '3d')}
        >
          <option value="2d">2D (Fast)</option>
          <option value="3d">3D (Accurate)</option>
        </select>
      </div>

      <button
        type="button"
        className="toggle-advanced"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        {showAdvanced ? 'Hide' : 'Show'} Advanced Options
      </button>

      {showAdvanced && (
        <div className="advanced-options">
          {algorithm === 'evolutionary' ? (
            <>
              <div className="input-row">
                <label htmlFor="popSize">Population Size</label>
                <NumberInput
                  id="popSize"
                  value={eaParams.population_size}
                  onChange={(val) => setEAParams({ population_size: val ?? 100 })}
                  min={10}
                  max={500}
                  integer
                />
              </div>

              <div className="input-row">
                <label htmlFor="maxGen">Max Generations</label>
                <NumberInput
                  id="maxGen"
                  value={eaParams.max_generations}
                  onChange={(val) => setEAParams({ max_generations: val ?? 200 })}
                  min={10}
                  max={2000}
                  integer
                />
              </div>

              <div className="input-row">
                <label htmlFor="targetError">Target Error (cents)</label>
                <NumberInput
                  id="targetError"
                  value={eaParams.target_error}
                  onChange={(val) => setEAParams({ target_error: val ?? 0.1 })}
                  min={0.001}
                  max={10}
                />
              </div>

              <div className="input-row">
                <label htmlFor="numElements">Elements X (length)</label>
                <NumberInput
                  id="numElements"
                  value={eaParams.num_elements}
                  onChange={(val) => setEAParams({ num_elements: val ?? 80 })}
                  min={20}
                  max={200}
                  integer
                />
              </div>

              <div className="input-row">
                <label htmlFor="mutStrength">Mutation Strength</label>
                <NumberInput
                  id="mutStrength"
                  value={eaParams.mutation_strength}
                  onChange={(val) => setEAParams({ mutation_strength: val ?? 0.12 })}
                  min={0.01}
                  max={0.5}
                />
              </div>

              <div className="input-row">
                <label htmlFor="f1Priority">F1 Priority</label>
                <NumberInput
                  id="f1Priority"
                  value={eaParams.f1_priority}
                  onChange={(val) => setEAParams({ f1_priority: val ?? 1.5 })}
                  min={1.0}
                  max={5.0}
                />
              </div>
            </>
          ) : (
            <>
              <div className="input-row">
                <label htmlFor="maxIter">Max Iterations</label>
                <NumberInput
                  id="maxIter"
                  value={surrogateParams.max_iterations}
                  onChange={(val) => setSurrogateParams({ max_iterations: val ?? 100 })}
                  min={10}
                  max={10000}
                  integer
                />
              </div>

              <div className="input-row">
                <label htmlFor="initSamples">Initial Samples</label>
                <NumberInput
                  id="initSamples"
                  value={surrogateParams.initial_samples}
                  onChange={(val) => setSurrogateParams({ initial_samples: val ?? 50 })}
                  min={10}
                  max={5000}
                  integer
                />
              </div>

              <div className="input-row">
                <label htmlFor="surTargetError">Target Error (cents)</label>
                <NumberInput
                  id="surTargetError"
                  value={surrogateParams.target_error}
                  onChange={(val) => setSurrogateParams({ target_error: val ?? 0.1 })}
                  min={0.001}
                  max={10}
                />
              </div>

              <div className="input-row">
                <label htmlFor="surF1Priority">F1 Priority</label>
                <NumberInput
                  id="surF1Priority"
                  value={surrogateParams.f1_priority}
                  onChange={(val) => setSurrogateParams({ f1_priority: val ?? 1.5 })}
                  min={1.0}
                  max={5.0}
                />
              </div>

              <div className="input-row">
                <label htmlFor="surNumElements">Elements X (length)</label>
                <NumberInput
                  id="surNumElements"
                  value={surrogateParams.num_elements}
                  onChange={(val) => setSurrogateParams({ num_elements: val ?? 80 })}
                  min={20}
                  max={200}
                  integer
                />
              </div>
            </>
          )}

          <div className="input-row">
            <label htmlFor="penaltyType">Penalty Type</label>
            <select
              id="penaltyType"
              value={penaltyConfig.penalty_type}
              onChange={(e) => {
                const newType = e.target.value as PenaltyType;
                // Set a default weight when enabling a penalty
                if (newType !== 'none' && penaltyConfig.penalty_weight === 0) {
                  setPenaltyConfig({ penalty_type: newType, penalty_weight: 0.1 });
                } else {
                  setPenaltyConfig({ penalty_type: newType });
                }
              }}
            >
              <option value="none">None</option>
              <option value="volume">Volume (minimize cuts)</option>
              <option value="roughness">Roughness (smooth profile)</option>
            </select>
          </div>

          {penaltyConfig.penalty_type !== 'none' && (
            <div className="input-row">
              <label htmlFor="penaltyWeight">Penalty Weight (alpha)</label>
              <NumberInput
                id="penaltyWeight"
                value={penaltyConfig.penalty_weight}
                onChange={(val) => setPenaltyConfig({ penalty_weight: val ?? 0.1 })}
                min={0}
                max={1}
              />
            </div>
          )}

          <div className="input-row">
            <label htmlFor="maxTrim">Max Trim (mm)</label>
            <NumberInput
              id="maxTrim"
              value={lengthAdjustConfig.max_trim * 1000}
              onChange={(val) => setLengthAdjustConfig({ max_trim: (val ?? 0) / 1000 })}
              min={0}
              max={150}
            />
          </div>

          <div className="input-row">
            <label htmlFor="maxExtend">Max Extend (mm)</label>
            <NumberInput
              id="maxExtend"
              value={lengthAdjustConfig.max_extend * 1000}
              onChange={(val) => setLengthAdjustConfig({ max_extend: (val ?? 0) / 1000 })}
              min={0}
              max={150}
            />
          </div>

          {analysisMode === '3d' && (
            <>
              <div className="input-row">
                <label htmlFor="elemY">Elements Y (width)</label>
                <NumberInput
                  id="elemY"
                  value={numElementsY}
                  onChange={(val) => setNumElementsY(val ?? 3)}
                  min={1}
                  max={10}
                  integer
                />
              </div>

              <div className="input-row">
                <label htmlFor="elemZ">Elements Z (height)</label>
                <NumberInput
                  id="elemZ"
                  value={numElementsZ}
                  onChange={(val) => setNumElementsZ(val ?? 3)}
                  min={1}
                  max={10}
                  integer
                />
              </div>
            </>
          )}

          <div className="input-row">
            <label htmlFor="meshUpdateInterval">Mesh Update Interval</label>
            <NumberInput
              id="meshUpdateInterval"
              value={meshUpdateInterval}
              onChange={(val) => setMeshUpdateInterval(val ?? 1)}
              min={1}
              max={50}
              integer
            />
          </div>
        </div>
      )}
    </div>
  );
}
