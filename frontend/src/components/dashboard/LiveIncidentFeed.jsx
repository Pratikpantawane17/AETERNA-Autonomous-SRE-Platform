import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';
import api from '../../config/api';
import { useSystem } from '../../context/SystemContext';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../config/constants';
import { truncateId, getStatusLabel, formatTimestamp, formatConfidence } from '../../utils/formatters';

const EASE = [0.25, 0.46, 0.45, 0.94];
const MAX_INCIDENTS = 50;

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();

const MOCK_DATA = [
  {
    id: 'a1b2c3d4-0001-0000-0000-000000000001',
    alert_type: 'cpu_spike',
    severity: 'critical',
    service: 'payment-service',
    status: 'processing',
    confidence: 0.94,
    is_predictive: false,
    autonomy_mode: 'AUTO',
    triage_result: {
      root_cause: 'CPU utilization exceeded 95% on pod payment-svc-3',
      recommended_action: 'Scale out payment-service by 3 replicas',
      estimated_impact: 'High — transaction degraded',
    },
    execution_log: [
      { step: 'triage', status: 'completed', ts: ago(14) },
      { step: 'scale_out', status: 'in_progress', ts: ago(12) },
    ],
    state_history: [
      { status: 'new', ts: ago(15) },
      { status: 'triaged', ts: ago(14) },
      { status: 'processing', ts: ago(12) },
    ],
    created_at: ago(15),
    updated_at: ago(2),
  },
  {
    id: 'a1b2c3d4-0002-0000-0000-000000000002',
    alert_type: 'memory_leak',
    severity: 'high',
    service: 'auth-service',
    status: 'awaiting_review',
    confidence: 0.81,
    is_predictive: true,
    autonomy_mode: 'REVIEW',
    triage_result: {
      root_cause: 'Heap usage growing 12MB/hr with no GC collection',
      recommended_action: 'Restart auth-service pods and review session caching',
      estimated_impact: 'Medium — auth latency increasing',
    },
    execution_log: [
      { step: 'triage', status: 'completed', ts: ago(28) },
      { step: 'human_review', status: 'pending', ts: ago(25) },
    ],
    state_history: [
      { status: 'new', ts: ago(30) },
      { status: 'triaged', ts: ago(28) },
      { status: 'awaiting_review', ts: ago(25) },
    ],
    created_at: ago(30),
    updated_at: ago(5),
  },
  {
    id: 'a1b2c3d4-0003-0000-0000-000000000003',
    alert_type: 'high_error_rate',
    severity: 'critical',
    service: 'api-gateway',
    status: 'escalated',
    confidence: 0.97,
    is_predictive: false,
    autonomy_mode: 'ESCALATE',
    triage_result: {
      root_cause: 'Error rate 42% — upstream DB connection pool exhausted',
      recommended_action: 'Immediate DBA intervention required',
      estimated_impact: 'Critical — all API traffic affected',
    },
    execution_log: [
      { step: 'triage', status: 'completed', ts: ago(8) },
      { step: 'escalate', status: 'completed', ts: ago(7) },
    ],
    state_history: [
      { status: 'new', ts: ago(10) },
      { status: 'triaged', ts: ago(8) },
      { status: 'escalated', ts: ago(7) },
    ],
    created_at: ago(10),
    updated_at: ago(1),
  },
  {
    id: 'a1b2c3d4-0004-0000-0000-000000000004',
    alert_type: 'disk_full',
    severity: 'medium',
    service: 'data-pipeline',
    status: 'resolved',
    confidence: 0.88,
    is_predictive: false,
    autonomy_mode: 'AUTO',
    triage_result: {
      root_cause: 'Disk usage at 94% on data-pipeline-worker-1',
      recommended_action: 'Purge logs older than 7 days',
      estimated_impact: 'Low — pipeline stall if not resolved',
    },
    execution_log: [
      { step: 'triage', status: 'completed', ts: ago(55) },
      { step: 'log_purge', status: 'completed', ts: ago(50) },
    ],
    state_history: [
      { status: 'new', ts: ago(60) },
      { status: 'processing', ts: ago(55) },
      { status: 'resolved', ts: ago(50) },
    ],
    created_at: ago(60),
    updated_at: ago(50),
  },
  {
    id: 'a1b2c3d4-0005-0000-0000-000000000005',
    alert_type: 'pod_crash_loop',
    severity: 'high',
    service: 'notification-svc',
    status: 'in_progress',
    confidence: 0.76,
    is_predictive: false,
    autonomy_mode: 'AUTO',
    triage_result: {
      root_cause: 'OOMKilled — container exceeding 512Mi memory limit',
      recommended_action: 'Increase memory limit to 768Mi and add HPA',
      estimated_impact: 'Medium — notifications delayed',
    },
    execution_log: [
      { step: 'triage', status: 'completed', ts: ago(22) },
      { step: 'resource_patch', status: 'in_progress', ts: ago(18) },
    ],
    state_history: [
      { status: 'new', ts: ago(25) },
      { status: 'triaged', ts: ago(22) },
      { status: 'in_progress', ts: ago(18) },
    ],
    created_at: ago(25),
    updated_at: ago(3),
  },
  {
    id: 'a1b2c3d4-0006-0000-0000-000000000006',
    alert_type: 'network_latency',
    severity: 'low',
    service: 'reporting-service',
    status: 'triaged',
    confidence: 0.63,
    is_predictive: true,
    autonomy_mode: 'AUTO',
    triage_result: {
      root_cause: 'P99 latency 340ms, cross-zone traffic spike suspected',
      recommended_action: 'Enforce zone-affinity routing rules',
      estimated_impact: 'Low — report generation slower',
    },
    execution_log: [
      { step: 'triage', status: 'completed', ts: ago(40) },
    ],
    state_history: [
      { status: 'new', ts: ago(42) },
      { status: 'triaged', ts: ago(40) },
    ],
    created_at: ago(42),
    updated_at: ago(40),
  },
  {
    id: 'a1b2c3d4-0007-0000-0000-000000000007',
    alert_type: 'db_connection_pool',
    severity: 'high',
    service: 'inventory-service',
    status: 'verifying',
    confidence: 0.89,
    is_predictive: false,
    autonomy_mode: 'AUTO',
    triage_result: {
      root_cause: 'DB connection pool at 98% capacity (198/200 connections)',
      recommended_action: 'Increase pool size and add read replica routing',
      estimated_impact: 'High — inventory queries failing',
    },
    execution_log: [
      { step: 'triage', status: 'completed', ts: ago(12) },
      { step: 'pool_resize', status: 'completed', ts: ago(8) },
      { step: 'verify', status: 'in_progress', ts: ago(3) },
    ],
    state_history: [
      { status: 'new', ts: ago(15) },
      { status: 'triaged', ts: ago(12) },
      { status: 'processing', ts: ago(8) },
      { status: 'verifying', ts: ago(3) },
    ],
    created_at: ago(15),
    updated_at: ago(3),
  },
  {
    id: 'a1b2c3d4-0008-0000-0000-000000000008',
    alert_type: 'circuit_breaker_open',
    severity: 'critical',
    service: 'checkout-service',
    status: 'new',
    confidence: 0.55,
    is_predictive: false,
    autonomy_mode: null,
    triage_result: null,
    execution_log: [],
    state_history: [{ status: 'new', ts: ago(1) }],
    created_at: ago(1),
    updated_at: ago(1),
  },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function confidenceColor(conf) {
  const c = conf ?? 0;
  if (c >= 0.85) return '#22C55E';
  if (c >= 0.6)  return '#FF9500';
  return '#FF3B5C';
}

function autonomyStyle(mode) {
  if (mode === 'AUTO')     return { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)',  color: '#22C55E' };
  if (mode === 'REVIEW')   return { bg: 'rgba(124,58,237,0.12)', border: 'rgba(124,58,237,0.3)', color: '#A78BFA' };
  if (mode === 'ESCALATE') return { bg: 'rgba(255,59,92,0.12)',  border: 'rgba(255,59,92,0.3)',  color: '#FF3B5C' };
  return null;
}

const AUTONOMY_LABELS = { AUTO: 'AUTO', REVIEW: 'REVIEW', ESCALATE: 'ESCALATE' };

// ─── RADAR EMPTY ─────────────────────────────────────────────────────────────
function RadarEmpty() {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-16 gap-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ease: EASE, duration: 0.4 }}
    >
      <svg width="120" height="120" viewBox="0 0 120 120">
        <defs>
          <radialGradient id="rfeed-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#00D4FF" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#00D4FF" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="60" cy="60" r="54" fill="url(#rfeed-grad)" />
        {[18, 36, 54].map((r, i) => (
          <circle key={i} cx="60" cy="60" r={r} fill="none"
            stroke="#1C2333" strokeWidth="0.8" strokeDasharray="3 4" />
        ))}
        <motion.g animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '60px 60px' }}>
          <line x1="60" y1="60" x2="114" y2="60"
            stroke="#00D4FF" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
          <path d="M 60 60 L 114 60 A 54 54 0 0 0 60 6 Z"
            fill="url(#radar-sweep-fill)" opacity="0.08" />
          <defs>
            <linearGradient id="radar-sweep-fill" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#00D4FF" stopOpacity="0" />
              <stop offset="100%" stopColor="#00D4FF" stopOpacity="1" />
            </linearGradient>
          </defs>
        </motion.g>
        <motion.circle cx="60" cy="60" r="3" fill="#00D4FF"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }} />
      </svg>
      <div className="text-center space-y-1">
        <p className="text-gray-400 text-sm font-mono">Awaiting incidents...</p>
        <p className="text-gray-600 text-[11px]">System is monitoring all services</p>
      </div>
    </motion.div>
  );
}

// ─── PREDICTIVE BANNER ────────────────────────────────────────────────────────
function PredictiveBanner({ event, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 10000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const service  = event?.service ?? 'Unknown';
  const type     = (event?.predicted_alert ?? event?.alert_type ?? 'unknown').replace(/_/g, ' ');
  const eta      = event?.eta_minutes ?? event?.eta ?? null;
  const conf     = event?.confidence ?? 0;
  const methods  = Array.isArray(event?.detection_methods) ? event.detection_methods : [];

  return (
    <motion.div
      className="relative overflow-hidden rounded-xl border border-[#7C3AED]/40 mb-3"
      style={{
        background: 'linear-gradient(135deg, rgba(124,58,237,0.18) 0%, rgba(0,212,255,0.08) 100%)',
        boxShadow: '0 0 40px rgba(124,58,237,0.25), inset 0 0 60px rgba(124,58,237,0.05)',
      }}
      initial={{ y: -60, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -60, opacity: 0, scale: 0.95 }}
      transition={{ ease: EASE, duration: 0.4 }}
    >
      {/* Animated glow border */}
      <motion.div
        className="absolute inset-0 rounded-xl pointer-events-none"
        style={{ border: '1px solid rgba(124,58,237,0.6)' }}
        animate={{ opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2, repeat: Infinity }}
      />

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <motion.span
              className="text-lg"
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >⚡</motion.span>
            <div>
              <p className="text-[#C084FC] font-mono text-xs font-bold tracking-[0.2em] uppercase">
                Predictive Alert
              </p>
              <p className="text-white font-semibold text-sm mt-0.5 capitalize">{type}</p>
            </div>
          </div>
          <button onClick={onDismiss}
            className="text-gray-500 hover:text-white text-xs font-mono transition-colors flex-shrink-0">
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-mono">
          <span className="text-gray-400">
            Service: <span className="text-white">{service}</span>
          </span>
          {eta != null && (
            <span className="text-gray-400">
              ETA: <span className="text-[#FF9500]">{eta}m</span>
            </span>
          )}
          <span className="text-gray-400">
            Confidence: <span style={{ color: confidenceColor(conf) }}>{formatConfidence(conf)}</span>
          </span>
        </div>

        {methods.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {methods.map((m) => (
              <span key={m}
                className="px-2 py-0.5 rounded-full text-[10px] font-mono"
                style={{ backgroundColor: 'rgba(124,58,237,0.2)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.3)' }}>
                {String(m).replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── INCIDENT ROW ─────────────────────────────────────────────────────────────
function IncidentRow({ incident, isNew, isFlashing, onClick }) {
  const sev        = typeof incident?.severity === 'string' ? incident.severity.toLowerCase() : 'low';
  const sevColor   = SEVERITY_COLORS[sev] ?? '#9CA3AF';
  const statusCol  = STATUS_COLORS[incident?.status] ?? '#9CA3AF';
  const conf       = incident?.confidence ?? 0;
  const confColor  = confidenceColor(conf);
  const isResolved = incident?.status === 'resolved';
  const autoStyle  = autonomyStyle(incident?.autonomy_mode);

  return (
    <motion.div
      layout
      initial={{ x: isNew ? -40 : 0, opacity: isNew ? 0 : 1 }}
      animate={{ x: 0, opacity: isResolved ? 0.65 : 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ ease: EASE, duration: 0.35 }}
      className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#1C2333] bg-[#080B14] group overflow-hidden ${onClick ? 'cursor-pointer hover:border-[#00D4FF]/40' : ''}`}
      whileHover={{
        borderColor: isResolved ? '#1C2333' : `${sevColor}30`,
        backgroundColor: `${sevColor}05`,
        transition: { duration: 0.15 },
      }}
      onClick={onClick ? () => onClick(incident?.id) : undefined}
    >
      {/* New item: cyan left border flash fading out */}
      <AnimatePresence>
        {isNew && (
          <motion.div
            key="new-bar"
            className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full"
            style={{ backgroundColor: '#00D4FF' }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 2.5, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {/* Updated item: amber flash overlay */}
      <AnimatePresence>
        {isFlashing && (
          <motion.div
            key="flash-bg"
            className="absolute inset-0 rounded-lg pointer-events-none"
            style={{ backgroundColor: '#FF9500' }}
            initial={{ opacity: 0.18 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
          />
        )}
      </AnimatePresence>

      {/* LEFT: severity badge + info */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        {/* Severity pill */}
        <span
          className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider flex-shrink-0"
          style={{
            backgroundColor: `${sevColor}18`,
            color: sevColor,
            border: `1px solid ${sevColor}38`,
          }}
        >
          {incident?.severity ?? 'N/A'}
        </span>

        {/* Info stack */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-gray-600 font-mono text-[10px] flex-shrink-0">
              #{truncateId(incident?.id)}
            </span>
            <span className="text-white text-xs font-medium truncate capitalize">
              {(incident?.alert_type ?? 'unknown').replace(/_/g, ' ')}
            </span>
          </div>
          <span className="text-gray-500 text-[10px] font-mono truncate block">
            {incident?.service ?? '—'}
          </span>
        </div>
      </div>

      {/* CENTER: status + badge row */}
      <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
        {/* Status */}
        <span
          className="px-2 py-0.5 rounded-full text-[10px] font-mono whitespace-nowrap"
          style={{
            backgroundColor: `${statusCol}15`,
            color: statusCol,
            border: `1px solid ${statusCol}32`,
          }}
        >
          {getStatusLabel(incident?.status)}
        </span>

        {/* Autonomy mode */}
        {autoStyle && incident?.autonomy_mode && (
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-mono whitespace-nowrap"
            style={{
              backgroundColor: autoStyle.bg,
              color: autoStyle.color,
              border: `1px solid ${autoStyle.border}`,
            }}
          >
            {AUTONOMY_LABELS[incident.autonomy_mode] ?? incident.autonomy_mode}
          </span>
        )}

        {/* Predictive badge */}
        {incident?.is_predictive && (
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-mono whitespace-nowrap"
            style={{
              background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(0,212,255,0.15))',
              color: '#C084FC',
              border: '1px solid rgba(124,58,237,0.35)',
            }}
          >
            🔮 PREDICTIVE
          </span>
        )}
      </div>

      {/* RIGHT: confidence + timestamp */}
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0 w-24">
        <div className="flex items-center gap-1.5 w-full">
          <div className="flex-1 h-1 rounded-full bg-[#1C2333] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: confColor }}
              initial={{ width: 0 }}
              animate={{ width: `${(conf * 100).toFixed(0)}%` }}
              transition={{ duration: 0.9, ease: EASE }}
            />
          </div>
          <span className="font-mono text-[10px] flex-shrink-0 w-7 text-right" style={{ color: confColor }}>
            {formatConfidence(conf)}
          </span>
        </div>
        <span className="text-gray-600 text-[10px] font-mono whitespace-nowrap">
          {formatTimestamp(incident?.created_at)}
        </span>
      </div>
    </motion.div>
  );
}

// ─── SEVERITY FILTER CHIPS ───────────────────────────────────────────────────
function SeverityChips({ active, onChange }) {
  const chips = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const colors = {
    ALL: '#9CA3AF', CRITICAL: '#FF3B5C', HIGH: '#FF6B35', MEDIUM: '#FF9500', LOW: '#00D4FF',
  };
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {chips.map((chip) => {
        const isActive = active === chip;
        const color = colors[chip];
        return (
          <motion.button
            key={chip}
            onClick={() => onChange(chip)}
            className="px-2.5 py-1 rounded-md text-[10px] font-mono uppercase tracking-wider transition-all duration-150"
            style={isActive
              ? { backgroundColor: `${color}22`, color, border: `1px solid ${color}55` }
              : { backgroundColor: 'transparent', color: '#6B7280', border: '1px solid #1C2333' }
            }
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={{ ease: EASE, duration: 0.14 }}
          >
            {chip}
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── STATUS SELECT ────────────────────────────────────────────────────────────
function StatusSelect({ value, onChange }) {
  return (
    <div className="relative flex-shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-[#080B14] border border-[#1C2333] rounded-lg px-3 pr-7 py-1.5 text-[11px] font-mono text-gray-400 focus:outline-none focus:border-[#00D4FF]/40 cursor-pointer hover:border-[#00D4FF]/25 transition-colors"
      >
        <option value="all"       style={{ backgroundColor: '#0D1117' }}>All Statuses</option>
        <option value="new"       style={{ backgroundColor: '#0D1117' }}>New</option>
        <option value="processing" style={{ backgroundColor: '#0D1117' }}>Processing</option>
        <option value="in_progress" style={{ backgroundColor: '#0D1117' }}>In Progress</option>
        <option value="awaiting_review" style={{ backgroundColor: '#0D1117' }}>Awaiting Review</option>
        <option value="escalated" style={{ backgroundColor: '#0D1117' }}>Escalated</option>
        <option value="resolved"  style={{ backgroundColor: '#0D1117' }}>Resolved</option>
      </select>
      <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
    </div>
  );
}

// ─── ERROR STATE ──────────────────────────────────────────────────────────────
function FeedError({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <AlertCircle size={22} className="text-[#FF3B5C]" />
      <p className="text-gray-500 text-xs font-mono text-center max-w-xs">{message}</p>
      <motion.button
        onClick={onRetry}
        className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-lg border border-[#FF3B5C]/30 text-[#FF3B5C] hover:text-white hover:border-[#FF3B5C]/60 transition-colors"
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
      >
        <RefreshCw size={11} /> Retry
      </motion.button>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function LiveIncidentFeed({ onRowClick, maxHeight = 480 }) {
  const { wsConnected, lastWsEvent } = useSystem();

  const [incidents, setIncidents]           = useState([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState(null);
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter]     = useState('all');
  const [newIds, setNewIds]                 = useState(new Set());
  const [flashIds, setFlashIds]             = useState(new Set());
  const [predictiveBanner, setPredictiveBanner] = useState(null);

  const abortRef           = useRef(null);
  const newIdTimers        = useRef(new Map());
  const flashIdTimers      = useRef(new Map());
  const predictiveTimer    = useRef(null);
  const lastHandledEvent   = useRef(null);
  // Tick to refresh relative timestamps every 30s
  const [, setTick]        = useState(0);

  // ── Fetch initial incidents ────────────────────────────────────────────────
  const fetchIncidents = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.get('/api/incidents', { signal });
      if (!signal.aborted) {
        const list = Array.isArray(data) ? data.slice(0, 20) : [];
        setIncidents(list);
        setError(null);
      }
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[LiveIncidentFeed] API unavailable, using mock', e);
      setIncidents(MOCK_DATA);
      setError(e?.response?.data?.detail ?? e.message ?? 'Could not load incidents');
    } finally {
      if (!abortRef.current?.signal?.aborted) setLoading(false);
    }
  }, []);

  // ── Flash helpers ──────────────────────────────────────────────────────────
  const addNewId = useCallback((id, duration = 3000) => {
    setNewIds((prev) => new Set([...prev, id]));
    if (newIdTimers.current.has(id)) clearTimeout(newIdTimers.current.get(id));
    const t = setTimeout(() => {
      setNewIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      newIdTimers.current.delete(id);
    }, duration);
    newIdTimers.current.set(id, t);
  }, []);

  const addFlashId = useCallback((id, duration = 1600) => {
    setFlashIds((prev) => new Set([...prev, id]));
    if (flashIdTimers.current.has(id)) clearTimeout(flashIdTimers.current.get(id));
    const t = setTimeout(() => {
      setFlashIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      flashIdTimers.current.delete(id);
    }, duration);
    flashIdTimers.current.set(id, t);
  }, []);

  // ── WebSocket event handler ────────────────────────────────────────────────
  useEffect(() => {
    if (!lastWsEvent || lastWsEvent === lastHandledEvent.current) return;
    lastHandledEvent.current = lastWsEvent;

    const { type, data } = lastWsEvent ?? {};
    if (!type) return;

    if (type === 'INCIDENT_CREATED' && data) {
      setIncidents((prev) => [data, ...prev].slice(0, MAX_INCIDENTS));
      addNewId(data.id);
    } else if ((type === 'INCIDENT_UPDATED' || type === 'INCIDENT_ERROR') && data) {
      setIncidents((prev) =>
        prev.map((inc) => (inc.id === data.id ? { ...inc, ...data } : inc))
      );
      addFlashId(data.id);
    } else if (type === 'INCIDENT_RESOLVED' && data) {
      setIncidents((prev) =>
        prev.map((inc) =>
          inc.id === data.id ? { ...inc, ...data, status: 'resolved' } : inc
        )
      );
      addFlashId(data.id, 2200);
    } else if (type === 'PREDICTIVE_ALERT' && data) {
      setPredictiveBanner(data);
      if (predictiveTimer.current) clearTimeout(predictiveTimer.current);
      predictiveTimer.current = setTimeout(() => setPredictiveBanner(null), 10000);
    }
  }, [lastWsEvent, addNewId, addFlashId]);

  // ── Mount / unmount ────────────────────────────────────────────────────────
  useEffect(() => {
    fetchIncidents();
    const tickInterval = setInterval(() => setTick((t) => t + 1), 30000);

    return () => {
      clearInterval(tickInterval);
      if (abortRef.current) abortRef.current.abort();
      if (predictiveTimer.current) clearTimeout(predictiveTimer.current);
      newIdTimers.current.forEach(clearTimeout);
      flashIdTimers.current.forEach(clearTimeout);
      newIdTimers.current.clear();
      flashIdTimers.current.clear();
    };
  }, [fetchIncidents]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return incidents.filter((inc) => {
      const sevMatch =
        severityFilter === 'ALL' ||
        (inc?.severity?.toUpperCase() ?? '') === severityFilter;
      const statMatch =
        statusFilter === 'all' || inc?.status === statusFilter;
      return sevMatch && statMatch;
    });
  }, [incidents, severityFilter, statusFilter]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#0D1117] border border-[#1C2333] rounded-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1C2333] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Zap size={14} className="text-[#00D4FF]" />
          <span className="text-white font-mono text-xs font-semibold tracking-[0.15em] uppercase">
            Live Incident Feed
          </span>
          {/* WS live dot */}
          {wsConnected && (
            <div className="relative flex-shrink-0">
              <motion.div
                className="w-2 h-2 rounded-full bg-[#FF3B5C]"
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              />
              <div className="absolute inset-0 w-2 h-2 rounded-full bg-[#FF3B5C] opacity-30"
                style={{ filter: 'blur(3px)' }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-600 text-[11px] font-mono">
            {filtered.length}/{incidents.length} shown
          </span>
          <motion.button
            onClick={fetchIncidents}
            className="p-1.5 rounded-md text-gray-600 hover:text-[#00D4FF] hover:bg-[#00D4FF]/8 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9, rotate: 180 }}
            transition={{ ease: EASE, duration: 0.2 }}
          >
            <RefreshCw size={12} />
          </motion.button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[#1C2333] flex-shrink-0 flex-wrap">
        <SeverityChips active={severityFilter} onChange={setSeverityFilter} />
        <div className="ml-auto">
          <StatusSelect value={statusFilter} onChange={setStatusFilter} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-0"
        style={{ maxHeight }}>

        {/* Predictive alert banner */}
        <AnimatePresence>
          {predictiveBanner && (
            <PredictiveBanner
              key="pred-banner"
              event={predictiveBanner}
              onDismiss={() => setPredictiveBanner(null)}
            />
          )}
        </AnimatePresence>

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#1C2333]">
                <div className="skeleton w-14 h-5 rounded flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton h-3 w-40 rounded" />
                  <div className="skeleton h-2.5 w-24 rounded" />
                </div>
                <div className="skeleton w-20 h-4 rounded-full flex-shrink-0" />
                <div className="flex flex-col gap-1.5 items-end w-24">
                  <div className="skeleton h-1 w-full rounded-full" />
                  <div className="skeleton h-2.5 w-12 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && incidents.length === 0 && (
          <FeedError message={error} onRetry={fetchIncidents} />
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <RadarEmpty />
        )}

        {/* Incident list */}
        {!loading && filtered.length > 0 && (
          <AnimatePresence mode="popLayout" initial={false}>
            <div className="space-y-1.5">
              {filtered.map((inc) => (
                <IncidentRow
                  key={inc?.id ?? Math.random()}
                  incident={inc}
                  isNew={newIds.has(inc?.id)}
                  isFlashing={flashIds.has(inc?.id)}
                  onClick={onRowClick}
                />
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
