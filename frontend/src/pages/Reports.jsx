import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, AlertTriangle, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Upload, Search, Filter, Brain, ArrowRight, Clock,
  BarChart3, Shield, Layers,
} from 'lucide-react';
import api from '../config/api';
import { formatTimestamp, truncateId } from '../utils/formatters';

const EASE = [0.25, 0.46, 0.45, 0.94];

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const T = (m) => new Date(Date.now() - m * 60000).toISOString();

const MOCK_DIGEST = {
  generated_at: T(5),
  period: 'last_7_days',
  top_incidents: [
    { incident_id: 'inc-001', service: 'payment-service', alert_type: 'cpu_spike',     status: 'resolved'       },
    { incident_id: 'inc-002', service: 'auth-service',    alert_type: 'memory_leak',   status: 'resolved'       },
    { incident_id: 'inc-003', service: 'db-primary',      alert_type: 'disk_full',     status: 'escalated'      },
    { incident_id: 'inc-004', service: 'api-gateway',     alert_type: 'network_latency', status: 'resolved'    },
    { incident_id: 'inc-005', service: 'cache-layer',     alert_type: 'high_error_rate', status: 'awaiting_review' },
  ],
  services_needing_attention: ['payment-service', 'db-primary', 'cache-layer'],
  automation_metrics: {
    total_incidents: 142, auto_resolved: 118, human_reviewed: 18, escalated: 6,
    automation_rate_pct: 83.1,
    action_success_rates: [
      { action: 'scale_service',      success_rate: 0.91, count: 34 },
      { action: 'restart_service',    success_rate: 0.84, count: 28 },
      { action: 'cleanup_logs',       success_rate: 0.96, count: 19 },
      { action: 'switch_to_fallback', success_rate: 0.78, count: 14 },
      { action: 'circuit_break',      success_rate: 0.72, count: 11 },
    ],
  },
};

const MOCK_HALLUCINATIONS = [
  { id: 'h1', timestamp: T(30),  incident_id: 'inc-001', alert_type: 'cpu_spike',     service: 'payment-service', llm_provider: 'gemini', bounded_adjustment: 0.05,  status: 'checked' },
  { id: 'h2', timestamp: T(90),  incident_id: 'inc-002', alert_type: 'memory_leak',   service: 'auth-service',    llm_provider: 'gemini', bounded_adjustment: -0.03, status: 'checked' },
  { id: 'h3', timestamp: T(150), incident_id: 'inc-003', alert_type: 'disk_full',     service: 'db-primary',      llm_provider: 'none',   bounded_adjustment: 0,     status: 'skipped' },
  { id: 'h4', timestamp: T(200), incident_id: 'inc-004', alert_type: 'network_latency', service: 'api-gateway',  llm_provider: 'grok',   bounded_adjustment: 0.02,  status: 'checked' },
  { id: 'h5', timestamp: T(260), incident_id: 'inc-005', alert_type: 'high_error_rate', service: 'cache-layer',  llm_provider: 'gemini', bounded_adjustment: 0.08,  status: 'checked' },
];

const MOCK_AUDIT = Array.from({ length: 48 }, (_, i) => ({
  id: `audit-${i}`, timestamp: T(i * 8),
  event_type: ['INCIDENT_CREATED', 'INCIDENT_UPDATED', 'INCIDENT_RESOLVED', 'WORKFLOW_STEP_COMPLETED', 'KILL_SWITCH_TOGGLED', 'OVERRIDE_SUBMITTED'][i % 6],
  details: `Event ${i + 1} detail payload`,
  actor: ['system', 'alice@ops', 'bob@sre', 'system'][i % 4],
}));

const MOCK_OVERRIDES = [
  { id: 'ov-1', timestamp: T(120), incident_id: 'inc-001', decision: 'approve', action: 'scale_service',    ai_action: 'scale_service',    actor: 'alice@ops', note: 'Agreed with AI' },
  { id: 'ov-2', timestamp: T(240), incident_id: 'inc-002', decision: 'redirect', action: 'escalate',        ai_action: 'restart_service',  actor: 'bob@sre',   note: 'Too risky at peak' },
  { id: 'ov-3', timestamp: T(360), incident_id: 'inc-003', decision: 'approve', action: 'cleanup_logs',     ai_action: 'cleanup_logs',     actor: 'alice@ops', note: '' },
  { id: 'ov-4', timestamp: T(460), incident_id: 'inc-004', decision: 'reject',  action: null,               ai_action: 'scale_service',    actor: 'carol@cto', note: 'Escalate to on-call' },
  { id: 'ov-5', timestamp: T(600), incident_id: 'inc-005', decision: 'redirect', action: 'manual_review',   ai_action: 'switch_to_fallback', actor: 'bob@sre', note: 'Need more data' },
  { id: 'ov-6', timestamp: T(800), incident_id: 'inc-006', decision: 'approve', action: 'restart_service',  ai_action: 'restart_service',  actor: 'alice@ops', note: '' },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const str = (v) => (v != null ? String(v) : '');
const cap = (v) => str(v).replace(/_/g, ' ');

const STATUS_COLORS = {
  resolved: '#22C55E', escalated: '#FF3B5C', awaiting_review: '#7C3AED',
  processing: '#FF9500', new: '#9CA3AF', in_progress: '#00D4FF',
};
const EVENT_COLORS = {
  INCIDENT_CREATED:         '#00D4FF',
  INCIDENT_UPDATED:         '#FF9500',
  INCIDENT_RESOLVED:        '#22C55E',
  WORKFLOW_STEP_COMPLETED:  '#7C3AED',
  KILL_SWITCH_TOGGLED:      '#FF3B5C',
  OVERRIDE_SUBMITTED:       '#A78BFA',
};
const LLM_COLORS = { gemini: '#4285F4', grok: '#00D4FF', openai: '#10A37F', none: '#6B7280' };

// ─── REUSABLE WRAPPERS ────────────────────────────────────────────────────────
function SectionCard({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div
      className="bg-[#0D1117] border border-[#1C2333] rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE, duration: 0.35 }}
    >
      <motion.button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors border-b border-[#1C2333]"
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.995 }}
      >
        <div className="flex items-center gap-2.5">
          <Icon size={14} className="text-[#00D4FF]" />
          <span className="font-mono text-xs font-bold tracking-[0.18em] uppercase text-white">{title}</span>
        </div>
        {open ? <ChevronUp size={13} className="text-gray-600" /> : <ChevronDown size={13} className="text-gray-600" />}
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.3 }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="divide-y divide-[#1C2333]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-5 py-3">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="skeleton h-3 rounded flex-1 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon = FileText, message = 'No data available', sub = '' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <motion.div
        className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)' }}
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 3, repeat: Infinity }}
      >
        <Icon size={28} className="text-gray-600" />
      </motion.div>
      <p className="text-gray-400 text-sm font-mono">{message}</p>
      {sub && <p className="text-gray-600 text-xs font-mono">{sub}</p>}
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <div className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ backgroundColor: 'rgba(255,59,92,0.1)', border: '1px solid rgba(255,59,92,0.3)' }}>
        <XCircle size={26} className="text-[#FF3B5C]" />
      </div>
      <p className="text-gray-400 text-sm font-mono">{message ?? 'Failed to load data'}</p>
      {onRetry && (
        <motion.button onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#1C2333] text-gray-400 hover:text-white hover:border-[#00D4FF]/40 text-xs font-mono transition-colors"
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
          <RefreshCw size={12} /> Retry
        </motion.button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — WEEKLY DIGEST
// ═══════════════════════════════════════════════════════════════════════════════
function AnimatedBar({ value, color, maxVal = 1, delay = 0 }) {
  const pct = Math.min(100, Math.max(0, (value / maxVal) * 100));
  return (
    <div className="h-full rounded-t-sm overflow-hidden flex items-end">
      <motion.div className="w-full rounded-t-sm" style={{ backgroundColor: color }}
        initial={{ height: 0 }}
        animate={{ height: `${pct}%` }}
        transition={{ duration: 0.9, delay, ease: [0.34, 1.56, 0.64, 1] }}
      />
    </div>
  );
}

function ActionBarChart({ data }) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const maxH = 120;

  return (
    <div className="flex items-end gap-3 mt-2" style={{ height: maxH + 40 }}>
      {data.map((item, i) => {
        const pct = (item?.success_rate ?? 0) * 100;
        const color = pct >= 90 ? '#22C55E' : pct >= 80 ? '#00D4FF' : pct >= 70 ? '#FF9500' : '#FF3B5C';
        return (
          <div key={item?.action ?? i} className="flex flex-col items-center gap-1 flex-1">
            <span className="font-mono text-[10px] font-bold tabular-nums" style={{ color }}>
              {pct.toFixed(0)}%
            </span>
            <div className="w-full relative" style={{ height: maxH }}>
              <AnimatedBar value={pct} maxVal={100} color={color} delay={i * 0.08} />
            </div>
            <span className="text-[8px] font-mono text-gray-600 text-center leading-tight capitalize">
              {cap(item?.action ?? '').replace('service', 'svc')}
            </span>
            <span className="text-[8px] font-mono text-gray-700">×{item?.count ?? 0}</span>
          </div>
        );
      })}
    </div>
  );
}

function WeeklyDigest() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const fetch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true); setError(null);

    api.get('/api/reports/weekly-digest', { signal: abortRef.current.signal })
      .then(({ data }) => { setData(data ?? null); setLoading(false); })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[WeeklyDigest] API unavailable, using mock', e);
        setData(MOCK_DIGEST); setLoading(false); setError('Live report unavailable');
      });
  }, []);

  useEffect(() => { fetch(); return () => { abortRef.current?.abort(); }; }, [fetch]);

  const metrics = data?.automation_metrics;

  return (
    <SectionCard title="Weekly Digest" icon={BarChart3}>
      <div className="p-6 space-y-6">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-mono"
            style={{ color: '#FF9500', backgroundColor: 'rgba(255,149,0,0.07)', borderColor: 'rgba(255,149,0,0.3)' }}>
            <AlertTriangle size={11} /> {error} — showing cached report
          </div>
        )}

        {loading ? (
          <div className="space-y-4 animate-pulse">
            <div className="skeleton h-4 w-40 rounded" />
            <TableSkeleton rows={5} cols={4} />
          </div>
        ) : !data ? (
          <EmptyState message="No weekly report yet" sub="Reports generate automatically after 7 days of data" />
        ) : (
          <>
            {/* Meta */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-gray-500 text-[11px] font-mono">
                Generated: <span className="text-gray-300">{formatTimestamp(data?.generated_at)}</span>
              </span>
              <span className="text-gray-700">·</span>
              <span className="text-gray-500 text-[11px] font-mono capitalize">{cap(data?.period ?? '')}</span>
            </div>

            {/* KPI strip */}
            {metrics && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total Incidents',  value: metrics.total_incidents,  color: '#00D4FF' },
                  { label: 'Auto-Resolved',    value: metrics.auto_resolved,    color: '#22C55E' },
                  { label: 'Human Reviewed',   value: metrics.human_reviewed,   color: '#FF9500' },
                  { label: 'Automation Rate',  value: `${metrics.automation_rate_pct?.toFixed(1)}%`, color: '#A78BFA' },
                ].map((kpi) => (
                  <div key={kpi.label} className="rounded-xl border border-[#1C2333] bg-[#080B14] px-4 py-3">
                    <p className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">{kpi.label}</p>
                    <p className="font-mono font-black text-xl mt-1" style={{ color: kpi.color }}>{kpi.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Action success bar chart */}
            {metrics?.action_success_rates?.length > 0 && (
              <div>
                <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em] mb-4">
                  Action Success Rates
                </p>
                <ActionBarChart data={metrics.action_success_rates} />
              </div>
            )}

            {/* Top 5 incidents table */}
            {Array.isArray(data?.top_incidents) && data.top_incidents.length > 0 && (
              <div>
                <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em] mb-3">
                  Top Incidents This Week
                </p>
                <div className="border border-[#1C2333] rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-[#080B14] border-b border-[#1C2333]">
                        {['Incident ID', 'Service', 'Alert Type', 'Status'].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-[9px] font-mono text-gray-600 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1C2333]">
                      {data.top_incidents.map((inc, i) => {
                        const sc = STATUS_COLORS[inc?.status] ?? '#9CA3AF';
                        return (
                          <motion.tr key={inc?.incident_id ?? i}
                            className="hover:bg-white/[0.02] transition-colors"
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.05, ease: EASE, duration: 0.25 }}>
                            <td className="px-4 py-2.5 font-mono text-[11px] text-[#00D4FF]">
                              #{truncateId(inc?.incident_id)}
                            </td>
                            <td className="px-4 py-2.5 text-[11px] text-gray-300 font-mono">{inc?.service ?? '—'}</td>
                            <td className="px-4 py-2.5 text-[11px] text-gray-400 font-mono capitalize">{cap(inc?.alert_type)}</td>
                            <td className="px-4 py-2.5">
                              <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold capitalize"
                                style={{ backgroundColor: `${sc}15`, color: sc }}>
                                {cap(inc?.status ?? 'unknown')}
                              </span>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Services needing attention */}
            {Array.isArray(data?.services_needing_attention) && data.services_needing_attention.length > 0 && (
              <div>
                <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em] mb-2">
                  Services Needing Attention
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.services_needing_attention.map((svc) => (
                    <span key={svc}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-[11px] font-semibold border"
                      style={{ backgroundColor: 'rgba(255,59,92,0.1)', color: '#FF3B5C', borderColor: 'rgba(255,59,92,0.35)' }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B5C] flex-shrink-0" />
                      {svc}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — LLM RELIABILITY AUDIT
// ═══════════════════════════════════════════════════════════════════════════════
function MiniDonut({ data }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  const r = 28, cx = 36, cy = 36, stroke = 10;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1C2333" strokeWidth={stroke} />
      {data.map((d) => {
        const frac = d.count / total;
        const dash = frac * circ;
        const seg = (
          <motion.circle key={d.label} cx={cx} cy={cy} r={r} fill="none"
            stroke={d.color} strokeWidth={stroke} strokeLinecap="butt"
            strokeDasharray={`${dash} ${circ}`}
            strokeDashoffset={-offset}
            style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}
            initial={{ strokeDasharray: `0 ${circ}` }}
            animate={{ strokeDasharray: `${dash} ${circ}` }}
            transition={{ duration: 0.9, delay: 0.2, ease: EASE }}
          />
        );
        offset += dash;
        return seg;
      })}
      <text x={cx} y={cy + 4} textAnchor="middle" fill="white" fontSize="11" fontFamily="monospace" fontWeight="bold">
        {total}
      </text>
    </svg>
  );
}

function LlmAudit() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortCol, setSortCol] = useState('timestamp');
  const [sortDir, setSortDir] = useState('desc');
  const abortRef = useRef(null);

  const fetch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true); setError(null);

    api.get('/api/reliability/hallucinations', { signal: abortRef.current.signal })
      .then(({ data: d }) => { setData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[LlmAudit] API unavailable, using mock', e);
        setData(MOCK_HALLUCINATIONS); setLoading(false); setError('Live data unavailable');
      });
  }, []);

  useEffect(() => { fetch(); return () => { abortRef.current?.abort(); }; }, [fetch]);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const sorted = [...data].sort((a, b) => {
    const av = a[sortCol] ?? ''; const bv = b[sortCol] ?? '';
    const cmp = str(av).localeCompare(str(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Stats
  const totalLLM    = data.filter((d) => (d?.llm_provider ?? '') !== 'none').length;
  const avgAdj      = data.length ? (data.reduce((s, d) => s + (d?.bounded_adjustment ?? 0), 0) / data.length) : 0;
  const provBreak   = ['gemini', 'grok', 'none'].map((p) => ({
    label: p.toUpperCase(),
    count: data.filter((d) => d?.llm_provider === p).length,
    color: LLM_COLORS[p],
  })).filter((d) => d.count > 0);

  const SortIcon = ({ col }) => sortCol === col
    ? (sortDir === 'asc' ? <ChevronUp size={10} className="inline ml-1" /> : <ChevronDown size={10} className="inline ml-1" />)
    : null;

  return (
    <SectionCard title="LLM Reliability Audit" icon={Brain}>
      <div className="p-6 space-y-5">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-mono"
            style={{ color: '#FF9500', backgroundColor: 'rgba(255,149,0,0.07)', borderColor: 'rgba(255,149,0,0.3)' }}>
            <AlertTriangle size={11} /> {error}
          </div>
        )}

        {/* Summary stats */}
        {!loading && data.length > 0 && (
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-[9px] font-mono text-gray-600 uppercase">Total LLM Calls</p>
              <p className="font-mono text-2xl font-black text-[#00D4FF]">{totalLLM}</p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-gray-600 uppercase">Avg Adjustment</p>
              <p className="font-mono text-2xl font-black" style={{ color: avgAdj >= 0 ? '#22C55E' : '#FF3B5C' }}>
                {avgAdj >= 0 ? '+' : ''}{(avgAdj * 100).toFixed(2)}%
              </p>
            </div>
            <div className="flex items-center gap-3">
              <MiniDonut data={provBreak} />
              <div className="space-y-1">
                {provBreak.map((p) => (
                  <div key={p.label} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
                    <span className="text-[9px] font-mono text-gray-500">{p.label}</span>
                    <span className="text-[9px] font-mono font-bold" style={{ color: p.color }}>{p.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {loading ? <TableSkeleton rows={5} cols={6} /> : data.length === 0 ? (
          <EmptyState icon={Brain} message="No LLM audit events yet" />
        ) : (
          <div className="border border-[#1C2333] rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="bg-[#080B14] border-b border-[#1C2333]">
                    {[['timestamp','Timestamp'],['incident_id','Incident'],['alert_type','Alert Type'],['service','Service'],['llm_provider','Provider'],['bounded_adjustment','Adjustment'],['status','Status']].map(([col, lbl]) => (
                      <th key={col}
                        className="px-4 py-2.5 text-left text-[9px] font-mono text-gray-600 uppercase tracking-wider cursor-pointer hover:text-gray-400 select-none"
                        onClick={() => toggleSort(col)}>
                        {lbl}<SortIcon col={col} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1C2333]">
                  {sorted.map((row, i) => {
                    const adj = row?.bounded_adjustment ?? 0;
                    const prov = (row?.llm_provider ?? 'none').toLowerCase();
                    const provColor = LLM_COLORS[prov] ?? '#9CA3AF';
                    return (
                      <motion.tr key={row?.id ?? i}
                        className="hover:bg-white/[0.02] transition-colors"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.03, ease: EASE, duration: 0.2 }}>
                        <td className="px-4 py-2.5 text-[11px] font-mono text-gray-500 whitespace-nowrap">
                          {formatTimestamp(row?.timestamp)}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-[#00D4FF]">
                          #{truncateId(row?.incident_id)}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] font-mono text-gray-400 capitalize">{cap(row?.alert_type)}</td>
                        <td className="px-4 py-2.5 text-[11px] font-mono text-gray-300">{row?.service ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase"
                            style={{ backgroundColor: `${provColor}15`, color: provColor }}>
                            {prov.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] font-bold tabular-nums"
                          style={{ color: adj > 0 ? '#22C55E' : adj < 0 ? '#FF3B5C' : '#6B7280' }}>
                          {adj === 0 ? '—' : `${adj > 0 ? '+' : ''}${(adj * 100).toFixed(2)}%`}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 rounded text-[9px] font-mono uppercase"
                            style={{
                              backgroundColor: row?.status === 'checked' ? 'rgba(34,197,94,0.12)' : 'rgba(156,163,175,0.1)',
                              color: row?.status === 'checked' ? '#22C55E' : '#9CA3AF',
                            }}>
                            {row?.status ?? 'unknown'}
                          </span>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — FULL AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════════
const PAGE_SIZE = 20;

function AuditLog() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const abortRef = useRef(null);

  const fetch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true); setError(null); setPage(0);

    api.get('/api/audit', { signal: abortRef.current.signal })
      .then(({ data: d }) => { setData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[AuditLog] API unavailable, using mock', e);
        setData(MOCK_AUDIT); setError('Live data unavailable'); setLoading(false);
      });
  }, []);

  useEffect(() => { fetch(); return () => { abortRef.current?.abort(); }; }, [fetch]);

  const allTypes = ['ALL', ...new Set(data.map((d) => d?.event_type).filter(Boolean))];

  const filtered = data.filter((row) => {
    const matchType = typeFilter === 'ALL' || row?.event_type === typeFilter;
    const q = search.toLowerCase();
    const matchSearch = !q
      || str(row?.event_type).toLowerCase().includes(q)
      || str(row?.details).toLowerCase().includes(q)
      || str(row?.actor).toLowerCase().includes(q);
    return matchType && matchSearch;
  });

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <SectionCard title="Full Audit Log" icon={Layers}>
      <div className="p-5 space-y-4">
        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-40">
            <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
            <input
              type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search events…"
              className="w-full bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg pl-8 pr-3 py-2 placeholder-gray-700 focus:outline-none focus:border-[#00D4FF]/40 transition-colors"
            />
          </div>
          {/* Type filter */}
          <div className="relative">
            <Filter size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
            <select
              value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
              className="appearance-none bg-[#080B14] border border-[#1C2333] text-gray-300 text-[11px] font-mono rounded-lg pl-7 pr-6 py-2 focus:outline-none focus:border-[#00D4FF]/40 transition-colors"
              style={{ colorScheme: 'dark' }}>
              {allTypes.map((t) => <option key={t} value={t} className="bg-[#0D1117]">{t}</option>)}
            </select>
            <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
          </div>
          {/* Refresh */}
          <motion.button onClick={fetch}
            className="p-2 rounded-lg border border-[#1C2333] text-gray-600 hover:text-[#00D4FF] hover:border-[#00D4FF]/30 transition-colors"
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95, rotate: -25 }}>
            <RefreshCw size={12} />
          </motion.button>
          <span className="text-[10px] font-mono text-gray-600">{filtered.length} events</span>
        </div>

        {loading ? <TableSkeleton rows={8} cols={4} /> : error && data.length === 0 ? (
          <ErrorState message={error} onRetry={fetch} />
        ) : filtered.length === 0 ? (
          <EmptyState message="No events match your filters" />
        ) : (
          <>
            <div className="border border-[#1C2333] rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#080B14] border-b border-[#1C2333]">
                    {['Timestamp', 'Event Type', 'Actor', 'Details'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[9px] font-mono text-gray-600 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1C2333]">
                  <AnimatePresence initial={false}>
                    {visible.map((row, i) => {
                      const ec = EVENT_COLORS[row?.event_type] ?? '#9CA3AF';
                      return (
                        <motion.tr key={row?.id ?? `${page}-${i}`}
                          layout
                          className="hover:bg-white/[0.02] transition-colors"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ delay: i * 0.02, duration: 0.2 }}>
                          <td className="px-4 py-2.5 text-[11px] font-mono text-gray-600 whitespace-nowrap">
                            {formatTimestamp(row?.timestamp)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded"
                              style={{ backgroundColor: `${ec}12`, color: ec }}>
                              {row?.event_type ?? '—'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-[11px] font-mono text-gray-500">{row?.actor ?? 'system'}</td>
                          <td className="px-4 py-2.5 text-[11px] font-mono text-gray-400 truncate max-w-xs">{str(row?.details)}</td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-gray-600">
                  Page {page + 1} of {totalPages} · {filtered.length} events
                </span>
                <div className="flex items-center gap-1">
                  <motion.button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                    className="p-1.5 rounded-lg border border-[#1C2333] text-gray-600 disabled:opacity-30 hover:text-white hover:border-[#00D4FF]/30 transition-colors"
                    whileHover={page > 0 ? { scale: 1.05 } : {}} whileTap={page > 0 ? { scale: 0.95 } : {}}>
                    <ChevronLeft size={13} />
                  </motion.button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const pg = page < 3 ? i : page > totalPages - 4 ? totalPages - 5 + i : page - 2 + i;
                    if (pg < 0 || pg >= totalPages) return null;
                    return (
                      <motion.button key={pg} onClick={() => setPage(pg)}
                        className="w-7 h-7 rounded-lg text-[11px] font-mono border transition-all"
                        style={{
                          backgroundColor: pg === page ? 'rgba(0,212,255,0.15)' : 'transparent',
                          borderColor:     pg === page ? 'rgba(0,212,255,0.4)'  : '#1C2333',
                          color:           pg === page ? '#00D4FF' : '#6B7280',
                        }}
                        whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }}>
                        {pg + 1}
                      </motion.button>
                    );
                  })}
                  <motion.button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    className="p-1.5 rounded-lg border border-[#1C2333] text-gray-600 disabled:opacity-30 hover:text-white hover:border-[#00D4FF]/30 transition-colors"
                    whileHover={page < totalPages - 1 ? { scale: 1.05 } : {}} whileTap={page < totalPages - 1 ? { scale: 0.95 } : {}}>
                    <ChevronRight size={13} />
                  </motion.button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — OVERRIDE HISTORY TIMELINE
// ═══════════════════════════════════════════════════════════════════════════════
const DECISION_CFG = {
  approve:  { color: '#22C55E', label: 'Approved'  },
  redirect: { color: '#FF9500', label: 'Redirected' },
  reject:   { color: '#FF3B5C', label: 'Rejected'   },
};

function OverrideTimeline() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const fetch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true); setError(null);

    api.get('/api/overrides', { signal: abortRef.current.signal })
      .then(({ data: d }) => { setData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[OverrideTimeline] API unavailable, using mock', e);
        setData(MOCK_OVERRIDES); setError('Live data unavailable'); setLoading(false);
      });
  }, []);

  useEffect(() => { fetch(); return () => { abortRef.current?.abort(); }; }, [fetch]);

  const disagreements = data.filter((d) => str(d?.action) !== str(d?.ai_action) && d?.ai_action).length;
  const overrideRate  = data.length > 0 ? ((disagreements / data.length) * 100).toFixed(0) : 0;

  return (
    <SectionCard title="Override History Timeline" icon={Shield}>
      <div className="p-6 space-y-5">
        {!loading && data.length > 0 && (
          <div className="flex items-center gap-5 flex-wrap">
            <div>
              <p className="text-[9px] font-mono text-gray-600 uppercase">Total Overrides</p>
              <p className="font-mono text-2xl font-black text-white">{data.length}</p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-gray-600 uppercase">Disagreement Rate</p>
              <p className="font-mono text-2xl font-black"
                style={{ color: Number(overrideRate) > 30 ? '#FF9500' : '#22C55E' }}>
                {overrideRate}%
              </p>
            </div>
            <p className="text-gray-600 text-[11px] font-mono ml-auto">
              Human chose differently than AI in {disagreements} of {data.length} overrides
            </p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0,1,2,3].map((i) => <div key={i} className="skeleton h-14 rounded-lg animate-pulse" />)}
          </div>
        ) : data.length === 0 ? (
          <EmptyState icon={Shield} message="No overrides recorded yet" />
        ) : (
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-4 top-4 w-px bottom-4"
              style={{ background: 'linear-gradient(to bottom, #7C3AED50, transparent)' }} />

            <div className="space-y-3 pl-10">
              {data.map((ov, i) => {
                const cfg = DECISION_CFG[ov?.decision] ?? { color: '#9CA3AF', label: str(ov?.decision) };
                const disagreed = str(ov?.action) !== str(ov?.ai_action) && ov?.ai_action;
                return (
                  <motion.div key={ov?.id ?? i}
                    className="relative"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06, ease: EASE, duration: 0.3 }}>
                    {/* Dot */}
                    <motion.div
                      className="absolute -left-[26px] top-3.5 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                      style={{
                        backgroundColor: `${cfg.color}20`,
                        borderColor: cfg.color,
                      }}
                      whileHover={{ scale: 1.2 }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                    </motion.div>

                    <div className="rounded-xl border px-4 py-3 flex items-start gap-4"
                      style={{
                        backgroundColor: disagreed ? 'rgba(255,149,0,0.04)' : '#080B14',
                        borderColor:     disagreed ? 'rgba(255,149,0,0.3)' : '#1C2333',
                      }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold"
                            style={{ backgroundColor: `${cfg.color}15`, color: cfg.color }}>
                            {cfg.label}
                          </span>
                          <span className="text-[10px] font-mono text-[#00D4FF]">
                            #{truncateId(ov?.incident_id)}
                          </span>
                          {disagreed && (
                            <span className="text-[9px] font-mono font-bold text-[#FF9500]">
                              ⚡ DISAGREEMENT
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-mono text-gray-500 flex-wrap">
                          <span className="text-gray-400">AI:</span>
                          <span className="text-gray-400 capitalize">{cap(ov?.ai_action ?? 'N/A')}</span>
                          {ov?.action && (
                            <>
                              <ArrowRight size={9} className="text-gray-700" />
                              <span className={`capitalize font-semibold`} style={{ color: cfg.color }}>
                                {cap(ov.action)}
                              </span>
                            </>
                          )}
                        </div>
                        {ov?.note && (
                          <p className="text-gray-600 text-[10px] font-mono mt-1 italic">"{ov.note}"</p>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-[10px] font-mono text-gray-600">{formatTimestamp(ov?.timestamp)}</p>
                        <p className="text-[9px] font-mono text-gray-700 mt-0.5">{ov?.actor ?? '—'}</p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — CSV BATCH UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════
function CsvUpload() {
  const [dragging, setDragging] = useState(false);
  const [file, setFile]         = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState(null);
  const inputRef                  = useRef(null);
  const abortRef                  = useRef(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f && f.name.endsWith('.csv')) { setFile(f); setResult(null); setError(null); }
    else setError('Please drop a valid .csv file');
  }, []);

  const handleUpload = useCallback(async () => {
    if (!file || uploading) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setUploading(true); setProgress(0); setError(null); setResult(null);

    const form = new FormData();
    form.append('file', file);

    try {
      const { data } = await api.post('/api/alerts/upload-csv', form, {
        signal: abortRef.current.signal,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (ev) => {
          if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      setResult(data ?? null);
      setProgress(100);
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      setError(str(e?.response?.data?.detail ?? e?.message ?? 'Upload failed'));
    } finally {
      if (!abortRef.current?.signal?.aborted) setUploading(false);
    }
  }, [file, uploading]);

  return (
    <SectionCard title="CSV Batch Upload" icon={Upload}>
      <div className="p-6 space-y-5">
        {/* Drop zone */}
        <motion.div
          className="rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-4 py-12 transition-all cursor-pointer"
          style={{
            borderColor: dragging ? '#00D4FF' : file ? 'rgba(34,197,94,0.5)' : '#1C2333',
            backgroundColor: dragging ? 'rgba(0,212,255,0.05)' : file ? 'rgba(34,197,94,0.04)' : 'transparent',
          }}
          animate={dragging ? { scale: 1.01 } : { scale: 1 }}
          transition={{ ease: EASE, duration: 0.15 }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          whileHover={{ borderColor: '#00D4FF60' }}
        >
          <input ref={inputRef} type="file" accept=".csv" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { setFile(f); setResult(null); setError(null); }
            }}
          />
          <motion.div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: file ? 'rgba(34,197,94,0.15)' : 'rgba(0,212,255,0.1)', border: `1px solid ${file ? 'rgba(34,197,94,0.4)' : 'rgba(0,212,255,0.25)'}` }}
            animate={dragging ? { scale: [1, 1.1, 1] } : {}}
            transition={{ duration: 0.5, repeat: dragging ? Infinity : 0 }}
          >
            {file
              ? <CheckCircle2 size={24} className="text-[#22C55E]" />
              : <Upload size={24} className="text-[#00D4FF]" />
            }
          </motion.div>
          <div className="text-center">
            <p className="text-white font-mono text-sm font-semibold">
              {file ? file.name : 'Drop CSV file here'}
            </p>
            <p className="text-gray-500 text-xs font-mono mt-1">
              {file
                ? `${(file.size / 1024).toFixed(1)} KB · click to replace`
                : 'or click to browse — .csv files only'}
            </p>
          </div>
        </motion.div>

        {/* Expected format */}
        <div className="rounded-xl border border-[#1C2333] bg-[#080B14] px-4 py-3">
          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em] mb-2">Expected Format</p>
          <code className="text-[11px] font-mono text-gray-400">
            alert_type, severity, service, timestamp (optional)
          </code>
          <br />
          <code className="text-[11px] font-mono text-gray-600 mt-1 block">
            cpu_spike, critical, payment-service, 2024-01-15T14:30:00Z
          </code>
        </div>

        {/* Upload progress */}
        <AnimatePresence>
          {uploading && (
            <motion.div className="space-y-2"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ ease: EASE, duration: 0.2 }}>
              <div className="flex justify-between items-center">
                <span className="text-[11px] font-mono text-gray-400">Uploading…</span>
                <span className="text-[11px] font-mono text-[#00D4FF] font-bold">{progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-[#1C2333] overflow-hidden">
                <motion.div className="h-full rounded-full bg-[#00D4FF]"
                  animate={{ width: `${progress}%` }}
                  transition={{ ease: EASE, duration: 0.3 }} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border"
              style={{ backgroundColor: 'rgba(255,59,92,0.08)', borderColor: 'rgba(255,59,92,0.3)' }}
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <XCircle size={13} className="text-[#FF3B5C] flex-shrink-0 mt-0.5" />
              <p className="text-[#FF3B5C] text-xs font-mono">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result */}
        <AnimatePresence>
          {result && (
            <motion.div
              className="rounded-xl border p-4 space-y-3"
              style={{ backgroundColor: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.3)' }}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ ease: EASE, duration: 0.3 }}>
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-[#22C55E]" />
                <p className="font-mono text-xs font-bold text-[#22C55E]">Upload Complete</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Processed', val: result?.processed ?? result?.total ?? '—', color: '#00D4FF' },
                  { label: 'Incidents Created', val: result?.incidents_created ?? '—', color: '#22C55E' },
                  { label: 'Deduplicated', val: result?.deduplicated ?? result?.skipped ?? '—', color: '#FF9500' },
                  { label: 'Errors', val: result?.errors?.length ?? 0, color: '#FF3B5C' },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-[9px] font-mono text-gray-600 uppercase">{s.label}</p>
                    <p className="font-mono font-black text-xl mt-0.5" style={{ color: s.color }}>{s.val}</p>
                  </div>
                ))}
              </div>
              {Array.isArray(result?.errors) && result.errors.length > 0 && (
                <div className="space-y-1 mt-2 border-t border-[#1C2333] pt-2">
                  <p className="text-[9px] font-mono text-gray-600 uppercase">Error Details</p>
                  {result.errors.slice(0, 5).map((e, i) => (
                    <p key={i} className="text-[10px] font-mono text-[#FF3B5C]">{str(e)}</p>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Upload button */}
        <motion.button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-mono text-sm font-bold"
          style={{
            backgroundColor: file && !uploading ? '#00D4FF' : 'rgba(0,212,255,0.1)',
            color:           file && !uploading ? '#080B14'  : '#00D4FF50',
            cursor:          file && !uploading ? 'pointer'  : 'not-allowed',
          }}
          whileHover={file && !uploading ? { scale: 1.01, filter: 'brightness(1.08)' } : {}}
          whileTap={file && !uploading ? { scale: 0.98 } : {}}
        >
          <Upload size={15} />
          {uploading ? 'Uploading…' : 'Upload & Process CSV'}
        </motion.button>
      </div>
    </SectionCard>
  );
}

function LazyReportSection({ component: Component }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="min-h-[100px]">
      {isVisible ? <Component /> : <div className="skeleton h-32 rounded-xl border border-[#1C2333] animate-pulse opacity-20" />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function Reports() {
  return (
    <motion.div
      className="p-5 space-y-4 max-w-6xl mx-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ease: EASE, duration: 0.3 }}
    >
      {/* Page header */}
      <div className="flex items-center gap-3 mb-2">
        <FileText size={16} className="text-[#00D4FF]" />
        <div>
          <h1 className="font-mono text-sm font-bold tracking-[0.15em] uppercase text-white">
            Reports & Audit
          </h1>
          <p className="text-gray-600 text-[10px] font-mono">
            Weekly digest · LLM reliability · Full audit trail · Override history · CSV ingestion
          </p>
        </div>
      </div>

      <LazyReportSection component={WeeklyDigest} />
      <LazyReportSection component={LlmAudit} />
      <LazyReportSection component={AuditLog} />
      <LazyReportSection component={OverrideTimeline} />
      <CsvUpload />
    </motion.div>
  );
}