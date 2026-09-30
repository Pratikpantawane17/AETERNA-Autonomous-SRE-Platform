import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Brain, Activity, ChevronDown, ChevronUp,
  Loader2, AlertTriangle, CheckCircle2, Clock, TrendingUp,
  RefreshCw, Eye,
} from 'lucide-react';
import api, { WS_URL } from '../../config/api';
import { formatTimestamp } from '../../utils/formatters';
import { useSystem } from '../../context/SystemContext';

const EASE = [0.25, 0.46, 0.45, 0.94];

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const T = (m) => new Date(Date.now() - m * 60000).toISOString();

const MOCK_PREDICTIVE_INCIDENTS = [
  {
    id: 'pred-001', is_predictive: true, alert_type: 'cpu_spike',
    service: 'payment-service', severity: 'critical',
    confidence: 0.91, status: 'resolved', created_at: T(45),
    metrics_snapshot: { eta_minutes: 8, detection_methods: ['linear_regression', 'z_score'] },
  },
  {
    id: 'pred-002', is_predictive: true, alert_type: 'memory_leak',
    service: 'auth-service', severity: 'high',
    confidence: 0.84, status: 'awaiting_review', created_at: T(120),
    metrics_snapshot: { eta_minutes: 15, detection_methods: ['z_score', 'velocity_spike'] },
  },
  {
    id: 'pred-003', is_predictive: true, alert_type: 'disk_full',
    service: 'db-primary', severity: 'critical',
    confidence: 0.88, status: 'resolved', created_at: T(200),
    metrics_snapshot: { eta_minutes: 22, detection_methods: ['linear_regression', 'seasonality'] },
  },
];

const MOCK_PREDICTION_RESULT = {
  predicted: true,
  service: 'payment-service',
  predicted_type: 'cpu_spike',
  confidence: 0.87,
  eta_minutes: 12,
  detection_methods: ['linear_regression', 'z_score'],
  recommended_action: 'scale_service',
};

const MOCK_WS_ALERT = {
  service: 'cache-layer',
  predicted_type: 'memory_leak',
  confidence: 0.89,
  eta_minutes: 7,
  detection_methods: ['z_score', 'velocity_spike'],
};

// ─── DETECTION METHOD CONFIG ──────────────────────────────────────────────────
const DETECTION_METHODS = [
  {
    id: 'linear_regression',
    label: 'Linear Regression',
    desc: 'Fits CPU/memory trend lines and projects when they cross critical thresholds.',
    badge: 'LR',
    color: '#7C3AED',
  },
  {
    id: 'z_score',
    label: 'Z-Score Anomaly',
    desc: 'Flags metrics deviating more than 2σ from historical baseline for this service.',
    badge: 'Z',
    color: '#00D4FF',
  },
  {
    id: 'multi_metric',
    label: 'Multi-Metric Correlation',
    desc: 'Detects when CPU + error rate + latency all trend together — stronger signal.',
    badge: 'MM',
    color: '#22C55E',
  },
  {
    id: 'velocity_spike',
    label: 'Velocity Spike',
    desc: 'Measures rate-of-change (dCPU/dt). Sharp acceleration triggers early warning.',
    badge: 'VS',
    color: '#FF9500',
  },
  {
    id: 'seasonality',
    label: 'Seasonality Sensitivity',
    desc: 'Lower deviation threshold Mon–Fri 09:00–18:00 UTC (business hours = higher impact).',
    badge: 'SS',
    color: '#FF3B5C',
    note: 'Lower threshold: Mon–Fri 09–18 UTC',
  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const str = (v) => (v != null ? String(v) : '');
const cap = (v) => str(v).replace(/_/g, ' ');
const confColor = (c) => {
  const v = typeof c === 'number' ? c : 0;
  return v >= 0.85 ? '#22C55E' : v >= 0.6 ? '#FF9500' : '#FF3B5C';
};

// ─── METHOD PILL ──────────────────────────────────────────────────────────────
function MethodPill({ method }) {
  const cfg = DETECTION_METHODS.find((m) => m.id === method)
    ?? { label: cap(method), color: '#7C3AED' };
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold"
      style={{ backgroundColor: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}30` }}
    >
      {cfg.label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART D — PredictiveAlertBadge (reusable pill)
// ═══════════════════════════════════════════════════════════════════════════════
export function PredictiveAlertBadge({ compact = false }) {
  return (
    <motion.span
      className="inline-flex items-center gap-1 font-mono font-bold"
      style={{
        fontSize: compact ? 8 : 9,
        background: 'linear-gradient(90deg, #7C3AED, #A78BFA)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
      }}
      animate={{ opacity: [0.8, 1, 0.8] }}
      transition={{ duration: 2.5, repeat: Infinity }}
    >
      🔮 {compact ? 'PRED' : 'PREDICTIVE'}
    </motion.span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART B — PredictiveIncidentCard
// ═══════════════════════════════════════════════════════════════════════════════
export function PredictiveIncidentCard({ incident, onClick }) {
  const conf     = incident?.confidence ?? 0;
  const eta      = incident?.metrics_snapshot?.eta_minutes;
  const methods  = incident?.metrics_snapshot?.detection_methods ?? [];

  return (
    <motion.div
      layout
      onClick={onClick}
      className="rounded-xl p-3.5 cursor-pointer relative overflow-hidden"
      style={{
        backgroundColor: 'rgba(124,58,237,0.05)',
        border:          '1px solid rgba(124,58,237,0.3)',
        borderLeft:      '4px solid',
        borderLeftColor: '#7C3AED',
      }}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      whileHover={{ borderColor: 'rgba(124,58,237,0.55)', scale: 1.01, transition: { duration: 0.12 } }}
    >
      {/* Subtle glow behind card */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at top left, rgba(124,58,237,0.08) 0%, transparent 70%)' }} />

      {/* Row 1 */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <PredictiveAlertBadge />
        <span className="text-gray-600 text-[9px] font-mono">{formatTimestamp(incident?.created_at)}</span>
      </div>

      {/* Row 2 */}
      <p className="text-white text-xs font-semibold capitalize mb-0.5">
        {cap(incident?.alert_type)}
      </p>
      <p className="text-gray-400 text-[10px] font-mono mb-2">{incident?.service ?? '—'}</p>

      {/* Confidence */}
      <p className="text-[10px] font-mono mb-1.5" style={{ color: confColor(conf) }}>
        AI predicted with <span className="font-bold">{Math.round(conf * 100)}%</span> confidence
      </p>

      {/* ETA */}
      {eta != null && (
        <div className="flex items-center gap-1.5 mb-2">
          <Clock size={9} className="text-[#FF9500]" />
          <span className="text-[#FF9500] text-[10px] font-mono">ETA was ~{eta} min</span>
        </div>
      )}

      {/* Detection method pills */}
      {methods.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {methods.map((m) => <MethodPill key={m} method={m} />)}
        </div>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART A — PredictiveAlertBanner (WebSocket-triggered fixed overlay)
// ═══════════════════════════════════════════════════════════════════════════════
const BANNER_DURATION = 15; // seconds

function FloatingParticle({ x, y, size, duration, color }) {
  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      style={{ width: size, height: size, backgroundColor: color, left: `${x}%`, top: `${y}%`, opacity: 0.3 }}
      animate={{ y: [0, -20, 0], x: [0, 8, -8, 0], opacity: [0.3, 0.6, 0.3] }}
      transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

export function PredictiveAlertBanner({ alert, onDismiss, onSubmitAlert }) {
  const [remaining, setRemaining]       = useState(BANNER_DURATION);
  const [etaRemaining, setEtaRemaining] = useState(null);
  const intervalRef                     = useRef(null);
  const etaIntervalRef                  = useRef(null);

  const conf    = alert?.confidence ?? 0;
  const etaMin  = alert?.eta_minutes ?? null;
  const methods = alert?.detection_methods ?? [];

  useEffect(() => {
    // Countdown to dismiss
    setRemaining(BANNER_DURATION);
    intervalRef.current = setInterval(() => {
      setRemaining((v) => {
        if (v <= 1) { clearInterval(intervalRef.current); onDismiss?.(); return 0; }
        return v - 1;
      });
    }, 1000);

    // ETA countdown
    if (etaMin != null) {
      setEtaRemaining(etaMin * 60);
      etaIntervalRef.current = setInterval(() => {
        setEtaRemaining((v) => (v > 0 ? v - 1 : 0));
      }, 1000);
    }

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(etaIntervalRef.current);
    };
  }, [alert, etaMin, onDismiss]);

  const fmtEta = (secs) => {
    if (secs == null) return '—';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  };

  const particles = [
    { x: 10, y: 20, size: 6,  duration: 4.2, color: '#A78BFA' },
    { x: 80, y: 70, size: 4,  duration: 3.5, color: '#7C3AED' },
    { x: 50, y: 30, size: 3,  duration: 5.1, color: '#00D4FF' },
    { x: 90, y: 15, size: 5,  duration: 3.8, color: '#A78BFA' },
  ];

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 z-[100] overflow-hidden"
      style={{ boxShadow: '0 8px 48px rgba(124,58,237,0.45)' }}
      initial={{ y: -120, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -120, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 22 }}
    >
      {/* Background gradient */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(135deg, #0D0820 0%, #180B35 40%, #0D1117 100%)' }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(124,58,237,0.35) 0%, transparent 60%)' }}
      />

      {/* Particles */}
      {particles.map((p, i) => <FloatingParticle key={i} {...p} />)}

      {/* Content */}
      <div className="relative z-10 px-6 py-4 flex items-center gap-5">
        {/* Icon */}
        <motion.div
          className="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(124,58,237,0.3)', border: '1px solid rgba(167,139,250,0.5)' }}
          animate={{ scale: [1, 1.08, 1], boxShadow: ['0 0 0px #7C3AED', '0 0 20px #7C3AED', '0 0 0px #7C3AED'] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <Zap size={22} className="text-[#A78BFA]" />
        </motion.div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <motion.span
              className="font-mono text-xs font-black tracking-[0.2em] uppercase"
              style={{ color: '#A78BFA' }}
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              ⚡ PREDICTIVE THREAT DETECTED
            </motion.span>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold"
              style={{ backgroundColor: `${confColor(conf)}18`, color: confColor(conf), border: `1px solid ${confColor(conf)}40` }}>
              {Math.round(conf * 100)}% confidence
            </span>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-white font-semibold text-sm">{alert?.service ?? '—'}</span>
            <span className="text-gray-400 text-sm">·</span>
            <span className="text-white text-sm capitalize">{cap(alert?.predicted_type)}</span>
            {etaRemaining != null && (
              <div className="flex items-center gap-1.5">
                <Clock size={11} className="text-[#FF9500]" />
                <span className="text-[#FF9500] font-mono text-sm font-bold tabular-nums">
                  {fmtEta(etaRemaining)}
                </span>
              </div>
            )}
          </div>

          {/* Detection methods */}
          {methods.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {methods.map((m) => <MethodPill key={m} method={m} />)}
            </div>
          )}
        </div>

        {/* Action button */}
        <motion.button
          onClick={() => onSubmitAlert?.(alert)}
          className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-xs font-bold"
          style={{ backgroundColor: 'rgba(167,139,250,0.2)', color: '#A78BFA', border: '1px solid rgba(167,139,250,0.4)' }}
          whileHover={{ backgroundColor: 'rgba(167,139,250,0.3)', scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          <Zap size={13} /> PRE-EMPTIVE ACTION
        </motion.button>

        {/* Dismiss */}
        <motion.button
          onClick={onDismiss}
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-gray-600 hover:text-white hover:bg-white/[0.06] transition-colors"
          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
        >
          ×
        </motion.button>
      </div>

      {/* Countdown progress bar */}
      <motion.div
        className="absolute bottom-0 left-0 h-[2px]"
        style={{ backgroundColor: '#7C3AED' }}
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: BANNER_DURATION, ease: 'linear' }}
      />
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PART C — PredictiveIntelligenceDashboard (embeds in /intelligence route)
// ═══════════════════════════════════════════════════════════════════════════════
const SCAN_INTERVAL = 30;

function ScanCountdown({ resetKey }) {
  const [tick, setTick] = useState(SCAN_INTERVAL);

  useEffect(() => {
    setTick(SCAN_INTERVAL);
    const id = setInterval(() => setTick((v) => (v <= 1 ? SCAN_INTERVAL : v - 1)), 1000);
    return () => clearInterval(id);
  }, [resetKey]);

  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-600 text-[10px] font-mono uppercase">Next scan in</span>
      <span className="font-mono text-sm font-bold tabular-nums" style={{ color: tick <= 5 ? '#FF9500' : '#A78BFA' }}>
        {String(tick).padStart(2, '0')}s
      </span>
      <div className="flex-1 h-1 rounded-full bg-[#1C2333] overflow-hidden">
        <motion.div
          key={resetKey}
          className="h-full rounded-full"
          style={{ backgroundColor: '#7C3AED' }}
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: SCAN_INTERVAL, ease: 'linear' }}
        />
      </div>
    </div>
  );
}

function DetectionMethodCard({ method, active }) {
  return (
    <motion.div
      className="rounded-xl border p-4 flex items-start gap-3"
      style={{ backgroundColor: `${method.color}06`, borderColor: `${method.color}25` }}
      whileHover={{ borderColor: `${method.color}50`, scale: 1.01, transition: { duration: 0.15 } }}
    >
      <div className="flex-shrink-0 flex flex-col items-center gap-2">
        <motion.div
          className="w-8 h-8 rounded-lg flex items-center justify-center font-mono text-[10px] font-black"
          style={{ backgroundColor: `${method.color}18`, color: method.color, border: `1px solid ${method.color}35` }}
        >
          {method.badge}
        </motion.div>
        <motion.div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: active ? method.color : '#374151' }}
          animate={active ? { opacity: [1, 0.3, 1], scale: [1, 1.3, 1] } : {}}
          transition={{ duration: 1.8, repeat: Infinity }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-mono text-xs font-semibold" style={{ color: method.color }}>{method.label}</p>
        <p className="text-gray-500 text-[11px] leading-snug mt-0.5">{method.desc}</p>
        {method.note && (
          <p className="text-gray-600 text-[10px] mt-1 italic">{method.note}</p>
        )}
      </div>
      <div className="flex-shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded-full"
        style={{
          backgroundColor: active ? `${method.color}18` : 'rgba(55,65,81,0.5)',
          color: active ? method.color : '#6B7280',
        }}>
        {active ? 'ACTIVE' : 'IDLE'}
      </div>
    </motion.div>
  );
}

function ManualPredictionForm({ onResult }) {
  const [open, setOpen]         = useState(false);
  const [service, setService]   = useState('');
  const [history, setHistory]   = useState([50, 52, 55, 60, 68, 75]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const abortRef                = useRef(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handlePredict = useCallback(async (e) => {
    e.preventDefault();
    if (!service.trim() || loading) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.post('/api/predict', {
        service: service.trim(),
        cpu_pct_history: history.map(Number),
      }, { signal: abortRef.current.signal });
      onResult?.(data ?? null);
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[PredictiveDashboard] predict API unavailable, using mock', e);
      onResult?.(MOCK_PREDICTION_RESULT);
      setError(null);
    } finally {
      if (!abortRef.current?.signal?.aborted) setLoading(false);
    }
  }, [service, history, loading, onResult]);

  return (
    <div className="border border-[#1C2333] rounded-2xl overflow-hidden bg-[#0D1117]">
      <motion.button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.99 }}
      >
        <div className="flex items-center gap-2">
          <Brain size={13} className="text-[#7C3AED]" />
          <span className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">Manual Prediction Trigger</span>
        </div>
        {open ? <ChevronUp size={13} className="text-gray-600" /> : <ChevronDown size={13} className="text-gray-600" />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.form
            onSubmit={handlePredict}
            className="px-5 pb-5 border-t border-[#1C2333] space-y-4"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.25 }}
          >
            <div className="pt-4 space-y-1.5">
              <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Service Name</label>
              <input
                type="text" value={service} onChange={(e) => setService(e.target.value)}
                placeholder="e.g. payment-service"
                className="w-full bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2.5 placeholder-gray-700 focus:outline-none focus:border-[#7C3AED]/50 transition-colors"
              />
            </div>

            {/* 6-slider CPU history */}
            <div>
              <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider block mb-2">
                CPU History (6 readings)
              </label>
              <div className="grid grid-cols-6 gap-2">
                {history.map((v, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <span className="text-[9px] font-mono tabular-nums"
                      style={{ color: v > 85 ? '#FF3B5C' : v > 70 ? '#FF9500' : '#22C55E' }}>
                      {v}%
                    </span>
                    <input
                      type="range" min="0" max="100" step="1" value={v}
                      onChange={(e) => {
                        const next = [...history];
                        next[i] = Number(e.target.value);
                        setHistory(next);
                      }}
                      className="h-20 accent-violet-500"
                      style={{ writingMode: 'vertical-lr', direction: 'rtl', appearance: 'slider-vertical', width: 24 }}
                    />
                    <span className="text-[9px] font-mono text-gray-600">T-{5 - i}</span>
                  </div>
                ))}
              </div>

              {/* Mini sparkline preview */}
              <svg viewBox="0 0 150 30" className="w-full mt-2 overflow-visible">
                <polyline
                  fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  points={history.map((v, i) => `${i * 30},${30 - (v / 100) * 28}`).join(' ')}
                />
                {history.map((v, i) => (
                  <circle key={i} cx={i * 30} cy={30 - (v / 100) * 28} r="2.5"
                    fill={v > 85 ? '#FF3B5C' : v > 70 ? '#FF9500' : '#7C3AED'} />
                ))}
              </svg>
            </div>

            {error && (
              <p className="text-[#FF9500] text-xs font-mono px-3 py-2 rounded-lg border border-[#FF9500]/30 bg-[#FF9500]/08">
                {error}
              </p>
            )}

            <motion.button
              type="submit"
              disabled={!service.trim() || loading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-mono text-sm font-bold"
              style={{
                backgroundColor: service.trim() && !loading ? 'rgba(124,58,237,0.25)' : 'rgba(124,58,237,0.07)',
                color:           service.trim() && !loading ? '#A78BFA' : '#7C3AED50',
                border:          '1px solid rgba(124,58,237,0.4)',
                cursor:          service.trim() && !loading ? 'pointer' : 'not-allowed',
              }}
              whileHover={service.trim() && !loading ? { scale: 1.01, filter: 'brightness(1.1)' } : {}}
              whileTap={service.trim() && !loading ? { scale: 0.98 } : {}}
            >
              {loading
                ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}><Loader2 size={15} /></motion.div> Running…</>
                : <><Brain size={15} /> Run Prediction Engine</>}
            </motion.button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

function PredictionResult({ result }) {
  if (!result) return null;
  const conf = result?.confidence ?? 0;

  return (
    <motion.div
      className="rounded-2xl p-5 border overflow-hidden relative"
      style={{ backgroundColor: 'rgba(124,58,237,0.07)', borderColor: 'rgba(124,58,237,0.35)' }}
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ ease: EASE, duration: 0.4 }}
    >
      {/* BG glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at top left, rgba(124,58,237,0.15) 0%, transparent 60%)' }} />

      <div className="relative z-10">
        <div className="flex items-center gap-3 mb-4">
          <motion.div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(124,58,237,0.2)', border: '1px solid rgba(167,139,250,0.4)' }}
            animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }}
          >
            <Brain size={20} className="text-[#A78BFA]" />
          </motion.div>
          <div>
            <p className="font-mono text-xs font-black tracking-[0.15em] text-[#A78BFA]">
              🔮 PREDICTION RESULT
            </p>
            <p className="text-gray-500 text-[10px] font-mono">{result?.service}</p>
          </div>
          <span className="ml-auto px-2.5 py-1 rounded-full font-mono text-xs font-bold"
            style={{ backgroundColor: `${confColor(conf)}15`, color: confColor(conf), border: `1px solid ${confColor(conf)}35` }}>
            {Math.round(conf * 100)}% confidence
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {result?.predicted_type && (
            <div>
              <p className="text-[9px] font-mono text-gray-600 uppercase mb-0.5">Predicted Failure</p>
              <p className="text-white font-mono text-sm font-bold capitalize">
                {cap(result.predicted_type)}
              </p>
            </div>
          )}
          {result?.eta_minutes != null && (
            <div>
              <p className="text-[9px] font-mono text-gray-600 uppercase mb-0.5">Estimated ETA</p>
              <p className="text-[#FF9500] font-mono text-sm font-bold flex items-center gap-1.5">
                <Clock size={13} /> ~{result.eta_minutes} min
              </p>
            </div>
          )}
          {result?.recommended_action && (
            <div className="col-span-2">
              <p className="text-[9px] font-mono text-gray-600 uppercase mb-0.5">Recommended Preemptive Action</p>
              <p className="text-[#00D4FF] font-mono text-sm font-bold capitalize flex items-center gap-1.5">
                <Zap size={13} /> {cap(result.recommended_action)}
              </p>
            </div>
          )}
          {Array.isArray(result?.detection_methods) && result.detection_methods.length > 0 && (
            <div className="col-span-2">
              <p className="text-[9px] font-mono text-gray-600 uppercase mb-1.5">Detection Methods</p>
              <div className="flex flex-wrap gap-1.5">
                {result.detection_methods.map((m) => <MethodPill key={m} method={m} />)}
              </div>
            </div>
          )}
        </div>

        {result?.predicted === false && (
          <div className="flex items-center gap-2 mt-4">
            <CheckCircle2 size={14} className="text-[#22C55E]" />
            <p className="text-[#22C55E] text-xs font-mono">No imminent failure predicted for this service</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function PredictiveIntelligenceDashboard() {
  const [predictions, setPredictions] = useState([]);
  const [predLoading, setPredLoading] = useState(true);
  const [scanResetKey, setScanResetKey] = useState(0);
  const [activeMethods, setActiveMethods] = useState(new Set(['linear_regression', 'z_score']));
  const [predResult, setPredResult]   = useState(null);
  const [histOpen, setHistOpen]       = useState(true);
  const abortRef                      = useRef(null);
  const wsRef                         = useRef(null);
  const { subscribe }                 = useSystem();

  // Fetch historical predictive incidents
  const fetchHistory = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    api.get('/api/incidents', { signal: abortRef.current.signal })
      .then(({ data }) => {
        const all  = Array.isArray(data) ? data : [];
        const pred = all.filter((i) => i?.is_predictive === true);
        setPredictions(pred);
        setPredLoading(false);
      })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[PredictiveDashboard] history unavailable, using mock', e);
        setPredictions(MOCK_PREDICTIVE_INCIDENTS);
        setPredLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchHistory();
    return () => { abortRef.current?.abort(); };
  }, [fetchHistory]);

  // WebSocket — reset scan countdown on PREDICTIVE_ALERT
  useEffect(() => {
    return subscribe('PREDICTIVE_ALERT', (msg) => {
      setScanResetKey((k) => k + 1);
      const methods = msg?.data?.detection_methods ?? [];
      setActiveMethods(new Set(methods.length ? methods : ['linear_regression', 'z_score']));
      fetchHistory();
    });
  }, [fetchHistory, subscribe]);

  const confColor2 = (i) => {
    const c = i?.confidence ?? 0;
    return confColor(c);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <motion.div animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.1, 1] }}
            transition={{ duration: 2.5, repeat: Infinity }}>
            <Zap size={16} className="text-[#7C3AED]" />
          </motion.div>
          <div>
            <h2 className="font-mono text-[11px] font-bold tracking-[0.22em] uppercase text-[#A78BFA]">
              Prediction Engine
            </h2>
            <p className="text-gray-600 text-[9px] font-mono">Runs every 30s · 5 detection methods</p>
          </div>
        </div>
        <motion.button onClick={fetchHistory}
          className="p-1.5 rounded-lg text-gray-600 hover:text-[#7C3AED] transition-colors"
          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95, rotate: -30 }}>
          <RefreshCw size={11} />
        </motion.button>
      </div>

      {/* Scan countdown */}
      <ScanCountdown resetKey={scanResetKey} />

      {/* Detection methods */}
      <div className="grid grid-cols-1 gap-2">
        {DETECTION_METHODS.map((method) => (
          <DetectionMethodCard key={method.id} method={method} active={activeMethods.has(method.id)} />
        ))}
      </div>

      {/* Historical predictive incidents */}
      <div className="border border-[#1C2333] rounded-2xl overflow-hidden bg-[#0D1117]">
        <motion.button
          className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors"
          onClick={() => setHistOpen((v) => !v)}
          whileTap={{ scale: 0.99 }}
        >
          <div className="flex items-center gap-2">
            <Eye size={13} className="text-[#7C3AED]" />
            <span className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">
              Historical Predictions
            </span>
            {predictions.length > 0 && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#1C2333] text-gray-500">
                {predictions.length}
              </span>
            )}
          </div>
          {histOpen ? <ChevronUp size={13} className="text-gray-600" /> : <ChevronDown size={13} className="text-gray-600" />}
        </motion.button>

        <AnimatePresence>
          {histOpen && (
            <motion.div
              className="border-t border-[#1C2333]"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ ease: EASE, duration: 0.25 }}
            >
              {predLoading ? (
                <div className="p-4 space-y-2">
                  {[0,1,2].map((i) => <div key={i} className="skeleton h-14 rounded-lg animate-pulse" />)}
                </div>
              ) : predictions.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <Zap size={28} className="text-gray-700" />
                  <p className="text-gray-600 text-xs font-mono">No predictive alerts fired yet</p>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {predictions.map((inc, i) => (
                    <motion.div key={inc?.id ?? i}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                      style={{ backgroundColor: 'rgba(124,58,237,0.05)', border: '1px solid rgba(124,58,237,0.2)' }}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06, ease: EASE, duration: 0.25 }}
                    >
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'rgba(124,58,237,0.15)', color: '#A78BFA' }}>
                        🔮 PRED
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-300 text-xs font-mono capitalize truncate">
                          {cap(inc?.alert_type)}
                        </p>
                        <p className="text-gray-600 text-[9px] font-mono">{inc?.service}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="font-mono text-[10px] font-bold" style={{ color: confColor2(inc) }}>
                          {Math.round((inc?.confidence ?? 0) * 100)}%
                        </span>
                        <span className="text-gray-600 text-[9px] font-mono">
                          {formatTimestamp(inc?.created_at)}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Manual prediction form */}
      <ManualPredictionForm onResult={setPredResult} />

      {/* Prediction result */}
      <AnimatePresence>
        {predResult && <PredictionResult key={predResult?.service + Date.now()} result={predResult} />}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT EXPORT — WebSocket-aware banner host
// ═══════════════════════════════════════════════════════════════════════════════
export default function PredictiveAlertViz() {
  const [activeAlert, setActiveAlert] = useState(null);
  const wsRef = useRef(null);
  const lastPredictionRef = useRef({});

  useEffect(() => {
    let ws;
    let reconnTimer;

    const connect = () => {
      try {
        ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onmessage = (ev) => {
          try {
            const msg  = JSON.parse(ev.data);
            const type = msg?.type ?? msg?.event_type;
            if (type === 'PREDICTIVE_ALERT') {
              const payload = msg?.data ?? msg?.payload ?? {};
              const svc = payload?.service ?? payload?.service_name;

              const now = Date.now();
              const fiveMinutes = 5 * 60 * 1000;
              const last = lastPredictionRef.current[svc];
              if (last && (now - last) < fiveMinutes) return;
              lastPredictionRef.current[svc] = now;

              setActiveAlert({
                service:          svc,
                predicted_type:   payload?.predicted_type ?? payload?.alert_type,
                confidence:       payload?.confidence,
                eta_minutes:      payload?.eta_minutes,
                detection_methods: payload?.detection_methods ?? [],
              });
            }
          } catch { /* ignore */ }
        };
        ws.onerror = () => {};
        ws.onclose = () => { reconnTimer = setTimeout(connect, 5000); };
      } catch { /* ignore */ }
    };

    connect();
    return () => {
      clearTimeout(reconnTimer);
      wsRef.current?.close();
    };
  }, []);

  return (
    <AnimatePresence>
      {activeAlert && (
        <PredictiveAlertBanner
          key={activeAlert.service + activeAlert.predicted_type}
          alert={activeAlert}
          onDismiss={() => setActiveAlert(null)}
          onSubmitAlert={(alert) => {
            // Emit custom event so TopBar modal can catch it if needed
            window.dispatchEvent(new CustomEvent('predictive-preemptive', { detail: alert }));
            setActiveAlert(null);
          }}
        />
      )}
    </AnimatePresence>
  );
}
