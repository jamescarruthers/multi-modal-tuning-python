import { useOptimizationStore } from '../../stores/optimizationStore';
import { NumberInput } from './NumberInput';

export function DimensionInputs() {
  const { barDimensions, setBarDimensions } = useOptimizationStore();

  // Convert m to mm for display
  const toMm = (m: number) => Math.round(m * 1000 * 10) / 10;
  const toM = (mm: number) => mm / 1000;

  return (
    <div className="config-section">
      <h4>Bar Dimensions (mm)</h4>

      <div className="input-row">
        <label htmlFor="length">Length</label>
        <NumberInput
          id="length"
          value={toMm(barDimensions.L)}
          onChange={(val) => val !== undefined && setBarDimensions({ L: toM(val) })}
          min={50}
          max={500}
        />
      </div>

      <div className="input-row">
        <label htmlFor="width">Width</label>
        <NumberInput
          id="width"
          value={toMm(barDimensions.b)}
          onChange={(val) => val !== undefined && setBarDimensions({ b: toM(val) })}
          min={10}
          max={100}
        />
      </div>

      <div className="input-row">
        <label htmlFor="height">Height</label>
        <NumberInput
          id="height"
          value={toMm(barDimensions.h0)}
          onChange={(val) => val !== undefined && setBarDimensions({ h0: toM(val) })}
          min={5}
          max={50}
        />
      </div>

      <div className="input-row">
        <label htmlFor="minHeight">Min Height</label>
        <NumberInput
          id="minHeight"
          value={barDimensions.hMin ? toMm(barDimensions.hMin) : undefined}
          onChange={(val) => setBarDimensions({ hMin: val ? toM(val) : undefined })}
          placeholder={`Auto (${toMm(barDimensions.h0 * 0.1)})`}
          min={1}
          max={toMm(barDimensions.h0) - 1}
        />
      </div>
    </div>
  );
}
