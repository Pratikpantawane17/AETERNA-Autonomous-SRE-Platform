import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Clock, AlertTriangle, CheckCircle2, ChevronDown, Loader2 } from 'lucide-react';
import api from '../../config/api';
import { ALERT_TYPES } from '../../config/constants';

const EASE = [0.25, 0.46, 0.45, 0.94];

// ─── ROUTE → PAGE TITLE MAP ──────────────────────────────────────────────────
const ROUTE_TITLES = {
  '/':             'Dashboard',
  '/incidents':    'Live Incidents',
  '/services':     'Services Monitor',
  '/intelligence': 'AI Intelligence',
  '/override':     'Human Override',
  '/reports':      'Reports & Audit',
  '/workflows':    'Workflow Rules',
};

const SEVERITIES = ['critical', 'high', 'medium', 'low'];

// ─── UTC CLOCK ────────────────────────────────────────────────────────────────
function UtcClock() {
  const [time, setTime] = useState(() => new Date().toUTCString().split(' ').slice(4, 5).join('') + ' UTC');

  useEffect(() => {
    const pad = (n) => String(n).padStart(2, '0');
    const tick = () => {
      const now = new Date();
      setTime(`${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-1.5 text-gray-500">
      <Clock size={11} />
      <span className="font-mono text-[11px] tracking-wider tabular-nums">{time}</span>
    </div>
  );
}

// ─── ANIMATED BADGE (incidents last hour) ────────────────────────────────────
function IncidentsBadge({ count }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);

  useEffect(() => {
    const end = parseInt(count) || 0;
    const t0  = performance.now();
    const dur  = 700;
    const step = (now) => {
      const x  = Math.min((now - t0) / dur, 1);
      const ease = 1 - Math.pow(1 - x, 3);
      setDisplay(Math.round(end * ease));
      if (x < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [count]);

  if (count == null) return null;

  return (
    <motion.div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
      style={{ backgroundColor: 'rgba(255,59,92,0.08)', borderColor: 'rgba(255,59,92,0.3)' }}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1,    opacity: 1 }}
      transition={{ ease: EASE, duration: 0.3 }}
    >
      <motion.div
        className="w-1.5 h-1.5 rounded-full bg-[#FF3B5C]"
        animate={{ opacity: [1, 0.3, 1] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      <span className="font-mono text-[11px] text-[#FF3B5C] font-semibold tabular-nums">
        {display}
      </span>
      <span className="text-[10px] text-gray-600 font-mono">/ hr</span>
    </motion.div>
  );
}

// ─── CUSTOM SELECT ────────────────────────────────────────────────────────────
function Select({ value, onChange, options, placeholder, id }) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2.5 pr-8 focus:outline-none focus:border-[#00D4FF]/60 transition-colors cursor-pointer"
        style={{ colorScheme: 'dark' }}
      >
        <option value="" disabled className="text-gray-600">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value ?? opt} value={opt.value ?? opt} className="bg-[#0D1117]">
            {opt.label ?? String(opt).replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
    </div>
  );
}

// ─── SUBMIT ALERT MODAL ───────────────────────────────────────────────────────
function SubmitAlertModal({ onClose }) {
  const [alertType, setAlertType] = useState('');
  const [severity,  setSeverity]  = useState('');
  const [service,   setService]   = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [success,   setSuccess]   = useState(false);
  const abortRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      abortRef.current?.abort();
    };
  }, [onClose]);

  const canSubmit = alertType && severity && service.trim();

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!canSubmit || loading) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      await api.post('/api/alerts', {
        alert_type: alertType,
        severity,
        service: service.trim(),
      }, { signal: abortRef.current.signal });

      setSuccess(true);
      setTimeout(() => { onClose(); }, 1800);
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      const msg = e?.response?.data?.detail ?? e?.message ?? 'Failed to submit alert';
      setError(String(msg));
    } finally {
      if (!abortRef.current?.signal?.aborted) setLoading(false);
    }
  }, [alertType, severity, service, canSubmit, loading, onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ ease: EASE, duration: 0.2 }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      {/* Modal */}
      <motion.div
        className="relative z-10 w-full max-w-md bg-[#0D1117] border border-[#1C2333] rounded-2xl shadow-2xl overflow-hidden"
        style={{ boxShadow: '0 0 80px rgba(0,212,255,0.06)' }}
        initial={{ opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0,  scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.96 }}
        transition={{ ease: EASE, duration: 0.25 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1C2333]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.25)' }}>
              <Plus size={14} className="text-[#00D4FF]" />
            </div>
            <div>
              <h3 className="text-white font-mono text-sm font-semibold">Submit Alert</h3>
              <p className="text-gray-600 text-[10px] font-mono">Inject into the AIOps pipeline</p>
            </div>
          </div>
          <motion.button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-600 hover:text-white hover:bg-white/[0.06] transition-colors"
            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
            disabled={loading}
          >
            <X size={15} />
          </motion.button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
          {/* Alert type */}
          <div className="space-y-1.5">
            <label htmlFor="modal-alert-type" className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
              Alert Type
            </label>
            <Select
              id="modal-alert-type"
              value={alertType}
              onChange={setAlertType}
              placeholder="Select alert type…"
              options={ALERT_TYPES}
            />
          </div>

          {/* Severity */}
          <div className="space-y-1.5">
            <label htmlFor="modal-severity" className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
              Severity
            </label>
            <Select
              id="modal-severity"
              value={severity}
              onChange={setSeverity}
              placeholder="Select severity…"
              options={SEVERITIES.map((s) => ({
                value: s,
                label: s.charAt(0).toUpperCase() + s.slice(1),
              }))}
            />
          </div>

          {/* Service */}
          <div className="space-y-1.5">
            <label htmlFor="modal-service" className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
              Service Name
            </label>
            <input
              id="modal-service"
              type="text"
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="e.g. payment-service"
              className="w-full bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2.5 placeholder-gray-700 focus:outline-none focus:border-[#00D4FF]/60 transition-colors"
              disabled={loading || success}
              autoComplete="off"
            />
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg border"
                style={{ backgroundColor: 'rgba(255,59,92,0.08)', borderColor: 'rgba(255,59,92,0.3)' }}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ ease: EASE, duration: 0.2 }}
              >
                <AlertTriangle size={13} className="text-[#FF3B5C] flex-shrink-0 mt-0.5" />
                <p className="text-[#FF3B5C] text-xs font-mono">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Success */}
          <AnimatePresence>
            {success && (
              <motion.div
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border"
                style={{ backgroundColor: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.3)' }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ ease: EASE, duration: 0.2 }}
              >
                <CheckCircle2 size={13} className="text-[#22C55E] flex-shrink-0" />
                <p className="text-[#22C55E] text-xs font-mono">Alert submitted — pipeline ingesting…</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit button */}
          <motion.button
            type="submit"
            disabled={!canSubmit || loading || success}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-mono text-sm font-semibold transition-all"
            style={{
              backgroundColor: success ? 'rgba(34,197,94,0.15)' : canSubmit && !loading ? '#00D4FF' : 'rgba(0,212,255,0.12)',
              color:           success ? '#22C55E' : canSubmit && !loading ? '#080B14' : '#00D4FF60',
              cursor:          canSubmit && !loading && !success ? 'pointer' : 'not-allowed',
            }}
            whileHover={canSubmit && !loading && !success ? { scale: 1.02, filter: 'brightness(1.08)' } : {}}
            whileTap={canSubmit && !loading && !success ? { scale: 0.97 } : {}}
          >
            <AnimatePresence mode="wait">
              {loading ? (
                <motion.span key="loading" className="flex items-center gap-2"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
                    <Loader2 size={14} />
                  </motion.div>
                  Submitting…
                </motion.span>
              ) : success ? (
                <motion.span key="success" className="flex items-center gap-2"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <CheckCircle2 size={14} /> Submitted
                </motion.span>
              ) : (
                <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  Submit Alert
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  );
}

// ─── TOP BAR ──────────────────────────────────────────────────────────────────
export default function TopBar({ incidentsLastHour }) {
  const location = useLocation();
  const [modalOpen, setModalOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);

  const pageTitle = ROUTE_TITLES[location.pathname] ?? 'Aeterna SRE';

  // Show success toast when modal closes after success (handled via AnimatePresence inside modal)
  const handleOpenModal = () => setModalOpen(true);
  const handleCloseModal = () => setModalOpen(false);

  return (
    <>
      {/* ── Bar ─────────────────────────────────────────────────────────────── */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-6"
        style={{
          height: 48,
          backgroundColor: '#080B14',
          borderBottom: '1px solid #1C2333',
        }}
      >
        {/* Left — Page title */}
        <AnimatePresence mode="wait">
          <motion.h1
            key={location.pathname}
            className="text-white font-semibold text-sm tracking-wide"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ ease: EASE, duration: 0.2 }}
          >
            {pageTitle}
          </motion.h1>
        </AnimatePresence>

        {/* Right — cluster */}
        <div className="flex items-center gap-3">
          {/* UTC Clock */}
          <UtcClock />

          {/* Divider */}
          <div className="w-px h-4 bg-[#1C2333]" />

          {/* Incidents last hour badge */}
          <IncidentsBadge count={incidentsLastHour} />

          {/* Divider */}
          <div className="w-px h-4 bg-[#1C2333]" />

          {/* Submit Alert button */}
          <motion.button
            id="submit-alert-btn"
            onClick={handleOpenModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs font-semibold transition-colors"
            style={{ backgroundColor: 'rgba(0,212,255,0.1)', color: '#00D4FF', border: '1px solid rgba(0,212,255,0.25)' }}
            whileHover={{ backgroundColor: 'rgba(0,212,255,0.18)', scale: 1.02, transition: { duration: 0.12 } }}
            whileTap={{ scale: 0.96 }}
          >
            <Plus size={12} />
            Submit Alert
          </motion.button>
        </div>
      </header>

      {/* ── Modal portal ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {modalOpen && <SubmitAlertModal key="alert-modal" onClose={handleCloseModal} />}
      </AnimatePresence>
    </>
  );
}
