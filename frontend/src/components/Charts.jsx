// Dependency-free SVG charts (no chart library to install).

/**
 * Grouped line chart: latency (ms) vs depth, one line per series.
 * series: [{ label, color, points: [{ x: depthLabel, y: ms }] }]
 * All series must share the same x labels (in order).
 */
export function LineChart({ series, xLabels, yUnit = 'ms', height = 280 }) {
  const W = 720;
  const H = height;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 48;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const yMax = Math.max(...allY, 0.001);
  const n = xLabels.length;

  const xFor = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v) => padT + plotH - (v / yMax) * plotH;

  // 4 horizontal gridlines
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {/* gridlines + y labels */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL}
            y1={yFor(t)}
            x2={W - padR}
            y2={yFor(t)}
            stroke="#262626"
            strokeWidth="1"
          />
          <text x={padL - 8} y={yFor(t) + 4} textAnchor="end" fontSize="11" fill="#737373">
            {formatMs(t)}
          </text>
        </g>
      ))}

      {/* x labels */}
      {xLabels.map((lbl, i) => (
        <text key={i} x={xFor(i)} y={H - padB + 20} textAnchor="middle" fontSize="11" fill="#a3a3a3">
          {lbl}
        </text>
      ))}
      <text x={padL} y={H - 6} fontSize="11" fill="#737373">
        depth (rows scanned past) — {yUnit}, lower is better
      </text>

      {/* series */}
      {series.map((s) => (
        <g key={s.label}>
          <polyline
            fill="none"
            stroke={s.color}
            strokeWidth="2.5"
            points={s.points.map((p, i) => `${xFor(i)},${yFor(p.y)}`).join(' ')}
          />
          {s.points.map((p, i) => (
            <g key={i}>
              <circle cx={xFor(i)} cy={yFor(p.y)} r="3.5" fill={s.color} />
              <text
                x={xFor(i)}
                y={yFor(p.y) - 8}
                textAnchor="middle"
                fontSize="10"
                fill={s.color}
              >
                {formatMs(p.y)}
              </text>
            </g>
          ))}
        </g>
      ))}
    </svg>
  );
}

/** Tiny inline sparkline for a stream of recent values. */
export function Sparkline({ values, color = '#34d399', width = 120, height = 28 }) {
  if (!values.length) return <svg width={width} height={height} />;
  const max = Math.max(...values, 0.001);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const stepX = width / Math.max(values.length - 1, 1);
  const pts = values
    .map((v, i) => `${i * stepX},${height - ((v - min) / span) * (height - 4) - 2}`)
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

function formatMs(n) {
  if (n === 0) return '0';
  if (n < 1) return n.toFixed(2);
  if (n < 100) return n.toFixed(1);
  return Math.round(n).toString();
}
