import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, ShieldCheck, ShieldOff, Play, Pause, Loader2, AlertTriangle } from 'lucide-react';
import { useSystem } from '../../context/SystemContext';

const EASE = [0.25, 0.46, 0.45, 0.94];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
// ACTIVE  = killSwitchActive === false  → AI running
// PAUSED  = killSwitchActive === true   → AI halted, humans handle everything

function useKillSwitchAnimate(killSwitchActive) {
  const [justChanged, setJustChanged] = useState(false);
  const prev = useRef(killSwitchActive);

  useEffect(() => {
    if (prev.current !== killSwitchActive) {
      setJustChanged(true);
      const t = setTimeout(() => setJustChanged(false), 1200);
      prev.current = killSwitchActive;
      return () => clearTimeout(t);
    }
  }, [killSwitchActive]);

  return justChanged;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED VARIANT
// ═══════════════════════════════════════════════════════════════════════════════

function StatusOrb({ paused }) {
  const color = paused ? '#FF3B5C' : '#22C55E';
  const size = 100;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Outer pulse ring */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: size, height: size, backgroundColor: `${color}18`, border: `1px solid ${color}35` }}
        animate={{ scale: [1, 1.18, 1], opacity: [0.4, 0.1, 0.4] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Mid ring */}
      <motion.div
        className="absolute rounded-full"
        style={{ width: size * 0.72, height: size * 0.72, backgroundColor: `${color}14`, border: `1px solid ${color}50` }}
        animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.2, 0.5] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
      />
      {/* Core circle */}
      <motion.div
        className="relative rounded-full flex items-center justify-center"
        style={{
          width: size * 0.48,
          height: size * 0.48,
          backgroundColor: `${color}25`,
          border: `2px solid ${color}`,
          boxShadow: `0 0 24px ${color}60, 0 0 60px ${color}20`,
        }}
        animate={paused
          ? { boxShadow: [`0 0 16px ${color}60`, `0 0 36px ${color}90`, `0 0 16px ${color}60`] }
          : { boxShadow: [`0 0 12px ${color}40`, `0 0 28px ${color}70`, `0 0 12px ${color}40`] }
        }
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        {paused
          ? <ShieldOff size={20} style={{ color }} />
          : <ShieldCheck size={20} style={{ color }} />
        }
      </motion.div>
    </div>
  );
}

function ExpandedKillSwitch() {
  const { killSwitchActive, toggleKillSwitch } = useSystem();
  const paused = killSwitchActive === true;
  const justChanged = useKillSwitchAnimate(killSwitchActive);

  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [flash, setFlash]           = useState(false);
  const confirmTimer                = useRef(null);

  // Cancel confirm if user navigates or doesn't act within 8s
  useEffect(() => {
    if (confirming) {
      confirmTimer.current = setTimeout(() => setConfirming(false), 8000);
      return () => clearTimeout(confirmTimer.current);
    }
  }, [confirming]);

  const handleToggleClick = () => {
    if (!confirming) { setConfirming(true); return; }
    // Confirmed
    clearTimeout(confirmTimer.current);
    setConfirming(false);
    setLoading(true);
    setFlash(true);
    setTimeout(() => setFlash(false), 600);

    toggleKillSwitch().finally(() => setLoading(false));
  };

  const statusColor = paused ? '#FF3B5C' : '#22C55E';

  return (
    <motion.div
      className="relative rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: '#0D1117',
        borderColor: paused ? 'rgba(255,59,92,0.45)' : 'rgba(34,197,94,0.25)',
        boxShadow: paused
          ? '0 0 40px rgba(255,59,92,0.12)'
          : '0 0 24px rgba(34,197,94,0.06)',
      }}
      animate={justChanged ? { scale: [1, 1.02, 1] } : {}}
      transition={{ duration: 0.4, ease: EASE }}
    >
      {/* Flash overlay on toggle */}
      <AnimatePresence>
        {flash && (
          <motion.div
            className="absolute inset-0 pointer-events-none z-10 rounded-2xl"
            style={{ backgroundColor: paused ? 'rgba(255,59,92,0.15)' : 'rgba(34,197,94,0.15)' }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          />
        )}
      </AnimatePresence>

      {/* PAUSED warning banner */}
      <AnimatePresence>
        {paused && (
          <motion.div
            className="flex items-center justify-center gap-2 py-2"
            style={{ backgroundColor: 'rgba(255,59,92,0.15)', borderBottom: '1px solid rgba(255,59,92,0.3)' }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.25 }}
          >
            <motion.div
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            >
              <AlertTriangle size={12} className="text-[#FF3B5C]" />
            </motion.div>
            <span className="text-[#FF3B5C] font-mono text-[10px] font-bold tracking-[0.2em] uppercase">
              Automation Paused — Human Override Active
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card body */}
      <div className="px-5 py-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-5">
          <ShieldAlert size={15} style={{ color: statusColor }} />
          <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-gray-500">
            Automation Control
          </span>
        </div>

        {/* Status display */}
        <div className="flex items-center gap-5 mb-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={paused ? 'paused' : 'active'}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ ease: EASE, duration: 0.3 }}
            >
              <StatusOrb paused={paused} />
            </motion.div>
          </AnimatePresence>

          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={paused ? 'paused-text' : 'active-text'}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ ease: EASE, duration: 0.25 }}
              >
                <p className="font-mono text-lg font-black tracking-[0.12em]" style={{ color: statusColor }}>
                  {paused ? 'AUTOMATION PAUSED' : 'AUTOMATION ACTIVE'}
                </p>
                <p className="text-gray-500 text-xs mt-1 leading-snug">
                  {paused
                    ? 'All new incidents routing to Human Override Queue'
                    : 'AI is autonomously resolving incidents'}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Confirm state or normal button */}
        <AnimatePresence mode="wait">
          {confirming ? (
            <motion.div
              key="confirm"
              className="rounded-xl border p-3 space-y-2"
              style={{
                backgroundColor: paused ? 'rgba(34,197,94,0.06)' : 'rgba(255,59,92,0.07)',
                borderColor: paused ? 'rgba(34,197,94,0.3)' : 'rgba(255,59,92,0.35)',
              }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ ease: EASE, duration: 0.2 }}
            >
              <p className="text-white text-xs font-mono text-center">
                {paused
                  ? '▶ Resume AI automation? All new incidents will be auto-triaged.'
                  : '⏸ Pause AI automation? All new incidents will require human approval.'}
              </p>
              <div className="flex gap-2">
                <motion.button
                  onClick={handleToggleClick}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg font-mono text-xs font-bold"
                  style={{
                    backgroundColor: paused ? '#22C55E' : '#FF3B5C',
                    color: '#080B14',
                  }}
                  whileHover={{ scale: 1.02, filter: 'brightness(1.08)' }}
                  whileTap={{ scale: 0.97 }}
                >
                  {loading
                    ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}><Loader2 size={13} /></motion.div>
                    : paused ? <><Play size={12} /> Confirm Resume</> : <><Pause size={12} /> Confirm Pause</>
                  }
                </motion.button>
                <motion.button
                  onClick={() => { clearTimeout(confirmTimer.current); setConfirming(false); }}
                  className="px-4 py-2 rounded-lg font-mono text-xs text-gray-500 hover:text-white border border-[#1C2333] hover:border-[#2D3748] transition-colors"
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                >
                  Cancel
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.button
              key="toggle-btn"
              onClick={handleToggleClick}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-mono text-sm font-bold border transition-all"
              style={{
                backgroundColor: paused ? 'rgba(34,197,94,0.1)' : 'rgba(255,59,92,0.1)',
                borderColor:     paused ? 'rgba(34,197,94,0.4)' : 'rgba(255,59,92,0.4)',
                color:           paused ? '#22C55E' : '#FF3B5C',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ ease: EASE, duration: 0.2 }}
              whileHover={{ scale: 1.01, filter: 'brightness(1.12)' }}
              whileTap={{ scale: 0.97 }}
            >
              {paused
                ? <><Play size={16} /> RESUME AUTOMATION</>
                : <><Pause size={16} /> PAUSE AUTOMATION</>
              }
            </motion.button>
          )}
        </AnimatePresence>

        {/* Impact explanation */}
        <motion.div
          className="mt-4 rounded-lg p-3 border space-y-1.5"
          style={{ backgroundColor: '#080B14', borderColor: '#1C2333' }}
          layout
        >
          <p className="text-[9px] font-mono text-gray-600 uppercase tracking-[0.18em]">
            {paused ? 'Current Flow (Paused)' : 'Current Flow (Active)'}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {(paused
              ? ['New Alert', 'awaiting_review', 'Human Override Queue']
              : ['New Alert', 'AI Triage', 'AUTO / REVIEW / ESCALATE']
            ).map((step, i, arr) => (
              <span key={step} className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-gray-400">{step}</span>
                {i < arr.length - 1 && (
                  <span className="text-gray-700 text-[10px]">→</span>
                )}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPACT VARIANT (sidebar)
// ═══════════════════════════════════════════════════════════════════════════════
function CompactKillSwitch() {
  const { killSwitchActive, toggleKillSwitch } = useSystem();
  const paused = killSwitchActive === true;
  const justChanged = useKillSwitchAnimate(killSwitchActive);

  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading]       = useState(false);
  const confirmTimer                = useRef(null);

  useEffect(() => {
    if (confirming) {
      confirmTimer.current = setTimeout(() => setConfirming(false), 5000);
      return () => clearTimeout(confirmTimer.current);
    }
  }, [confirming]);

  const handleClick = () => {
    if (!confirming) { setConfirming(true); return; }
    clearTimeout(confirmTimer.current);
    setConfirming(false);
    setLoading(true);
    toggleKillSwitch().finally(() => setLoading(false));
  };

  const color = paused ? '#FF3B5C' : '#22C55E';

  return (
    <motion.div
      className="mx-3 mb-3 rounded-xl border px-3 py-2.5 flex items-center gap-2.5"
      style={{
        backgroundColor: `${color}07`,
        borderColor: `${color}30`,
      }}
      animate={justChanged ? { scale: [1, 1.04, 1] } : {}}
      transition={{ duration: 0.35, ease: EASE }}
    >
      {/* Pulsing dot */}
      <motion.div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
        animate={paused
          ? { opacity: [1, 0.3, 1], scale: [1, 1.4, 1] }
          : { opacity: [1, 0.6, 1] }
        }
        transition={{ duration: 1.6, repeat: Infinity }}
      />

      {/* Text */}
      <AnimatePresence mode="wait">
        {confirming ? (
          <motion.span
            key="confirm"
            className="flex-1 text-[10px] font-mono font-bold"
            style={{ color }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {paused ? 'Resume AI?' : 'Pause AI?'}
          </motion.span>
        ) : (
          <motion.span
            key="status"
            className="flex-1 text-[10px] font-mono font-semibold truncate"
            style={{ color }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {paused ? 'AI Paused' : 'AI Active'}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Toggle icon button */}
      <motion.button
        onClick={handleClick}
        disabled={loading}
        className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center border transition-colors"
        style={{
          backgroundColor: `${color}15`,
          borderColor:     `${color}40`,
          color,
        }}
        whileHover={{ scale: 1.1, filter: 'brightness(1.15)' }}
        whileTap={{ scale: 0.9 }}
        title={paused ? 'Resume automation' : 'Pause automation'}
      >
        {loading
          ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}><Loader2 size={10} /></motion.div>
          : confirming
            ? <span className="text-[10px] font-bold">✓</span>
            : paused ? <Play size={10} /> : <Pause size={10} />
        }
      </motion.button>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════
export default function KillSwitch({ variant = 'expanded' }) {
  return variant === 'compact'
    ? <CompactKillSwitch />
    : <ExpandedKillSwitch />;
}
