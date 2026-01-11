import { useState } from 'react';
import { Cut } from '../types';
import { encodeGenes, formatGeneCode } from '../optimization/geneCodec';

interface ResultsSummaryProps {
  tuningError: number;
  maxErrorCents: number;
  volumePercent: number;
  generations: number;
  cuts: Cut[];
  lengthTrim?: number;        // m, length adjustment (positive = trim, negative = extend)
  effectiveLength?: number;   // m, total effective length after adjustment
  genes?: number[];           // Best individual's genes for encoding
}

export function ResultsSummary({
  tuningError,
  maxErrorCents,
  volumePercent,
  generations,
  cuts,
  lengthTrim,
  effectiveLength,
  genes
}: ResultsSummaryProps) {
  const [copied, setCopied] = useState(false);

  const geneCode = genes ? formatGeneCode(encodeGenes(genes)) : null;

  const handleCopyGeneCode = async () => {
    if (geneCode) {
      try {
        await navigator.clipboard.writeText(geneCode.replace(/-/g, ''));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    }
  };

  const getErrorClass = (cents: number): string => {
    if (cents <= 2) return 'success';
    if (cents <= 10) return 'warning';
    return 'error';
  };

  // Sort cuts by lambda descending
  const sortedCuts = [...cuts].sort((a, b) => b.lambda - a.lambda);

  return (
    <div className="panel">
      <h3 className="panel-title">Results</h3>

      <div className="results-summary">
        <div className={`result-card ${getErrorClass(maxErrorCents)}`}>
          <div className="label">Max Error</div>
          <div className="value">{maxErrorCents.toFixed(1)} ¢</div>
        </div>
        <div className="result-card">
          <div className="label">Avg Error</div>
          <div className="value">{tuningError.toFixed(4)}%</div>
        </div>
        <div className="result-card">
          <div className="label">Volume Removed</div>
          <div className="value">{volumePercent.toFixed(1)}%</div>
        </div>
        <div className="result-card">
          <div className="label">Generations</div>
          <div className="value">{generations}</div>
        </div>
      </div>

      {lengthTrim !== undefined && lengthTrim !== 0 && effectiveLength && (
        <div className="cut-dimensions" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            Length Optimization:
          </div>
          <div className="cut-item">
            <span className="cut-label">{lengthTrim > 0 ? 'Length Trim' : 'Length Extend'}</span>
            <span className="cut-values">
              {Math.abs(lengthTrim * 1000).toFixed(1)} mm {lengthTrim > 0 ? 'removed from' : 'added to'} each end
            </span>
          </div>
          <div className="cut-item">
            <span className="cut-label">Effective Length</span>
            <span className="cut-values">
              {(effectiveLength * 1000).toFixed(1)} mm (was {((effectiveLength + 2 * lengthTrim) * 1000).toFixed(1)} mm)
            </span>
          </div>
        </div>
      )}

      <div className="cut-dimensions">
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, marginTop: lengthTrim !== undefined && lengthTrim !== 0 ? 8 : 16 }}>
          Cut Dimensions:
        </div>
        {sortedCuts.map((cut, i) => {
          // Cut width is 2 * lambda (symmetric about center)
          const cutWidth = cut.lambda * 2 * 1000;
          // Spacing to next inner cut (if exists)
          const nextCut = sortedCuts[i + 1];
          const spacing = nextCut ? (cut.lambda - nextCut.lambda) * 1000 : null;

          return (
            <div key={i} className="cut-item">
              <span className="cut-label">Cut {i + 1}</span>
              <span className="cut-values">
                width = {cutWidth.toFixed(1)} mm, h = {(cut.h * 1000).toFixed(2)} mm
                {spacing !== null && (
                  <span className="cut-gap">(gap: {spacing.toFixed(1)} mm)</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {geneCode && (
        <div className="gene-code-container">
          <div className="gene-code-label">Gene Code</div>
          <div
            className="gene-code-value"
            onClick={handleCopyGeneCode}
            title="Click to copy"
          >
            {geneCode}
          </div>
          <div className="gene-code-hint">
            {copied ? 'Copied!' : 'Click to copy - paste into "Seed Gene Code" to resume optimization'}
          </div>
        </div>
      )}
    </div>
  );
}
