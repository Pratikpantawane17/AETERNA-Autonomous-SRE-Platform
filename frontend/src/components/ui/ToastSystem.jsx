import React, {
  createContext, useContext, useState, useEffect, useRef, useCallback, memo,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, CheckCircle2, ShieldOff, ShieldCheck, AlertTriangle, Brain, Activity, Info } from 'lucide-react';
import { useSystem } from '../../context/SystemContext';
import { useNavigate } from 'react-router-dom';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const EASE = [0.25, 0.46, 0.45, 0.94];
const MAX_TOASTS = 5;

const TOAST_CFG = {
  incident:   { color: '#00D4FF', bg: 'rgba(0,212,255,0.08)',    border: 'rgba(0,212,255,0.28)',   duration: 5000,  icon: Zap         },
  resolved:   { color: '#22C55E', bg: 'rgba(34,197,94,0.08)',    border: 'rgba(34,197,94,0.28)',   duration: 5000,  icon: CheckCircle2},
  predictive: { color: '#A78BFA', bg: 'rgba(124,58,237,0.12)',   border: 'rgba(124,58,237,0.4)',   duration: 8000,  icon: Brain, glow: true },
  error:      { color: '#FF3B5C', bg: 'rgba(255,59,92,0.09)',    border: 'rgba(255,59,92,0.35)',   duration: 12000, icon: AlertTriangle},
  override:   { color: '#FF9500', bg: 'rgba(255,149,0,0.09)',    border: 'rgba(255,149,0,0.3)',    duration: 5000,  icon: Activity    },
  killswitch: { color: '#FF3B5C', bg: 'rgba(255,59,92,0.12)',    border: 'rgba(255,59,92,0.4)',    duration: 7000,  icon: ShieldOff   },
  learning:   { color: '#818CF8', bg: 'rgba(129,140,248,0.09)',  border: 'rgba(129,140,248,0.28)', duration: 5000,  icon: Brain       },
  info:       { color: '#9CA3AF', bg: 'rgba(156,163,175,0.07)',  border: 'rgba(156,163,175,0.18)', duration: 4000,  icon: Info        },
};

// ─── CONTEXT ──────────────────────────────────────────────────────────────────
const ToastContext = createContext(null);

let _idCounter = 0;
const nextId = () => `toast-${++_idCounter}-${Date.now()}`;

// ─── SINGLE TOAST ITEM ────────────────────────────────────────────────────────
const ToastItem = memo(function ToastItem({ toast, onDismiss }) {
  const cfg          = TOAST_CFG[toast.type] ?? TOAST_CFG.info;
  const duration     = toast.duration ?? cfg.duration;
  const Icon         = cfg.icon ?? Info;

  const [pct, setPct]     = useState(100);
  const remainRef         = useRef(duration);
  const lastTickRef       = useRef(Date.now());
  const timerRef          = useRef(null);
  const navigate          = useNavigate();

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    lastTickRef.current = Date.now();
    timerRef.current = setInterval(() => {
      const now   = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      remainRef.current = Math.max(0, remainRef.current - delta);
      setPct((remainRef.current / duration) * 100);
      if (remainRef.current <= 0) {
        clearTimer();
        onDismiss(toast.id);
      }
    }, 50);
  }, [clearTimer, duration, onDismiss, toast.id]);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  const handleClick = useCallback(() => {
    if (toast.incidentId) {
      navigate('/incidents');
      window.dispatchEvent(new CustomEvent('open-incident-drawer', { detail: { id: toast.incidentId } }));
    }
  }, [toast.incidentId, navigate]);

  return (
    <motion.div
      layout
      initial={{ x: 420, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 420, opacity: 0, scale: 0.96 }}
      transition={{ ease: EASE, duration: 0.3 }}
      className="relative overflow-hidden rounded-xl border shadow-2xl select-none"
      style={{
        maxWidth: 380,
        backgroundColor: cfg.bg,
        borderColor:     cfg.border,
        cursor:          toast.incidentId ? 'pointer' : 'default',
        boxShadow: cfg.glow
          ? `0 0 24px rgba(124,58,237,0.25), 0 4px 16px rgba(0,0,0,0.5)`
          : '0 4px 16px rgba(0,0,0,0.45)',
      }}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
      onClick={handleClick}
      whileHover={{ scale: 1.01, transition: { duration: 0.1 } }}
    >
      {/* Body */}
      <div className="flex items-start gap-3 px-4 py-3 pr-8">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <motion.div
            animate={cfg.glow ? { scale: [1, 1.15, 1] } : {}}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            <Icon size={14} style={{ color: cfg.color }} />
          </motion.div>
        </div>

        {/* Message */}
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs leading-snug font-medium">{toast.message}</p>
          {toast.incidentId && (
            <p className="text-[10px] font-mono mt-0.5" style={{ color: cfg.color }}>
              {toast.incidentId} · tap to view →
            </p>
          )}
          {toast.sub && (
            <p className="text-gray-500 text-[10px] mt-0.5 font-mono truncate">{toast.sub}</p>
          )}
        </div>
      </div>

      {/* Dismiss button */}
      <motion.button
        className="absolute top-2 right-2 text-gray-600 hover:text-white transition-colors p-0.5 rounded"
        onClick={(e) => { e.stopPropagation(); onDismiss(toast.id); }}
        whileHover={{ scale: 1.2 }} whileTap={{ scale: 0.9 }}
      >
        <X size={11} />
      </motion.button>

      {/* Progress bar */}
      <div className="h-0.5 w-full" style={{ backgroundColor: `${cfg.color}18` }}>
        <motion.div
          className="h-full"
          style={{ backgroundColor: cfg.color, width: `${pct}%`, transition: 'width 100ms linear' }}
        />
      </div>
    </motion.div>
  );
});

// ─── TOAST CONTAINER (portal) ─────────────────────────────────────────────────
function ToastContainer({ toasts, onDismiss, queuedCount }) {
  return createPortal(
    <div
      className="fixed top-16 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none"
      style={{ maxWidth: 400 }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full">
            <ToastItem toast={t} onDismiss={onDismiss} />
          </div>
        ))}
        {queuedCount > 0 && (
          <motion.div
            key="queue-badge"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="pointer-events-auto flex items-center justify-center py-1.5 px-3 rounded-full mt-1 bg-[#7C3AED]/20 border border-[#7C3AED]/40 backdrop-blur-md"
          >
            <span className="text-[#A78BFA] text-[10px] font-mono font-bold tracking-wider uppercase">
              + {queuedCount} MORE PREDICTIONS QUEUED
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

// ─── PROVIDER ─────────────────────────────────────────────────────────────────
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [predictiveQueue, setPredictiveQueue] = useState([]);
  const lastPredictionRef   = useRef({});
  const { subscribe }       = useSystem();

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((type, message, opts = {}) => {
    const cfg = TOAST_CFG[type] ?? TOAST_CFG.info;
    const toast = {
      id:         nextId(),
      type,
      message:    String(message),
      incidentId: opts.incidentId ?? null,
      sub:        opts.sub ?? null,
      duration:   opts.duration ?? cfg.duration,
    };
    setToasts((prev) => [toast, ...prev].slice(0, MAX_TOASTS));
    return toast.id;
  }, []);

  const dismissToast = useCallback((id) => dismiss(id), [dismiss]);
  const clearAll     = useCallback(() => { setToasts([]); setPredictiveQueue([]); }, []);

  // Queue manager for predictive toasts
  useEffect(() => {
    const visiblePredictive = toasts.filter(t => t.type === 'predictive').length;
    if (visiblePredictive < 3 && predictiveQueue.length > 0) {
      const nextToast = predictiveQueue[0];
      setPredictiveQueue(q => q.slice(1));
      setToasts(prev => [nextToast, ...prev].slice(0, MAX_TOASTS));
    }
  }, [toasts, predictiveQueue]);

  // ── Subscribe to WS events via SystemContext (single shared WS) ───────────
  useEffect(() => {
    const unsubs = [
      subscribe('ALERT_RECEIVED', (d) => {
        const svc   = d?.data?.service ?? d?.service ?? '';
        const atype = (d?.data?.alert_type ?? d?.alert_type ?? '').replace(/_/g, ' ');
        const incId = d?.data?.incident_id ?? d?.data?.id ?? null;
        const sev   = d?.data?.severity ?? '';
        showToast('incident', `New incident: ${atype || 'alert'} on ${svc || 'unknown'}`,
          { incidentId: incId, sub: sev ? `Severity: ${sev}` : null });
      }),
      subscribe('INCIDENT_CREATED', (d) => {
        const svc   = d?.data?.service ?? '';
        const atype = (d?.data?.alert_type ?? '').replace(/_/g, ' ');
        const incId = d?.data?.incident_id ?? d?.data?.id ?? null;
        const sev   = d?.data?.severity ?? '';
        showToast('incident', `New incident: ${atype || 'alert'} on ${svc || 'unknown'}`,
          { incidentId: incId, sub: sev ? `Severity: ${sev}` : null });
      }),
      subscribe('INCIDENT_RESOLVED', (d) => {
        const incId  = d?.data?.incident_id ?? d?.data?.id ?? null;
        const svc    = d?.data?.service ?? '';
        const dur    = d?.data?.resolution_time_secs ?? d?.data?.duration_secs ?? null;
        const durStr = dur != null ? ` in ${Math.floor(dur / 60)}m ${dur % 60}s` : '';
        showToast('resolved', `✓ Resolved: ${incId || svc}${durStr}`, { incidentId: incId });
      }),
      subscribe('PREDICTIVE_ALERT', (d) => {
        const svc   = d?.data?.service ?? '';
        const atype = (d?.data?.alert_type ?? '').replace(/_/g, ' ');

        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;
        const last = lastPredictionRef.current[svc];
        if (last && (now - last) < fiveMinutes) return;

        lastPredictionRef.current[svc] = now;
        const toast = {
          id: nextId(),
          type: 'predictive',
          message: `🔮 Predictive: ${atype || 'failure'} predicted for ${svc}`,
          sub: d?.data?.predicted_in ? `In ~${d.data.predicted_in}` : null,
          incidentId: null,
          duration: 8000,
        };

        setPredictiveQueue(prev => [...prev, toast]);
      }),
      subscribe('INCIDENT_ERROR', (d) => {
        const incId = d?.data?.incident_id ?? d?.data?.id ?? null;
        const svc   = d?.data?.service ?? '';
        showToast('error', `⚠ Triage failed: ${incId || svc || 'unknown incident'}`,
          { incidentId: incId, duration: 12000 });
      }),
      subscribe('KILL_SWITCH_TOGGLED', (d) => {
        const paused = d?.data?.kill_switch_active ?? d?.kill_switch_active;
        if (paused === true)  showToast('killswitch', '🛑 Automation PAUSED — incidents → Human Override', { duration: 8000 });
        else if (paused === false) showToast('killswitch', '▶ Automation RESUMED — AI triage active', { duration: 6000 });
        else showToast('killswitch', '⚡ Kill Switch toggled', { duration: 6000 });
      }),
      subscribe('WORKFLOW_STEP_COMPLETED', (d) => {
        const step = (d?.data?.step ?? d?.data?.action ?? 'step').replace(/_/g, ' ');
        const svc  = d?.data?.service ?? '';
        showToast('info', `Workflow: ${step} completed`, { sub: svc || null });
      }),
      subscribe('INCIDENT_UPDATED', (d) => {
        if (d?.data?.status === 'escalated') {
          const incId = d?.data?.incident_id ?? d?.data?.id ?? null;
          const svc   = d?.data?.service ?? '';
          showToast('error', `⬆ Escalated: ${incId || svc}`, { incidentId: incId });
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, showToast]);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast, clearAll }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} queuedCount={predictiveQueue.length} />
    </ToastContext.Provider>
  );
}

// ─── HOOK ──────────────────────────────────────────────────────────────────────
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ─── CONVENIENCE WRAPPER (mount in App) ──────────────────────────────────────
// Usage: just mount <ToastProvider> ... </ToastProvider> in App.jsx
// This file intentionally has no default export — use named exports.
