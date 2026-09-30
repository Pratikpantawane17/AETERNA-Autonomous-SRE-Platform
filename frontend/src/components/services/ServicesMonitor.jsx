import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import {
  Activity, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, Zap, TrendingUp, X, ChevronDown, Loader2,
} from 'lucide-react';
import api, { WS_URL } from '../../config/api';
import { formatTimestamp, truncateId } from '../../utils/formatters';
import { useSystem } from '../../context/SystemContext';

const EASE = [0.25, 0.46, 0.45, 0.94];

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const MOCK_SERVICES = {
  'payment-service':  { health: 'unhealthy',  cpu_pct: 94.7, disk_pct: 62, error_rate: 0.087, traffic_level: 'high',     escalated: true,  fallback_active: false, last_updated: new Date(Date.now() - 45000).toISOString() },
  'auth-service':     { health: 'degraded',   cpu_pct: 71.2, disk_pct: 45, error_rate: 0.021, traffic_level: 'elevated', escalated: false, fallback_active: false, last_updated: new Date(Date.now() - 30000).toISOString() },
  'api-gateway':      { health: 'healthy',    cpu_pct: 38.4, disk_pct: 31, error_rate: 0.003, traffic_level: 'normal',   escalated: false, fallback_active: false, last_updated: new Date(Date.now() - 20000).toISOString() },
  'db-primary':       { health: 'degraded',   cpu_pct: 82.1, disk_pct: 97, error_rate: 0.019, traffic_level: 'elevated', escalated: false, fallback_active: true,  last_updated: new Date(Date.now() - 60000).toISOString() },
  'notification-svc': { health: 'healthy',    cpu_pct: 22.8, disk_pct: 18, error_rate: 0.001, traffic_level: 'normal',   escalated: false, fallback_active: false, last_updated: new Date(Date.now() - 10000).toISOString() },
  'order-service':    { health: 'healthy',    cpu_pct: 45.6, disk_pct: 52, error_rate: 0.004, traffic_level: 'elevated', escalated: false, fallback_active: false, last_updated: new Date(Date.now() - 90000).toISOString() },
  'cache-layer':      { health: 'unhealthy',  cpu_pct: 88.3, disk_pct: 74, error_rate: 0.052, traffic_level: 'high',     escalated: false, fallback_active: true,  last_updated: new Date(Date.now() - 15000).toISOString() },
  'ml-inference':     { health: 'healthy',    cpu_pct: 61.0, disk_pct: 40, error_rate: 0.006, traffic_level: 'normal',   escalated: false, fallback_active: false, last_updated: new Date(Date.now() - 5000).toISOString() },
};

// ─── HEALTH CONFIG ───────────────────────────────────────────────────────────
const HEALTH = {
  healthy:   { color: '#22C55E', label: 'HEALTHY',    bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.35)' },
  degraded:  { color: '#FF9500', label: 'DEGRADED',   bg: 'rgba(255,149,0,0.1)',   border: 'rgba(255,149,0,0.35)' },
  unhealthy: { color: '#FF3B5C', label: 'UNHEALTHY',  bg: 'rgba(255,59,92,0.1)',   border: 'rgba(255,59,92,0.35)' },
  escalated: { color: '#FF3B5C', label: 'ESCALATED',  bg: 'rgba(255,59,92,0.12)',  border: 'rgba(255,59,92,0.5)' },
};

const hcfg = (h) => HEALTH[h?.toLowerCase?.()] ?? HEALTH.healthy;

// ─── METRIC COLOR ─────────────────────────────────────────────────────────────
function cpuColor(v)  { return v > 85 ? '#FF3B5C' : v > 70 ? '#FF9500' : '#22C55E'; }
function diskColor(v) { return v > 85 ? '#FF3B5C' : v > 70 ? '#FF9500' : '#22C55E'; }
function errColor(v)  { return v > 0.03 ? '#FF3B5C' : v > 0.01 ? '#FF9500' : '#22C55E'; }

const TRAFFIC_STYLES = {
  high:     { color: '#FF3B5C', bg: 'rgba(255,59,92,0.15)' },
  elevated: { color: '#FF9500', bg: 'rgba(255,149,0,0.12)' },
  normal:   { color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)' },
};
const tStyle = (t) => TRAFFIC_STYLES[t?.toLowerCase?.()] ?? TRAFFIC_STYLES.normal;

// ─── ANIMATED METRIC BAR ──────────────────────────────────────────────────────
function MetricBar({ label, value = 0, color, unit = '%', maxVal = 100 }) {
  const pct = Math.min(100, Math.max(0, (value / maxVal) * 100));
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center">
        <span className="text-[9px] font-mono text-gray-600 uppercase">{label}</span>
        <span className="text-[10px] font-mono font-semibold tabular-nums" style={{ color }}>
          {typeof value === 'number' ? value.toFixed(unit === '%' ? 1 : 2) : '—'}{unit}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[#1C2333] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: EASE }}
          initial={false}
        />
      </div>
    </div>
  );
}

// ─── SERVICE CARD ─────────────────────────────────────────────────────────────
function ServiceCard({ name, data, flash, onClick }) {
  const cfg   = hcfg(data?.health);
  const isEsc = data?.escalated === true;
  const isFb  = data?.fallback_active === true;
  const cpu   = data?.cpu_pct   ?? 0;
  const disk  = data?.disk_pct  ?? 0;
  const err   = data?.error_rate ?? 0;
  const trf   = data?.traffic_level ?? 'normal';
  const ts    = tStyle(trf);

  return (
    <motion.div
      layout
      className="rounded-xl border p-4 flex flex-col gap-3 cursor-pointer relative overflow-hidden"
      style={{
        backgroundColor: '#0D1117',
        borderColor: flash ? '#00D4FF' : cfg.border,
        boxShadow: flash ? '0 0 20px rgba(0,212,255,0.25)' : 'none',
      }}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ ease: EASE, duration: 0.35 }}
      whileHover={{ borderColor: `${cfg.color}70`, scale: 1.01, transition: { duration: 0.15 } }}
      onClick={onClick}
    >
      {/* Flash overlay */}
      <AnimatePresence>
        {flash && (
          <motion.div
            className="absolute inset-0 pointer-events-none rounded-xl"
            style={{ backgroundColor: 'rgba(0,212,255,0.06)' }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
          />
        )}
      </AnimatePresence>

      {/* Fallback banner */}
      <AnimatePresence>
        {isFb && (
          <motion.div
            className="absolute top-0 left-0 right-0 flex items-center justify-center gap-1.5 py-1 text-[9px] font-mono font-bold"
            style={{ backgroundColor: 'rgba(255,149,0,0.18)', color: '#FF9500' }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ ease: EASE, duration: 0.2 }}
          >
            <Zap size={9} />
            FALLBACK ACTIVE
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card header */}
      <div className={`flex items-start justify-between gap-2 ${isFb ? 'mt-5' : ''}`}>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{name}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Escalated badge */}
          {isEsc && (
            <motion.span
              className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold"
              style={{ backgroundColor: 'rgba(255,59,92,0.2)', color: '#FF3B5C', border: '1px solid rgba(255,59,92,0.4)' }}
              animate={{ opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            >
              ESCALATED
            </motion.span>
          )}
          {/* Status badge */}
          <div className="flex items-center gap-1.5">
            <motion.div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: cfg.color, boxShadow: `0 0 6px ${cfg.color}` }}
              animate={data?.health !== 'healthy' ? { opacity: [1, 0.3, 1], scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 1.6, repeat: Infinity }}
            />
            <span className="text-[9px] font-mono font-bold" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
          </div>
        </div>
      </div>

      {/* Metrics */}
      <div className="space-y-2">
        <MetricBar label="CPU"  value={cpu}  color={cpuColor(cpu)}  maxVal={100} />
        <MetricBar label="Disk" value={disk} color={diskColor(disk)} maxVal={100} />

        <div className="flex items-center justify-between">
          <div className="flex-1 space-y-0.5 mr-4">
            <div className="flex justify-between">
              <span className="text-[9px] font-mono text-gray-600 uppercase">Error Rate</span>
              <span className="text-[10px] font-mono font-semibold tabular-nums" style={{ color: errColor(err) }}>
                {(err * 100).toFixed(2)}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#1C2333] overflow-hidden">
              <motion.div className="h-full rounded-full"
                style={{ backgroundColor: errColor(err) }}
                animate={{ width: `${Math.min(100, err * 1000)}%` }}
                transition={{ duration: 0.7, ease: EASE }}
                initial={false} />
            </div>
          </div>
          <span className="text-[9px] font-mono px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: ts.bg, color: ts.color }}>
            {(trf ?? 'normal').toUpperCase()}
          </span>
        </div>
      </div>

      {/* Footer */}
      <p className="text-gray-700 text-[9px] font-mono">
        Updated {formatTimestamp(data?.last_updated)}
      </p>
    </motion.div>
  );
}

// ─── METRIC INJECTION PANEL ───────────────────────────────────────────────────
function MetricInjector({ onSuccess }) {
  const [open, setOpen]       = useState(false);
  const [service, setService] = useState('');
  const [cpu, setCpu]        = useState(50);
  const [disk, setDisk]      = useState(40);
  const [errRate, setErrRate] = useState(0.005);
  const [health, setHealth]   = useState('healthy');
  const [traffic, setTraffic] = useState('normal');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]         = useState(null);
  const abortRef              = useRef(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handlePush = useCallback(async (e) => {
    e.preventDefault();
    if (!service.trim() || loading) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setMsg(null);

    try {
      await api.post('/api/ingest/metrics', {
        service: service.trim(),
        cpu_pct:  parseFloat(cpu),
        disk_pct: parseFloat(disk),
        error_rate: parseFloat(errRate),
        health,
        traffic_level: traffic,
      }, { signal: abortRef.current.signal });
      setMsg({ ok: true, text: 'Metrics pushed — watch the service card update!' });
      if (onSuccess) onSuccess();
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      setMsg({ ok: false, text: e?.response?.data?.detail ?? e?.message ?? 'Push failed' });
    } finally {
      if (!abortRef.current?.signal?.aborted) setLoading(false);
    }
  }, [service, cpu, disk, errRate, health, traffic, loading, onSuccess]);

  return (
    <div className="border border-[#1C2333] rounded-2xl overflow-hidden bg-[#0D1117]">
      <motion.button
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.99 }}
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={13} className="text-[#7C3AED]" />
          <span className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">
            Metric Injection Panel
          </span>
        </div>
        {open ? <ChevronDown size={13} className="text-gray-600 rotate-180 transition-transform" />
               : <ChevronDown size={13} className="text-gray-600 transition-transform" />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.form
            onSubmit={handlePush}
            className="px-5 pb-5 space-y-4 border-t border-[#1C2333]"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{   height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.25 }}
          >
            <div className="pt-4 grid grid-cols-2 gap-3">
              {/* Service name */}
              <div className="col-span-2 space-y-1.5">
                <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Service Name</label>
                <input
                  type="text" value={service} onChange={(e) => setService(e.target.value)}
                  placeholder="e.g. payment-service"
                  className="w-full bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2 placeholder-gray-700 focus:outline-none focus:border-[#7C3AED]/50 transition-colors"
                />
              </div>

              {/* CPU */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider flex justify-between">
                  <span>CPU %</span>
                  <span style={{ color: cpuColor(cpu) }}>{cpu}%</span>
                </label>
                <input type="range" min="0" max="100" step="1" value={cpu}
                  onChange={(e) => setCpu(Number(e.target.value))}
                  className="w-full accent-violet-500 h-1.5 rounded-full" />
              </div>

              {/* Disk */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider flex justify-between">
                  <span>Disk %</span>
                  <span style={{ color: diskColor(disk) }}>{disk}%</span>
                </label>
                <input type="range" min="0" max="100" step="1" value={disk}
                  onChange={(e) => setDisk(Number(e.target.value))}
                  className="w-full accent-violet-500 h-1.5 rounded-full" />
              </div>

              {/* Error rate */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Error Rate</label>
                <input type="number" min="0" max="1" step="0.001" value={errRate}
                  onChange={(e) => setErrRate(parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-[#7C3AED]/50 transition-colors"
                />
              </div>

              {/* Health */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Health</label>
                <select value={health} onChange={(e) => setHealth(e.target.value)}
                  className="w-full appearance-none bg-[#080B14] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-[#7C3AED]/50 transition-colors"
                  style={{ colorScheme: 'dark' }}>
                  {['healthy', 'degraded', 'unhealthy'].map((h) => (
                    <option key={h} value={h} className="bg-[#0D1117]">{h}</option>
                  ))}
                </select>
              </div>

              {/* Traffic */}
              <div className="col-span-2 space-y-1.5">
                <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Traffic Level</label>
                <div className="flex gap-2">
                  {['normal', 'elevated', 'high'].map((t) => (
                    <motion.button key={t} type="button"
                      onClick={() => setTraffic(t)}
                      className="flex-1 py-1.5 rounded-lg text-[10px] font-mono font-semibold border transition-all"
                      style={{
                        backgroundColor: traffic === t ? `${tStyle(t).color}18` : 'transparent',
                        borderColor:     traffic === t ? `${tStyle(t).color}50` : '#1C2333',
                        color:           traffic === t ? tStyle(t).color : '#6B7280',
                      }}
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                      {t.toUpperCase()}
                    </motion.button>
                  ))}
                </div>
              </div>
            </div>

            {/* Message */}
            <AnimatePresence>
              {msg && (
                <motion.p
                  className="text-xs font-mono px-3 py-2 rounded-lg border"
                  style={{
                    color:           msg.ok ? '#22C55E' : '#FF3B5C',
                    backgroundColor: msg.ok ? 'rgba(34,197,94,0.08)' : 'rgba(255,59,92,0.08)',
                    borderColor:     msg.ok ? 'rgba(34,197,94,0.3)' : 'rgba(255,59,92,0.3)',
                  }}
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                >
                  {msg.text}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.button type="submit" disabled={!service.trim() || loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-mono text-xs font-bold transition-all"
              style={{
                backgroundColor: service.trim() && !loading ? 'rgba(124,58,237,0.2)' : 'rgba(124,58,237,0.06)',
                color:           service.trim() && !loading ? '#A78BFA' : '#7C3AED50',
                border:          '1px solid rgba(124,58,237,0.3)',
                cursor:          service.trim() && !loading ? 'pointer' : 'not-allowed',
              }}
              whileHover={service.trim() && !loading ? { scale: 1.01 } : {}}
              whileTap={service.trim() && !loading ? { scale: 0.98 } : {}}>
              {loading
                ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}><Loader2 size={13} /></motion.div> Pushing…</>
                : <><TrendingUp size={13} /> Push Metrics</>}
            </motion.button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
const FILTERS = ['ALL', 'HEALTHY', 'DEGRADED', 'UNHEALTHY', 'ESCALATED'];

export default function ServicesMonitor({ onServiceClick }) {
  const [services, setServices]     = useState({});
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [filter, setFilter]         = useState('ALL');
  const [flashMap, setFlashMap]     = useState({});
  const abortRef                    = useRef(null);
  const wsRef                       = useRef(null);
  const timerRef                    = useRef(null);
  const { subscribe }               = useSystem();

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchServices = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setError(null);

    api.get('/api/services/state', { signal: abortRef.current.signal })
      .then(({ data }) => {
        setServices(data && typeof data === 'object' ? data : {});
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[ServicesMonitor] API unavailable, using mock', e);
        setServices(MOCK_SERVICES);
        setError('Live data unavailable');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchServices();
    timerRef.current = setInterval(fetchServices, 15000);
    return () => {
      clearInterval(timerRef.current);
      abortRef.current?.abort();
    };
  }, [fetchServices]);

  // ── WebSocket ────────────────────────────────────────────────────────────
  useEffect(() => {
    return subscribe('SERVICE_STATE_UPDATED', (msg) => {
      const payload = msg?.data ?? msg?.payload ?? {};
      const svcName = payload?.service ?? payload?.service_name;
      if (svcName) {
        setServices((prev) => ({
          ...prev,
          [svcName]: { ...(prev[svcName] ?? {}), ...payload, last_updated: new Date().toISOString() },
        }));
        // Flash the updated card
        setFlashMap((prev) => ({ ...prev, [svcName]: true }));
        setTimeout(() => setFlashMap((prev) => ({ ...prev, [svcName]: false })), 1500);
      } else {
        fetchServices();
      }
    });
  }, [fetchServices, subscribe]);

  // ── Derived ────────────────────────────────────────────────────────────
  const entries = Object.entries(services).filter(([name]) => {
    const invalid = ["string","number","boolean","object","null","undefined"];
    return name?.length >= 3 && !invalid.includes(name);
  });
  const healthy   = entries.filter(([, d]) => d?.health?.toLowerCase() === 'healthy').length;
  const degraded  = entries.filter(([, d]) => d?.health?.toLowerCase() === 'degraded').length;
  const unhealthy = entries.filter(([, d]) => d?.health?.toLowerCase() === 'unhealthy').length;

  const visible = entries.filter(([name, data]) => {
    if (filter === 'ALL')       return true;
    if (filter === 'ESCALATED') return data?.escalated === true;
    return (data?.health ?? '').toUpperCase() === filter;
  });

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0,1,2,3,4,5].map((i) => <div key={i} className="skeleton h-52 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-[#00D4FF]" />
            <h1 className="text-white font-mono text-sm font-bold tracking-[0.15em] uppercase">
              Service Health Monitor
            </h1>
          </div>
          {!loading && entries.length > 0 && (
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {[
                { count: healthy,   color: '#22C55E', label: 'healthy' },
                { count: degraded,  color: '#FF9500', label: 'degraded' },
                { count: unhealthy, color: '#FF3B5C', label: 'unhealthy' },
              ].map(({ count, color, label }) => (
                <span key={label} className="text-[11px] font-mono" style={{ color }}>
                  {count} {label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Error badge */}
          {error && (
            <span className="text-[10px] font-mono px-2 py-1 rounded-lg border"
              style={{ color: '#FF9500', backgroundColor: 'rgba(255,149,0,0.08)', borderColor: 'rgba(255,149,0,0.3)' }}>
              <AlertTriangle size={9} className="inline mr-1" />Mock data
            </span>
          )}

          {/* Refresh */}
          <motion.button onClick={fetchServices}
            className="p-2 rounded-lg border border-[#1C2333] text-gray-600 hover:text-[#00D4FF] hover:border-[#00D4FF]/30 transition-colors"
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95, rotate: -30 }}>
            <RefreshCw size={13} />
          </motion.button>

          {/* Live indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#1C2333]">
            <motion.div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"
              animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }} />
            <span className="text-[10px] font-mono text-gray-500">Live · 15s</span>
          </div>
        </div>
      </div>

      {/* ── Filter ───────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => {
          const isActive = filter === f;
          const col = f === 'HEALTHY' ? '#22C55E' : f === 'DEGRADED' ? '#FF9500' : f === 'UNHEALTHY' || f === 'ESCALATED' ? '#FF3B5C' : '#00D4FF';
          return (
            <motion.button key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold border transition-all"
              style={{
                backgroundColor: isActive ? `${col}18` : 'transparent',
                borderColor:     isActive ? `${col}50` : '#1C2333',
                color:           isActive ? col : '#6B7280',
              }}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              {f}
            </motion.button>
          );
        })}
      </div>

      {/* ── Grid ─────────────────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <motion.div
          className="flex flex-col items-center justify-center gap-5 py-24"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        >
          <motion.div className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)' }}
            animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 3, repeat: Infinity }}>
            <Activity size={36} className="text-[#00D4FF]" />
          </motion.div>
          {entries.length === 0 ? (
            <>
              <p className="text-gray-400 text-sm font-mono font-medium">No services being monitored</p>
              <p className="text-gray-600 text-xs font-mono">Push metrics via POST /api/ingest/metrics to start</p>
            </>
          ) : (
            <p className="text-gray-500 text-sm font-mono">No {filter.toLowerCase()} services found</p>
          )}
        </motion.div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map(([name, data]) => (
              <ServiceCard
                key={name}
                name={name}
                data={data}
                flash={!!flashMap[name]}
                onClick={() => onServiceClick?.(name, data)}
              />
            ))}
          </div>
        </AnimatePresence>
      )}

      {/* ── Metric Injector ───────────────────────────────────────────── */}
      <MetricInjector onSuccess={fetchServices} />
    </div>
  );
}
