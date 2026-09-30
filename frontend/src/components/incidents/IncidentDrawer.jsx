import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, ChevronDown, ChevronUp, Copy, CheckCheck,
  ArrowRight, Clock, CheckCircle2, XCircle, AlertTriangle,
  Brain, Zap, Shield, ExternalLink, RefreshCw, Cpu, FileText,
  Database, BrainCircuit, ShieldCheck
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import api from '../../config/api';
import { SEVERITY_COLORS, STATUS_COLORS } from '../../config/constants';
import { formatTimestamp, getStatusLabel, truncateId, formatConfidence, formatDuration } from '../../utils/formatters';

const EASE   = [0.25, 0.46, 0.45, 0.94];
const SPRING = { type: 'spring', damping: 28, stiffness: 280 };

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();

const MOCK_INCIDENT = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  alert_type: 'cpu_spike',
  severity: 'critical',
  service: 'payment-service',
  status: 'awaiting_review',
  confidence: 0.87,
  is_predictive: false,
  autonomy_mode: 'REVIEW',
  ai_reasoning: 'Based on historical patterns and real-time metrics, this CPU spike on payment-service is consistent with a sudden traffic surge. Similar incidents have occurred 12 times in the past 30 days, with scale_service resolving 91% of cases. However, the confidence score of 0.87 falls below the autonomous action threshold of 0.90, requiring human review before execution. The LLM validator assessed risk as elevated due to peak business hours.',
  llm_used: 'gemini',
  triage_result: {
    root_cause: 'CPU utilization exceeded 95% threshold on pod payment-svc-3 driven by a 340% traffic spike from a flash sale event. The pod autoscaler has not yet triggered due to a 2-minute lag in the HPA metrics pipeline.',
    recommended_action: 'scale_service',
    estimated_impact: 'High — transaction processing degraded, 2.3s P99 latency increase',
    chain_of_thought: [
      'Alert received: cpu_spike on payment-service (CPU 94.7% sustained for 3 min)',
      'Querying incident history — found 12 matching patterns in last 30 days',
      'Pattern classification: traffic-induced CPU exhaustion (confidence 0.84)',
      'Evaluating remediation options: scale_service vs restart_service vs circuit_break',
      'Historical success analysis: scale_service resolved 11/12 similar cases (91.6%)',
      'Risk assessment: Scale action during peak hours — moderate risk level 0.15',
      'Cost evaluation: Adding 2 replicas — estimated $2.40/hr incremental cost',
      'LLM validation: Gemini-1.5-Pro confirms scale action is appropriate',
      'Confidence calculation: 0.87 — below AUTO threshold of 0.90, escalating to REVIEW',
    ],
    why: {
      base_confidence: 0.72,
      historical_success: 0.916,
      similarity_score: 0.84,
      risk_penalty: 0.15,
      cost_penalty: 0.08,
      llm_adjustment: 0.05,
      final_confidence: 0.87,
      similar_incidents: 12,
      llm_provider: 'gemini',
      alternatives: [
        { action: 'scale_service',   score: 0.87 },
        { action: 'restart_service', score: 0.73 },
        { action: 'reroute_traffic', score: 0.61 },
        { action: 'circuit_break',   score: 0.44 },
      ],
    },
    sentinel: {
      similar_count: 12,
      patterns_matched: ['cpu_spike', 'payment-service', 'traffic_surge', 'hpa_lag'],
    },
    strategist: {
      action_chosen: 'scale_service',
      confidence: 0.87,
    },
    validator: {
      mode: 'REVIEW',
      reason: 'Confidence 0.87 below AUTO threshold 0.90 — human approval required',
    },
  },
  execution_log: [
    { step: 'shadow_execute', action: 'scale_service', status: 'success',    timestamp: ago(12), details: 'Dry-run completed — would add 2 replicas' },
    { step: 'await_approval', action: null,             status: 'in_progress', timestamp: ago(10), details: 'Waiting for human review decision' },
  ],
  state_history: [
    { status: 'new',            timestamp: ago(15), actor: 'system',     reason: 'Alert ingested from monitoring pipeline' },
    { status: 'triaged',        timestamp: ago(14), actor: 'SENTINEL',   reason: '12 similar patterns matched' },
    { status: 'in_progress',    timestamp: ago(13), actor: 'STRATEGIST', reason: 'scale_service selected with confidence 0.87' },
    { status: 'awaiting_review',timestamp: ago(10), actor: 'VALIDATOR',  reason: 'Below auto threshold — human review required' },
  ],
  created_at: ago(15),
  updated_at: ago(2),
  resolved_at: null,
};

const MOCK_POSTMORTEM = {
  incident_id: MOCK_INCIDENT.id,
  summary: 'Payment service experienced a CPU spike caused by a flash sale traffic surge. The AI correctly identified the pattern and recommended scaling, which was executed after human approval.',
  root_cause: 'HPA metrics pipeline lag of 2 minutes prevented auto-scaling from triggering in time.',
  impact: 'P99 latency increased by 2.3 seconds for 18 minutes affecting approximately 4,200 transactions.',
  prevention_measures: [
    'Reduce HPA scale-up stabilization window from 5min to 1min',
    'Add predictive scaling trigger based on marketing event calendar',
    'Pre-warm payment-service pods before known flash sale events',
  ],
  lessons_learned: 'Flash sale events should be pre-configured in the scaling policy. The AI correctly identified the issue but the HPA lag could be mitigated with proactive configuration.',
  generated_at: ago(1),
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function sevColor(sev) { return SEVERITY_COLORS[typeof sev === 'string' ? sev.toLowerCase() : 'low'] ?? '#9CA3AF'; }
function statusColor(s) { return STATUS_COLORS[s] ?? '#9CA3AF'; }
function confColor(c) {
  const v = c ?? 0;
  if (v >= 0.85) return '#22C55E';
  if (v >= 0.60) return '#FF9500';
  return '#FF3B5C';
}

function SectionHeader({ label, children }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <span className="text-[10px] font-mono text-gray-600 tracking-[0.2em] uppercase">{label}</span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#1C2333] my-5" />;
}

// ─── COPY BUTTON ──────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handle = useCallback(() => {
    navigator.clipboard.writeText(text ?? '').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <motion.button onClick={handle} className="text-gray-600 hover:text-[#00D4FF] transition-colors"
      whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
      {copied ? <CheckCheck size={13} className="text-[#22C55E]" /> : <Copy size={13} />}
    </motion.button>
  );
}

// ─── CONFIDENCE GAUGE ─────────────────────────────────────────────────────────
function ConfidenceGauge({ value }) {
  const R    = 38;
  const circ = 2 * Math.PI * R;
  const conf = value ?? 0;
  const offset = circ - conf * circ;
  const color  = confColor(conf);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="100" height="100" className="overflow-visible">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#1C2333" strokeWidth="7" />
        <motion.circle
          cx="50" cy="50" r={R}
          fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: EASE, delay: 0.2 }}
          style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px', filter: `drop-shadow(0 0 6px ${color}60)` }}
        />
        <text x="50" y="46" textAnchor="middle" fill="white" fontSize="20" fontWeight="700" fontFamily="monospace">{Math.round(conf * 100)}</text>
        <text x="50" y="60" textAnchor="middle" fill="#6B7280" fontSize="9"  fontFamily="monospace" letterSpacing="1">CONF %</text>
      </svg>
    </div>
  );
}

// ─── LLM BADGE ───────────────────────────────────────────────────────────────
function LlmBadge({ llm }) {
  const configs = {
    gemini: { label: 'GEMINI',  color: '#4285F4', bg: 'rgba(66,133,244,0.12)' },
    grok:   { label: 'GROK',    color: '#00D4FF', bg: 'rgba(0,212,255,0.12)'  },
    none:   { label: 'NO LLM',  color: '#6B7280', bg: 'rgba(107,114,128,0.12)'},
  };
  const c = configs[typeof llm === 'string' ? llm.toLowerCase() : 'none'] ?? configs.none;
  return (
    <span className="px-2.5 py-1 rounded font-mono text-xs font-bold uppercase tracking-wider"
      style={{ backgroundColor: c.bg, color: c.color, border: `1px solid ${c.color}30` }}>
      🤖 {c.label}
    </span>
  );
}

// ─── AUTONOMY BADGE ───────────────────────────────────────────────────────────
function AutonomyBadge({ mode }) {
  const styles = {
    AUTO:     { color: '#22C55E', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)',   label: '⚡ AUTONOMOUS' },
    REVIEW:   { color: '#A78BFA', bg: 'rgba(124,58,237,0.12)',  border: 'rgba(124,58,237,0.3)',  label: '👁 REVIEW'     },
    ESCALATE: { color: '#FF3B5C', bg: 'rgba(255,59,92,0.12)',   border: 'rgba(255,59,92,0.3)',   label: '🚨 ESCALATED'  },
  };
  const s = styles[mode] ?? styles.REVIEW;
  return (
    <span className="px-3 py-1.5 rounded-lg font-mono text-xs font-bold tracking-wider flex-shrink-0"
      style={{ backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
      {s.label}
    </span>
  );
}

// ─── CHAIN OF THOUGHT ─────────────────────────────────────────────────────────
function ChainOfThought({ steps }) {
  const [expanded, setExpanded] = useState(false);
  const safeSteps = Array.isArray(steps) ? steps : [];
  if (safeSteps.length === 0) return null;
  return (
    <div>
      <SectionHeader label="AI Chain of Thought">
        <motion.button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-mono text-gray-500 hover:text-[#7C3AED] transition-colors"
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? 'Collapse' : `Show ${safeSteps.length} steps`}
        </motion.button>
      </SectionHeader>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.35 }}
            className="overflow-hidden"
          >
            <div className="space-y-0 relative">
              <div className="absolute left-3.5 top-2 bottom-2 w-px bg-[#1C2333]" />
              {safeSteps.map((step, i) => (
                <motion.div
                  key={i}
                  className="flex gap-3 pb-3 relative"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, ease: EASE, duration: 0.3 }}
                >
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#0D1117] border border-[#1C2333] flex items-center justify-center z-10">
                    <span className="text-[#7C3AED] font-mono text-[10px] font-bold">{i + 1}</span>
                  </div>
                  <p className="text-gray-300 text-xs leading-relaxed pt-1.5">{step}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!expanded && (
        <p className="text-gray-600 text-xs font-mono italic">
          "{safeSteps[0]?.substring(0, 80)}..."
        </p>
      )}
    </div>
  );
}

// ─── WHY BLOCK ────────────────────────────────────────────────────────────────
function WhyBlock({ why }) {
  if (!why) return null;
  const {
    base_confidence = 0, historical_success = 0, similarity_score = 0,
    risk_penalty = 0, cost_penalty = 0, llm_adjustment = 0,
    final_confidence = 0, similar_incidents = 0, alternatives = [],
  } = why;

  const rows = [
    { label: 'Base confidence',      weight: '× 0.50', value: base_confidence * 0.50,    sign: '+', raw: base_confidence },
    { label: 'Historical success',   weight: '× 0.30', value: historical_success * 0.30,  sign: '+', raw: historical_success },
    { label: 'Similarity score',     weight: '× 0.20', value: similarity_score * 0.20,    sign: '+', raw: similarity_score },
    { label: 'Risk penalty',         weight: '× 0.08', value: -(risk_penalty * 0.08),     sign: '−', raw: risk_penalty },
    { label: 'Cost penalty',         weight: '× 0.05', value: -(cost_penalty * 0.05),     sign: '−', raw: cost_penalty },
    { label: 'LLM adjustment',       weight: '',        value: llm_adjustment,              sign: '+', raw: llm_adjustment },
  ];
  const maxAlt = Math.max(...(Array.isArray(alternatives) ? alternatives.map((a) => a?.score ?? 0) : [1]), 1);

  return (
    <div>
      <SectionHeader label="Confidence Scoring">
        <span className="text-gray-700 text-[10px] font-mono">{similar_incidents} similar incidents</span>
      </SectionHeader>

      <div className="space-y-1.5 mb-3">
        {rows.map((row, i) => {
          const pct = Math.abs(row.raw * 100).toFixed(0);
          const color = row.sign === '−' ? '#FF3B5C' : '#22C55E';
          return (
            <motion.div key={i}
              className="flex items-center gap-2 font-mono text-[11px]"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, ease: EASE, duration: 0.3 }}>
              <span style={{ color }} className="w-3 flex-shrink-0">{row.sign}</span>
              <span className="text-gray-400 flex-1">{row.label}</span>
              <span className="text-gray-600 w-14 text-right">{row.weight}</span>
              <span style={{ color }} className="w-12 text-right">{pct}%</span>
              <div className="w-16 h-1 rounded-full bg-[#1C2333] overflow-hidden flex-shrink-0">
                <motion.div className="h-full rounded-full"
                  style={{ backgroundColor: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, parseFloat(pct))}%` }}
                  transition={{ duration: 0.7, delay: i * 0.06 + 0.2, ease: EASE }} />
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="border-t border-[#1C2333] pt-2 flex items-center justify-between">
        <span className="text-gray-500 font-mono text-[11px] uppercase tracking-wider">Final Confidence</span>
        <span className="font-mono text-lg font-bold" style={{ color: confColor(final_confidence) }}>
          {Math.round(final_confidence * 100)}%
        </span>
      </div>

      {/* Alternatives */}
      {Array.isArray(alternatives) && alternatives.length > 0 && (
        <div className="mt-4 space-y-2">
          <span className="text-gray-600 text-[10px] font-mono uppercase tracking-wider">Actions Considered</span>
          {alternatives.map((alt, i) => {
            const score = alt?.score ?? 0;
            const isChosen = i === 0 || score === Math.max(...alternatives.map(a => a?.score ?? 0));
            return (
              <div key={i} className="flex items-center gap-2.5">
                <span className={`text-[11px] font-mono capitalize flex-shrink-0 w-32 truncate ${isChosen ? 'text-[#00D4FF]' : 'text-gray-500'}`}>
                  {(alt?.action ?? '').replace(/_/g, ' ')}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-[#1C2333] overflow-hidden">
                  <motion.div className="h-full rounded-full"
                    style={{ backgroundColor: isChosen ? '#00D4FF' : '#4B5563' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${((score / maxAlt) * 100).toFixed(0)}%` }}
                    transition={{ duration: 0.7, delay: i * 0.07, ease: EASE }} />
                </div>
                <span className={`font-mono text-[11px] w-9 text-right flex-shrink-0 ${isChosen ? 'text-[#00D4FF]' : 'text-gray-600'}`}>
                  {Math.round(score * 100)}%
                </span>
                {isChosen && <span className="text-[#00D4FF] text-[9px] font-mono flex-shrink-0">CHOSEN</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── DECISION PROCESS (FIX 1) ───────────────────────────────────────────────
function DecisionProcess({ incident }) {
  const [showAllSteps, setShowAllSteps] = useState(false);
  
  const triage = incident?.triage_result ?? {};
  const sentinel = triage.sentinel ?? {};
  const strategist = triage.strategist ?? {};
  const validator = triage.validator ?? {};
  const why = triage.why ?? {};
  const alternatives = why.alternatives ?? [];
  const chainOfThought = triage.chain_of_thought ?? [];
  
  const displaySteps = showAllSteps ? chainOfThought : chainOfThought.slice(0, 3);
  
  return (
    <div className="space-y-6">
      <SectionHeader label="How the AI Decided">
        <Brain size={16} className="text-[#7C3AED]" />
      </SectionHeader>

      {/* SUBSECTION A — The Situation */}
      <div className="mb-6">
        <h4 className="text-[#7C3AED] text-[10px] font-mono font-bold uppercase mb-2 tracking-wider">The Situation</h4>
        <p className="text-gray-300 text-sm leading-relaxed">
          The AI detected a <span className="text-[#FF3B5C] font-semibold uppercase">{incident?.severity ?? 'unknown'}</span>{' '}
          <span className="text-[#00D4FF] font-mono capitalize">{(incident?.alert_type ?? 'unknown').replace(/_/g, ' ')}</span> on{' '}
          <span className="text-white font-mono">{incident?.service ?? 'unknown'}</span>. 
          At the time, <span className="font-bold">{sentinel.similar_count ?? 0}</span> similar past incidents were found in memory, 
          and the service had <span className="text-[#FF9500] uppercase">{incident?.health_status ?? 'unknown'}</span> health status with <span className="text-gray-400 uppercase">{incident?.traffic_level ?? 'normal'}</span> traffic.
        </p>
      </div>

      {/* SUBSECTION B — The Decision Process */}
      <div>
        <h4 className="text-[#7C3AED] text-[10px] font-mono font-bold uppercase mb-4 tracking-wider">The Decision Process</h4>
        <div className="space-y-4">
          
          {/* STEP 1 — SENTINEL */}
          <div className="rounded-xl border border-[#7C3AED]/30 bg-[#7C3AED]/5 p-4 flex gap-4">
            <div className="flex-shrink-0 mt-1">
              <div className="w-8 h-8 rounded-lg bg-[#7C3AED]/20 flex items-center justify-center">
                <Database size={16} className="text-[#A78BFA]" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[#A78BFA] text-[10px] font-mono font-bold uppercase tracking-wider mb-1">Memory Search</p>
              <p className="text-gray-300 text-xs mb-2 leading-relaxed">
                Searched historical incident memory and found <span className="font-bold text-white">{sentinel.similar_count ?? 0}</span> similar past incidents.<br />
                Top resolution pattern: <span className="font-mono text-[#00D4FF]">{sentinel.patterns_matched?.[0] ?? sentinel.top_past_resolutions?.[0]?.action_taken ?? 'No prior data'}</span>
              </p>
              <div className="flex items-center gap-3 mt-3">
                <div className="flex-1 h-1.5 rounded-full bg-[#1C2333] overflow-hidden">
                  <motion.div className="h-full rounded-full bg-[#7C3AED]"
                    initial={{ width: 0 }}
                    animate={{ width: `${(why.similarity_score ?? 0) * 100}%` }}
                    transition={{ duration: 0.8, ease: EASE }} />
                </div>
                <span className="text-[10px] font-mono text-[#A78BFA] flex-shrink-0">{Math.round((why.similarity_score ?? 0) * 100)}% match</span>
              </div>
            </div>
          </div>

          {/* STEP 2 — STRATEGIST */}
          <div className="rounded-xl border border-[#00D4FF]/30 bg-[#00D4FF]/5 p-4 flex gap-4">
            <div className="flex-shrink-0 mt-1">
              <div className="w-8 h-8 rounded-lg bg-[#00D4FF]/20 flex items-center justify-center">
                <BrainCircuit size={16} className="text-[#00D4FF]" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[#00D4FF] text-[10px] font-mono font-bold uppercase tracking-wider mb-3">Decision Engine</p>
              
              {/* Scoring breakdown table */}
              <div className="font-mono text-[10px] text-gray-400 bg-black/40 border border-[#1C2333] rounded p-3 mb-3">
                <div className="flex justify-between items-center mb-1">
                  <span>Base Confidence</span>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></div>
                    <span>{(why.base_confidence ?? 0).toFixed(2)} × 0.50 = {((why.base_confidence ?? 0) * 0.5).toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span>Historical Success</span>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></div>
                    <span>{(why.historical_success ?? 0).toFixed(2)} × 0.30 = {((why.historical_success ?? 0) * 0.3).toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span>Similarity Score</span>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></div>
                    <span>{(why.similarity_score ?? 0).toFixed(2)} × 0.20 = {((why.similarity_score ?? 0) * 0.2).toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span>Risk Penalty</span>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FF3B5C]"></div>
                    <span>{Number(why.risk_penalty ?? 0).toFixed(2)} × 0.08 = -{((why.risk_penalty ?? 0) * 0.08).toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center mb-1">
                  <span>Cost Penalty</span>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#FF3B5C]"></div>
                    <span>{Number(why.cost_penalty ?? 0).toFixed(2)} × 0.05 = -{((why.cost_penalty ?? 0) * 0.05).toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-[#1C2333]/60 mb-2">
                  <span>LLM Adjustment</span>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"></div>
                    <span className="text-[#22C55E]">{(why.llm_adjustment ?? 0) > 0 ? '+' : ''}{(why.llm_adjustment ?? 0).toFixed(2)}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center font-bold text-white">
                  <span>FINAL CONFIDENCE</span>
                  <span>{Math.round((why.final_confidence ?? 0) * 100)}%</span>
                </div>
              </div>

              {/* LLM Status */}
              <p className="text-gray-400 text-[10px] mb-4 text-left font-mono">
                {why.llm_provider && why.llm_provider.toLowerCase() !== 'none' 
                  ? `Called ${why.llm_provider} which adjusted confidence by ${(why.llm_adjustment ?? 0) > 0 ? '+' : ''}${why.llm_adjustment ?? 0}`
                  : 'Resolved using historical patterns only — no LLM call was needed'
                }
              </p>

              {/* Alternatives */}
              {alternatives.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-mono text-gray-500 uppercase">Alternatives considered</p>
                  <div className="flex flex-wrap gap-2">
                    {alternatives.map((alt, i) => {
                      const isChosen = alt.action === (strategist.action ?? strategist.action_chosen ?? triage.final_action) || i === 0;
                      return (
                        <div key={i} className={`px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1.5 ${isChosen ? 'border border-[#00D4FF] bg-[#00D4FF]/10 text-white' : 'border border-[#1C2333] bg-[#080B14] text-gray-400'}`}>
                          {alt.action?.replace(/_/g, ' ')}: {Math.round((alt.score ?? 0) * 100)}%
                          {isChosen && <span className="text-[#00D4FF] font-bold">✓ SELECTED</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* STEP 3 — VALIDATOR */}
          <div className="rounded-xl border border-gray-700/50 bg-gray-800/10 p-4 flex gap-4">
            <div className="flex-shrink-0 mt-1">
              <div className="w-8 h-8 rounded-lg bg-gray-800/50 flex items-center justify-center border border-gray-700">
                <ShieldCheck size={16} className={validator.mode === 'AUTO' ? 'text-[#22C55E]' : validator.mode === 'ESCALATE' ? 'text-[#FF3B5C]' : 'text-[#A78BFA]'} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-[10px] font-mono font-bold uppercase tracking-wider mb-2 ${validator.mode === 'AUTO' ? 'text-[#22C55E]' : validator.mode === 'ESCALATE' ? 'text-[#FF3B5C]' : 'text-[#A78BFA]'}`}>
                Safety Gate
              </p>
              <p className="text-gray-300 text-xs mb-4">
                With a final confidence of <span className="font-bold text-white">{Math.round((why.final_confidence ?? 0) * 100)}%</span>, the Validator applied the following routing rule:
              </p>
              
              {/* Threshold Scale line */}
              <div className="mb-5">
                <div className="relative h-2 rounded-full overflow-hidden flex font-mono text-[9px] text-[#080B14] font-bold mb-1">
                  <div className="w-[60%] bg-[#FF3B5C] flex items-center justify-center">ESCALATE</div>
                  <div className="w-[25%] bg-[#A78BFA] flex items-center justify-center relative">
                    <span className="absolute -left-3 top-[-14px] text-gray-400 text-[8px] font-normal">60%</span>
                    REVIEW
                  </div>
                  <div className="w-[15%] bg-[#22C55E] flex items-center justify-center relative">
                    <span className="absolute -left-3 top-[-14px] text-gray-400 text-[8px] font-normal">85%</span>
                    AUTO
                  </div>
                </div>
                <div className="relative h-0">
                  <motion.div className="absolute top-[-4px] w-2 h-2 rounded-full bg-white shadow-[0_0_8px_white]"
                    initial={{ left: 0 }}
                    animate={{ left: `calc(${Math.round((why.final_confidence ?? 0) * 100)}% - 4px)` }}
                    transition={{ delay: 0.5, duration: 1, ease: EASE }} />
                </div>
              </div>

              <div className="flex items-center flex-wrap gap-2 mt-2">
                <span className={`px-2 py-1 rounded text-[10px] font-mono font-bold ${validator.mode === 'AUTO' ? 'bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30' : validator.mode === 'ESCALATE' ? 'bg-[#FF3B5C]/10 text-[#FF3B5C] border border-[#FF3B5C]/30' : 'bg-[#A78BFA]/10 text-[#A78BFA] border border-[#A78BFA]/30'}`}>
                  {validator.mode ?? 'UNKNOWN'}
                </span>
                <span className="text-gray-400 text-xs font-mono break-words">— {validator.reason ?? 'No reason provided'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SUBSECTION C — Chain of Thought */}
      {chainOfThought.length > 0 && (
        <div className="mt-8">
          <h4 className="text-gray-500 text-[10px] font-mono uppercase mb-4 tracking-[0.2em]">AI Reasoning Steps</h4>
          <div className="relative pl-3 ml-3 border-l border-[#1C2333]/40 space-y-4">
            {displaySteps.map((step, i) => (
              <motion.div key={i} className="relative"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, ease: EASE, duration: 0.3 }}>
                <div className="absolute -left-[19px] top-[-2px] w-4 h-4 rounded-full bg-[#080B14] border border-[#00D4FF] flex items-center justify-center text-[#00D4FF] font-mono text-[8px] font-bold">
                  {i + 1}
                </div>
                <p className="text-gray-300 text-xs pl-3 font-mono leading-relaxed">{step}</p>
              </motion.div>
            ))}
          </div>
          {chainOfThought.length > 3 && (
            <button onClick={() => setShowAllSteps(!showAllSteps)} className="mt-4 ml-7 text-[10px] font-mono text-[#00D4FF] hover:text-[#00D4FF]/80 underline transition-colors">
              {showAllSteps ? 'Show less' : `Show all ${chainOfThought.length} steps`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── EXECUTION TIMELINE (DEPRECATED) ─────────────────────────────────────────

// ─── MCP EXECUTION LAYER ──────────────────────────────────────────────────────
function McpExecutionLayer({ incident }) {
  const mcpTool = incident?.mcp_tool_used;
  const mcpOut  = incident?.mcp_output;
  const log     = Array.isArray(incident?.execution_log) ? incident.execution_log : [];

  return (
    <div>
      <SectionHeader label="MCP Tool Execution">
        <div className="flex items-center gap-1.5 text-[#00D4FF]">
          <Cpu size={12} />
          <span className="text-[10px] font-mono tracking-wider text-[#00D4FF]">EXECUTION ENGINE</span>
        </div>
      </SectionHeader>

      <div className="space-y-4">
        {/* Tool Used Badge */}
        <div>
          <span className="text-gray-500 text-[10px] font-mono uppercase tracking-wider block mb-1">Target Tool</span>
          {mcpTool ? (
            <span className="inline-block px-3 py-1 bg-[#00D4FF]/10 border border-[#00D4FF]/30 text-[#00D4FF] font-mono text-xs rounded">
              {mcpTool}
            </span>
          ) : (
            <span className="text-gray-600 font-mono text-xs">No MCP tool assigned yet</span>
          )}
        </div>

        {/* Execution Pipeline */}
        {log.length > 0 && (
          <div className="relative space-y-0 ml-1">
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-[#1C2333]" />
            {log.map((entry, i) => {
              const s = entry?.status ?? 'unknown';
              const step = entry?.step ?? 'unknown';
              
              let color = '#6B7280';
              let Icon = Clock;
              
              if (step === 'post_verify') {
                color = s === 'success' ? '#22C55E' : '#FF3B5C';
                Icon = s === 'success' ? CheckCircle2 : XCircle;
              } else if (step === 'shadow_execute') {
                color = '#6B7280';
                Icon = Copy;
              } else if (step === 'execute_action' || step === 'execute') {
                color = '#00D4FF';
                Icon = Zap;
              }

              return (
                <motion.div key={i}
                  className="flex gap-4 pb-4 relative"
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1, ease: EASE, duration: 0.3 }}>
                  <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center z-10 bg-[#080B14] rounded-full border border-[#1C2333]" style={{ borderColor: `${color}40` }}>
                    <Icon size={12} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2">
                       <span className="text-gray-300 text-xs font-mono capitalize">
                         {step.replace(/_/g, ' ')}
                       </span>
                       <span className="text-[9px] font-mono" style={{ color }}>{s}</span>
                    </div>
                    {entry?.details && (
                      <p className="text-gray-500 text-[11px] mt-0.5 leading-snug">{entry.details}</p>
                    )}
                    <p className="text-gray-700 text-[9px] font-mono mt-1">{formatTimestamp(entry?.timestamp)}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Output */}
        <div>
          <span className="text-gray-500 text-[10px] font-mono uppercase tracking-wider block mb-1">MCP Output</span>
          {mcpOut ? (
             <pre className="bg-black/50 border border-[#1C2333] font-mono text-[#22C55E] text-[10px] rounded p-3 overflow-x-auto whitespace-pre-wrap">
               {mcpOut}
             </pre>
          ) : (
            <span className={`font-mono text-xs italic ${incident?.status === 'resolved' ? 'text-[#22C55E]' : 'text-gray-600'}`}>
              {incident?.status === 'resolved' ? 'Execution completed successfully' : 
               incident?.status === 'in_progress' ? 'Awaiting output...' : 
               incident?.status === 'awaiting_review' ? 'Pending human approval' : 
               'Awaiting execution output...'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── STATE HISTORY ────────────────────────────────────────────────────────────
function StateHistory({ history }) {
  const safeHistory = Array.isArray(history) ? history : [];
  if (safeHistory.length === 0) return null;
  return (
    <div>
      <SectionHeader label="State Transitions" />
      <div className="space-y-1.5">
        {safeHistory.map((entry, i) => {
          const toStatus = entry?.to_status ?? entry?.status ?? 'unknown';
          const color = STATUS_COLORS[toStatus] ?? '#9CA3AF';
          return (
            <motion.div key={i}
              className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg border border-[#1C2333] hover:border-[#1C2333]/80 transition-colors"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, ease: EASE, duration: 0.3 }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              {entry?.from_status && (
                <>
                  <span className="font-mono text-[11px] capitalize flex-shrink-0 text-gray-500">
                    {getStatusLabel(entry.from_status)}
                  </span>
                  <ArrowRight size={10} className="text-gray-600 flex-shrink-0" />
                </>
              )}
              <span className="font-mono text-[11px] capitalize flex-shrink-0" style={{ color }}>
                {getStatusLabel(toStatus)}
              </span>
              <span className="text-gray-700 text-[10px] font-mono flex-shrink-0">via {entry?.actor ?? 'system'}</span>
              <span className="text-gray-600 text-[10px] flex-1 truncate">{entry?.reason ?? ''}</span>
              <span className="text-gray-700 text-[10px] font-mono flex-shrink-0">
                {formatTimestamp(entry?.timestamp)}
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── INLINE OVERRIDE PANEL ────────────────────────────────────────────────────
function OverridePanel({ incidentId, onOverrideSuccess }) {
  const [decision, setDecision] = useState(null);
  const [note, setNote]         = useState('');
  const [actor, setActor]       = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]     = useState(null);
  const abortRef = useRef(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const submit = useCallback(async () => {
    if (!decision) return;
    abortRef.current = new AbortController();
    setSubmitting(true);
    try {
      await api.post(`/api/incidents/${incidentId}/override`, {
        decision, action: typeof decision === 'string' ? decision.toLowerCase() : 'none', note, actor: actor || 'human_operator',
      }, { signal: abortRef.current.signal });
      setResult('success');
      onOverrideSuccess?.();
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      setResult('error');
    } finally {
      setSubmitting(false);
    }
  }, [decision, note, actor, incidentId, onOverrideSuccess]);

  const decisions = [
    { key: 'APPROVE',  label: 'Approve',  color: '#22C55E' },
    { key: 'REJECT',   label: 'Reject',   color: '#FF3B5C' },
    { key: 'ESCALATE', label: 'Escalate', color: '#FF9500' },
  ];

  return (
    <motion.div
      className="border border-[#7C3AED]/30 rounded-xl p-4 space-y-3"
      style={{ backgroundColor: 'rgba(124,58,237,0.05)' }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE, duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <Zap size={13} className="text-[#7C3AED]" />
        <span className="text-[#A78BFA] font-mono text-[11px] font-bold uppercase tracking-wider">Human Decision Required</span>
      </div>

      {result === 'success' ? (
        <div className="flex items-center gap-2 text-[#22C55E] font-mono text-xs">
          <CheckCircle2 size={14} /> Override submitted successfully
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            {decisions.map((d) => (
              <motion.button key={d.key}
                onClick={() => setDecision(d.key)}
                className="flex-1 py-2 rounded-lg font-mono text-xs font-bold uppercase tracking-wider border transition-all duration-150"
                style={decision === d.key
                  ? { backgroundColor: `${d.color}20`, color: d.color, borderColor: `${d.color}50` }
                  : { backgroundColor: 'transparent', color: '#6B7280', borderColor: '#1C2333' }
                }
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                transition={{ ease: EASE, duration: 0.13 }}>
                {d.label}
              </motion.button>
            ))}
          </div>
          <input
            className="w-full bg-[#080B14] border border-[#1C2333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#7C3AED]/50 transition-colors placeholder-gray-700"
            placeholder="Your name / team"
            value={actor}
            onChange={(e) => setActor(e.target.value)} />
          <textarea
            className="w-full bg-[#080B14] border border-[#1C2333] rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-[#7C3AED]/50 transition-colors placeholder-gray-700 resize-none"
            placeholder="Decision note (optional)"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)} />
          {result === 'error' && (
            <p className="text-[#FF3B5C] text-[11px] font-mono">Failed to submit override. Please retry.</p>
          )}
          <motion.button
            onClick={submit}
            disabled={!decision || submitting}
            className="w-full py-2 rounded-lg font-mono text-xs font-semibold disabled:opacity-40 transition-all"
            style={{ backgroundColor: 'rgba(124,58,237,0.15)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.35)' }}
            whileHover={!submitting && decision ? { scale: 1.01, backgroundColor: 'rgba(124,58,237,0.25)' } : {}}
            whileTap={!submitting && decision ? { scale: 0.99 } : {}}
            transition={{ ease: EASE, duration: 0.15 }}>
            {submitting ? 'Submitting...' : decision ? `Submit: ${decision}` : 'Select a decision above'}
          </motion.button>
        </>
      )}
    </motion.div>
  );
}

// ─── POSTMORTEM (INLINE) ──────────────────────────────────────────────────────
function InlinePostmortem({ incident }) {
  const [postmortem, setPostmortem] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    // Treat empty string / falsy as no postmortem
    if (incident?.postmortem && typeof incident.postmortem === 'string' && incident.postmortem.trim().length > 0) {
      setPostmortem(incident.postmortem);
    }
  }, [incident?.postmortem]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = useCallback(() => {
    if (!incident?.id) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    api.get(`/api/incidents/${incident.id}/postmortem`, { signal: abortRef.current.signal })
      .then(({ data }) => {
        if (data?.postmortem && data.postmortem.trim().length > 0) {
          setPostmortem(data.postmortem);
        } else {
          setError('Failed to generate postmortem');
        }
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        setError('Failed to generate postmortem');
        setLoading(false);
      });
  }, [incident?.id]);

  if (!postmortem && !loading && !error) {
    return (
      <div className="py-2">
        <motion.button onClick={generate}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-mono text-xs font-semibold transition-all"
          style={{ backgroundColor: 'rgba(124,58,237,0.12)', color: '#A78BFA', border: '1px solid rgba(124,58,237,0.3)' }}
          whileHover={{ scale: 1.01, backgroundColor: 'rgba(124,58,237,0.2)' }}
          whileTap={{ scale: 0.99 }}>
          <FileText size={14} /> Generate AI Postmortem
        </motion.button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3 p-4 border border-[#1C2333] rounded-xl bg-[#0D1117] mt-3">
        <div className="flex animate-pulse items-center gap-2 text-[#A78BFA] font-mono text-xs mb-2">
           <RefreshCw size={12} className="animate-spin" /> Generating Postmortem...
        </div>
        {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-3 w-full rounded" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-6 border border-[#FF3B5C]/30 rounded-xl bg-[#FF3B5C]/5 gap-3 mt-3">
        <p className="text-[#FF3B5C] font-mono text-xs">{error}</p>
        <button onClick={generate} className="px-4 py-1.5 rounded-lg border border-[#FF3B5C]/40 text-[#FF3B5C] text-xs font-mono hover:bg-[#FF3B5C]/10 transition-colors">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 border-b border-[#1C2333] pb-3 mb-4">
        <FileText size={15} className="text-[#7C3AED]" />
        <span className="text-white font-semibold text-sm">AI Postmortem</span>
      </div>
      <div className="bg-black/20 border-l-4 border-purple-500 rounded-r-xl p-4 mt-2">
        {typeof postmortem === 'string' && postmortem.trim().length > 0 && (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              components={{
                h2: ({children}) => (
                  <h2 className="text-white font-semibold text-base mt-4 mb-2 border-b border-[#1C2333] pb-1">
                    {children}
                  </h2>
                ),
                h3: ({children}) => (
                  <h3 className="text-cyan-400 font-medium text-sm mt-3 mb-1">
                    {children}
                  </h3>
                ),
                p: ({children}) => (
                  <p className="text-gray-300 text-sm leading-relaxed mb-2">
                    {children}
                  </p>
                ),
                strong: ({children}) => (
                  <strong className="text-white font-semibold">
                    {children}
                  </strong>
                ),
                li: ({children}) => (
                  <li className="text-gray-300 text-sm ml-4 list-disc mb-1">
                    {children}
                  </li>
                ),
                code: ({children}) => (
                  <code className="bg-black/40 text-cyan-400 px-1 rounded font-mono text-xs">
                    {children}
                  </code>
                ),
              }}
            >
              {postmortem}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SKELETON DRAWER ──────────────────────────────────────────────────────────
function SkeletonDrawer() {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <div className="skeleton h-3 w-64 rounded" />
        <div className="skeleton h-7 w-48 rounded" />
        <div className="flex gap-2 mt-3">
          <div className="skeleton h-6 w-20 rounded-full" />
          <div className="skeleton h-6 w-24 rounded-full" />
        </div>
      </div>
      <div className="skeleton h-px w-full" />
      <div className="space-y-3">
        <div className="skeleton h-3 w-32 rounded" />
        <div className="skeleton h-20 w-full rounded-xl" />
        <div className="flex gap-4">
          <div className="skeleton w-24 h-24 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-4 w-28 rounded" />
            <div className="skeleton h-4 w-20 rounded" />
          </div>
        </div>
      </div>
      <div className="skeleton h-px w-full" />
      <div className="space-y-2">
        <div className="skeleton h-3 w-40 rounded" />
        {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-3 w-full rounded" />)}
      </div>
    </div>
  );
}

// ─── MAIN DRAWER ─────────────────────────────────────────────────────────────
export default function IncidentDrawer({ incidentId, onClose }) {
  const [incident, setIncident]         = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const abortRef = useRef(null);

  const fetchIncident = useCallback(async (id) => {
    if (!id) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setLoading(true); setError(null); setIncident(null);
    try {
      const { data } = await api.get(`/api/incidents/${id}`, { signal });
      if (!signal.aborted) { setIncident(data ?? MOCK_INCIDENT); setLoading(false); }
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[IncidentDrawer] API unavailable, using mock', e);
      setIncident(MOCK_INCIDENT); setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (incidentId) { fetchIncident(incidentId); }
    return () => abortRef.current?.abort();
  }, [incidentId, fetchIncident]);

  const isOpen = !!incidentId;
  const sev    = typeof incident?.severity === 'string' ? incident.severity.toLowerCase() : 'none';
  const sc     = sevColor(sev);
  const stc    = statusColor(incident?.status);

  const duration = incident?.resolved_at && incident?.created_at
    ? Math.round((new Date(incident.resolved_at) - new Date(incident.created_at)) / 60000)
    : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40"
            style={{ backgroundColor: 'rgba(8,11,20,0.7)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ ease: EASE, duration: 0.25 }}
            onClick={onClose}
          />

          {/* Drawer panel */}
          <motion.aside
            className="fixed top-0 right-0 h-full z-50 flex flex-col overflow-hidden"
            style={{
              width: '100%',
              maxWidth: 680,
              backgroundColor: '#080B14',
              borderLeft: '1px solid #1C2333',
              boxShadow: '-20px 0 80px rgba(0,0,0,0.6)',
            }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={SPRING}
          >
            {/* Drawer header bar */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1C2333] flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="text-gray-600 font-mono text-[11px]">INCIDENT</span>
                <span className="text-white font-mono text-[11px] select-all">
                  {truncateId(incidentId)}
                </span>
              </div>
              <motion.button
                onClick={onClose}
                className="p-1.5 text-gray-500 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                transition={{ ease: EASE, duration: 0.18 }}>
                <X size={16} />
              </motion.button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {loading && <SkeletonDrawer />}

              {error && !incident && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <AlertTriangle size={24} className="text-[#FF3B5C]" />
                  <p className="text-gray-500 text-sm font-mono">{error}</p>
                  <motion.button onClick={() => fetchIncident(incidentId)}
                    className="flex items-center gap-1.5 text-xs font-mono text-[#FF3B5C] px-3 py-1.5 rounded border border-[#FF3B5C]/30 hover:border-[#FF3B5C]/60 transition-colors"
                    whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                    <RefreshCw size={11} /> Retry
                  </motion.button>
                </div>
              )}

              {incident && (
                <div className="p-5 space-y-0">

                  {/* ── SECTION 1: Header ───────────────────────────────────────── */}
                  <motion.div className="space-y-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: EASE, duration: 0.35 }}>
                    <div className="flex items-center gap-2 text-gray-600 font-mono text-[11px]">
                      <span className="select-all text-gray-500">{incident?.id ?? '—'}</span>
                      <CopyButton text={incident?.id} />
                    </div>
                    <h2 className="text-white font-bold text-xl capitalize leading-tight">
                      {(incident?.alert_type ?? 'Unknown').replace(/_/g, ' ')}
                    </h2>
                    <p className="text-gray-400 text-sm font-mono">{incident?.service ?? '—'}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-3 py-1 rounded-lg font-mono text-sm font-bold uppercase"
                        style={{ backgroundColor: `${sc}18`, color: sc, border: `1px solid ${sc}40` }}>
                        {incident?.severity ?? 'N/A'}
                      </span>
                      <span className="px-3 py-1 rounded-lg font-mono text-sm font-semibold capitalize"
                        style={{ backgroundColor: `${stc}15`, color: stc, border: `1px solid ${stc}35` }}>
                        {getStatusLabel(incident?.status)}
                      </span>
                      {incident?.is_predictive && (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-mono"
                          style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(0,212,255,0.15))', color: '#C084FC', border: '1px solid rgba(124,58,237,0.35)' }}>
                          🔮 PREDICTIVE
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-gray-600">
                      <span>Created: <span className="text-gray-400">{formatTimestamp(incident?.created_at)}</span></span>
                      <span>Updated: <span className="text-gray-400">{formatTimestamp(incident?.updated_at)}</span></span>
                      {incident?.resolved_at
                        ? <span>Resolved: <span className="text-[#22C55E]">{formatTimestamp(incident.resolved_at)} ({formatDuration(duration)})</span></span>
                        : <span className="text-[#FF9500]">Ongoing</span>
                      }
                    </div>
                  </motion.div>

                  <Divider />

                  {/* ── SECTION 2/3/4/5: Decision Process ────────────────────────── */}
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, ease: EASE, duration: 0.35 }}>
                    <DecisionProcess incident={incident} />
                  </motion.div>

                  <Divider />

                  {/* ── SECTION 6: Execution Log ─────────────────────────────────── */}
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.22, ease: EASE, duration: 0.35 }}>
                    <McpExecutionLayer incident={incident} />
                  </motion.div>

                  <Divider />

                  {/* ── SECTION 7: State History ─────────────────────────────────── */}
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.24, ease: EASE, duration: 0.35 }}>
                    <StateHistory history={incident?.state_history} />
                  </motion.div>

                  <Divider />

                  {/* ── SECTION 8: Actions ───────────────────────────────────────── */}
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.26, ease: EASE, duration: 0.35 }}>
                    <SectionHeader label="Actions" />
                    {incident?.status === 'awaiting_review' && (
                      <OverridePanel
                        incidentId={incident?.id}
                        onOverrideSuccess={() => fetchIncident(incident?.id)}
                      />
                    )}
                    {incident?.status === 'resolved' && (
                      <InlinePostmortem incident={incident} />
                    )}
                    {incident?.status !== 'awaiting_review' && incident?.status !== 'resolved' && (
                      <p className="text-gray-600 text-xs font-mono">No actions available for current status</p>
                    )}
                  </motion.div>

                  {/* Bottom padding */}
                  <div className="h-8" />
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
