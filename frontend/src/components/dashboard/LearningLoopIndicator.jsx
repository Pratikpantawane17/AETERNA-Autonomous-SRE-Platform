import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, TrendingUp, TrendingDown, RefreshCw, Zap } from 'lucide-react';
import api from '../../config/api';
import { useSystem } from '../../context/SystemContext';
import { formatTimestamp, formatConfidence } from '../../utils/formatters';

const EASE = [0.25, 0.46, 0.45, 0.94];
const POLL_MS = 120000; // 2 min

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();

const MOCK_DATA = [
  { action: 'restart_service',     alert_type: 'pod_crash_loop',    success: true,  timestamp: ago(3),   accuracy: 0.91 },
  { action: 'scale_service',       alert_type: 'cpu_spike',         success: true,  timestamp: ago(9),   accuracy: 0.87 },
  { action: 'cleanup_logs',        alert_type: 'disk_full',         success: true,  timestamp: ago(14),  accuracy: 0.78 },
  { action: 'restart_service',     alert_type: 'memory_leak',       success: false, timestamp: ago(22),  accuracy: 0.43 },
  { action: 'scale_service',       alert_type: 'high_error_rate',   success: true,  timestamp: ago(31),  accuracy: 0.89 },
  { action: 'reroute_traffic',     alert_type: 'network_latency',   success: true,  timestamp: ago(44),  accuracy: 0.82 },
  { action: 'db_connection_reset', alert_type: 'db_connection_pool',success: false, timestamp: ago(53),  accuracy: 0.38 },
  { action: 'cleanup_logs',        alert_type: 'disk_full',         success: true,  timestamp: ago(68),  accuracy: 0.85 },
  { action: 'restart_service',     alert_type: 'cpu_spike',         success: true,  timestamp: ago(79),  accuracy: 0.93 },
  { action: 'scale_service',       alert_type: 'pod_crash_loop',    success: true,  timestamp: ago(92),  accuracy: 0.88 },
  { action: 'reroute_traffic',     alert_type: 'service_down',      success: false, timestamp: ago(106), accuracy: 0.51 },
  { action: 'db_connection_reset', alert_type: 'db_connection_pool',success: true,  timestamp: ago(121), accuracy: 0.76 },
  { action: 'cleanup_logs',        alert_type: 'disk_full',         success: true,  timestamp: ago(138), accuracy: 0.81 },
  { action: 'restart_service',     alert_type: 'memory_leak',       success: true,  timestamp: ago(153), accuracy: 0.74 },
  { action: 'scale_service',       alert_type: 'cpu_spike',         success: true,  timestamp: ago(170), accuracy: 0.90 },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function actionColor(rate) {
  if (rate >= 0.8) return '#22C55E';
  if (rate >= 0.6) return '#FF9500';
  return '#FF3B5C';
}

function CountUp({ value, suffix = '', decimals = 0 }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    if (value == null || isNaN(value) || typeof value !== 'number') return;
    const start = 0;
    const end = value;
    const duration = 900;
    const startTime = performance.now();
    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(parseFloat((start + (end - start) * eased).toFixed(decimals)));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, decimals]);
  return <span>{display}{suffix}</span>;
}

// ─── SPARKLINE ────────────────────────────────────────────────────────────────
function Sparkline({ data }) {
  const W = 160, H = 36;
  if (!data || data.length < 2) return <div className="w-40 h-9" />;

  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - Math.max(0, Math.min(1, v ?? 0)) * (H - 6) - 3,
  }));
  const pathD = 'M ' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
  const areaD = pathD + ` L ${W} ${H} L 0 ${H} Z`;
  const last  = pts[pts.length - 1];

  return (
    <svg width={W} height={H} className="overflow-visible">
      <defs>
        <linearGradient id="ll-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#7C3AED" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0"   />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#ll-spark)" />
      <motion.path
        d={pathD}
        fill="none"
        stroke="#7C3AED"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.0, ease: EASE }}
      />
      <motion.circle
        cx={last.x} cy={last.y} r={3}
        fill="#7C3AED"
        animate={{ r: [2, 4.5, 2], opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      />
    </svg>
  );
}

// ─── ORBITAL PARTICLE EMPTY STATE ────────────────────────────────────────────
function OrbitalParticles() {
  const ORBIT_R = 32;
  const SIZE    = 80;
  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          animate={{ opacity: [0.25, 0.65, 0.25], scale: [0.9, 1.08, 0.9] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Brain size={22} className="text-[#7C3AED]" />
        </motion.div>
      </div>
      {/* Dashed orbit ring */}
      <div
        className="absolute rounded-full"
        style={{
          width: ORBIT_R * 2,
          height: ORBIT_R * 2,
          top: SIZE / 2 - ORBIT_R,
          left: SIZE / 2 - ORBIT_R,
          border: '1px dashed rgba(124,58,237,0.2)',
        }}
      />
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{ width: SIZE, height: SIZE, top: 0, left: 0 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 5 + i * 0.85, repeat: Infinity, ease: 'linear', delay: i * 1.25 }}
        >
          <div
            style={{
              position: 'absolute',
              width: 5 - i * 0.5,
              height: 5 - i * 0.5,
              borderRadius: '50%',
              backgroundColor: '#7C3AED',
              boxShadow: '0 0 8px rgba(124,58,237,0.9)',
              left: SIZE / 2 - (5 - i * 0.5) / 2,
              top:  SIZE / 2 - ORBIT_R - (5 - i * 0.5) / 2,
              opacity: 0.5 + i * 0.12,
            }}
          />
        </motion.div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-10 gap-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ease: EASE, duration: 0.4 }}
    >
      <OrbitalParticles />
      <div className="text-center space-y-1 mt-2">
        <p className="text-[#00D4FF] text-xs font-mono animate-pulse tracking-wide">Collecting learning signals...</p>
        <p className="text-gray-500 text-[11px] max-w-[200px] text-center leading-relaxed">
          resolve incidents to see performance data
        </p>
      </div>
    </motion.div>
  );
}

// ─── METRIC CARD ─────────────────────────────────────────────────────────────
function MetricCard({ label, value, suffix = '', decimals = 0, color = '#00D4FF', icon: Icon, index }) {
  const isNumber = typeof value === 'number' && !isNaN(value);
  return (
    <motion.div
      className="bg-[#080B14] border border-[#1C2333] rounded-lg p-3 flex flex-col gap-1.5"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, ease: EASE, duration: 0.35 }}
      whileHover={{ borderColor: `${color}35`, scale: 1.02, transition: { duration: 0.15 } }}
    >
      <div className="flex items-center justify-between">
        <span className="text-gray-600 text-[10px] font-mono uppercase tracking-wider">{label}</span>
        {Icon && <Icon size={12} style={{ color }} />}
      </div>
      <span className="font-mono text-xl font-bold" style={{ color: isNumber ? color : '#6B7280' }}>
        {isNumber ? <CountUp value={value} suffix={suffix} decimals={decimals} /> : value}
      </span>
    </motion.div>
  );
}

// ─── EVENT ROW ────────────────────────────────────────────────────────────────
function EventRow({ event, isFromWs, index }) {
  const success     = event?.success ?? false;
  const action      = (event?.action ?? 'unknown').replace(/_/g, ' ');
  const alertType   = (event?.alert_type ?? 'unknown').replace(/_/g, ' ');
  const accuracy    = event?.accuracy ?? 0;
  const accColor    = actionColor(accuracy);

  return (
    <motion.div
      layout
      initial={{ x: isFromWs ? 40 : 0, opacity: isFromWs ? 0 : 1 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -20, opacity: 0 }}
      transition={{ ease: EASE, duration: 0.3, delay: isFromWs ? 0 : index * 0.03 }}
      className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-white/3 transition-colors group"
    >
      {/* Signal icon */}
      <div className={`flex-shrink-0 p-1 rounded ${success ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
        {success
          ? <TrendingUp  size={11} className="text-[#22C55E]" />
          : <TrendingDown size={11} className="text-[#FF3B5C]" />
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-white text-[11px] font-medium capitalize truncate">{action}</p>
        <p className="text-gray-600 text-[10px] font-mono capitalize truncate">{alertType}</p>
      </div>

      {/* Accuracy bar */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0 w-20">
        <div className="flex items-center gap-1.5 w-full">
          <div className="flex-1 h-0.5 rounded-full bg-[#1C2333] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: accColor }}
              initial={{ width: 0 }}
              animate={{ width: `${(accuracy * 100).toFixed(0)}%` }}
              transition={{ duration: 0.7, ease: EASE }}
            />
          </div>
          <span className="text-[10px] font-mono flex-shrink-0" style={{ color: accColor }}>
            {formatConfidence(accuracy)}
          </span>
        </div>
        <span className="text-gray-600 text-[10px] font-mono">
          {formatTimestamp(event?.timestamp)}
        </span>
      </div>
    </motion.div>
  );
}

// ─── ACTION PERFORMANCE GRID ──────────────────────────────────────────────────
function ActionGrid({ actionPerf }) {
  if (!actionPerf || actionPerf.length === 0) return null;
  return (
    <div className="space-y-2">
      {actionPerf.slice(0, 6).map((item, i) => {
        const color = actionColor(item.rate);
        const label = (item.action ?? 'unknown').replace(/_/g, ' ');
        return (
          <motion.div
            key={item.action}
            className="flex items-center gap-2.5"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, ease: EASE, duration: 0.3 }}
          >
            <span className="text-gray-500 text-[10px] font-mono capitalize truncate flex-shrink-0" style={{ width: 110 }}>
              {label}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-[#1C2333] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: color, opacity: 0.8 }}
                initial={{ width: 0 }}
                animate={{ width: `${(item.rate * 100).toFixed(0)}%` }}
                transition={{ duration: 0.9, delay: i * 0.07, ease: EASE }}
              />
            </div>
            <span className="font-mono text-[10px] flex-shrink-0 w-8 text-right" style={{ color }}>
              {(item.rate * 100).toFixed(0)}%
            </span>
            <span className="text-gray-700 text-[10px] font-mono flex-shrink-0 w-6 text-right">
              ×{item.total}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function LearningLoopIndicator() {
  const { lastWsEvent } = useSystem();

  const [events, setEvents]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [learningPulse, setLearning]  = useState(false);
  const [wsEventIds, setWsEventIds]   = useState(new Set());

  const abortRef          = useRef(null);
  const pollRef           = useRef(null);
  const pulseTimerRef     = useRef(null);
  const lastHandledRef    = useRef(null);
  const wsTimersRef       = useRef(new Map());

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchEvents = useCallback(async (signal) => {
    try {
      const { data } = await api.get('/api/learning/updates', { signal });
      if (!signal?.aborted) {
        setEvents(Array.isArray(data) ? data : MOCK_DATA);
      }
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[LearningLoopIndicator] API unavailable, using mock', e);
      setEvents(MOCK_DATA);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  // ── Mount / unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    abortRef.current = new AbortController();
    fetchEvents(abortRef.current.signal);

    pollRef.current = setInterval(() => {
      const ctrl = new AbortController();
      fetchEvents(ctrl.signal);
    }, POLL_MS);

    return () => {
      abortRef.current?.abort();
      clearInterval(pollRef.current);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      wsTimersRef.current.forEach(clearTimeout);
      wsTimersRef.current.clear();
    };
  }, [fetchEvents]);

  // ── WebSocket: INCIDENT_RESOLVED triggers learning ─────────────────────────
  useEffect(() => {
    if (!lastWsEvent || lastWsEvent === lastHandledRef.current) return;
    lastHandledRef.current = lastWsEvent;
    if (lastWsEvent.type !== 'INCIDENT_RESOLVED') return;

    const resolved = lastWsEvent.data ?? {};

    // Purple glow flash
    setLearning(true);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = setTimeout(() => setLearning(false), 2200);

    // Synthesize learning event
    const syntheticId = `ws-${Date.now()}`;
    const syntheticEvent = {
      _id: syntheticId,
      action: 'restart_service',
      alert_type: resolved?.alert_type ?? 'unknown',
      success: true,
      timestamp: new Date().toISOString(),
      accuracy: 0.7 + Math.random() * 0.25,
    };

    setEvents((prev) => [syntheticEvent, ...prev].slice(0, 30));
    setWsEventIds((prev) => new Set([...prev, syntheticId]));

    // Clear ws marker after animation
    const t = setTimeout(() => {
      setWsEventIds((prev) => { const n = new Set(prev); n.delete(syntheticId); return n; });
      wsTimersRef.current.delete(syntheticId);
    }, 2000);
    wsTimersRef.current.set(syntheticId, t);
  }, [lastWsEvent]);

  // ── Derived metrics ────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const total = events.length;
    if (total === 0) return { total: '—', successRate: '—', improved: '—', deprioritized: '—' };
    const improved = events.filter((u) => u?.success === true).length;
    const deprioritized = total - improved;
    const successRate = Math.round((improved / total) * 100);
    return { total, successRate, improved, deprioritized };
  }, [events]);

  const sparklineData = useMemo(() => {
    if (events.length === 0) return [];
    const recent = [...events].slice(0, 12).reverse();
    return recent.map((_, i) => {
      const window = recent.slice(0, i + 1);
      const s = window.filter((u) => u?.success === true).length;
      return s / window.length;
    });
  }, [events]);

  const actionPerf = useMemo(() => {
    if (events.length === 0) return [];
    const acc = {};
    events.forEach((u) => {
      if (!u?.action) return;
      if (!acc[u.action]) acc[u.action] = { total: 0, success: 0 };
      acc[u.action].total++;
      if (u.success === true) acc[u.action].success++;
    });
    return Object.entries(acc)
      .map(([action, s]) => ({ action, rate: s.total > 0 ? s.success / s.total : 0, total: s.total }))
      .sort((a, b) => b.rate - a.rate);
  }, [events]);

  const isEmpty = !loading && events.length === 0;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <motion.div
      className="bg-[#0D1117] border border-[#1C2333] rounded-xl overflow-hidden flex flex-col"
      animate={{
        boxShadow: learningPulse
          ? [
              '0 0 0px rgba(124,58,237,0)',
              '0 0 40px rgba(124,58,237,0.35)',
              '0 0 0px rgba(124,58,237,0)',
            ]
          : '0 0 0px rgba(124,58,237,0)',
      }}
      transition={{ duration: 1.8, ease: 'easeInOut' }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1C2333] flex-shrink-0">
        <div className="flex items-center gap-2">
          <motion.div
            animate={{ opacity: [0.65, 1, 0.65], scale: [1, 1.12, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <Brain size={15} className="text-[#7C3AED]" />
          </motion.div>
          <span className="text-white font-mono text-xs font-semibold tracking-[0.15em] uppercase">
            AI Learning Loop
          </span>
          <AnimatePresence>
            {learningPulse && (
              <motion.div
                key="learning-badge"
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)' }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ ease: EASE, duration: 0.2 }}
              >
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-[#7C3AED]"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                />
                <span className="text-[#A78BFA] text-[9px] font-mono">LEARNING</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <motion.button
          className="p-1.5 rounded-md text-gray-600 hover:text-[#7C3AED] hover:bg-[#7C3AED]/8 transition-colors"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => { abortRef.current?.abort(); abortRef.current = new AbortController(); fetchEvents(abortRef.current.signal); }}
        >
          <RefreshCw size={12} />
        </motion.button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-5">
        {/* ── Metric cards ─────────────────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-[#080B14] border border-[#1C2333] rounded-lg p-3 space-y-2">
                <div className="skeleton h-2.5 w-20 rounded" />
                <div className="skeleton h-6 w-12 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="Signals Processed" value={metrics.total}        color="#7C3AED" icon={Zap}          index={0} />
            <MetricCard label="Success Rate"       value={metrics.successRate}  color="#22C55E" suffix="%" decimals={1} index={1} />
            <MetricCard label="Actions Improved"   value={metrics.improved}     color="#00D4FF" icon={TrendingUp}   index={2} />
            <MetricCard label="Deprioritized"      value={metrics.deprioritized}color="#FF9500" icon={TrendingDown} index={3} />
          </div>
        )}

        {/* ── Sparkline trend ───────────────────────────────────────────────── */}
        {!loading && !isEmpty && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-500 text-[10px] font-mono uppercase tracking-wider">
                Success Rate Trend
              </span>
              <span className="text-[#7C3AED] text-[10px] font-mono">
                last {sparklineData.length} events
              </span>
            </div>
            <Sparkline data={sparklineData} />
          </div>
        )}

        {/* ── Empty state ───────────────────────────────────────────────────── */}
        {isEmpty && <EmptyState />}

        {/* ── Learning events list ──────────────────────────────────────────── */}
        {!loading && !isEmpty && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-500 text-[10px] font-mono uppercase tracking-wider">
                Recent Signals
              </span>
              <span className="text-gray-700 text-[10px] font-mono">{events.length} total</span>
            </div>
            <div className="space-y-0 border-t border-[#1C2333] divide-y divide-[#1C2333]/50">
              <AnimatePresence mode="popLayout" initial={false}>
                {events.slice(0, 8).map((ev, i) => {
                  const id = ev?._id ?? ev?.id ?? `${ev?.action}-${ev?.timestamp}-${i}`;
                  return (
                    <EventRow
                      key={id}
                      event={ev}
                      isFromWs={wsEventIds.has(id)}
                      index={i}
                    />
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* ── Action performance grid ───────────────────────────────────────── */}
        {!loading && actionPerf.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-gray-500 text-[10px] font-mono uppercase tracking-wider">
                Action Performance
              </span>
              <span className="text-gray-700 text-[10px] font-mono">{actionPerf.length} actions</span>
            </div>
            <ActionGrid actionPerf={actionPerf} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
