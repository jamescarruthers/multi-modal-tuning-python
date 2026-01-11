import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { encodeGenes, formatGeneCode } from '../optimization/geneCodec';

interface GenerationEntry {
  generation: number;
  fitness: number;
  errorsInCents: number[];
  computedFrequencies: number[];
  genes: number[];
}

interface GenerationLogProps {
  entries: GenerationEntry[];
  targetFrequencies: number[];
  selectedGeneration: number | null;
  onSelectGeneration: (generation: number | null) => void;
}

type SortKey = 'generation' | 'fitness' | `error${number}`;
type SortDirection = 'asc' | 'desc';

export function GenerationLog({
  entries,
  targetFrequencies,
  selectedGeneration,
  onSelectGeneration
}: GenerationLogProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('generation');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [copiedGeneration, setCopiedGeneration] = useState<number | null>(null);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const logContentRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const container = logContentRef.current;
    if (!container) return;

    // Check if scrolled to bottom (with small tolerance)
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 20;
    setIsUserScrolled(!isAtBottom);
  }, []);

  // Handle copying gene code
  const handleCopyGeneCode = async (e: React.MouseEvent, genes: number[], generation: number) => {
    e.stopPropagation(); // Prevent row selection
    const geneCode = encodeGenes(genes);
    try {
      await navigator.clipboard.writeText(geneCode);
      setCopiedGeneration(generation);
      setTimeout(() => setCopiedGeneration(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Sort entries based on current sort key and direction
  const sortedEntries = useMemo(() => {
    const sorted = [...entries].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      if (sortKey === 'generation') {
        aVal = a.generation;
        bVal = b.generation;
      } else if (sortKey === 'fitness') {
        aVal = a.fitness;
        bVal = b.fitness;
      } else {
        // error0, error1, etc.
        const idx = parseInt(sortKey.replace('error', ''));
        aVal = Math.abs(a.errorsInCents[idx] ?? 0);
        bVal = Math.abs(b.errorsInCents[idx] ?? 0);
      }

      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [entries, sortKey, sortDirection]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      // Toggle direction if same key
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      // New key, default to ascending (except fitness defaults to asc = best first)
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const getSortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  // Auto-scroll to bottom when new entries arrive, but only if user hasn't scrolled up
  useEffect(() => {
    if (isExpanded && logEndRef.current && sortKey === 'generation' && sortDirection === 'asc' && !isUserScrolled) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length, isExpanded, sortKey, sortDirection, isUserScrolled]);

  // Reset scroll tracking when log is collapsed/expanded or sort changes
  useEffect(() => {
    setIsUserScrolled(false);
  }, [isExpanded, sortKey, sortDirection]);

  if (entries.length === 0) {
    return null;
  }

  const handleRowClick = (generation: number) => {
    if (selectedGeneration === generation) {
      onSelectGeneration(null); // Deselect if already selected
    } else {
      onSelectGeneration(generation);
    }
  };

  return (
    <div className="panel generation-log">
      <button
        className="log-header"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="log-title">
          Generation Log ({entries.length})
          {selectedGeneration !== null && (
            <span className="log-selected-badge">
              Viewing Gen {selectedGeneration}
            </span>
          )}
        </span>
        <span className={`log-chevron ${isExpanded ? 'expanded' : ''}`}>
          ▶
        </span>
      </button>

      {isExpanded && (
        <div className="log-content" ref={logContentRef} onScroll={handleScroll}>
          <table className="log-table">
            <thead>
              <tr>
                <th
                  className="sortable"
                  onClick={() => handleSort('generation')}
                >
                  Gen{getSortIndicator('generation')}
                </th>
                <th
                  className="sortable"
                  onClick={() => handleSort('fitness')}
                >
                  Fitness{getSortIndicator('fitness')}
                </th>
                {targetFrequencies.map((_, i) => (
                  <th
                    key={i}
                    className="sortable"
                    onClick={() => handleSort(`error${i}`)}
                  >
                    f{i + 1} err{getSortIndicator(`error${i}`)}
                  </th>
                ))}
                <th className="gene-code-header">Gene Code</th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <tr
                  key={entry.generation}
                  className={`log-row ${selectedGeneration === entry.generation ? 'selected' : ''}`}
                  onClick={() => handleRowClick(entry.generation)}
                >
                  <td className="gen-num">{entry.generation}</td>
                  <td className="fitness">{entry.fitness.toFixed(4)}%</td>
                  {entry.errorsInCents.map((err, i) => (
                    <td
                      key={i}
                      className={`error-cell ${getErrorClass(err)}`}
                    >
                      {err >= 0 ? '+' : ''}{err.toFixed(1)}¢
                    </td>
                  ))}
                  <td className="gene-code-cell">
                    <button
                      type="button"
                      className="copy-gene-btn"
                      onClick={(e) => handleCopyGeneCode(e, entry.genes, entry.generation)}
                      title="Copy gene code to clipboard"
                    >
                      {copiedGeneration === entry.generation ? 'Copied!' : 'Copy'}
                    </button>
                  </td>
                </tr>
              ))}
              {selectedGeneration !== null && sortedEntries.find(e => e.generation === selectedGeneration) && (
                <tr className="gene-code-detail-row">
                  <td colSpan={3 + targetFrequencies.length}>
                    <div className="gene-code-detail">
                      <span className="gene-code-label">Gene Code (Gen {selectedGeneration}):</span>
                      <code className="gene-code-value">
                        {formatGeneCode(encodeGenes(sortedEntries.find(e => e.generation === selectedGeneration)!.genes))}
                      </code>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}

function getErrorClass(errorCents: number): string {
  const absError = Math.abs(errorCents);
  if (absError <= 5) return 'error-excellent';
  if (absError <= 15) return 'error-good';
  if (absError <= 50) return 'error-ok';
  return 'error-bad';
}

export type { GenerationEntry };
