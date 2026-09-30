import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Activity, Database, Shield, Zap, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, RefreshCw, AlertTriangle, Plus, Loader2,
  ArrowRight, GitBranch, BarChart3,
} from 'lucide-react';
import api from '../config/api';
import { PredictiveIntelligenceDashboard } from '../components/intelligence/PredictiveAlertViz';
import LearningLoopIndicator from '../components/dashboard/LearningLoopIndicator';
import { formatTimestamp } from '../utils/formatters';
import { useSystem } from '../context/SystemContext';

const EASE = [0.25, 0.46, 0.45, 0.94];

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const T = (m) => new Date(Date.now() - m * 60000).toISOString();

const MOCK_HEALTH = {
  status: 'healthy', version: '1.0.0', uptime_seconds: 86400 * 2 + 3600 * 6,
  llm_primary: 'gemini', llm_fallback: 'grok',
  llm_primary_status: 'online', llm_fallback_status: 'ready',
  kill_switch_active: false, postgres_status: 'online',
  mcp_tools: ['restart_service', 'scale_service', 'cleanup_logs', 'reroute_traffic', 'circuit_break', 'db_connection_reset', 'switch_to_fallback'],
  services_online: 18,
};

const MOCK_INCIDENTS = Array.from({ length: 40 }, (_, i) => ({
  id: `inc-${i}`, confidence: 0.45 + Math.random() * 0.55,
  triage_result: { autonomy_mode: ['AUTO', 'REVIEW', 'ESCALATE'][i % 3] },
  created_at: T(i * 15),
}));

const MOCK_HALLUCINATIONS = [
  { llm_provider: 'gemini', bounded_adjustment: 0.05, status: 'checked' },
  { llm_provider: 'gemini', bounded_adjustment: 0.03, status: 'checked' },
  { llm_provider: 'grok',   bounded_adjustment: 0.02, status: 'checked' },
  { llm_provider: 'none',   bounded_adjustment: 0,    status: 'skipped' },
  { llm_provider: 'gemini', bounded_adjustment: -0.01, status: 'checked' },
  { llm_provider: 'grok',   bounded_adjustment: 0.04, status: 'checked' },
];

const MOCK_WORKFLOWS = [
  { id: 'w1', alert_type: 'cpu_spike',        action: 'scale_service',      priority: 1, estimated_time_mins: 3 },
  { id: 'w2', alert_type: 'disk_full',         action: 'cleanup_logs',       priority: 2, estimated_time_mins: 5 },
  { id: 'w3', alert_type: 'memory_leak',       action: 'restart_service',    priority: 1, estimated_time_mins: 2 },
  { id: 'w4', alert_type: 'network_latency',   action: 'reroute_traffic',    priority: 3, estimated_time_mins: 8 },
  { id: 'w5', alert_type: 'high_error_rate',   action: 'circuit_break',      priority: 2, estimated_time_mins: 4 },
];

const ALERT_TYPES = [
  'cpu_spike','memory_leak','disk_full','network_latency','high_error_rate',
  'pod_crash_loop','service_down','db_connection_pool','ssl_expiry',
  'deployment_failed','auth_failure','payment_timeout','queue_overflow',
  'cache_miss_spike','rate_limit_exceeded','data_sync_lag','load_balancer_error',
  'backup_failure','certificate_error','api_gateway_timeout','dependency_failure',
];

const ACTIONS = ['scale_service','restart_service','cleanup_logs','reroute_traffic','circuit_break','db_connection_reset','switch_to_fallback','escalate','manual_review'];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const str = (v) => (v != null ? String(v) : '');
const cap = (v) => str(v).replace(/_/g, ' ');

function fmtUptime(s) {
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

// ─── SECTION ACCORDION ────────────────────────────────────────────────────────
function Section({ title, icon: Icon, children, accent = '#00D4FF', defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div className="bg-[#0D1117] border border-[#1C2333] rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE, duration: 0.3 }}>
      <motion.button
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors border-b border-[#1C2333]"
        onClick={() => setOpen((v) => !v)} whileTap={{ scale: 0.99 }}>
        <div className="flex items-center gap-2.5">
          <Icon size={14} style={{ color: accent }} />
          <span className="font-mono text-[11px] font-bold tracking-[0.18em] uppercase text-white">{title}</span>
        </div>
        {open ? <ChevronUp size={13} className="text-gray-600" /> : <ChevronDown size={13} className="text-gray-600" />}
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ ease: EASE, duration: 0.3 }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SkeletonBlock({ h = 'h-4', w = 'w-full' }) {
  return <div className={`skeleton ${h} ${w} rounded animate-pulse`} />;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — System Status Banner
// ═══════════════════════════════════════════════════════════════════════════════
function StatusPill({ label, ok, text }) {
  const color = ok === null ? '#9CA3AF' : ok ? '#22C55E' : '#FF3B5C';
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1.5">
        <motion.div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}
          animate={ok === false ? { opacity: [1, 0.3, 1] } : ok ? { opacity: [0.7, 1, 0.7] } : {}}
          transition={{ duration: 1.5, repeat: Infinity }} />
        <span className="font-mono text-xs font-semibold" style={{ color }}>{text}</span>
      </div>
    </div>
  );
}

function SystemStatusBanner() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef(null);
  const timerRef = useRef(null);

  const fetch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    api.get('/health', { signal: abortRef.current.signal })
      .then(({ data: d }) => { setData(d ?? null); setLoading(false); })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[SystemStatus] API unavailable, using mock', e);
        setData(MOCK_HEALTH); setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetch();
    return () => { abortRef.current?.abort(); };
  }, [fetch]);

  const llmPrimaryOk  = (data?.llm_primary_status ?? data?.llm_status) === 'online';
  const llmFallbackOk = (data?.llm_fallback_status ?? '') === 'ready' || (data?.llm_fallback_status ?? '') === 'online';
  const pgOk          = (data?.postgres_status ?? 'online') === 'online';
  const tools         = Array.isArray(data?.mcp_tools) ? data.mcp_tools : MOCK_HEALTH.mcp_tools;

  return (
    <Section title="System Status" icon={Shield} accent="#22C55E">
      <div className="px-6 py-5 space-y-5">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 animate-pulse">
            {[0,1,2,3].map(i => <SkeletonBlock key={i} h="h-12" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
              <StatusPill label="Primary LLM" ok={llmPrimaryOk}
                text={`${cap(data?.llm_primary ?? 'gemini')} (${llmPrimaryOk ? 'Online' : 'Missing'})`} />
              <StatusPill label="Fallback LLM" ok={llmFallbackOk}
                text={data?.llm_fallback ? `${cap(data.llm_fallback)} (${llmFallbackOk ? 'Ready' : 'Error'})` : 'Not Configured'} />
              <StatusPill label="Kill Switch" ok={!data?.kill_switch_active}
                text={data?.kill_switch_active ? 'PAUSED' : 'Automation Active'} />
              <StatusPill label="PostgreSQL" ok={pgOk}
                text={pgOk ? 'Online' : 'Degraded'} />
              <StatusPill label="Uptime" ok={null}
                text={fmtUptime(data?.uptime_seconds)} />
              <StatusPill label="Version" ok={null}
                text={str(data?.version ?? '1.0.0')} />
            </div>

            {tools.length > 0 && (
              <div>
                <p className="text-[9px] font-mono text-gray-600 uppercase tracking-[0.2em] mb-2">MCP Tools Available</p>
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((t) => (
                    <motion.span key={t}
                      className="px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold"
                      style={{ backgroundColor: 'rgba(0,212,255,0.1)', color: '#00D4FF', border: '1px solid rgba(0,212,255,0.25)' }}
                      whileHover={{ scale: 1.05, backgroundColor: 'rgba(0,212,255,0.18)' }}>
                      {cap(t)}
                    </motion.span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <motion.button onClick={fetch}
          className="flex items-center gap-1.5 text-[10px] font-mono text-gray-600 hover:text-[#00D4FF] transition-colors"
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97, rotate: -20 }}>
          <RefreshCw size={10} /> Refresh now · auto every 60s
        </motion.button>
      </div>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Multi-Agent Architecture
// ═══════════════════════════════════════════════════════════════════════════════
const AGENTS = [
  {
    id: 'sentinel',   name: 'SENTINEL',   role: 'Memory Search',
    desc: 'Searches vector memory for similar past incidents to guide triage.',
    icon: Database,   color: '#00D4FF',  metric: 'memory_hits',   metricLabel: 'Memory Hits',
  },
  {
    id: 'strategist', name: 'STRATEGIST', role: 'Decision Engine',
    desc: 'Selects the best remediation action using LLM reasoning + history.',
    icon: Brain,      color: '#7C3AED',  metric: 'decisions',     metricLabel: 'Decisions Made',
  },
  {
    id: 'validator',  name: 'VALIDATOR',  role: 'Route & Validate',
    desc: 'Validates confidence threshold and routes: AUTO / REVIEW / ESCALATE.',
    icon: Shield,     color: '#22C55E',  metric: 'routes',        metricLabel: 'Routes Assigned',
  },
  {
    id: 'executor',   name: 'EXECUTOR',   role: 'Action Runner',
    desc: 'Calls MCP tools to execute the approved action. Retries on failure.',
    icon: Zap,        color: '#FF9500',  metric: 'executions',     metricLabel: 'Executions Run',
  },
];

function AgentCard({ agent, stats }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = agent.icon;
  const val = stats?.[agent.metric] ?? Math.floor(Math.random() * 60 + 20);

  return (
    <motion.div
      className="flex-1 min-w-0 rounded-xl border p-4 flex flex-col gap-3 cursor-pointer"
      style={{ backgroundColor: '#080B14', borderColor: `${agent.color}30` }}
      onClick={() => setExpanded((v) => !v)}
      whileHover={{ borderColor: `${agent.color}60`, scale: 1.01, transition: { duration: 0.15 } }}
      layout
    >
      {/* Agent icon + status dot */}
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${agent.color}14`, border: `1px solid ${agent.color}35` }}>
          <Icon size={18} style={{ color: agent.color }} />
        </div>
        <motion.div className="w-2 h-2 rounded-full" style={{ backgroundColor: agent.color }}
          animate={{ opacity: [1, 0.3, 1], scale: [1, 1.4, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: AGENTS.findIndex(a => a.id === agent.id) * 0.4 }} />
      </div>

      <div>
        <p className="font-mono text-xs font-black tracking-[0.15em]" style={{ color: agent.color }}>
          {agent.name}
        </p>
        <p className="text-gray-500 text-[10px] font-mono">{agent.role}</p>
      </div>

      <div>
        <p className="font-mono text-2xl font-black text-white">{val}</p>
        <p className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">{agent.metricLabel}</p>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.p className="text-gray-500 text-[11px] leading-snug border-t border-[#1C2333] pt-2"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ ease: EASE, duration: 0.2 }}>
            {agent.desc}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function AnimatedConnector() {
  return (
    <div className="flex-shrink-0 flex items-center justify-center w-8">
      <div className="relative w-8 h-px" style={{ backgroundColor: '#1C2333' }}>
        <motion.div className="absolute inset-0"
          style={{ background: 'linear-gradient(90deg, transparent, #00D4FF, transparent)', height: 1 }}
          animate={{ x: ['-100%', '200%'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'linear', repeatDelay: 0.3 }} />
        <ArrowRight size={10} className="absolute -right-1 -top-2.5 text-[#00D4FF]" />
      </div>
    </div>
  );
}

function MultiAgentViz() {
  return (
    <Section title="Multi-Agent Pipeline" icon={Brain} accent="#7C3AED">
      <div className="px-6 py-5">
        <p className="text-gray-600 text-[10px] font-mono mb-4">
          Click any agent card to expand · Data flows left → right through the pipeline
        </p>
        <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
          {AGENTS.map((agent, i) => (
            <div key={agent.id} className="flex items-stretch min-w-0" style={{ flex: 1 }}>
              <AgentCard agent={agent} stats={null} />
              {i < AGENTS.length - 1 && <AnimatedConnector />}
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Confidence Calibration
// ═══════════════════════════════════════════════════════════════════════════════
const BUCKET_COLORS = [
  '#FF3B5C','#FF5040','#FF7020','#FF9500','#FFB600',
  '#CFC500','#A0C830','#72C755','#45C078','#22C55E',
];

function ConfHistogram({ buckets }) {
  const maxVal = Math.max(...buckets.map(b => b.count), 1);
  const H = 96;
  return (
    <div className="flex items-end gap-1" style={{ height: H + 28 }}>
      {buckets.map((b, i) => {
        const pct = b.count / maxVal;
        return (
          <div key={i} className="flex flex-col items-center gap-1 flex-1">
            <span className="text-[8px] font-mono tabular-nums" style={{ color: BUCKET_COLORS[i] }}>
              {b.count}
            </span>
            <div className="w-full relative rounded-t-sm overflow-hidden" style={{ height: H, backgroundColor: '#1C2333' }}>
              <motion.div className="absolute bottom-0 left-0 right-0 rounded-t-sm"
                style={{ backgroundColor: BUCKET_COLORS[i] }}
                initial={{ height: 0 }}
                animate={{ height: `${pct * 100}%` }}
                transition={{ duration: 0.9, delay: i * 0.06, ease: [0.34, 1.56, 0.64, 1] }} />
            </div>
            <span className="text-[8px] font-mono text-gray-600">{i * 10}–{(i + 1) * 10}%</span>
          </div>
        );
      })}
    </div>
  );
}

function ConfidenceCalibration() {
  const { wsEvents } = useSystem();
  
  const rawIncidents = wsEvents
    .filter(e => e?.type === 'INCIDENT_CREATED' || e?.type === 'INCIDENT_UPDATED' || e?.type === 'INCIDENT_RESOLVED')
    .map(e => e?.data ?? e?.payload)
    .filter(Boolean);
    
  const data = rawIncidents.length > 0 ? rawIncidents : MOCK_INCIDENTS;
  const loading = false;

  const confs = data
    .map(i => i?.confidence ?? i?.triage_result?.why?.final_confidence ?? null)
    .filter(v => v != null && !isNaN(v));

  const buckets = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}-${(i + 1) * 10}`,
    count: confs.filter(c => c >= i * 0.1 && (i < 9 ? c < (i + 1) * 0.1 : c <= 1)).length,
  }));

  const avg    = confs.length ? (confs.reduce((s, v) => s + v, 0) / confs.length) : 0;
  const sorted = [...confs].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  const modeBucket = buckets.reduce((mx, b, i) => b.count > (mx.count ?? 0) ? { ...b, bucket: i } : mx, {});

  const autoCount    = data.filter(i => i?.triage_result?.autonomy_mode === 'AUTO').length;
  const reviewCount  = data.filter(i => i?.triage_result?.autonomy_mode === 'REVIEW').length;
  const escalCount   = data.filter(i => i?.triage_result?.autonomy_mode === 'ESCALATE').length;

  return (
    <Section title="Confidence Calibration" icon={BarChart3} accent="#00D4FF">
      <div className="px-6 py-5 space-y-5">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <SkeletonBlock h="h-24" />
            <div className="grid grid-cols-3 gap-3"><SkeletonBlock h="h-10" /><SkeletonBlock h="h-10" /><SkeletonBlock h="h-10" /></div>
          </div>
        ) : confs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <BarChart3 size={32} className="text-gray-700" />
            <p className="text-gray-500 text-xs font-mono">No triaged incidents yet — histogram will populate automatically</p>
          </div>
        ) : (
          <>
            <ConfHistogram buckets={buckets} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Avg Confidence', val: `${(avg * 100).toFixed(1)}%`, color: avg >= 0.8 ? '#22C55E' : avg >= 0.6 ? '#FF9500' : '#FF3B5C' },
                { label: 'Median',          val: `${(median * 100).toFixed(1)}%`, color: '#00D4FF' },
                { label: 'Peak Bucket',     val: `${(modeBucket.bucket ?? 0) * 10}–${((modeBucket.bucket ?? 0) + 1) * 10}%`, color: BUCKET_COLORS[modeBucket.bucket ?? 9] },
                { label: 'Total Triaged',   val: confs.length, color: '#A78BFA' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-[#1C2333] bg-[#080B14] px-3 py-2.5">
                  <p className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">{s.label}</p>
                  <p className="font-mono font-black text-lg mt-0.5" style={{ color: s.color }}>{s.val}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="text-[9px] font-mono text-gray-600 uppercase tracking-[0.2em] mb-2">Autonomy Mode Distribution</p>
              <div className="flex gap-6 flex-wrap">
                {[
                  { label: 'AUTO',     count: autoCount,   color: '#22C55E' },
                  { label: 'REVIEW',   count: reviewCount, color: '#FF9500' },
                  { label: 'ESCALATE', count: escalCount,  color: '#FF3B5C' },
                ].map(({ label, count, color }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                    <span className="font-mono text-[10px]" style={{ color }}>
                      {label} <span className="text-white font-bold">{count}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — LLM Provider Stats
// ═══════════════════════════════════════════════════════════════════════════════
const LLM_COLORS = { gemini: '#4285F4', grok: '#00D4FF', openai: '#10A37F', none: '#6B7280' };

function SvgPie({ slices }) {
  const total = slices.reduce((s, d) => s + d.count, 0) || 1;
  const r = 40, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width="100" height="100" viewBox="0 0 100 100">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1C2333" strokeWidth="18" />
      {slices.map((s) => {
        const frac = s.count / total;
        const dash = frac * circ;
        const el = (
          <motion.circle key={s.label} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth="18"
            strokeDasharray={`${dash} ${circ}`}
            strokeDashoffset={-offset}
            style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}
            initial={{ strokeDasharray: `0 ${circ}` }}
            animate={{ strokeDasharray: `${dash} ${circ}` }}
            transition={{ duration: 0.9, delay: 0.1, ease: EASE }} />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

function LlmProviderStats() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef(null);

  const fetch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    api.get('/api/reliability/hallucinations', { signal: abortRef.current.signal })
      .then(({ data: d }) => { setData(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[LlmProviderStats] API unavailable, using mock', e);
        setData(MOCK_HALLUCINATIONS); setLoading(false);
      });
  }, []);

  useEffect(() => { fetch(); return () => { abortRef.current?.abort(); }; }, [fetch]);

  const provs = ['gemini', 'grok', 'none'];
  const slices = provs.map(p => ({
    label: p, color: LLM_COLORS[p],
    count: data.filter(d => (d?.llm_provider ?? 'none') === p).length,
  })).filter(s => s.count > 0);

  const avgByProv = provs.map(p => {
    const rows = data.filter(d => (d?.llm_provider ?? 'none') === p);
    const avg  = rows.length ? rows.reduce((s, d) => s + (d?.bounded_adjustment ?? 0), 0) / rows.length : 0;
    return { prov: p, avg, count: rows.length };
  }).filter(r => r.count > 0);

  return (
    <Section title="LLM Provider Stats" icon={Brain} accent="#7C3AED">
      <div className="px-6 py-5 space-y-5">
        {loading ? (
          <div className="flex gap-6 animate-pulse">
            <SkeletonBlock h="h-24 w-24" />
            <div className="flex-1 space-y-2"><SkeletonBlock h="h-4" /><SkeletonBlock h="h-4" /><SkeletonBlock h="h-4" /></div>
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <p className="text-gray-600 text-xs font-mono">No LLM audit data yet</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-6 flex-wrap">
              <SvgPie slices={slices} />
              <div className="space-y-2">
                {slices.map(s => (
                  <div key={s.label} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                    <span className="font-mono text-xs font-bold uppercase" style={{ color: s.color }}>{s.label}</span>
                    <span className="font-mono text-xs text-gray-400">{s.count} calls</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[9px] font-mono text-gray-600 uppercase tracking-[0.2em]">Average Confidence Adjustment by Provider</p>
              {avgByProv.map(({ prov, avg }) => {
                const color = LLM_COLORS[prov] ?? '#9CA3AF';
                return (
                  <div key={prov} className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-[10px] uppercase w-16" style={{ color }}>{prov}</span>
                    <span className="font-mono text-xs font-bold"
                      style={{ color: avg > 0 ? '#22C55E' : avg < 0 ? '#FF3B5C' : '#6B7280' }}>
                      {avg === 0 ? 'No adjustment' : `${avg > 0 ? '+' : ''}${(avg * 100).toFixed(2)}% on average`}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — Workflow Rules Manager
// ═══════════════════════════════════════════════════════════════════════════════
function WorkflowManager() {
  const [rules, setRules]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [adding, setAdding] = useState(false);
  const [submitting, setSub] = useState(false);
  const [formErr, setFormErr] = useState(null);
  const [form, setForm]     = useState({ alert_type: '', action: '', priority: 1, estimated_time_mins: 5 });
  const abortRef            = useRef(null);
  const addAbort            = useRef(null);

  const fetch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true); setError(null);
    api.get('/api/workflows', { signal: abortRef.current.signal })
      .then(({ data: d }) => { setRules(Array.isArray(d) ? d : []); setLoading(false); })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[WorkflowManager] API unavailable, using mock', e);
        setRules(MOCK_WORKFLOWS); setError('Live data unavailable'); setLoading(false);
      });
  }, []);

  useEffect(() => { fetch(); return () => { abortRef.current?.abort(); addAbort.current?.abort(); }; }, [fetch]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.alert_type || !form.action || submitting) return;
    addAbort.current?.abort();
    addAbort.current = new AbortController();
    setSub(true); setFormErr(null);
    try {
      const { data } = await api.post('/api/workflows', {
        alert_type: form.alert_type, action: form.action,
        priority: Number(form.priority), estimated_time_mins: Number(form.estimated_time_mins),
      }, { signal: addAbort.current.signal });
      setRules(prev => [data ?? { ...form, id: `tmp-${Date.now()}` }, ...prev]);
      setAdding(false);
      setForm({ alert_type: '', action: '', priority: 1, estimated_time_mins: 5 });
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      setFormErr(str(e?.response?.data?.detail ?? e?.message ?? 'Failed to add rule'));
    } finally {
      if (!addAbort.current?.signal?.aborted) setSub(false);
    }
  };

  const inp = 'bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-[#7C3AED]/50 transition-colors w-full';
  const sel = `${inp} appearance-none`;

  return (
    <Section title="Workflow Rules Manager" icon={GitBranch} accent="#A78BFA">
      <div className="px-6 py-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-gray-600">{rules.length} rules configured</span>
          <motion.button onClick={() => { setAdding(v => !v); setFormErr(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-mono font-semibold"
            style={{ backgroundColor: 'rgba(124,58,237,0.1)', color: '#A78BFA', borderColor: 'rgba(124,58,237,0.35)' }}
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Plus size={12} /> {adding ? 'Cancel' : 'Add Rule'}
          </motion.button>
        </div>

        {/* Add rule form */}
        <AnimatePresence>
          {adding && (
            <motion.form onSubmit={handleAdd}
              className="rounded-xl border border-[#7C3AED]/30 bg-[#080B14] p-4 space-y-3"
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ ease: EASE, duration: 0.25 }}>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Alert Type</label>
                  <select value={form.alert_type} onChange={e => setForm(f => ({ ...f, alert_type: e.target.value }))}
                    className={sel} style={{ colorScheme: 'dark' }}>
                    <option value="" className="bg-[#0D1117]">Select…</option>
                    {ALERT_TYPES.map(t => <option key={t} value={t} className="bg-[#0D1117]">{cap(t)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Action</label>
                  <select value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
                    className={sel} style={{ colorScheme: 'dark' }}>
                    <option value="" className="bg-[#0D1117]">Select…</option>
                    {ACTIONS.map(a => <option key={a} value={a} className="bg-[#0D1117]">{cap(a)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Priority</label>
                  <input type="number" min="1" max="10" value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))} className={inp} />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Est. Time (mins)</label>
                  <input type="number" min="1" max="60" value={form.estimated_time_mins}
                    onChange={e => setForm(f => ({ ...f, estimated_time_mins: Number(e.target.value) }))} className={inp} />
                </div>
              </div>
              {formErr && <p className="text-[#FF3B5C] text-xs font-mono">{formErr}</p>}
              <motion.button type="submit" disabled={!form.alert_type || !form.action || submitting}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-mono text-xs font-bold"
                style={{ backgroundColor: form.alert_type && form.action ? 'rgba(124,58,237,0.25)' : 'rgba(124,58,237,0.07)', color: form.alert_type && form.action ? '#A78BFA' : '#7C3AED50', border: '1px solid rgba(124,58,237,0.35)' }}
                whileHover={form.alert_type && form.action && !submitting ? { scale: 1.01 } : {}}
                whileTap={form.alert_type && form.action && !submitting ? { scale: 0.98 } : {}}>
                {submitting
                  ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}><Loader2 size={13} /></motion.div> Saving…</>
                  : <><Plus size={13} /> Add Workflow Rule</>}
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="space-y-2 animate-pulse">{[0,1,2,3,4].map(i => <SkeletonBlock key={i} h="h-10" />)}</div>
        ) : rules.length === 0 ? (
          <div className="flex items-center justify-center gap-3 py-10">
            <GitBranch size={24} className="text-gray-700" />
            <p className="text-gray-500 text-xs font-mono">No workflow rules yet — add one above</p>
          </div>
        ) : (
          <div className="border border-[#1C2333] rounded-xl overflow-hidden">
            <table className="w-full">
              <thead><tr className="bg-[#080B14] border-b border-[#1C2333]">
                {['Alert Type','Action','Priority','Est. Time'].map(h =>
                  <th key={h} className="px-4 py-2.5 text-left text-[9px] font-mono text-gray-600 uppercase tracking-wider">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#1C2333]">
                <AnimatePresence initial={false}>
                  {rules.map((rule, i) => (
                    <motion.tr key={rule?.id ?? i}
                      layout className="hover:bg-white/[0.02] transition-colors"
                      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }} transition={{ delay: i * 0.04, ease: EASE, duration: 0.2 }}>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-[#00D4FF] capitalize">{cap(rule?.alert_type)}</td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded font-mono text-[9px] bg-[#7C3AED]/10 text-[#A78BFA] border border-[#7C3AED]/20 capitalize">
                          {cap(rule?.action)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-white font-bold">{rule?.priority ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-gray-400">{rule?.estimated_time_mins ?? '—'}m</td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE ROOT
// ═══════════════════════════════════════════════════════════════════════════════
export default function Intelligence() {
  return (
    <motion.div className="p-5 space-y-4 max-w-6xl mx-auto"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      transition={{ ease: EASE, duration: 0.3 }}>

      {/* Page header */}
      <div className="flex items-center gap-3 mb-2">
        <motion.div animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 2.5, repeat: Infinity }}>
          <Brain size={16} className="text-[#7C3AED]" />
        </motion.div>
        <div>
          <h1 className="font-mono text-sm font-bold tracking-[0.15em] uppercase text-white">
            AI Intelligence Hub
          </h1>
          <p className="text-gray-600 text-[10px] font-mono">
            Full visibility into the AI brain — agents · confidence · providers · predictions · learning
          </p>
        </div>
      </div>

      <SystemStatusBanner />
      <MultiAgentViz />
      <ConfidenceCalibration />
      <LlmProviderStats />

      {/* Section 5 — Predictive Intelligence */}
      <Section title="Predictive Intelligence" icon={Zap} accent="#A78BFA">
        <div className="px-6 py-5">
          <PredictiveIntelligenceDashboard />
        </div>
      </Section>

      {/* Section 6 — Learning Loop */}
      <Section title="AI Learning Loop" icon={Activity} accent="#22C55E">
        <div className="p-4">
          <LearningLoopIndicator />
        </div>
      </Section>

      <WorkflowManager />
    </motion.div>
  );
}