import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GitBranch, Plus, RefreshCw, Loader2, XCircle, AlertTriangle, ChevronDown,
} from 'lucide-react';
import api from '../config/api';
import { ALERT_TYPES } from '../config/constants';

const EASE = [0.25, 0.46, 0.45, 0.94];

// ─── MOCK DATA ─────────────────────────────────────────────────────────────────
const MOCK_DATA = [
  { id: 'w1', alert_type: 'high_cpu',      action: 'restart_service',    priority: 1, estimated_time_mins: 2.0 },
  { id: 'w2', alert_type: 'high_cpu',      action: 'scale_service',      priority: 2, estimated_time_mins: 3.0 },
  { id: 'w3', alert_type: 'disk_full',     action: 'cleanup_logs',       priority: 1, estimated_time_mins: 1.5 },
  { id: 'w4', alert_type: 'api_failure',   action: 'switch_to_fallback', priority: 1, estimated_time_mins: 0.5 },
  { id: 'w5', alert_type: 'service_down',  action: 'restart_and_notify', priority: 1, estimated_time_mins: 2.5 },
  { id: 'w6', alert_type: 'memory_leak',   action: 'restart_service',    priority: 1, estimated_time_mins: 2.0 },
  { id: 'w7', alert_type: 'ssl_expiry',    action: 'escalate',           priority: 0, estimated_time_mins: 0.0 },
];

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────
const ACTIONS = [
  'restart_service',
  'scale_service',
  'cleanup_logs',
  'switch_to_fallback',
  'restart_and_notify',
  'escalate',
  'manual_review',
];

// All 21 alert types from spec + constants.js combined (deduplicated)
const ALL_ALERT_TYPES = [
  ...new Set([
    ...ALERT_TYPES,
    'high_cpu', 'api_failure', 'restart_and_notify', 'payment_timeout',
    'auth_failure', 'rate_limit_exceeded',
  ]),
].sort();

const ACTION_CFG = {
  restart_service:    { color: '#3B82F6', label: 'Restart Service'   },
  scale_service:      { color: '#22C55E', label: 'Scale Service'     },
  cleanup_logs:       { color: '#FF9500', label: 'Cleanup Logs'      },
  switch_to_fallback: { color: '#FB923C', label: 'Switch Fallback'   },
  restart_and_notify: { color: '#00D4FF', label: 'Restart + Notify'  },
  escalate:           { color: '#FF3B5C', label: 'Escalate'          },
  manual_review:      { color: '#A78BFA', label: 'Manual Review'     },
};

const PRIORITY_CFG = {
  0: { color: '#FF3B5C', label: 'P0 · Critical' },
  1: { color: '#3B82F6', label: 'P1 · High'     },
  2: { color: '#9CA3AF', label: 'P2 · Normal'   },
};

// ─── HELPERS ───────────────────────────────────────────────────────────────────
const str = (v) => (v != null ? String(v) : '');
const cap = (v) => str(v).replace(/_/g, ' ');

function fmtTime(mins) {
  if (mins == null || isNaN(mins)) return '—';
  const m = Math.floor(mins);
  const s = Math.round((mins - m) * 60);
  return `${m}m ${s}s`;
}

// ─── STAT CARD ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color = '#00D4FF', index = 0 }) {
  return (
    <motion.div
      className="flex-1 min-w-0 rounded-xl border border-[#1C2333] bg-[#0D1117] px-5 py-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, ease: EASE, duration: 0.3 }}
      whileHover={{ borderColor: `${color}35`, scale: 1.01, transition: { duration: 0.15 } }}
    >
      <p className="text-[9px] font-mono text-gray-600 uppercase tracking-[0.2em]">{label}</p>
      <p className="font-mono font-black text-2xl mt-1" style={{ color }}>{value}</p>
    </motion.div>
  );
}

// ─── SKELETON ROW ──────────────────────────────────────────────────────────────
function SkeletonRow({ index }) {
  return (
    <motion.tr
      className="border-b border-[#1C2333]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.04 }}
    >
      {[140, 120, 60, 70].map((w, i) => (
        <td key={i} className="px-5 py-3.5">
          <div className="skeleton h-3.5 rounded animate-pulse" style={{ width: w }} />
        </td>
      ))}
    </motion.tr>
  );
}

// ─── RULE ROW ─────────────────────────────────────────────────────────────────
function RuleRow({ rule, index, isNew }) {
  const actionCfg  = ACTION_CFG[rule?.action] ?? { color: '#9CA3AF', label: cap(rule?.action ?? '—') };
  const priNum     = parseInt(str(rule?.priority ?? 1), 10);
  const priCfg     = PRIORITY_CFG[priNum] ?? PRIORITY_CFG[1];

  return (
    <motion.tr
      layout
      className="border-b border-[#1C2333] group hover:bg-white/[0.025] transition-colors"
      initial={{ opacity: 0, x: isNew ? 12 : 0, backgroundColor: isNew ? 'rgba(0,212,255,0.08)' : 'transparent' }}
      animate={{ opacity: 1, x: 0, backgroundColor: 'transparent' }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ delay: isNew ? 0 : index * 0.04, ease: EASE, duration: 0.3 }}
    >
      {/* Alert Type */}
      <td className="px-5 py-3.5">
        <span className="px-2.5 py-1 rounded-md font-mono text-[11px] text-gray-300"
          style={{ backgroundColor: '#1C2333' }}>
          {cap(rule?.alert_type ?? '—')}
        </span>
      </td>

      {/* Action */}
      <td className="px-5 py-3.5">
        <span className="px-2.5 py-1 rounded-md font-mono text-[11px] font-semibold"
          style={{
            backgroundColor: `${actionCfg.color}14`,
            color:           actionCfg.color,
            border:          `1px solid ${actionCfg.color}30`,
          }}>
          {actionCfg.label}
        </span>
      </td>

      {/* Priority */}
      <td className="px-5 py-3.5">
        <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold"
          style={{ backgroundColor: `${priCfg.color}15`, color: priCfg.color }}>
          {priCfg.label}
        </span>
      </td>

      {/* Est. Time */}
      <td className="px-5 py-3.5 font-mono text-[11px] text-gray-400 tabular-nums">
        {fmtTime(rule?.estimated_time_mins)}
      </td>
    </motion.tr>
  );
}

// ─── ADD RULE FORM ─────────────────────────────────────────────────────────────
const BLANK = { alert_type: '', action: '', priority: 1, estimated_time_mins: 2.0 };

function AddRuleForm({ onSuccess, onCancel }) {
  const [form, setForm]     = useState(BLANK);
  const [loading, setLoad]  = useState(false);
  const [err, setErr]       = useState(null);
  const abortRef            = useRef(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.alert_type || !form.action || loading) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoad(true); setErr(null);

    try {
      const { data } = await api.post('/api/workflows', {
        alert_type:          form.alert_type,
        action:              form.action,
        priority:            Number(form.priority),
        estimated_time_mins: Number(form.estimated_time_mins),
      }, { signal: abortRef.current.signal });

      onSuccess(data ?? { ...form, id: `tmp-${Date.now()}` });
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[Workflows] POST failed', e);
      setErr(str(e?.response?.data?.detail ?? e?.message ?? 'Failed to save rule'));
    } finally {
      if (!abortRef.current?.signal?.aborted) setLoad(false);
    }
  };

  const base = 'w-full bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-[#00D4FF]/40 transition-colors appearance-none';
  const valid = form.alert_type && form.action;

  return (
    <motion.form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-[#00D4FF]/20 bg-[#0D1117] p-5 space-y-4"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ ease: EASE, duration: 0.3 }}
    >
      <p className="text-[10px] font-mono text-[#00D4FF] uppercase tracking-[0.2em]">
        New Workflow Rule
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Alert type */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Alert Type *</label>
          <div className="relative">
            <select value={form.alert_type} onChange={(e) => set('alert_type', e.target.value)}
              className={base} style={{ colorScheme: 'dark' }}>
              <option value="" className="bg-[#0D1117]">Select alert type…</option>
              {ALL_ALERT_TYPES.map((t) => (
                <option key={t} value={t} className="bg-[#0D1117]">{cap(t)}</option>
              ))}
            </select>
            <ChevronDown size={10} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
          </div>
        </div>

        {/* Action */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Action *</label>
          <div className="relative">
            <select value={form.action} onChange={(e) => set('action', e.target.value)}
              className={base} style={{ colorScheme: 'dark' }}>
              <option value="" className="bg-[#0D1117]">Select action…</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a} className="bg-[#0D1117]">{cap(a)}</option>
              ))}
            </select>
            <ChevronDown size={10} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
          </div>
        </div>

        {/* Priority */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Priority (0=critical, 2=normal)</label>
          <select value={form.priority} onChange={(e) => set('priority', Number(e.target.value))}
            className={base} style={{ colorScheme: 'dark' }}>
            <option value={0} className="bg-[#0D1117]">P0 · Critical</option>
            <option value={1} className="bg-[#0D1117]">P1 · High</option>
            <option value={2} className="bg-[#0D1117]">P2 · Normal</option>
          </select>
        </div>

        {/* Estimated time */}
        <div className="space-y-1">
          <label className="text-[9px] font-mono text-gray-600 uppercase tracking-wider">Est. Time (minutes)</label>
          <input
            type="number" min="0" max="60" step="0.5"
            value={form.estimated_time_mins}
            onChange={(e) => set('estimated_time_mins', parseFloat(e.target.value) || 0)}
            className={base}
          />
        </div>
      </div>

      {err && (
        <motion.div className="flex items-start gap-2 px-3 py-2 rounded-lg border"
          style={{ backgroundColor: 'rgba(255,59,92,0.08)', borderColor: 'rgba(255,59,92,0.3)' }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <XCircle size={12} className="text-[#FF3B5C] flex-shrink-0 mt-0.5" />
          <p className="text-[#FF3B5C] text-xs font-mono">{err}</p>
        </motion.div>
      )}

      <div className="flex gap-2 pt-1">
        <motion.button type="submit" disabled={!valid || loading}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl font-mono text-xs font-bold border transition-all"
          style={{
            backgroundColor: valid ? 'rgba(0,212,255,0.12)' : 'rgba(0,212,255,0.04)',
            borderColor:     valid ? 'rgba(0,212,255,0.4)'  : 'rgba(0,212,255,0.1)',
            color:           valid ? '#00D4FF' : '#00D4FF50',
            cursor:          valid && !loading ? 'pointer' : 'not-allowed',
          }}
          whileHover={valid && !loading ? { scale: 1.01, filter: 'brightness(1.1)' } : {}}
          whileTap={valid && !loading ? { scale: 0.98 } : {}}>
          {loading
            ? <><motion.div animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
                <Loader2 size={13} /></motion.div> Saving…</>
            : <><Plus size={13} /> Save Rule</>}
        </motion.button>
        <motion.button type="button" onClick={onCancel}
          className="px-5 py-2.5 rounded-xl font-mono text-xs text-gray-500 border border-[#1C2333] hover:text-white hover:border-[#2D3748] transition-colors"
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
          Cancel
        </motion.button>
      </div>
    </motion.form>
  );
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────
export default function Workflows() {
  const [rules, setRules]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [adding, setAdding]   = useState(false);
  const [newIds, setNewIds]   = useState(new Set());
  const abortRef              = useRef(null);

  const fetch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true); setError(null);

    api.get('/api/workflows', { signal: abortRef.current.signal })
      .then(({ data }) => {
        setRules(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[Workflows] API unavailable, using mock', e);
        setRules(MOCK_DATA);
        setError('Live data unavailable — showing defaults');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (rules.length > 0) return; // skip if already populated
    fetch();
    return () => { abortRef.current?.abort(); };
  }, [fetch, rules.length]);

  const handleSuccess = useCallback((newRule) => {
    const id = newRule?.id ?? `tmp-${Date.now()}`;
    const rule = { ...newRule, id };
    setRules((prev) => [rule, ...prev]);
    setNewIds((prev) => new Set([...prev, id]));
    setTimeout(() => setNewIds((prev) => { const n = new Set(prev); n.delete(id); return n; }), 2000);
    setAdding(false);
  }, []);

  // Stats
  const stats = useMemo(() => {
    const total       = rules.length;
    const alertTypes  = new Set(rules.map((r) => r?.alert_type).filter(Boolean)).size;
    const times       = rules.map((r) => r?.estimated_time_mins ?? 0).filter((v) => !isNaN(v));
    const avgTime     = times.length ? times.reduce((s, v) => s + v, 0) / times.length : 0;
    return { total, alertTypes, avgTime };
  }, [rules]);

  return (
    <motion.div
      className="p-5 space-y-5 max-w-5xl mx-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ease: EASE, duration: 0.3 }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <motion.div
            animate={{ rotate: [0, 8, -8, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <GitBranch size={16} className="text-[#00D4FF]" />
          </motion.div>
          <div>
            <h1 className="font-mono text-sm font-bold tracking-[0.15em] uppercase text-white">
              Workflow Rules
            </h1>
            <p className="text-gray-600 text-[10px] font-mono mt-0.5">
              Automated response rules for the AI triage engine
            </p>
          </div>
        </div>

        <motion.button
          id="workflow-add-btn"
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-xs font-bold border"
          style={{ backgroundColor: 'rgba(0,212,255,0.1)', color: '#00D4FF', borderColor: 'rgba(0,212,255,0.35)' }}
          whileHover={{ scale: 1.03, filter: 'brightness(1.1)' }}
          whileTap={{ scale: 0.97 }}
          aria-label="Add workflow rule"
        >
          <Plus size={13} />  {adding ? 'Cancel' : 'Add Rule'}
        </motion.button>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border text-[11px] font-mono"
            style={{ backgroundColor: 'rgba(255,149,0,0.07)', borderColor: 'rgba(255,149,0,0.25)', color: '#FF9500' }}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <AlertTriangle size={12} /> {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stats row ────────────────────────────────────────────────────── */}
      {!loading && (
        <div className="flex gap-3 flex-wrap">
          <StatCard label="Total Rules"         value={stats.total}      color="#00D4FF" index={0} />
          <StatCard label="Alert Types Covered" value={stats.alertTypes} color="#A78BFA" index={1} />
          <StatCard label="Avg Response Time"   value={fmtTime(stats.avgTime)} color="#22C55E" index={2} />
        </div>
      )}

      {/* ── Add rule form ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {adding && (
          <AddRuleForm
            key="add-form"
            onSuccess={handleSuccess}
            onCancel={() => setAdding(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Rules table ─────────────────────────────────────────────────── */}
      <div className="bg-[#0D1117] border border-[#1C2333] rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1C2333]" style={{ backgroundColor: '#080B14' }}>
              {['Alert Type', 'Action', 'Priority', 'Est. Time'].map((h) => (
                <th key={h}
                  className="px-5 py-3 text-left text-[9px] font-mono text-gray-600 uppercase tracking-[0.18em]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} index={i} />)
            ) : (
              <AnimatePresence initial={false}>
                {rules.map((rule, i) => (
                  <RuleRow
                    key={rule?.id ?? `${rule?.alert_type}-${rule?.action}-${i}`}
                    rule={rule}
                    index={i}
                    isNew={newIds.has(rule?.id)}
                  />
                ))}
              </AnimatePresence>
            )}
          </tbody>
        </table>

        {/* Empty state */}
        {!loading && rules.length === 0 && (
          <div className="flex flex-col items-center gap-5 py-20">
            <motion.div
              className="w-18 h-18 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'rgba(0,212,255,0.07)', border: '1px solid rgba(0,212,255,0.15)', width: 72, height: 72 }}
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 3, repeat: Infinity }}>
              <GitBranch size={30} className="text-gray-600" />
            </motion.div>
            <div className="text-center">
              <p className="text-gray-400 text-sm font-mono font-semibold">No workflow rules configured</p>
              <p className="text-gray-600 text-xs font-mono mt-1">
                Rules tell the AI engine how to automatically respond to each alert type
              </p>
            </div>
            <motion.button onClick={() => setAdding(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border font-mono text-xs font-semibold"
              style={{ backgroundColor: 'rgba(0,212,255,0.08)', color: '#00D4FF', borderColor: 'rgba(0,212,255,0.3)' }}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
              <Plus size={13} /> Add your first rule
            </motion.button>
          </div>
        )}

        {/* Error state (with data = 0 rows) */}
        {!loading && error && rules.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-20">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'rgba(255,59,92,0.1)', border: '1px solid rgba(255,59,92,0.3)' }}>
              <XCircle size={28} className="text-[#FF3B5C]" />
            </div>
            <p className="text-gray-400 text-sm font-mono">Failed to load workflow rules</p>
            <motion.button onClick={fetch}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#1C2333] text-gray-400 hover:text-white text-xs font-mono transition-colors"
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <RefreshCw size={12} /> Retry
            </motion.button>
          </div>
        )}
      </div>

      {/* Footer: rule count */}
      {!loading && rules.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-[10px] font-mono text-gray-600">
            {rules.length} rule{rules.length !== 1 ? 's' : ''} · AI engine applies highest-priority rule first
          </p>
          <motion.button onClick={fetch}
            className="flex items-center gap-1 text-[10px] font-mono text-gray-700 hover:text-[#00D4FF] transition-colors"
            whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.95, rotate: -20 }}>
            <RefreshCw size={9} /> Refresh
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}