import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShieldCheck, ShieldX, RotateCcw, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, AlertTriangle, Clock, User,
  Loader2, Shield, History, ArrowRight, Zap,
} from 'lucide-react';
import api, { WS_URL } from '../../config/api';
import AIExplainabilityPanel from '../intelligence/AIExplainabilityPanel';
import { useSystem } from '../../context/SystemContext';
import { SEVERITY_COLORS } from '../../config/constants';
import { formatTimestamp, truncateId } from '../../utils/formatters';

const EASE = [0.25, 0.46, 0.45, 0.94];

const REDIRECT_ACTIONS = [
  'restart_service',
  'cleanup_logs',
  'scale_service',
  'switch_to_fallback',
  'restart_and_notify',
  'escalate',
  'manual_review',
];

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const T = (m) => new Date(Date.now() - m * 60000).toISOString();

const MOCK_QUEUE = [
  {
    id: 'inc-mock-001', alert_type: 'cpu_spike', severity: 'critical', service: 'payment-service',
    status: 'awaiting_review', confidence: 0.81, created_at: T(8),
    ai_reasoning: 'Traffic-induced CPU exhaustion. Historical patterns suggest scale_service.',
    triage_result: {
      recommended_action: 'scale_service',
      chain_of_thought: ['CPU at 94% sustained', 'Matched 11 past incidents', 'scale_service has 91% success rate'],
      why: { base_confidence: 0.72, historical_success: 0.91, similarity_score: 0.84, risk_penalty: 0.10, cost_penalty: 0.05, llm_adjustment: 0.04, bounded_adjustment: 0.03, final_confidence: 0.81, similar_incidents: 11, llm_provider: 'gemini', alternatives: [{ action: 'scale_service', score: 0.81 }, { action: 'restart_service', score: 0.67 }] },
      sentinel: { similar_count: 11, similarity_score: 0.84, patterns_matched: ['cpu_spike', 'payment-service'], top_past_resolutions: [{ action: 'scale_service', success_rate: 0.91, count: 10 }] },
      strategist: { action_chosen: 'scale_service', confidence: 0.81, llm_provider: 'gemini' },
      validator: { mode: 'REVIEW', reason: 'Confidence below 0.90 AUTO threshold', threshold_auto: 0.90, threshold_review: 0.60 },
    },
    llm_used: 'gemini', autonomy_mode: 'REVIEW',
  },
  {
    id: 'inc-mock-002', alert_type: 'memory_leak', severity: 'high', service: 'auth-service',
    status: 'awaiting_review', confidence: 0.74, created_at: T(23),
    ai_reasoning: 'Gradual heap growth detected. Restart with memory limit increase recommended.',
    triage_result: {
      recommended_action: 'restart_service',
      chain_of_thought: ['Memory at 89%', 'Heap growth trend 15 min', 'Pattern: memory_leak class'],
      why: { base_confidence: 0.65, historical_success: 0.78, similarity_score: 0.71, risk_penalty: 0.08, cost_penalty: 0.03, llm_adjustment: 0.02, bounded_adjustment: 0.01, final_confidence: 0.74, similar_incidents: 6, llm_provider: 'gemini', alternatives: [{ action: 'restart_service', score: 0.74 }, { action: 'scale_service', score: 0.58 }] },
      sentinel: { similar_count: 6, similarity_score: 0.71, patterns_matched: ['memory_leak', 'auth-service'], top_past_resolutions: [{ action: 'restart_service', success_rate: 0.83, count: 5 }] },
      strategist: { action_chosen: 'restart_service', confidence: 0.74, llm_provider: 'gemini' },
      validator: { mode: 'REVIEW', reason: 'Confidence below 0.90 threshold', threshold_auto: 0.90, threshold_review: 0.60 },
    },
    llm_used: 'gemini', autonomy_mode: 'REVIEW',
  },
  {
    id: 'inc-mock-003', alert_type: 'network_latency', severity: 'medium', service: 'api-gateway',
    status: 'awaiting_review', confidence: 0.68, created_at: T(41),
    ai_reasoning: 'Elevated P99 latency. Route switch to fallback CDN recommended.',
    triage_result: {
      recommended_action: 'switch_to_fallback',
      chain_of_thought: ['P99 latency +380ms', 'CDN upstream degraded', 'Fallback available'],
      why: { base_confidence: 0.60, historical_success: 0.72, similarity_score: 0.66, risk_penalty: 0.06, cost_penalty: 0.02, llm_adjustment: 0.02, bounded_adjustment: 0.02, final_confidence: 0.68, similar_incidents: 4, llm_provider: null, alternatives: [{ action: 'switch_to_fallback', score: 0.68 }, { action: 'manual_review', score: 0.55 }] },
      sentinel: { similar_count: 4, similarity_score: 0.66, patterns_matched: ['network_latency', 'api-gateway'], top_past_resolutions: [{ action: 'switch_to_fallback', success_rate: 0.75, count: 3 }] },
      strategist: { action_chosen: 'switch_to_fallback', confidence: 0.68, llm_provider: null },
      validator: { mode: 'REVIEW', reason: 'Mid-range confidence, human check needed', threshold_auto: 0.90, threshold_review: 0.60 },
    },
    llm_used: null, autonomy_mode: 'REVIEW',
  },
  {
    id: 'inc-mock-004', alert_type: 'disk_full', severity: 'critical', service: 'db-primary',
    status: 'awaiting_review', confidence: 0.77, created_at: T(3),
    ai_reasoning: 'Disk at 97%. Immediate cleanup_logs will recover ~18GB.',
    triage_result: {
      recommended_action: 'cleanup_logs',
      chain_of_thought: ['Disk 97% full', 'Log rotation missed', 'cleanup_logs: 18GB projected recovery'],
      why: { base_confidence: 0.70, historical_success: 0.85, similarity_score: 0.79, risk_penalty: 0.07, cost_penalty: 0.01, llm_adjustment: 0.03, bounded_adjustment: 0.02, final_confidence: 0.77, similar_incidents: 9, llm_provider: 'gemini', alternatives: [{ action: 'cleanup_logs', score: 0.77 }, { action: 'scale_service', score: 0.52 }] },
      sentinel: { similar_count: 9, similarity_score: 0.79, patterns_matched: ['disk_full', 'db-primary'], top_past_resolutions: [{ action: 'cleanup_logs', success_rate: 0.89, count: 8 }] },
      strategist: { action_chosen: 'cleanup_logs', confidence: 0.77, llm_provider: 'gemini' },
      validator: { mode: 'REVIEW', reason: 'Below AUTO threshold, review recommended', threshold_auto: 0.90, threshold_review: 0.60 },
    },
    llm_used: 'gemini', autonomy_mode: 'REVIEW',
  },
];

const MOCK_HISTORY = [
  { id: 'ov-1', incident_id: 'inc-aab1', decision: 'approve', action: 'scale_service', actor: 'alice@ops', ai_action: 'scale_service', timestamp: T(120), note: 'Looks correct' },
  { id: 'ov-2', incident_id: 'inc-bbc2', decision: 'redirect', action: 'escalate',     actor: 'bob@sre',   ai_action: 'restart_service', timestamp: T(240), note: 'Too risky during peak' },
  { id: 'ov-3', incident_id: 'inc-cc3d', decision: 'approve', action: 'cleanup_logs',  actor: 'alice@ops', ai_action: 'cleanup_logs', timestamp: T(360), note: '' },
  { id: 'ov-4', incident_id: 'inc-dd4e', decision: 'reject',  action: null,            actor: 'carol@cto', ai_action: 'scale_service', timestamp: T(480), note: 'Escalate to on-call engineer' },
  { id: 'ov-5', incident_id: 'inc-ee5f', decision: 'redirect', action: 'manual_review', actor: 'bob@sre',  ai_action: 'switch_to_fallback', timestamp: T(600), note: 'Need more data' },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const sev = (s) => (s ?? 'low').toLowerCase();
const sevColor = (s) => SEVERITY_COLORS[sev(s)] ?? '#9CA3AF';
const str = (v) => (v != null ? String(v) : '');
const cap = (v) => str(v).replace(/_/g, ' ');

function confColor(c) {
  const v = typeof c === 'number' ? c : 0;
  if (v >= 0.85) return '#22C55E';
  if (v >= 0.60) return '#FF9500';
  return '#FF3B5C';
}

// ─── LIVE WAIT TIMER ──────────────────────────────────────────────────────────
function WaitTimer({ createdAt }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const tick = () => {
      if (!createdAt) { setElapsed('—'); return; }
      const secs = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      const h = Math.floor(m / 60);
      if (h > 0) setElapsed(`${h}h ${m % 60}m`);
      else if (m > 0) setElapsed(`${m}m ${String(s).padStart(2, '0')}s`);
      else setElapsed(`${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [createdAt]);

  return <span className="tabular-nums">{elapsed}</span>;
}

// ─── SKELETON ─────────────────────────────────────────────────────────────────
function QueueSkeleton() {
  return (
    <div className="p-3 space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-[#1C2333] p-3 space-y-2 animate-pulse">
          <div className="flex justify-between">
            <div className="skeleton h-4 w-20 rounded" />
            <div className="skeleton h-3 w-12 rounded" />
          </div>
          <div className="skeleton h-3 w-32 rounded" />
          <div className="skeleton h-1.5 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ─── QUEUE CARD ───────────────────────────────────────────────────────────────
function QueueCard({ incident, isSelected, onClick }) {
  const sc = sevColor(incident?.severity);
  const isCrit = sev(incident?.severity) === 'critical';
  const conf = incident?.confidence ?? incident?.triage_result?.why?.final_confidence ?? 0;
  const action = incident?.triage_result?.recommended_action ?? incident?.triage_result?.strategist?.action_chosen;

  return (
    <motion.button
      layout
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border p-3 transition-all relative overflow-hidden focus:outline-none"
      style={{
        backgroundColor: isSelected ? `${sc}0C` : 'transparent',
        borderColor: isSelected ? `${sc}60` : isCrit ? `${sc}35` : '#1C2333',
        cursor: 'pointer',
      }}
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10, height: 0 }}
      whileHover={{ borderColor: `${sc}50`, transition: { duration: 0.12 } }}
    >
      {/* Selected bar */}
      {isSelected && (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
          style={{ backgroundColor: '#00D4FF' }} />
      )}

      {/* Critical pulse ring */}
      {isCrit && !isSelected && (
        <motion.span
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{ border: `1px solid ${sc}` }}
          animate={{ opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Row 1 */}
      <div className="flex items-center justify-between gap-2 mb-1 pl-1">
        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase"
          style={{ backgroundColor: `${sc}20`, color: sc }}>
          {incident?.severity ?? 'N/A'}
        </span>
        <span className="text-gray-700 text-[9px] font-mono flex items-center gap-1">
          <Clock size={8} />
          <WaitTimer createdAt={incident?.created_at} />
        </span>
      </div>

      {/* Row 2 */}
      <p className="text-white text-xs font-semibold capitalize pl-1 truncate">
        {cap(incident?.alert_type)}
      </p>
      <p className="text-gray-500 text-[10px] font-mono pl-1 mb-1.5">{incident?.service ?? '—'}</p>

      {/* AI recommendation */}
      {action && (
        <div className="flex items-center gap-1.5 pl-1 mb-2">
          <Zap size={9} className="text-[#7C3AED] flex-shrink-0" />
          <span className="text-[10px] font-mono text-gray-400">
            AI: <span className="text-[#A78BFA]">{cap(action)}</span>
          </span>
        </div>
      )}

      {/* Confidence bar */}
      <div className="flex items-center gap-2 pl-1">
        <div className="flex-1 h-[3px] rounded-full bg-[#1C2333] overflow-hidden">
          <motion.div className="h-full rounded-full"
            style={{ backgroundColor: confColor(conf) }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(conf * 100)}%` }}
            transition={{ duration: 0.6, ease: EASE }} />
        </div>
        <span className="text-[9px] font-mono flex-shrink-0" style={{ color: confColor(conf) }}>
          {Math.round(conf * 100)}%
        </span>
      </div>
    </motion.button>
  );
}

// ─── DECISION PANEL ───────────────────────────────────────────────────────────
const DECISION_BTNS = [
  { key: 'approve',  label: 'Approve',  sub: 'Execute AI recommendation', Icon: ShieldCheck, color: '#22C55E' },
  { key: 'redirect', label: 'Redirect', sub: 'Choose a different action',  Icon: RotateCcw,  color: '#FF9500' },
  { key: 'reject',   label: 'Reject',   sub: 'Escalate to on-call',        Icon: ShieldX,    color: '#FF3B5C' },
];

function DecisionPanel({ incident, onSuccess }) {
  const [decision, setDecision]         = useState(null);
  const [redirectAction, setRedirectAction] = useState('');
  const [note, setNote]                 = useState('');
  const [actor, setActor]               = useState(() => localStorage.getItem('override_actor') ?? '');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [done, setDone]                 = useState(false);
  const abortRef                        = useRef(null);

  const aiAction = incident?.triage_result?.recommended_action
    ?? incident?.triage_result?.strategist?.action_chosen ?? 'N/A';
  const incidentId = incident?.id ?? incident?.incident_id;

  // Persist actor name
  useEffect(() => {
    if (actor) localStorage.setItem('override_actor', actor);
    return () => { abortRef.current?.abort(); };
  }, [actor]);

  const finalAction = decision === 'approve' ? aiAction
    : decision === 'redirect' ? redirectAction
    : null;

  const canSubmit = decision && actor.trim() && !loading && !done
    && (decision !== 'redirect' || redirectAction);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!canSubmit) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);

    try {
      await api.post(`/api/incidents/${incidentId}/override`, {
        decision,
        action: finalAction,
        note: note.trim() || null,
        actor: actor.trim(),
      }, { signal: abortRef.current.signal });

      setDone(true);
      setTimeout(() => onSuccess(incidentId), 1600);
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      setError(str(err?.response?.data?.detail ?? err?.message ?? 'Submit failed'));
    } finally {
      if (!abortRef.current?.signal?.aborted) setLoading(false);
    }
  }, [canSubmit, incidentId, decision, finalAction, note, actor, onSuccess]);

  if (done) {
    return (
      <motion.div
        className="flex flex-col items-center justify-center gap-4 py-16"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ease: EASE, duration: 0.4 }}
      >
        <motion.div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'rgba(34,197,94,0.15)', border: '2px solid rgba(34,197,94,0.4)' }}
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ duration: 0.6, times: [0, 0.5, 1] }}
        >
          <CheckCircle2 size={40} className="text-[#22C55E]" />
        </motion.div>
        <p className="text-[#22C55E] font-mono text-sm font-semibold">Override recorded</p>
        <p className="text-gray-500 text-xs font-mono">Removing from queue…</p>
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Decision buttons */}
      <div>
        <p className="text-[10px] font-mono text-[#7C3AED] tracking-[0.22em] uppercase mb-3">
          Override Decision
        </p>
        <div className="grid grid-cols-3 gap-2">
          {DECISION_BTNS.map(({ key, label, sub, Icon, color }) => {
            const isActive = decision === key;
            return (
              <motion.button
                key={key}
                type="button"
                onClick={() => setDecision(key === decision ? null : key)}
                className="flex flex-col items-center gap-2 p-3 rounded-xl border text-center transition-all focus:outline-none"
                style={{
                  backgroundColor: isActive ? `${color}15` : 'transparent',
                  borderColor: isActive ? `${color}60` : '#1C2333',
                }}
                whileHover={{ scale: 1.02, borderColor: `${color}50`, transition: { duration: 0.12 } }}
                whileTap={{ scale: 0.97 }}
              >
                <motion.div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${color}18`, border: `1px solid ${color}35` }}
                  animate={isActive ? { scale: [1, 1.08, 1], opacity: [0.9, 1, 0.9] } : {}}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Icon size={18} style={{ color }} />
                </motion.div>
                <div>
                  <p className="font-mono text-xs font-bold" style={{ color: isActive ? color : 'white' }}>
                    {label}
                  </p>
                  <p className="text-gray-600 text-[9px] mt-0.5 leading-tight">{sub}</p>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Approve — shows AI action */}
      <AnimatePresence>
        {decision === 'approve' && (
          <motion.div
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border"
            style={{ backgroundColor: 'rgba(34,197,94,0.07)', borderColor: 'rgba(34,197,94,0.3)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ ease: EASE, duration: 0.2 }}
          >
            <CheckCircle2 size={14} className="text-[#22C55E] flex-shrink-0" />
            <span className="text-[#22C55E] font-mono text-xs">
              Will execute: <span className="font-bold capitalize">{cap(aiAction)}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Redirect — action dropdown */}
      <AnimatePresence>
        {decision === 'redirect' && (
          <motion.div
            className="space-y-1.5"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ ease: EASE, duration: 0.2 }}
          >
            <label htmlFor="redirect-action" className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
              Choose Action
            </label>
            <div className="relative">
              <select
                id="redirect-action"
                value={redirectAction}
                onChange={(e) => setRedirectAction(e.target.value)}
                className="w-full appearance-none bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2.5 pr-8 focus:outline-none focus:border-[#FF9500]/60 transition-colors"
                style={{ colorScheme: 'dark' }}
              >
                <option value="" disabled>Select alternative action…</option>
                {REDIRECT_ACTIONS.map((a) => (
                  <option key={a} value={a} className="bg-[#0D1117]">{cap(a)}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reject hint */}
      <AnimatePresence>
        {decision === 'reject' && (
          <motion.div
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border"
            style={{ backgroundColor: 'rgba(255,59,92,0.07)', borderColor: 'rgba(255,59,92,0.3)' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ ease: EASE, duration: 0.2 }}
          >
            <AlertTriangle size={14} className="text-[#FF3B5C] flex-shrink-0" />
            <span className="text-[#FF3B5C] font-mono text-xs">
              Will escalate to on-call. Backend routes to ESCALATE state.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Note */}
      <div className="space-y-1.5">
        <label htmlFor="override-note" className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
          Override Note <span className="text-gray-700">(optional)</span>
        </label>
        <textarea
          id="override-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Reason for override…"
          className="w-full bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2.5 placeholder-gray-700 focus:outline-none focus:border-[#7C3AED]/50 transition-colors resize-none"
        />
      </div>

      {/* Actor */}
      <div className="space-y-1.5">
        <label htmlFor="override-actor" className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
          Your Name / Handle
        </label>
        <div className="relative">
          <User size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
          <input
            id="override-actor"
            type="text"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="alice@ops"
            className="w-full bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg pl-8 pr-3 py-2.5 placeholder-gray-700 focus:outline-none focus:border-[#7C3AED]/50 transition-colors"
          />
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="flex items-start gap-2 px-3 py-2.5 rounded-lg border"
            style={{ backgroundColor: 'rgba(255,59,92,0.08)', borderColor: 'rgba(255,59,92,0.3)' }}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          >
            <XCircle size={13} className="text-[#FF3B5C] flex-shrink-0 mt-0.5" />
            <p className="text-[#FF3B5C] text-xs font-mono">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Submit */}
      <motion.button
        type="submit"
        disabled={!canSubmit}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-mono text-sm font-bold transition-all"
        style={{
          backgroundColor: canSubmit
            ? (decision === 'approve' ? '#22C55E' : decision === 'reject' ? '#FF3B5C' : '#FF9500')
            : 'rgba(124,58,237,0.12)',
          color: canSubmit ? '#080B14' : '#7C3AED50',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
        whileHover={canSubmit ? { scale: 1.02, filter: 'brightness(1.08)' } : {}}
        whileTap={canSubmit ? { scale: 0.97 } : {}}
      >
        {loading ? (
          <>
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
              <Loader2 size={15} />
            </motion.div>
            Submitting…
          </>
        ) : (
          <>
            <Shield size={15} />
            Confirm Override
          </>
        )}
      </motion.button>
    </form>
  );
}

// ─── OVERRIDE HISTORY ──────────────────────────────────────────────────────────
const DECISION_STYLES = {
  approve:  { color: '#22C55E', label: 'Approved' },
  redirect: { color: '#FF9500', label: 'Redirected' },
  reject:   { color: '#FF3B5C', label: 'Rejected' },
};

function OverrideHistory() {
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [open, setOpen]           = useState(false);
  const abortRef                  = useRef(null);

  const fetchHistory = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);

    api.get('/api/overrides', { signal: abortRef.current.signal })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : [];
        setHistory(list.slice(0, 10));
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[OverrideHistory] API unavailable, using mock', e);
        setHistory(MOCK_HISTORY);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchHistory();
    return () => { abortRef.current?.abort(); };
  }, [fetchHistory]);

  return (
    <div className="border-t border-[#1C2333]">
      <motion.button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors"
        whileTap={{ scale: 0.99 }}
      >
        <div className="flex items-center gap-2">
          <History size={13} className="text-gray-600" />
          <span className="text-[11px] font-mono text-gray-500 uppercase tracking-wider">Override History</span>
          {history.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#1C2333] text-gray-500">
              {history.length}
            </span>
          )}
        </div>
        {open ? <ChevronUp size={13} className="text-gray-600" /> : <ChevronDown size={13} className="text-gray-600" />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4">
              {loading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skeleton h-10 rounded-lg" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-gray-600 text-xs font-mono py-4 text-center">No override history yet</p>
              ) : (
                <div className="space-y-1.5">
                  {history.map((ov, i) => {
                    const ds = DECISION_STYLES[ov?.decision] ?? { color: '#9CA3AF', label: ov?.decision ?? 'Unknown' };
                    const agreed = str(ov?.ai_action) === str(ov?.action);
                    return (
                      <motion.div key={ov?.id ?? i}
                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#1C2333] hover:border-[#2D3748] transition-colors"
                        style={{ backgroundColor: '#080B14' }}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05, ease: EASE, duration: 0.25 }}>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold flex-shrink-0"
                          style={{ backgroundColor: `${ds.color}18`, color: ds.color }}>
                          {ds.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-[10px] font-mono">
                            {ov?.ai_action && (
                              <>
                                <span className="text-gray-600">AI:</span>
                                <span className="text-gray-400 capitalize">{cap(ov.ai_action)}</span>
                              </>
                            )}
                            {ov?.action && !agreed && (
                              <>
                                <ArrowRight size={9} className="text-gray-700" />
                                <span className="capitalize" style={{ color: ds.color }}>{cap(ov.action)}</span>
                              </>
                            )}
                            {agreed && <span className="text-gray-600 text-[9px]">(agreed)</span>}
                          </div>
                          <p className="text-gray-700 text-[9px] font-mono truncate">
                            {ov?.actor} · {formatTimestamp(ov?.timestamp ?? ov?.created_at)}
                          </p>
                        </div>
                        <span className="text-gray-700 text-[9px] font-mono flex-shrink-0">
                          #{truncateId(ov?.incident_id)}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function HumanOverridePanel() {
  const [queue, setQueue]             = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId]   = useState(null);
  const [fullIncident, setFullIncident] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const listAbort   = useRef(null);
  const detailAbort = useRef(null);
  const wsRef       = useRef(null);
  const { subscribe } = useSystem();

  // ── Fetch awaiting_review queue ────────────────────────────────────────────
  const fetchQueue = useCallback(() => {
    listAbort.current?.abort();
    listAbort.current = new AbortController();
    setListLoading(true);

    api.get('/api/incidents', { signal: listAbort.current.signal })
      .then(({ data }) => {
        const all  = Array.isArray(data) ? data : [];
        const q    = all.filter((i) => i?.status === 'awaiting_review');
        // Priority sort: critical first, then by created_at (oldest first)
        q.sort((a, b) => {
          const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          const sa = sevOrder[sev(a?.severity)] ?? 4;
          const sb = sevOrder[sev(b?.severity)] ?? 4;
          if (sa !== sb) return sa - sb;
          return new Date(a?.created_at ?? 0) - new Date(b?.created_at ?? 0);
        });
        setQueue(q);
        setListLoading(false);
        if (!selectedId && q.length > 0) {
          const id = q[0]?.id ?? q[0]?.incident_id;
          if (id) setSelectedId(str(id));
        }
      })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[HumanOverridePanel] list unavailable, using mock', e);
        setQueue(MOCK_QUEUE);
        setListLoading(false);
        setSelectedId(MOCK_QUEUE[0]?.id ?? null);
      });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchQueue();
    return () => { listAbort.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket for INCIDENT_UPDATED ──────────────────────────────────────────
  useEffect(() => {
    return subscribe('*', (msg) => {
      const type = msg?.type ?? msg?.event_type;
      if (['INCIDENT_UPDATED', 'INCIDENT_CREATED', 'INCIDENT_RESOLVED'].includes(type)) {
        fetchQueue();
      }
    });
  }, [fetchQueue, subscribe]);

  // ── Fetch incident detail ───────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;

    detailAbort.current?.abort();
    detailAbort.current = new AbortController();
    const signal = detailAbort.current.signal;

    setDetailLoading(true);
    setFullIncident(null);

    api.get(`/api/incidents/${selectedId}`, { signal })
      .then(({ data }) => {
        if (signal.aborted) return;
        setFullIncident(data ?? null);
        setDetailLoading(false);
      })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        const fallback = queue.find((i) => str(i?.id ?? i?.incident_id) === selectedId) ?? null;
        setFullIncident(fallback);
        setDetailLoading(false);
      });

    return () => { detailAbort.current?.abort(); };
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── On override success: remove from queue ─────────────────────────────────
  const handleSuccess = useCallback((incidentId) => {
    setQueue((prev) => prev.filter((i) => str(i?.id ?? i?.incident_id) !== str(incidentId)));
    setSelectedId(null);
    setFullIncident(null);
  }, []);

  return (
    <div className="flex h-full min-h-full overflow-hidden">
      {/* ── LEFT: Queue ─────────────────────────────────────────────────────── */}
      <aside className="flex-shrink-0 flex flex-col border-r border-[#1C2333] bg-[#080B14]"
        style={{ width: 300 }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1C2333]">
          <div className="flex items-center gap-2">
            <motion.div
              className="w-2 h-2 rounded-full bg-[#7C3AED]"
              animate={{ opacity: [1, 0.3, 1], scale: [1, 1.2, 1] }}
              transition={{ duration: 1.8, repeat: Infinity }}
            />
            <span className="text-white font-mono text-[11px] font-semibold tracking-[0.12em] uppercase">
              Awaiting Review
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!listLoading && (
              <AnimatePresence>
                {queue.length > 0 && (
                  <motion.span
                    className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold"
                    style={{ backgroundColor: 'rgba(124,58,237,0.2)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.4)' }}
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.7, opacity: 0 }}
                  >
                    {queue.length}
                  </motion.span>
                )}
              </AnimatePresence>
            )}
            <motion.button onClick={fetchQueue} className="p-1 rounded text-gray-600 hover:text-[#7C3AED] transition-colors"
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
              <RotateCcw size={11} />
            </motion.button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {listLoading ? (
            <QueueSkeleton />
          ) : queue.length === 0 ? (
            <motion.div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <motion.div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)' }}
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 3, repeat: Infinity }}
              >
                <ShieldCheck size={30} className="text-[#22C55E]" />
              </motion.div>
              <p className="text-gray-400 text-xs font-mono font-medium">No incidents awaiting review</p>
              <p className="text-gray-600 text-[10px] font-mono leading-relaxed">
                The AI is handling everything autonomously
              </p>
            </motion.div>
          ) : (
            <div className="p-2.5 space-y-1.5">
              <AnimatePresence mode="popLayout">
                {queue.map((incident) => {
                  const id = str(incident?.id ?? incident?.incident_id);
                  return (
                    <QueueCard
                      key={id}
                      incident={incident}
                      isSelected={selectedId === id}
                      onClick={() => setSelectedId(id)}
                    />
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </aside>

      {/* ── RIGHT: Detail + Actions + History ───────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#080B14]">
        {!selectedId ? (
          <motion.div className="flex-1 flex flex-col items-center justify-center gap-4"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div
              animate={{ opacity: [0.3, 0.7, 0.3], scale: [1, 1.06, 1] }}
              transition={{ duration: 3, repeat: Infinity }}>
              <Shield size={52} className="text-[#2D3748]" />
            </motion.div>
            <p className="text-gray-600 text-sm font-mono">Select an incident to override</p>
          </motion.div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Top: AI Explainability Panel */}
            <div className="p-5 border-b border-[#1C2333]">
              <AnimatePresence mode="wait">
                {detailLoading ? (
                  <motion.div key="skel" className="bg-[#0D1117] border border-[#1C2333] rounded-2xl p-6 space-y-4 animate-pulse"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <div className="flex gap-4">
                      <div className="skeleton w-[160px] h-[100px] rounded-full flex-shrink-0" />
                      <div className="flex-1 space-y-2.5">
                        <div className="skeleton h-3 w-32 rounded" />
                        <div className="skeleton h-3 w-full rounded" />
                        <div className="skeleton h-3 w-5/6 rounded" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {[0,1,2].map((i) => <div key={i} className="flex-1 skeleton h-36 rounded-xl" />)}
                    </div>
                  </motion.div>
                ) : fullIncident ? (
                  <motion.div key={`panel-${selectedId}`}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    transition={{ ease: EASE, duration: 0.3 }}>
                    <AIExplainabilityPanel incident={fullIncident} />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            {/* Middle: Decision Panel */}
            {fullIncident && (
              <div className="px-5 py-5 border-b border-[#1C2333]">
                <DecisionPanel
                  key={selectedId}
                  incident={fullIncident}
                  onSuccess={handleSuccess}
                />
              </div>
            )}

            {/* Bottom: Override History */}
            <OverrideHistory />
          </div>
        )}
      </div>
    </div>
  );
}
