import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const EASE = [0.25, 0.46, 0.45, 0.94];

const MOCK_DATA = {
  high_cpu: 28,
  disk_full: 19,
  memory_leak: 15,
  network_latency: 22,
  service_down: 8,
  api_timeout: 11,
  pod_crash_loop: 6,
  high_error_rate: 17,
  db_connection_pool: 9,
  ssl_expiry: 3,
};

// Interpolate between electric cyan (#00D4FF) and purple (#7C3AED) by t ∈ [0,1]
function lerpColor(t) {
  const a = [0, 212, 255];
  const b = [124, 58, 237];
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bv = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bv})`;
}

function RadarSweepEmpty() {
  const CX = 60;
  const CY = 60;
  const R  = 44;
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-4">
      <svg width="120" height="120" viewBox="0 0 120 120" className="overflow-visible">
        <defs>
          <radialGradient id="radar-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#00D4FF" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#00D4FF" stopOpacity="0"    />
          </radialGradient>
        </defs>
        {/* Concentric rings */}
        {[R * 0.33, R * 0.66, R].map((r, i) => (
          <circle key={i} cx={CX} cy={CY} r={r} fill="none"
            stroke="#1C2333" strokeWidth="0.5" />
        ))}
        {/* Rotating sweep line */}
        <motion.g
          animate={{ rotate: 360 }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: `${CX}px ${CY}px` }}
        >
          {/* Fade trail */}
          <motion.path
            d={`M ${CX} ${CY} L ${CX + R} ${CY}`}
            stroke="url(#radar-fwd)"
            strokeWidth="1"
            fill="none"
          />
          <line x1={CX} y1={CY} x2={CX + R} y2={CY}
            stroke="#00D4FF" strokeWidth="1.2" opacity="0.7" />
          <defs>
            <linearGradient id="radar-fwd" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#00D4FF" stopOpacity="0" />
              <stop offset="100%" stopColor="#00D4FF" stopOpacity="0.5" />
            </linearGradient>
          </defs>
        </motion.g>
        {/* Outer ring */}
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#00D4FF22" strokeWidth="1" />
      </svg>
      <span className="text-gray-600 text-xs font-mono">No alerts recorded yet</span>
    </div>
  );
}

function SkeletonBar() {
  return (
    <div className="flex items-center gap-3">
      <div className="skeleton h-3 w-28 rounded flex-shrink-0" />
      <div className="skeleton flex-1 h-4 rounded-sm" />
      <div className="skeleton h-3 w-6 rounded flex-shrink-0" />
    </div>
  );
}

export default function AlertTypeBreakdown({ data, loading }) {
  const safeData = data ?? MOCK_DATA;

  const entries = useMemo(() => {
    if (!safeData || typeof safeData !== 'object') return [];
    return Object.entries(safeData)
      .map(([type, count]) => ({ type, count: Number(count) || 0 }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [safeData]);

  const maxCount = entries[0]?.count ?? 1;
  const isEmpty  = entries.length === 0;

  if (loading) {
    return (
      <div className="bg-[#0D1117] border border-[#1C2333] rounded-xl p-5 space-y-4">
        <div className="skeleton h-4 w-40 rounded" />
        {[...Array(6)].map((_, i) => <SkeletonBar key={i} />)}
      </div>
    );
  }

  return (
    <div className="bg-[#0D1117] border border-[#1C2333] rounded-xl p-5 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="text-white font-semibold text-sm">Alert Type Breakdown</span>
        <span className="text-gray-600 text-[11px] font-mono">
          {isEmpty ? '0 types' : `top ${entries.length}`}
        </span>
      </div>

      <AnimatePresence mode="wait">
        {isEmpty ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <RadarSweepEmpty />
          </motion.div>
        ) : (
          <motion.div key="bars" className="space-y-3">
            {entries.map((entry, i) => {
              const widthPct = (entry.count / maxCount) * 100;
              const color    = lerpColor(i / Math.max(entries.length - 1, 1));
              const label    = entry.type.replace(/_/g, ' ');

              return (
                <motion.div
                  key={entry.type}
                  className="flex items-center gap-3 group"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, ease: EASE, duration: 0.35 }}
                >
                  {/* Type name */}
                  <span
                    className="text-gray-400 text-[11px] font-mono capitalize truncate flex-shrink-0 group-hover:text-white transition-colors duration-200"
                    style={{ width: 120 }}
                  >
                    {label}
                  </span>

                  {/* Bar track */}
                  <div className="flex-1 h-4 bg-[#1C2333] rounded-sm overflow-hidden relative">
                    <motion.div
                      className="h-full rounded-sm relative overflow-hidden"
                      style={{ backgroundColor: color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${widthPct}%` }}
                      transition={{ delay: i * 0.05 + 0.15, duration: 0.7, ease: EASE }}
                    >
                      {/* Shimmer on bar */}
                      <motion.div
                        className="absolute inset-0"
                        style={{
                          background:
                            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)',
                          backgroundSize: '200% 100%',
                        }}
                        animate={{ backgroundPosition: ['200% 0', '-200% 0'] }}
                        transition={{
                          duration: 2.5,
                          repeat: Infinity,
                          ease: 'linear',
                          delay: i * 0.2,
                        }}
                      />
                    </motion.div>
                  </div>

                  {/* Count */}
                  <span
                    className="font-mono text-xs font-semibold flex-shrink-0 w-6 text-right"
                    style={{ color }}
                  >
                    {entry.count}
                  </span>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
