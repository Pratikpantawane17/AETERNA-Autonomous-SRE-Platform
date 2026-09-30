import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import {
  Brain, Database, Cpu, ShieldCheck, CheckCircle2,
  ChevronDown, ChevronUp, ArrowRight, Zap,
} from 'lucide-react';

const EASE = [0.25, 0.46, 0.45, 0.94];

// ─── SAFE STRING HELPER ───────────────────────────────────────────────────────
const s = (v) => (v != null ? String(v) : '');
const safeReplace = (v) => s(v).replace(/_/g, ' ');
const safeLC = (v) => s(v).toLowerCase();

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const T = (m) => new Date(Date.now() - m * 60000).toISOString();

export const MOCK_INCIDENT = {
  id: 'mock-a1b2-c3d4',
  alert_type: 'cpu_spike',
  severity: 'critical',
  service: 'payment-service',
  status: 'awaiting_review',
  confidence: 0.87,
  is_predictive: false,
  autonomy_mode: 'REVIEW',
  ai_reasoning:
    'Based on historical patterns and real-time metrics, this CPU spike on payment-service is consistent with a sudden traffic surge. 12 similar incidents resolved with scale_service at 91.6% success. Confidence 0.87 is below the 0.90 AUTO threshold — routing to human review.',
  llm_used: 'gemini',
  triage_result: {
    root_cause: 'CPU broke 95% sustained on pod payment-svc-3, driven by a 340% unscheduled flash-sale traffic surge.',
    recommended_action: 'scale_service',
    estimated_impact: 'High — P99 latency +2.3s, degraded transactions',
    chain_of_thought: [
      'Alert ingested: cpu_spike on payment-service, 94.7% CPU sustained 3 min',
      'Querying incident history — 12 matching patterns in last 30 days found',
      'Traffic-induced CPU exhaustion pattern classified (confidence 0.84)',
      'Evaluating options: scale_service, restart_service, reroute_traffic, circuit_break',
      'scale_service: 11/12 historical successes (91.6% rate) — top candidate',
      'Risk scored: scale during peak hours → moderate 0.15',
      'Cost projection: +2 replicas $2.40/hr incremental — within threshold',
      'LLM (Gemini-1.5-Pro) called — confirmed scale recommendation',
      'Final confidence 0.87 < 0.90 AUTO threshold — escalate to REVIEW',
    ],
    why: {
      base_confidence: 0.72,
      historical_success: 0.916,
      similarity_score: 0.84,
      risk_penalty: 0.15,
      cost_penalty: 0.08,
      llm_adjustment: 0.05,
      bounded_adjustment: 0.03,
      final_confidence: 0.87,
      similar_incidents: 12,
      llm_provider: 'gemini',
      alternatives: [
        { action: 'scale_service', score: 0.87 },
        { action: 'restart_service', score: 0.73 },
        { action: 'reroute_traffic', score: 0.61 },
        { action: 'circuit_break', score: 0.44 },
      ],
    },
    sentinel: {
      similar_count: 12,
      similarity_score: 0.84,
      patterns_matched: ['cpu_spike', 'payment-service', 'traffic_surge', 'hpa_lag'],
      top_past_resolutions: [
        { action: 'scale_service', success_rate: 0.916, count: 11 },
        { action: 'restart_service', success_rate: 0.636, count: 7 },
      ],
    },
    strategist: {
      action_chosen: 'scale_service',
      confidence: 0.87,
      llm_provider: 'gemini',
    },
    validator: {
      mode: 'REVIEW',
      reason: 'Confidence 0.87 below AUTO threshold 0.90 — human approval required',
      threshold_auto: 0.90,
      threshold_review: 0.60,
    },
  },
  created_at: T(15),
  updated_at: T(2),
  resolved_at: null,
};

// ─── CONFIDENCE COLOR ─────────────────────────────────────────────────────────
function confColor(c) {
  const v = typeof c === 'number' ? c : 0;
  if (v >= 0.85) return '#22C55E';
  if (v >= 0.60) return '#FF9500';
  return '#FF3B5C';
}

// ─── SECTION LABEL ────────────────────────────────────────────────────────────
function SectionLabel({ children, className = '' }) {
  return (
    <p className={`text-[10px] font-mono text-gray-600 tracking-[0.25em] uppercase mb-3 ${className}`}>
      {children}
    </p>
  );
}

// ─── ANIMATED COUNT ───────────────────────────────────────────────────────────
function AnimCount({ to, duration = 1.2, decimals = 0 }) {
  const [val, setVal] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    const end = parseFloat(to) || 0;
    const t0 = performance.now();
    const step = (now) => {
      const x = Math.min((now - t0) / (duration * 1000), 1);
      const ease = 1 - Math.pow(1 - x, 3);
      setVal(parseFloat((end * ease).toFixed(decimals)));
      if (x < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [to, duration, decimals]);
  return <span>{val}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — SEMICIRCULAR CONFIDENCE GAUGE
// ═══════════════════════════════════════════════════════════════════════════════
function SemiGauge({ confidence }) {
  const CX = 110, CY = 120, R = 90;
  const TOTAL = Math.PI * R;          // ≈ 282.7 px
  const conf = typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : 0;
  const color = confColor(conf);

  // Needle — driven by motion value so it springs from 0 → target
  const angleMV = useMotionValue(-90);
  const targetAng = -90 + conf * 180;

  useEffect(() => {
    const ctrl = animate(angleMV, targetAng, {
      duration: 1.6,
      ease: [0.25, 0.46, 0.45, 0.94],
      delay: 0.4,
    });
    return () => ctrl.stop();
  }, [targetAng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Percentage counter
  const pctMV = useMotionValue(0);
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const ctrl = animate(pctMV, Math.round(conf * 100), {
      duration: 1.6, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.4,
    });
    const unsub = pctMV.on('change', (v) => setPct(Math.round(v)));
    return () => { ctrl.stop(); unsub(); };
  }, [conf]); // eslint-disable-line react-hooks/exhaustive-deps

  const trackD = `M ${CX - R} ${CY} A ${R} ${R} 0 0 0 ${CX + R} ${CY}`;
  const redLen = 0.60 * TOTAL;
  const yellowLen = 0.25 * TOTAL;
  const greenLen = 0.15 * TOTAL;

  return (
    <div className="flex flex-col items-center select-none">
      <div className="relative">
        {/* Glow halo */}
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-44 h-16 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(ellipse at center, ${color}25 0%, transparent 70%)`, filter: 'blur(16px)' }}
        />

        <svg width="220" height="132" viewBox="0 0 220 132" className="overflow-visible">
          {/* Track */}
          <path d={trackD} fill="none" stroke="#1C2333" strokeWidth="16" strokeLinecap="round" />

          {/* Zone backgrounds */}
          <path d={trackD} fill="none" stroke="#FF3B5C" strokeWidth="16" strokeLinecap="butt" opacity="0.15"
            strokeDasharray={`${redLen} ${TOTAL}`} strokeDashoffset="0" />
          <path d={trackD} fill="none" stroke="#FF9500" strokeWidth="16" strokeLinecap="butt" opacity="0.15"
            strokeDasharray={`${yellowLen} ${TOTAL}`} strokeDashoffset={-redLen} />
          <path d={trackD} fill="none" stroke="#22C55E" strokeWidth="16" strokeLinecap="butt" opacity="0.15"
            strokeDasharray={`${greenLen} ${TOTAL}`} strokeDashoffset={-(redLen + yellowLen)} />

          {/* Active fill — animates from 0 → conf */}
          <motion.path
            d={trackD} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round"
            strokeDasharray={`${TOTAL} ${TOTAL}`}
            initial={{ strokeDashoffset: TOTAL }}
            animate={{ strokeDashoffset: TOTAL * (1 - conf) }}
            transition={{ duration: 1.6, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.4 }}
            style={{ filter: `drop-shadow(0 0 8px ${color}80)` }}
          />

          {/* Needle — uses CSS rotate so it works reliably in SVG */}
          <motion.line
            x1={CX} y1={CY} x2={CX} y2={CY - 74}
            stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round"
            style={{ transformOrigin: `${CX}px ${CY}px`, filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.4))' }}
            initial={{ rotate: -90 }}
            animate={{ rotate: targetAng }}
            transition={{ duration: 1.6, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.5 }}
          />

          {/* Hub */}
          <circle cx={CX} cy={CY} r={11} fill="#080B14" stroke="#1C2333" strokeWidth="2" />
          <motion.circle cx={CX} cy={CY} r={5} fill={color}
            style={{ filter: `drop-shadow(0 0 5px ${color})` }}
            animate={{ r: [4, 6, 4] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Pct text */}
          <text x={CX} y={CY - 32} textAnchor="middle" fill="white"
            fontSize="36" fontWeight="800" fontFamily="ui-monospace,monospace">
            {pct}
          </text>
          <text x={CX} y={CY - 11} textAnchor="middle" fill={color}
            fontSize="13" fontFamily="ui-monospace,monospace">%
          </text>

          {/* End labels */}
          <text x={CX - R + 2} y={CY + 22} fill="#FF3B5C55" fontSize="9" fontFamily="ui-monospace,monospace">0</text>
          <text x={CX + R - 12} y={CY + 22} fill="#22C55E55" fontSize="9" fontFamily="ui-monospace,monospace">100</text>

          {/* Tick marks */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const ang = Math.PI * (1 - t);
            return (
              <line key={t}
                x1={CX + (R - 2) * Math.cos(ang)} y1={CY - (R - 2) * Math.sin(ang)}
                x2={CX + (R + 7) * Math.cos(ang)} y2={CY - (R + 7) * Math.sin(ang)}
                stroke="#1C2333" strokeWidth="1.5"
              />
            );
          })}
        </svg>
      </div>

      <p className="text-[10px] font-mono text-gray-600 tracking-[0.25em] uppercase mt-0.5">
        Confidence Level
      </p>

      {/* Zone legend */}
      <div className="flex items-center gap-4 mt-2">
        {[['#FF3B5C', '0–60% LOW'], ['#FF9500', '60–85% MED'], ['#22C55E', '85–100% HIGH']].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: c }} />
            <span className="text-[9px] font-mono text-gray-600">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — THREE AGENT CARDS
// ═══════════════════════════════════════════════════════════════════════════════
const AGENT_THEMES = {
  sentinel: { label: 'SENTINEL', sub: 'Memory Search', Icon: Database, c: '#7C3AED' },
  strategist: { label: 'STRATEGIST', sub: 'Decision Engine', Icon: Cpu, c: '#00D4FF' },
  validator: { label: 'VALIDATOR', sub: 'Safety Gate', Icon: ShieldCheck, c: null },
};

function modeColor(mode) {
  const m = safeLC(mode);
  if (m === 'auto') return '#22C55E';
  if (m === 'escalate') return '#FF3B5C';
  return '#A78BFA';
}

function AgentCard({ type, sentinel, strategist, validator, why, index, triage }) {
  const theme = AGENT_THEMES[type] || AGENT_THEMES.sentinel;
  const color = theme.c ?? modeColor(validator?.mode);
  const { Icon } = theme;

  const topRes = sentinel?.top_past_resolutions?.[0];
  const alts = Array.isArray(why?.alternatives) ? why.alternatives : [];
  const maxAlt = Math.max(...alts.map((a) => a?.score ?? 0), 1);

  return (
    <motion.div
      className="flex-1 rounded-xl p-4 border flex flex-col gap-3 min-w-0 cursor-default"
      style={{ backgroundColor: `${color}07`, borderColor: `${color}35` }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.12, ease: EASE, duration: 0.4 }}
      whileHover={{ scale: 1.015, borderColor: `${color}60`, transition: { duration: 0.15 } }}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <motion.div animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 2.5, repeat: Infinity }}>
          <Icon size={14} style={{ color }} />
        </motion.div>
        <div>
          <p className="font-mono text-[10px] font-bold tracking-[0.18em]" style={{ color }}>
            {theme.label}
          </p>
          <p className="text-gray-600 text-[9px] font-mono">{theme.sub}</p>
        </div>
      </div>

      {/* Sentinel body */}
      {type === 'sentinel' && (
        <>
          <p className="text-white text-xs">
            Found <span className="font-bold" style={{ color }}>{sentinel?.similar_count ?? 0}</span>{' '}
            similar past incidents
          </p>
          {topRes && (
            <div className="space-y-1">
              <p className="text-gray-600 text-[9px] font-mono">Top effective action</p>
              <p className="text-white text-[11px] font-mono capitalize font-semibold">
                {safeReplace(topRes.action)}
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-[#1C2333] overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ backgroundColor: color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${((topRes.success_rate ?? 0) * 100).toFixed(0)}%` }}
                    transition={{ duration: 0.9, delay: 0.6, ease: EASE }} />
                </div>
                <span className="text-[9px] font-mono flex-shrink-0" style={{ color }}>
                  {((sentinel?.similarity_score ?? 0) * 100).toFixed(0)}% match
                </span>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1 mt-auto">
            {(Array.isArray(sentinel?.patterns_matched) ? sentinel.patterns_matched : []).slice(0, 3).map((p, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                style={{ backgroundColor: `${color}18`, color }}>
                {safeReplace(p)}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Strategist body */}
      {type === 'strategist' && (
        <>
          <div>
            <p className="text-gray-500 text-[9px] font-mono uppercase tracking-wider mb-0.5">Selected</p>
            <p className="font-bold text-sm capitalize" style={{ color }}>
              {safeReplace(strategist?.action ?? triage?.final_action ?? 'Determining...')}
            </p>
          </div>
          <div className="space-y-1.5 flex-1">
            {alts.slice(0, 4).map((alt, i) => {
              const chosen = s(alt?.action) === s(strategist?.action_chosen);
              const pct = ((alt?.score ?? 0) / maxAlt * 100).toFixed(0);
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[9px] font-mono text-gray-500 capitalize w-24 truncate flex-shrink-0">
                    {safeReplace(alt?.action)}
                  </span>
                  <div className="flex-1 h-1.5 rounded bg-[#1C2333] overflow-hidden">
                    <motion.div className="h-full rounded"
                      style={{ backgroundColor: chosen ? color : '#374151' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, delay: 0.5 + i * 0.08, ease: EASE }} />
                  </div>
                  {chosen && <span className="text-[8px] font-mono flex-shrink-0" style={{ color }}>✓</span>}
                </div>
              );
            })}
          </div>
          {(() => {
            const llmProv = why?.llm_provider ?? strategist?.llm_provider;
            const validProv = llmProv && String(llmProv).toLowerCase() !== 'none';
            return (
              <span className="self-start px-2 py-0.5 rounded text-[9px] font-mono border"
                style={{ backgroundColor: `${color}12`, color, borderColor: `${color}30` }}>
                {validProv ? `🤖 via ${String(llmProv).toUpperCase()}` : 'Hybrid Score Only'}
              </span>
            );
          })()}
        </>
      )}

      {/* Validator body */}
      {type === 'validator' && (
        <>
          <motion.span
            className="self-start px-2.5 py-1 rounded-lg font-mono text-xs font-bold border"
            style={{ backgroundColor: `${color}15`, color, borderColor: `${color}40` }}
            animate={{ opacity: [0.8, 1, 0.8] }}
            transition={{ duration: 2.2, repeat: Infinity }}
          >
            {safeLC(validator?.mode) === 'auto' ? '⚡ AUTONOMOUS'
              : safeLC(validator?.mode) === 'escalate' ? '🚨 ESCALATED'
                : '👁 REVIEW'}
          </motion.span>
          <p className="text-gray-400 text-[11px] leading-snug">
            {s(validator?.reason) || '—'}
          </p>
          <div className="mt-auto rounded-lg bg-[#080B14] p-2 space-y-1">
            {[
              ['#22C55E', '≥ 90%', 'AUTO'],
              ['#A78BFA', '60–90%', 'REVIEW'],
              ['#FF3B5C', '< 60%', 'ESCALATE'],
            ].map(([c, thr, lbl]) => (
              <div key={lbl} className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                <span className="text-[9px] font-mono text-gray-600">
                  {thr} → <span style={{ color: c }}>{lbl}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — SCORING BREAKDOWN (stacked bar)
// ═══════════════════════════════════════════════════════════════════════════════
function ScoringBar({ why }) {
  const [hovered, setHovered] = useState(null);
  if (!why || typeof why !== 'object') return null;

  const {
    base_confidence = 0,
    historical_success = 0,
    similarity_score = 0,
    risk_penalty = 0,
    cost_penalty = 0,
    llm_adjustment = 0,
  } = why;

  const segments = [
    { id: 'base', label: 'Base Confidence', raw: base_confidence, weight: '× 0.50', value: base_confidence * 0.50, color: '#7C3AED', positive: true },
    { id: 'hist', label: 'Historical Success', raw: historical_success, weight: '× 0.30', value: historical_success * 0.30, color: '#00D4FF', positive: true },
    { id: 'sim', label: 'Similarity Score', raw: similarity_score, weight: '× 0.20', value: similarity_score * 0.20, color: '#22C55E', positive: true },
    { id: 'llmA', label: 'LLM Adjustment', raw: llm_adjustment, weight: 'direct', value: Math.max(llm_adjustment, 0), color: '#FF9500', positive: true },
  ];
  const penalties = [
    { id: 'risk', label: 'Risk Penalty', raw: risk_penalty, weight: '× 0.08', value: risk_penalty * 0.08, color: '#FF3B5C' },
    { id: 'cost', label: 'Cost Penalty', raw: cost_penalty, weight: '× 0.05', value: cost_penalty * 0.05, color: '#FF6B35' },
  ];

  const total = segments.reduce((a, s) => a + s.value, 0) || 1;

  return (
    <div className="space-y-3">
      <SectionLabel>Confidence Components</SectionLabel>

      {/* Stacked bar */}
      <div className="relative">
        <div className="flex h-8 w-full rounded-lg overflow-hidden gap-px">
          {segments.map((seg, i) => {
            const pct = (seg.value / total * 100).toFixed(1);
            return (
              <motion.div
                key={seg.id}
                className="h-full relative group"
                style={{ backgroundColor: hovered === seg.id ? seg.color : `${seg.color}CC`, cursor: 'default' }}
                initial={{ flex: 0 }}
                animate={{ flex: parseFloat(pct) }}
                transition={{ duration: 0.9, delay: i * 0.08, ease: EASE }}
                onHoverStart={() => setHovered(seg.id)}
                onHoverEnd={() => setHovered(null)}
                whileHover={{ scaleY: 1.1, transition: { duration: 0.12 } }}
              >
                <AnimatePresence>
                  {hovered === seg.id && (
                    <motion.div
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 whitespace-nowrap bg-[#0D1117] border border-[#1C2333] rounded-lg px-3 py-2 shadow-2xl pointer-events-none"
                      initial={{ opacity: 0, y: 6, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.9 }}
                      transition={{ ease: EASE, duration: 0.15 }}
                    >
                      <p className="text-white text-[11px] font-mono font-semibold">{seg.label}</p>
                      <p className="text-gray-400 text-[10px] font-mono mt-0.5">
                        {(seg.raw * 100).toFixed(1)}% {seg.weight} = +{(seg.value * 100).toFixed(1)}%
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        {/* Percentage labels */}
        <div className="flex gap-px mt-1">
          {segments.map((seg) => (
            <div key={seg.id} className="flex-1 text-center">
              <span className="text-[8px] font-mono" style={{ color: seg.color }}>
                {(seg.value * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Penalty pills */}
      <div className="flex flex-wrap gap-2">
        {penalties.map((pen) => (
          <div key={pen.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border"
            style={{ backgroundColor: `${pen.color}0C`, borderColor: `${pen.color}30` }}>
            <span className="text-[10px] font-mono" style={{ color: pen.color }}>−</span>
            <span className="text-[10px] font-mono text-gray-400">{pen.label}</span>
            <span className="text-[10px] font-mono font-bold" style={{ color: pen.color }}>
              {(pen.value * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((seg) => (
          <div key={seg.id} className="flex items-center gap-1.5 cursor-default"
            onMouseEnter={() => setHovered(seg.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="w-2 h-2 rounded-sm flex-shrink-0 transition-transform"
              style={{ backgroundColor: seg.color, transform: hovered === seg.id ? 'scale(1.4)' : 'scale(1)' }} />
            <span className="text-[10px] font-mono text-gray-500">{seg.label}</span>
            <span className="text-[10px] font-mono font-semibold" style={{ color: seg.color }}>
              +{(seg.value * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — CHAIN OF THOUGHT TIMELINE
// ═══════════════════════════════════════════════════════════════════════════════
function ChainTimeline({ steps }) {
  const [expanded, setExpanded] = useState(false);
  const safe = Array.isArray(steps) ? steps : [];
  if (safe.length === 0) return null;
  const visible = expanded ? safe : safe.slice(0, 4);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel className="mb-0">Chain of Thought</SectionLabel>
        {safe.length > 4 && (
          <motion.button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-mono text-gray-600 hover:text-[#7C3AED] transition-colors"
            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          >
            {expanded ? <><ChevronUp size={11} /> Collapse</> : <><ChevronDown size={11} /> +{safe.length - 4} steps</>}
          </motion.button>
        )}
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-3.5 top-4 w-px"
          style={{ height: `calc(100% - 24px)`, background: 'linear-gradient(to bottom, #7C3AED60, transparent)' }} />

        <AnimatePresence initial={false}>
          {visible.map((step, i) => (
            <motion.div key={i} layout
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ delay: i * 0.10, ease: EASE, duration: 0.3 }}
              className="flex gap-3 pb-4"
            >
              {/* Numbered circle */}
              <motion.div
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center z-10 border"
                style={{ backgroundColor: '#080B14', borderColor: i < 2 ? '#7C3AED' : '#1C2333' }}
                whileHover={{ scale: 1.15, borderColor: '#7C3AED' }}
                transition={{ duration: 0.15 }}
              >
                <span className="text-[10px] font-mono font-bold"
                  style={{ color: i < 2 ? '#A78BFA' : '#6B7280' }}>{i + 1}</span>
              </motion.div>

              {/* Text with left border */}
              <div className="flex-1 pt-1">
                <motion.p
                  className="text-gray-300 text-xs leading-relaxed border-l-2 pl-3"
                  style={{ borderColor: i === 0 ? '#7C3AED70' : i < 3 ? '#7C3AED35' : '#1C2333' }}
                  whileHover={{ color: '#FFFFFF', borderColor: '#7C3AED80' }}
                  transition={{ duration: 0.12 }}
                >
                  {typeof step === 'string' ? step : JSON.stringify(step)}
                </motion.p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — ALTERNATIVES CONSIDERED
// ═══════════════════════════════════════════════════════════════════════════════
function AlternativesSection({ alternatives, chosen }) {
  const safe = Array.isArray(alternatives) ? alternatives : [];
  const maxScore = Math.max(...safe.map((a) => a?.score ?? 0), 1);
  if (safe.length === 0) return null;

  return (
    <div>
      <SectionLabel>Alternatives Considered</SectionLabel>
      <div className="space-y-2">
        {safe.map((alt, i) => {
          const isWinner = s(alt?.action) === s(chosen);
          const score = alt?.score ?? 0;
          const pct = ((score / maxScore) * 100).toFixed(0);
          return (
            <motion.div key={i}
              className="flex items-center gap-3"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: isWinner ? 1 : 0.55, x: 0 }}
              transition={{ delay: i * 0.07, ease: EASE, duration: 0.3 }}
              whileHover={{ opacity: 1, transition: { duration: 0.1 } }}
            >
              <span className={`text-[11px] font-mono capitalize w-32 flex-shrink-0 ${isWinner ? 'text-[#00D4FF]' : 'text-gray-500 line-through decoration-gray-700'}`}>
                {safeReplace(alt?.action)}
              </span>

              <div className="flex-1 h-2 rounded-full bg-[#1C2333] overflow-hidden">
                <motion.div className="h-full rounded-full"
                  style={{ backgroundColor: isWinner ? '#00D4FF' : '#374151' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, delay: i * 0.08 + 0.2, ease: EASE }} />
              </div>

              <span className={`font-mono text-xs w-9 text-right flex-shrink-0 ${isWinner ? 'font-bold text-[#00D4FF]' : 'text-gray-600'}`}>
                {(score * 100).toFixed(0)}%
              </span>

              <AnimatePresence>
                {isWinner && (
                  <motion.span
                    className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ backgroundColor: 'rgba(0,212,255,0.12)', color: '#00D4FF', border: '1px solid rgba(0,212,255,0.28)' }}
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ delay: 0.5, ease: EASE }}
                  >
                    CHOSEN
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — WHY BLOCK TABLE
// ═══════════════════════════════════════════════════════════════════════════════
function WhyTable({ why }) {
  if (!why || typeof why !== 'object') return null;
  const {
    base_confidence = 0,
    historical_success = 0,
    similarity_score = 0,
    risk_penalty = 0,
    cost_penalty = 0,
    llm_adjustment = 0,
    final_confidence = 0,
    similar_incidents = 0,
  } = why;

  const rows = [
    { field: 'Base Confidence', raw: base_confidence, w: 0.50, contrib: base_confidence * 0.50, pos: true },
    { field: 'Historical Success', raw: historical_success, w: 0.30, contrib: historical_success * 0.30, pos: true },
    { field: 'Similarity Score', raw: similarity_score, w: 0.20, contrib: similarity_score * 0.20, pos: true },
    { field: 'Risk Penalty', raw: risk_penalty, w: -0.08, contrib: -(risk_penalty * 0.08), pos: false },
    { field: 'Cost Penalty', raw: cost_penalty, w: -0.05, contrib: -(cost_penalty * 0.05), pos: false },
    { field: 'LLM Adjustment', raw: llm_adjustment, w: null, contrib: llm_adjustment, pos: llm_adjustment >= 0 },
  ];

  return (
    <div>
      <SectionLabel>Scoring Breakdown</SectionLabel>
      <div className="border border-[#1C2333] rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-[#080B14] border-b border-[#1C2333]">
              {['Factor', 'Raw Value', 'Weight', 'Contribution'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-[9px] font-mono text-gray-600 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1C2333]">
            {rows.map((row, i) => (
              <motion.tr key={row.field}
                className="hover:bg-white/[0.02] transition-colors"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, ease: EASE, duration: 0.25 }}
              >
                <td className="px-3 py-2.5 text-[11px] font-mono text-gray-300">{row.field}</td>
                <td className="px-3 py-2.5 text-[11px] font-mono text-white font-semibold">
                  {(row.raw * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2.5 text-[11px] font-mono text-gray-500">
                  {row.w !== null ? `${row.w > 0 ? '+' : ''}${row.w}` : 'direct'}
                </td>
                <td className="px-3 py-2.5">
                  <span className="text-[11px] font-mono font-bold"
                    style={{ color: row.pos ? '#22C55E' : '#FF3B5C' }}>
                    {row.contrib >= 0 ? '+' : ''}{(row.contrib * 100).toFixed(1)}%
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#1C2333] bg-[#080B14]">
              <td colSpan={3} className="px-3 py-3 text-[10px] font-mono text-gray-500 uppercase tracking-wider">
                Final Confidence · {similar_incidents} historical matches
              </td>
              <td className="px-3 py-3">
                <span className="text-lg font-mono font-black" style={{ color: confColor(final_confidence) }}>
                  <AnimCount to={Math.round(final_confidence * 100)} />%
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — LLM PROVIDER INFO
// ═══════════════════════════════════════════════════════════════════════════════
const LLM_CONFIGS = {
  gemini: { label: 'GEMINI', color: '#4285F4', emoji: '🔵' },
  grok: { label: 'GROK', color: '#00D4FF', emoji: '⚡' },
  openai: { label: 'OPENAI', color: '#10A37F', emoji: '🟢' },
  claude: { label: 'CLAUDE', color: '#C97A3A', emoji: '🧡' },
};

function LlmInfo({ incident }) {
  const rawLlm = incident?.triage_result?.why?.llm_provider ?? incident?.triage_result?.strategist?.llm_provider;
  const llm = rawLlm != null ? safeLC(rawLlm) : '';
  const adj = incident?.triage_result?.why?.bounded_adjustment
    ?? incident?.triage_result?.why?.llm_adjustment;
  const usedLlm = incident?.llm_used !== false && llm && llm !== 'none' && llm !== 'false' && llm !== '';
  const cfg = LLM_CONFIGS[llm] ?? null;

  return (
    <motion.div
      className="rounded-xl p-4 border flex items-start gap-4"
      style={{
        backgroundColor: usedLlm ? `${cfg?.color ?? '#00D4FF'}08` : 'rgba(156,163,175,0.06)',
        borderColor: usedLlm ? `${cfg?.color ?? '#00D4FF'}30` : 'rgba(156,163,175,0.28)',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ease: EASE, duration: 0.4, delay: 0.3 }}
    >
      {usedLlm ? (
        <>
          <div className="flex-shrink-0 text-2xl">{cfg?.emoji ?? '🤖'}</div>
          <div className="flex-1 min-w-0">
            <p className="font-mono text-sm font-bold" style={{ color: cfg?.color ?? '#00D4FF' }}>
              {cfg?.label ?? llm.toUpperCase()} Validated
            </p>
            <p className="text-gray-400 text-xs mt-0.5">LLM analyzed context and validated this decision</p>
            {adj != null && (
              <p className="text-gray-600 text-[11px] font-mono mt-1.5">
                Confidence adjustment:{' '}
                <span style={{ color: cfg?.color ?? '#00D4FF' }}>
                  {adj >= 0 ? '+' : ''}{(adj * 100).toFixed(1)}%
                </span>
                {' '}(bounded)
              </p>
            )}
          </div>
          <div className="flex-shrink-0">
            <motion.span
              className="text-[9px] font-mono px-2 py-1 rounded-lg font-bold"
              style={{ backgroundColor: `${cfg?.color ?? '#00D4FF'}18`, color: cfg?.color ?? '#00D4FF', border: `1px solid ${cfg?.color ?? '#00D4FF'}30` }}
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 2.5, repeat: Infinity }}
            >
              LLM VALIDATED
            </motion.span>
          </div>
        </>
      ) : (
        <>
          <CheckCircle2 size={20} className="text-gray-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-gray-400 font-mono text-sm font-semibold uppercase tracking-wider">Resolved via historical patterns</p>
            <p className="text-gray-500 text-xs mt-0.5">
              Resolved via historical pattern matching — no LLM call required
            </p>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════
export default function AIExplainabilityPanel({ incident }) {
  const safeInc = incident ?? null;

  // Defensive unwrapping — backend may send strings/nulls for nested objects
  const rawTriage = safeInc?.triage_result;
  const triage = rawTriage && typeof rawTriage === 'object' ? rawTriage : {};
  const why = triage.why && typeof triage.why === 'object' ? triage.why : {};
  const sentinel = triage.sentinel && typeof triage.sentinel === 'object' ? triage.sentinel : {};
  const strat = triage.strategist && typeof triage.strategist === 'object' ? triage.strategist : {};
  const valid = triage.validator && typeof triage.validator === 'object' ? triage.validator : {};
  const coT = Array.isArray(triage.chain_of_thought) ? triage.chain_of_thought : [];
  const alts = Array.isArray(why.alternatives) ? why.alternatives : [];
  const conf = typeof safeInc?.confidence === 'number' ? safeInc.confidence : 0;

  // Empty state
  if (!safeInc) {
    return (
      <motion.div
        className="bg-[#0D1117] border border-[#1C2333] rounded-2xl p-10 flex flex-col items-center justify-center gap-4 min-h-[320px]"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ease: EASE, duration: 0.4 }}
      >
        <motion.div animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 2.8, repeat: Infinity }}>
          <Brain size={44} className="text-[#7C3AED]" />
        </motion.div>
        <p className="text-gray-500 text-sm font-mono">Select an incident to inspect AI reasoning</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="bg-[#0D1117] border border-[#1C2333] rounded-2xl overflow-hidden"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE, duration: 0.35 }}
      style={{ boxShadow: '0 0 60px rgba(124,58,237,0.05)' }}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-[#1C2333] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <motion.div animate={{ opacity: [0.5, 1, 0.5], scale: [1, 1.1, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
            <Brain size={18} className="text-[#7C3AED]" />
          </motion.div>
          <div>
            <h2 className="text-[#00D4FF] font-mono text-xs font-bold tracking-[0.28em] uppercase">
              AI Decision Intelligence
            </h2>
            <p className="text-gray-600 text-[10px] font-mono mt-0.5">
              {safeReplace(safeInc?.alert_type)} · {s(safeInc?.service)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <motion.div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
            style={{ backgroundColor: `${confColor(conf)}15`, border: `1px solid ${confColor(conf)}35` }}
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2.8, repeat: Infinity }}
          >
            <Zap size={10} style={{ color: confColor(conf) }} />
            <span className="font-mono text-[10px] font-bold" style={{ color: confColor(conf) }}>
              {s(safeInc?.autonomy_mode) || 'N/A'}
            </span>
          </motion.div>
        </div>
      </div>

      {/* ── SCROLLABLE BODY ──────────────────────────────────────────────────── */}
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>

        {/* 1 — Gauge + Reasoning */}
        <div className="px-6 py-6 border-b border-[#1C2333]">
          <div className="flex flex-col lg:flex-row items-center gap-8">
            <div className="flex-shrink-0">
              <SemiGauge confidence={conf} />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <SectionLabel className="mb-0">AI Reasoning</SectionLabel>
              <blockquote
                className="border-l-2 border-[#7C3AED] pl-4 py-2 text-gray-300 text-[0.77rem] leading-relaxed italic rounded-r-lg"
                style={{ backgroundColor: 'rgba(124,58,237,0.04)' }}
              >
                {s(safeInc?.ai_reasoning) || s(triage?.root_cause) || '—'}
              </blockquote>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-gray-600">
                {safeInc?.service && <span>Service: <span className="text-white">{s(safeInc.service)}</span></span>}
                {(strat.action ?? triage.final_action) && <span>Action: <span className="text-[#00D4FF] capitalize">{safeReplace(strat.action ?? triage.final_action)}</span></span>}
                {safeInc?.status && <span>Status: <span className="text-gray-400 capitalize">{safeReplace(safeInc.status)}</span></span>}
              </div>
            </div>
          </div>
        </div>

        {/* 2 — Agent Cards */}
        <div className="px-6 py-6 border-b border-[#1C2333]">
          <SectionLabel>Multi-Agent Pipeline</SectionLabel>
          <div className="flex gap-2 items-start">
            <AgentCard type="sentinel" sentinel={sentinel} why={why} index={0} triage={triage} />
            <div className="flex-shrink-0 flex items-center pt-8 text-gray-700">
              <ArrowRight size={13} />
            </div>
            <AgentCard type="strategist" strategist={strat} why={why} index={1} triage={triage} />
            <div className="flex-shrink-0 flex items-center pt-8 text-gray-700">
              <ArrowRight size={13} />
            </div>
            <AgentCard type="validator" validator={valid} why={why} index={2} triage={triage} />
          </div>
        </div>

        {/* 3 — Scoring bar */}
        <div className="px-6 py-6 border-b border-[#1C2333]">
          <ScoringBar why={why} />
        </div>

        {/* 4 — Chain of Thought */}
        {coT.length > 0 && (
          <div className="px-6 py-6 border-b border-[#1C2333]">
            <ChainTimeline steps={coT} />
          </div>
        )}

        {/* 5 — Alternatives */}
        {alts.length > 0 && (
          <div className="px-6 py-6 border-b border-[#1C2333]">
            <AlternativesSection alternatives={alts} chosen={strat?.action_chosen} />
          </div>
        )}

        {/* 6 — Why table */}
        <div className="px-6 py-6 border-b border-[#1C2333]">
          <WhyTable why={why} />
        </div>

        {/* 7 — LLM info */}
        <div className="px-6 py-6">
          <SectionLabel>LLM Validation</SectionLabel>
          <LlmInfo incident={safeInc} />
        </div>
      </div>
    </motion.div>
  );
}
