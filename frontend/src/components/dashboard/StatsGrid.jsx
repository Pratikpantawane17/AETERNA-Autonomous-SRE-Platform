import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
  Timer,
  Activity,
  RefreshCw,
} from 'lucide-react';

const EASE = [0.25, 0.46, 0.45, 0.94];

const MOCK_DATA = {
  total_incidents: 142,
  resolved: 118,
  pending: 12,
  escalated: 3,
  avg_resolution_mins: 4.7,
  mttr_formatted: '4m 42s',
  alerts_by_severity: { critical: 8, high: 34, medium: 67, low: 33 },
  alerts_by_type: { high_cpu: 28, disk_full: 19, memory_leak: 15, network_latency: 22, service_down: 8 },
  automation_rate_pct: 83.1,
  incidents_last_hour: 7,
  pending_review: 4,
  learning_updates: [],
  chronic_services: [],
};

// Animated count-up using Framer Motion
function AnimatedNumber({ value, color = '#ffffff', className = '' }) {
  const motionVal = useMotionValue(0);
  const rounded = useTransform(motionVal, (v) => Math.round(v).toLocaleString());
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    if (value == null) return;
    const controls = animate(motionVal, value, {
      duration: 1.1,
      ease: [0.25, 0.46, 0.45, 0.94],
    });
    const unsubscribe = rounded.on('change', setDisplay);
    return () => {
      controls.stop();
      unsubscribe();
    };
  }, [value, motionVal, rounded]);

  return (
    <span className={`font-mono tabular-nums ${className}`} style={{ color }}>
      {display}
    </span>
  );
}

// SVG arc progress ring
function ArcRing({ pct = 0, size = 52, stroke = 4, color = '#22C55E' }) {
  const safeVal = Math.min(100, Math.max(0, pct ?? 0));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (safeVal / 100) * circ;

  return (
    <svg width={size} height={size} className="flex-shrink-0" style={{ transform: 'rotate(-90deg)' }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={stroke}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.2, ease: EASE, delay: 0.3 }}
        style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}
      />
    </svg>
  );
}

// Tiny sparkline (last 6 readings)
function Sparkline({ history }) {
  const data = history ?? [];
  if (data.length < 2) return null;

  const w = 72;
  const h = 28;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#00D4FF" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#00D4FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.polyline
        points={points.join(' ')}
        fill="none"
        stroke="#00D4FF"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: EASE }}
      />
    </svg>
  );
}

// Pending color: green → yellow → red as count rises
function pendingColor(count) {
  const n = count ?? 0;
  if (n === 0) return '#22C55E';
  if (n <= 5) return '#22C55E';
  if (n <= 15) return '#FF9500';
  return '#FF3B5C';
}

// Skeleton card
function SkeletonCard() {
  return (
    <div className="bg-[#0D1117] border border-[#1C2333] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="skeleton h-3 w-20 rounded" />
        <div className="skeleton h-4 w-4 rounded" />
      </div>
      <div className="skeleton h-8 w-16 rounded" />
      <div className="skeleton h-2.5 w-24 rounded" />
    </div>
  );
}

// Error card
function ErrorCard({ onRetry }) {
  return (
    <div
      className="bg-[#0D1117] border border-[#FF3B5C]/30 rounded-xl p-4 flex flex-col items-center justify-center gap-2 min-h-[100px]"
      style={{ boxShadow: '0 0 16px rgba(255,59,92,0.08)' }}
    >
      <AlertCircle size={18} className="text-[#FF3B5C]" />
      <span className="text-gray-500 text-xs text-center">Stats unavailable</span>
      <motion.button
        onClick={onRetry}
        className="flex items-center gap-1 text-[10px] font-mono text-[#FF3B5C] hover:text-white transition-colors"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <RefreshCw size={10} />
        Retry
      </motion.button>
    </div>
  );
}

// Base stat card wrapper
function StatCard({ children, index = 0, pulse = false, hoverGlow = '#00D4FF' }) {
  return (
    <motion.div
      className="bg-[#0D1117] border border-[#1C2333] rounded-xl p-4 relative overflow-hidden flex flex-col gap-2"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, ease: EASE, duration: 0.4 }}
      whileHover={{
        scale: 1.025,
        borderColor: `${hoverGlow}4D`,
        boxShadow: `0 0 24px ${hoverGlow}18`,
        transition: { ease: EASE, duration: 0.2 },
      }}
    >
      {pulse && (
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none"
          animate={{ opacity: [0, 0.12, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ backgroundColor: '#FF3B5C' }}
        />
      )}
      {children}
    </motion.div>
  );
}

// ── CARD 1: Total Incidents ──────────────────────────────────────────────
function TotalIncidentsCard({ stats, index }) {
  const total = stats?.total_incidents ?? 0;
  return (
    <StatCard index={index} hoverGlow="#9CA3AF">
      <div className="flex items-start justify-between">
        <span className="text-gray-500 text-[11px] font-mono uppercase tracking-wider">
          Total Incidents
        </span>
        <AlertCircle size={14} className="text-gray-600 flex-shrink-0" />
      </div>
      <AnimatedNumber value={total} color="#ffffff" className="text-3xl font-bold" />
      <span className="text-gray-600 text-[11px] font-mono">All time</span>
    </StatCard>
  );
}

// ── CARD 2: Resolved ─────────────────────────────────────────────────────
function ResolvedCard({ stats, index }) {
  const resolved = stats?.resolved ?? 0;
  const pct = stats?.automation_rate_pct ?? 0;

  return (
    <StatCard index={index} hoverGlow="#22C55E">
      <div className="flex items-start justify-between">
        <span className="text-gray-500 text-[11px] font-mono uppercase tracking-wider">
          Resolved
        </span>
        <CheckCircle2 size={14} className="text-[#22C55E] flex-shrink-0" />
      </div>
      <div className="flex items-center gap-3">
        <AnimatedNumber value={resolved} color="#22C55E" className="text-3xl font-bold" />
        <ArcRing pct={pct} size={44} stroke={4} color="#22C55E" />
      </div>
      <span className="text-gray-600 text-[11px] font-mono">
        <span className="text-[#22C55E]">{pct?.toFixed(1) ?? '—'}%</span> automated
      </span>
    </StatCard>
  );
}

// ── CARD 3: Pending ──────────────────────────────────────────────────────
function PendingCard({ stats, index }) {
  const pending = stats?.pending ?? 0;
  const color = pendingColor(pending);

  return (
    <StatCard index={index} hoverGlow={color}>
      <div className="flex items-start justify-between">
        <span className="text-gray-500 text-[11px] font-mono uppercase tracking-wider">
          Pending
        </span>
        <Clock size={14} style={{ color }} className="flex-shrink-0" />
      </div>
      <AnimatedNumber value={pending} color={color} className="text-3xl font-bold" />
      <span className="text-gray-600 text-[11px] font-mono">Awaiting action</span>
    </StatCard>
  );
}

// ── CARD 4: Escalated ────────────────────────────────────────────────────
function EscalatedCard({ stats, index }) {
  const escalated = stats?.escalated ?? 0;
  const hasEscalated = escalated > 0;
  const color = hasEscalated ? '#FF3B5C' : '#6B7280';

  return (
    <StatCard index={index} pulse={hasEscalated} hoverGlow={color}>
      <div className="flex items-start justify-between">
        <span className="text-gray-500 text-[11px] font-mono uppercase tracking-wider">
          Escalated
        </span>
        <TrendingUp size={14} style={{ color }} className="flex-shrink-0" />
      </div>
      <AnimatedNumber value={escalated} color={color} className="text-3xl font-bold" />
      <span className="text-gray-600 text-[11px] font-mono">
        {hasEscalated ? (
          <span className="text-[#FF3B5C]">Requires attention</span>
        ) : (
          'No escalations'
        )}
      </span>
    </StatCard>
  );
}

// ── CARD 5: MTTR ─────────────────────────────────────────────────────────
function MttrCard({ stats, index }) {
  const mttr = stats?.mttr_formatted ?? '—';

  return (
    <StatCard index={index} hoverGlow="#7C3AED">
      <div className="flex items-start justify-between">
        <span className="text-gray-500 text-[11px] font-mono uppercase tracking-wider">
          MTTR
        </span>
        <Timer size={14} className="text-[#7C3AED] flex-shrink-0" />
      </div>
      <motion.span
        key={mttr}
        className="text-3xl font-bold font-mono"
        style={{ color: '#7C3AED' }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ease: EASE, duration: 0.3 }}
      >
        {mttr}
      </motion.span>
      <span className="text-gray-600 text-[11px] font-mono">Mean time to resolve</span>
    </StatCard>
  );
}

// ── CARD 6: Incidents Last Hour ──────────────────────────────────────────
function LastHourCard({ stats, index }) {
  const current = stats?.incidents_last_hour ?? null;
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (current == null) return;
    setHistory((prev) => {
      const next = [...prev, current].slice(-6);
      return next;
    });
  }, [current]);

  return (
    <StatCard index={index} hoverGlow="#00D4FF">
      <div className="flex items-start justify-between">
        <span className="text-gray-500 text-[11px] font-mono uppercase tracking-wider">
          Last Hour
        </span>
        <Activity size={14} className="text-[#00D4FF] flex-shrink-0" />
      </div>
      <div className="flex items-end gap-3">
        <AnimatedNumber value={current ?? 0} color="#00D4FF" className="text-3xl font-bold" />
        <div className="pb-1">
          <Sparkline history={history} />
        </div>
      </div>
      <span className="text-gray-600 text-[11px] font-mono">Incidents this hour</span>
    </StatCard>
  );
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────
export default function StatsGrid({ stats, loading, error, onRetry }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[...Array(6)].map((_, i) => (
          <ErrorCard key={i} onRetry={onRetry} />
        ))}
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <TotalIncidentsCard stats={stats} index={0} />
        <ResolvedCard stats={stats} index={1} />
        <PendingCard stats={stats} index={2} />
        <EscalatedCard stats={stats} index={3} />
        <MttrCard stats={stats} index={4} />
        <LastHourCard stats={stats} index={5} />
      </div>
    </AnimatePresence>
  );
}

export { MOCK_DATA as STATS_MOCK_DATA };
