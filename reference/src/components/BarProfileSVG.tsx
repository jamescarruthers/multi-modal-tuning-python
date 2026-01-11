import { useMemo } from 'react';
import { Cut } from '../types';

interface BarProfileSVGProps {
  length: number;           // mm (original bar length)
  thickness: number;        // mm (h0)
  cuts: Cut[];              // cuts with lambda and h in meters
  showDimensions: boolean;
  effectiveLength?: number; // mm (length after trim, same as length if no trim)
}

export function BarProfileSVG({ length, thickness, cuts, showDimensions, effectiveLength }: BarProfileSVGProps) {
  // Validate inputs to prevent NaN in SVG paths
  const safeLength = length > 0 && !isNaN(length) ? length : 100;
  const safeThickness = thickness > 0 && !isNaN(thickness) ? thickness : 10;
  const safeEffectiveLength = effectiveLength && !isNaN(effectiveLength) ? effectiveLength : safeLength;

  // Calculate length adjustment from each end
  // If effectiveLength < length: trimming (positive adjustment), show in red
  // If effectiveLength > length: extension (negative adjustment), show in green
  const lengthDiff = safeEffectiveLength - safeLength;
  const adjustFromEachEnd = Math.abs(lengthDiff) / 2;
  const hasTrim = lengthDiff < -0.01;  // Bar shortened (with small tolerance)
  const hasExtend = lengthDiff > 0.01;  // Bar lengthened (with small tolerance)
  const hasAdjustment = hasTrim || hasExtend;

  // Convert cuts from meters to mm for display, filtering out invalid values
  const cutsInMm = cuts
    .filter(cut => typeof cut.lambda === 'number' && typeof cut.h === 'number' &&
                   !isNaN(cut.lambda) && !isNaN(cut.h))
    .map(cut => ({
      lambda: cut.lambda * 1000,
      h: cut.h * 1000
    }));

  // Sort cuts by lambda descending (largest first = outermost cut)
  const sortedCuts = [...cutsInMm].sort((a, b) => b.lambda - a.lambda);

  // SVG dimensions - extra height for dimension lines below
  const svgWidth = 800;
  const padding = { top: 40, right: 100, bottom: 130, left: 90 };

  const plotWidth = svgWidth - padding.left - padding.right;

  // Use true aspect ratio - same scale for x and y
  const xScale = plotWidth / safeLength;
  // Bar height in pixels = thickness * xScale (same scale as length)
  // But ensure a minimum visible height and maximum reasonable height
  const trueBarHeight = safeThickness * xScale;
  const minBarHeight = 30;  // Minimum pixels for very thin bars
  const maxBarHeight = 150; // Maximum pixels to prevent overly tall display
  const barHeight = Math.max(minBarHeight, Math.min(maxBarHeight, trueBarHeight));

  // Calculate total SVG height based on bar height
  const svgHeight = padding.top + barHeight + padding.bottom;

  // Scale factors - use same scale for proper aspect ratio
  const yScale = barHeight / safeThickness;

  // Y coordinates: top of bar at barTop, original bottom at barBottom
  const barTop = padding.top;
  const barBottom = padding.top + barHeight;

  // Center X in SVG coordinates
  const centerXSvg = padding.left + (safeLength / 2) * xScale;

  // Generate the bar outline path (with undercuts)
  const barOutlinePath = useMemo(() => {
    const centerX = safeLength / 2;

    // Compute height at a given x position
    // The bar has undercuts on the bottom - cuts define regions from center
    // For nested cuts, we need to find the INNERMOST cut that contains this point
    // (smallest lambda that still includes this position)
    const getHeightAt = (x: number): number => {
      const distFromCenter = Math.abs(x - centerX);

      // Find all cuts that contain this point
      const containingCuts = sortedCuts.filter(cut =>
        cut.lambda > 0 && distFromCenter <= cut.lambda
      );

      if (containingCuts.length === 0) {
        return safeThickness; // Outside all cuts = original thickness
      }

      // Return the height of the innermost (smallest lambda) containing cut
      // sortedCuts is descending by lambda, so the last one in containingCuts is innermost
      return containingCuts[containingCuts.length - 1].h;
    };

    // Build list of all x positions where height changes
    // These are the cut boundaries (symmetric around center)
    const xPositions: number[] = [0];
    for (const cut of sortedCuts) {
      if (cut.lambda > 0) {
        const leftBoundary = centerX - cut.lambda;
        const rightBoundary = centerX + cut.lambda;
        // Only add boundaries that are within the bar
        if (leftBoundary > 0) {
          xPositions.push(leftBoundary);
        }
        if (rightBoundary < safeLength) {
          xPositions.push(rightBoundary);
        }
      }
    }
    xPositions.push(safeLength);

    // Sort and remove duplicates
    const sortedX = [...new Set(xPositions)].sort((a, b) => a - b);

    // Build bottom profile as array of {x, y} points with step transitions
    const bottomPoints: { x: number; y: number }[] = [];

    for (let i = 0; i < sortedX.length; i++) {
      const xPos = sortedX[i];
      const svgX = padding.left + xPos * xScale;

      // Get height just to the right of this position (inside the region)
      const hRight = getHeightAt(xPos + 0.001);
      const yRight = barTop + hRight * yScale;

      // Get height just to the left of this position
      const hLeft = xPos > 0 ? getHeightAt(xPos - 0.001) : hRight;
      const yLeft = barTop + hLeft * yScale;

      // If there's a height change at this boundary, we need two points
      if (i > 0 && Math.abs(yLeft - yRight) > 0.5) {
        // Add point at previous height (coming from left)
        bottomPoints.push({ x: svgX, y: yLeft });
        // Add point at new height (step down/up)
        bottomPoints.push({ x: svgX, y: yRight });
      } else {
        bottomPoints.push({ x: svgX, y: yRight });
      }
    }

    // Build the SVG path
    // Start at top-left, go across top, down right edge, trace bottom left, up left edge
    let path = `M ${padding.left} ${barTop}`;
    path += ` L ${padding.left + plotWidth} ${barTop}`;

    // Down right edge to the rightmost bottom point
    const lastPoint = bottomPoints[bottomPoints.length - 1];
    path += ` L ${padding.left + plotWidth} ${lastPoint.y}`;

    // Trace bottom profile from right to left
    for (let i = bottomPoints.length - 1; i >= 0; i--) {
      path += ` L ${bottomPoints[i].x} ${bottomPoints[i].y}`;
    }

    // Close left edge: from first bottom point up to top-left
    const firstPoint = bottomPoints[0];
    path += ` L ${padding.left} ${firstPoint.y}`;
    path += ` L ${padding.left} ${barTop}`;
    path += ' Z';

    return path;
  }, [sortedCuts, safeLength, safeThickness, xScale, yScale, barTop, padding.left, plotWidth]);

  return (
    <div className="bar-profile-container panel">
      <h3 className="panel-title">Bar Profile (Side View)</h3>
      <svg
        className="bar-profile-svg"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background */}
        <rect
          x={padding.left}
          y={padding.top - 10}
          width={plotWidth}
          height={barHeight + 20}
          fill="#fafafa"
        />

        {/* Center line (dashed) */}
        <line
          x1={centerXSvg}
          y1={barTop - 10}
          x2={centerXSvg}
          y2={barBottom + 15}
          stroke="#bbb"
          strokeWidth="1"
          strokeDasharray="4,4"
        />

        {/* The bar shape */}
        <path
          d={barOutlinePath}
          fill="#bbdefb"
          stroke="#1976d2"
          strokeWidth="2"
        />

        {/* Trim zones - shaded areas at each end that will be removed (red) */}
        {hasTrim && (
          <>
            {/* Left trim zone */}
            <rect
              x={padding.left}
              y={barTop}
              width={adjustFromEachEnd * xScale}
              height={barHeight}
              fill="rgba(220, 38, 38, 0.2)"
              stroke="#dc2626"
              strokeWidth="1"
              strokeDasharray="4,2"
            />
            {/* Right trim zone */}
            <rect
              x={padding.left + plotWidth - adjustFromEachEnd * xScale}
              y={barTop}
              width={adjustFromEachEnd * xScale}
              height={barHeight}
              fill="rgba(220, 38, 38, 0.2)"
              stroke="#dc2626"
              strokeWidth="1"
              strokeDasharray="4,2"
            />
            {/* Trim labels */}
            <text
              x={padding.left + (adjustFromEachEnd * xScale) / 2}
              y={barTop - 5}
              textAnchor="middle"
              fontSize="9"
              fill="#dc2626"
            >
              -{adjustFromEachEnd.toFixed(1)}mm
            </text>
            <text
              x={padding.left + plotWidth - (adjustFromEachEnd * xScale) / 2}
              y={barTop - 5}
              textAnchor="middle"
              fontSize="9"
              fill="#dc2626"
            >
              -{adjustFromEachEnd.toFixed(1)}mm
            </text>
          </>
        )}

        {/* Extension zones - shaded areas at each end that will be added (green) */}
        {hasExtend && (
          <>
            {/* Left extension zone - shown outside the original bar */}
            <rect
              x={padding.left - adjustFromEachEnd * xScale}
              y={barTop}
              width={adjustFromEachEnd * xScale}
              height={barHeight}
              fill="rgba(34, 197, 94, 0.2)"
              stroke="#16a34a"
              strokeWidth="1"
              strokeDasharray="4,2"
            />
            {/* Right extension zone */}
            <rect
              x={padding.left + plotWidth}
              y={barTop}
              width={adjustFromEachEnd * xScale}
              height={barHeight}
              fill="rgba(34, 197, 94, 0.2)"
              stroke="#16a34a"
              strokeWidth="1"
              strokeDasharray="4,2"
            />
            {/* Extension labels */}
            <text
              x={padding.left - (adjustFromEachEnd * xScale) / 2}
              y={barTop - 5}
              textAnchor="middle"
              fontSize="9"
              fill="#16a34a"
            >
              +{adjustFromEachEnd.toFixed(1)}mm
            </text>
            <text
              x={padding.left + plotWidth + (adjustFromEachEnd * xScale) / 2}
              y={barTop - 5}
              textAnchor="middle"
              fontSize="9"
              fill="#16a34a"
            >
              +{adjustFromEachEnd.toFixed(1)}mm
            </text>
          </>
        )}

        {/* h₀ dimension on left side with proper arrows */}
        <g>
          {/* Horizontal ticks */}
          <line x1={padding.left - 25} y1={barTop} x2={padding.left - 10} y2={barTop} stroke="#444" strokeWidth="1" />
          <line x1={padding.left - 25} y1={barBottom} x2={padding.left - 10} y2={barBottom} stroke="#444" strokeWidth="1" />
          {/* Vertical dimension line */}
          <line x1={padding.left - 17} y1={barTop} x2={padding.left - 17} y2={barBottom} stroke="#444" strokeWidth="1" />
          {/* Arrow heads */}
          <polygon points={`${padding.left - 17},${barTop} ${padding.left - 20},${barTop + 6} ${padding.left - 14},${barTop + 6}`} fill="#444" />
          <polygon points={`${padding.left - 17},${barBottom} ${padding.left - 20},${barBottom - 6} ${padding.left - 14},${barBottom - 6}`} fill="#444" />
          {/* Label */}
          <text x={padding.left - 30} y={(barTop + barBottom) / 2} textAnchor="end" fontSize="11" fill="#333" dominantBaseline="middle">
            h₀ = {safeThickness} mm
          </text>
        </g>

        {/* Total length dimension below bar */}
        <g>
          {/* Vertical ticks */}
          <line x1={padding.left} y1={barBottom + 25} x2={padding.left} y2={barBottom + 40} stroke="#444" strokeWidth="1" />
          <line x1={padding.left + plotWidth} y1={barBottom + 25} x2={padding.left + plotWidth} y2={barBottom + 40} stroke="#444" strokeWidth="1" />
          {/* Horizontal dimension line */}
          <line x1={padding.left} y1={barBottom + 32} x2={padding.left + plotWidth} y2={barBottom + 32} stroke="#444" strokeWidth="1" />
          {/* Arrow heads */}
          <polygon points={`${padding.left},${barBottom + 32} ${padding.left + 6},${barBottom + 29} ${padding.left + 6},${barBottom + 35}`} fill="#444" />
          <polygon points={`${padding.left + plotWidth},${barBottom + 32} ${padding.left + plotWidth - 6},${barBottom + 29} ${padding.left + plotWidth - 6},${barBottom + 35}`} fill="#444" />
          {/* Label */}
          <text x={centerXSvg} y={barBottom + 48} textAnchor="middle" fontSize="11" fill="#333">
            {hasAdjustment
              ? `L = ${safeEffectiveLength.toFixed(1)} mm (original: ${safeLength} mm)`
              : `L = ${safeLength} mm`
            }
          </text>
        </g>

        {/* Center label */}
        <text x={centerXSvg} y={barBottom + 22} textAnchor="middle" fontSize="9" fill="#888">
          center
        </text>

        {/* Cut dimension lines - showing distance from left end and cut width */}
        {showDimensions && (() => {
          // Sort cuts by lambda ascending (innermost first) for nested cuts display
          const cutsByLambda = [...sortedCuts].filter(c => c.lambda > 0).sort((a, b) => a.lambda - b.lambda);

          return cutsByLambda.map((cut, i) => {
            const centerX = safeLength / 2;
            // Distance from left end to where this cut starts
            const distFromLeft = centerX - cut.lambda;
            // Total width of the cut (spans both sides of center)
            const cutWidth = cut.lambda * 2;

            const leftEdgeX = padding.left + distFromLeft * xScale;
            const rightEdgeX = padding.left + (centerX + cut.lambda) * xScale;
            const dimLineY = barBottom + 60 + i * 22;

            return (
              <g key={`cut-dim-${i}`}>
                {/* Distance from left end */}
                <line x1={padding.left} y1={dimLineY - 5} x2={padding.left} y2={dimLineY + 5} stroke="#666" strokeWidth="1" />
                <line x1={leftEdgeX} y1={dimLineY - 5} x2={leftEdgeX} y2={dimLineY + 5} stroke="#666" strokeWidth="1" />
                <line x1={padding.left} y1={dimLineY} x2={leftEdgeX} y2={dimLineY} stroke="#666" strokeWidth="1" />
                <polygon points={`${padding.left},${dimLineY} ${padding.left + 5},${dimLineY - 3} ${padding.left + 5},${dimLineY + 3}`} fill="#666" />
                <polygon points={`${leftEdgeX},${dimLineY} ${leftEdgeX - 5},${dimLineY - 3} ${leftEdgeX - 5},${dimLineY + 3}`} fill="#666" />
                <text x={(padding.left + leftEdgeX) / 2} y={dimLineY - 7} textAnchor="middle" fontSize="9" fill="#666">
                  {distFromLeft.toFixed(1)}
                </text>

                {/* Cut width (highlighted) */}
                <line x1={leftEdgeX} y1={dimLineY} x2={rightEdgeX} y2={dimLineY} stroke="#e65100" strokeWidth="2" />
                <polygon points={`${leftEdgeX},${dimLineY} ${leftEdgeX + 5},${dimLineY - 3} ${leftEdgeX + 5},${dimLineY + 3}`} fill="#e65100" />
                <polygon points={`${rightEdgeX},${dimLineY} ${rightEdgeX - 5},${dimLineY - 3} ${rightEdgeX - 5},${dimLineY + 3}`} fill="#e65100" />
                <text x={(leftEdgeX + rightEdgeX) / 2} y={dimLineY - 7} textAnchor="middle" fontSize="10" fill="#e65100" fontWeight="600">
                  {cutWidth.toFixed(1)} mm
                </text>

                {/* Cut label with depth */}
                <text x={rightEdgeX + 8} y={dimLineY + 3} fontSize="9" fill="#1565c0">
                  Cut {i + 1}: depth {(safeThickness - cut.h).toFixed(2)} mm
                </text>
              </g>
            );
          });
        })()}

        {/* Height labels on the right side for each cut - staggered to avoid overlap */}
        {showDimensions && (() => {
          // Calculate label positions, staggering if they would overlap
          const minSpacing = 16; // Minimum pixels between labels

          // Sort cuts by lambda ascending for consistent numbering with dimension lines
          const cutsByLambda = [...sortedCuts].filter(c => c.lambda > 0).sort((a, b) => a.lambda - b.lambda);

          // Get all cut heights sorted by y position (top to bottom in SVG)
          const labels = cutsByLambda
            .map((cut, i) => ({
              cut,
              index: i,
              naturalY: barTop + cut.h * yScale
            }))
            .sort((a, b) => a.naturalY - b.naturalY);

          // Adjust positions to prevent overlap
          for (let i = 1; i < labels.length; i++) {
            const prev = labels[i - 1];
            const curr = labels[i];
            if (curr.naturalY - prev.naturalY < minSpacing) {
              // Push this label down
              labels[i] = { ...curr, naturalY: prev.naturalY + minSpacing };
            }
          }

          const labelX = padding.left + plotWidth + 10;

          return labels.map(({ cut, index, naturalY }) => {
            const actualCutY = barTop + cut.h * yScale;

            return (
              <g key={`height-${index}`}>
                {/* Height indicator tick on right side at actual cut position */}
                <line x1={padding.left + plotWidth + 2} y1={actualCutY} x2={padding.left + plotWidth + 8} y2={actualCutY} stroke="#1565c0" strokeWidth="1.5" />
                {/* Leader line if label is offset */}
                {Math.abs(naturalY - actualCutY) > 2 && (
                  <line x1={padding.left + plotWidth + 8} y1={actualCutY} x2={labelX + 3} y2={naturalY} stroke="#1565c0" strokeWidth="0.5" strokeDasharray="2,2" />
                )}
                {/* Height label - show remaining thickness */}
                <text x={labelX + 5} y={naturalY} fontSize="10" fill="#1565c0" dominantBaseline="middle">
                  {cut.h.toFixed(2)} mm
                </text>
              </g>
            );
          });
        })()}

        {/* No cuts message */}
        {cuts.length === 0 && (
          <text
            x={svgWidth / 2}
            y={svgHeight / 2 - 30}
            textAnchor="middle"
            fontSize="14"
            fill="#999"
          >
            Run optimization to see bar profile
          </text>
        )}
      </svg>
    </div>
  );
}
