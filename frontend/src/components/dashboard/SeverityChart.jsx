import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const EASE = [0.25, 0.46, 0.45, 0.94];

const MOCK_DATA = {
  critical: 8,
  high: 34,
  medium: 67,
  low: 33,
};

const SEVERITY_CONFIG = [
  { key: 'critical', label: 'Critical', color: '#FF3B5C' },
  { key: 'high',     label: 'High',     color: '#FF6B35' },
  { key: 'medium',   label: 'Medium',   color: '#FF9500' },
  { key: 'low',      label: 'Low',      color: '#00D4FF' },
];

const CX = 100;
const CY = 100;
const R  = 60;
const STROKE_W = 26;
const GAP_PX   = 3.5; // physical gap between segments

function buildSegments(data) {
  const circ  = 2 * Math.PI * R;
  const total = SEVERITY_CONFIG.reduce((s, c) => s + (data?.[c.key] ?? 0), 0);
  if (total === 0) return { segments: [], total: 0, circ };

  let accAngle = 0;
  const segments = SEVERITY_CONFIG.map((config, i) => {
    const value = data?.[config.key] ?? 0;
    if (value === 0) return null;

    const pct      = value / total;
    const sweepDeg = pct * 360;
    const dashLen  = Math.max(pct * circ - GAP_PX, 1);
    const startAngle = accAngle;
    const midAngle   = accAngle + sweepDeg / 2;
    accAngle += sweepDeg;

    // start at top: rotate by (startAngle - 90)
    const rotDeg = startAngle - 90;

    // hover translate direction (outward from center)
    const midRad = ((midAngle - 90) * Math.PI) / 180;
    const hx = Math.cos(midRad) * 6;
    const hy = Math.sin(midRad) * 6;

    return { ...config, value, pct, dashLen, rotDeg, hx, hy, index: i };
  }).filter(Boolean);

  return { segments, total, circ };
}

function SkeletonChart() {
  return (
    <div className="bg-[#0D1117] border border-[#1C2333] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="skeleton h-4 w-36 rounded" />
        <div className="skeleton h-3 w-12 rounded" />
      </div>
      <div className="flex justify-center">
        <div className="skeleton w-[180px] h-[180px] rounded-full" />
      </div>
      <div className="space-y-2.5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="skeleton h-3 w-16 rounded" />
            <div className="skeleton h-1.5 flex-1 rounded-full" />
            <div className="skeleton h-3 w-6 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SeverityChart({ data, loading }) {
  const [hoveredKey, setHoveredKey] = useState(null);
  const safeData = data ?? MOCK_DATA;
  const { segments, total, circ } = buildSegments(safeData);
  const hovered = segments.find((s) => s.key === hoveredKey) ?? null;

  if (loading) return <SkeletonChart />;

  return (
    <div className="bg-[#0D1117] border border-[#1C2333] rounded-xl p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="text-white font-semibold text-sm">Severity Distribution</span>
        <span className="text-gray-600 text-[11px] font-mono">{total} total</span>
      </div>

      {/* SVG Donut */}
      <div className="flex justify-center">
        <svg
          width="200"
          height="200"
          viewBox="0 0 200 200"
          className="overflow-visible"
          style={{ display: 'block' }}
        >
          {/* Background ring */}
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="#1C2333"
            strokeWidth={STROKE_W}
          />

          {/* Slow-rotating accent ring */}
          <motion.circle
            cx={CX} cy={CY} r={R + STROKE_W / 2 + 6}
            fill="none"
            stroke="url(#accent-grad)"
            strokeWidth="1"
            strokeDasharray="24 580"
            animate={{ rotate: 360 }}
            transition={{ duration: 720, repeat: Infinity, ease: 'linear' }}
            style={{ transformOrigin: `${CX}px ${CY}px` }}
          />

          <defs>
            <linearGradient id="accent-grad" gradientUnits="userSpaceOnUse"
              x1="0" y1="0" x2="200" y2="200">
              <stop offset="0%"   stopColor="#00D4FF" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#7C3AED" stopOpacity="0.5" />
            </linearGradient>
          </defs>

          {/* Segments */}
          {segments.map((seg) => {
            const isHovered = hoveredKey === seg.key;
            const dimmed    = !!hoveredKey && !isHovered;

            return (
              <motion.g
                key={seg.key}
                animate={{ x: isHovered ? seg.hx : 0, y: isHovered ? seg.hy : 0 }}
                transition={{ ease: EASE, duration: 0.22 }}
                onMouseEnter={() => setHoveredKey(seg.key)}
                onMouseLeave={() => setHoveredKey(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* SVG-native rotate to start angle */}
                <g transform={`rotate(${seg.rotDeg} ${CX} ${CY})`}>
                  <motion.circle
                    cx={CX} cy={CY} r={R}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={STROKE_W}
                    strokeDasharray={`${seg.dashLen} ${circ}`}
                    animate={{
                      strokeDashoffset: 0,
                      opacity: dimmed ? 0.4 : 1,
                    }}
                    initial={{ strokeDashoffset: seg.dashLen, opacity: 0 }}
                    transition={{
                      strokeDashoffset: { duration: 1.2, delay: seg.index * 0.2, ease: EASE },
                      opacity: { duration: 0.2 },
                    }}
                    style={{
                      filter: isHovered
                        ? `drop-shadow(0 0 10px ${seg.color}90)`
                        : 'none',
                      transition: 'filter 0.2s',
                    }}
                  />
                </g>
              </motion.g>
            );
          })}

          {/* Center text */}
          <AnimatePresence mode="wait">
            {hovered ? (
              <motion.g key={hovered.key}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ ease: EASE, duration: 0.18 }}
                style={{ transformOrigin: `${CX}px ${CY}px` }}
              >
                <text x={CX} y={CY - 10} textAnchor="middle"
                  fill={hovered.color} fontSize="24" fontWeight="700"
                  fontFamily="ui-monospace, monospace">
                  {hovered.value}
                </text>
                <text x={CX} y={CY + 8} textAnchor="middle"
                  fill={hovered.color} fontSize="9"
                  fontFamily="ui-monospace, monospace"
                  letterSpacing="2">
                  {hovered.label.toUpperCase()}
                </text>
                <text x={CX} y={CY + 22} textAnchor="middle"
                  fill="#6B7280" fontSize="9"
                  fontFamily="ui-monospace, monospace">
                  {(hovered.pct * 100).toFixed(0)}%
                </text>
              </motion.g>
            ) : (
              <motion.g key="total"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ ease: EASE, duration: 0.18 }}
              >
                <text x={CX} y={CY - 4} textAnchor="middle"
                  fill="#ffffff" fontSize="30" fontWeight="700"
                  fontFamily="ui-monospace, monospace">
                  {total}
                </text>
                <text x={CX} y={CY + 15} textAnchor="middle"
                  fill="#4B5563" fontSize="8"
                  fontFamily="ui-monospace, monospace"
                  letterSpacing="3">
                  INCIDENTS
                </text>
              </motion.g>
            )}
          </AnimatePresence>
        </svg>
      </div>

      {/* Legend */}
      <div className="space-y-2.5">
        {segments.map((seg) => {
          const dimmed = !!hoveredKey && hoveredKey !== seg.key;
          return (
            <motion.div
              key={seg.key}
              className="flex items-center gap-2.5 cursor-pointer"
              animate={{ opacity: dimmed ? 0.4 : 1 }}
              transition={{ duration: 0.15 }}
              onMouseEnter={() => setHoveredKey(seg.key)}
              onMouseLeave={() => setHoveredKey(null)}
            >
              <div
                className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-gray-400 text-[11px] font-mono w-14 flex-shrink-0">
                {seg.label}
              </span>
              <div className="flex-1 h-1 rounded-full bg-[#1C2333] overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: seg.color, opacity: 0.7 }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(seg.pct * 100).toFixed(1)}%` }}
                  transition={{ duration: 1.1, ease: EASE, delay: 0.4 + seg.index * 0.1 }}
                />
              </div>
              <span className="font-mono text-xs text-white w-5 text-right flex-shrink-0">
                {seg.value}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
