import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Activity, AlertTriangle, CheckCircle2, Loader2,
  Brain, Clock, Zap, TrendingUp,
} from 'lucide-react';
import api from '../../config/api';
import { formatTimestamp, truncateId } from '../../utils/formatters';
import { SEVERITY_COLORS } from '../../config/constants';

const EASE = [0.25, 0.46, 0.45, 0.94];

function cpuColor(v)  { return v > 85 ? '#FF3B5C' : v > 70 ? '#FF9500' : '#22C55E'; }
function diskColor(v) { return v > 85 ? '#FF3B5C' : v > 70 ? '#FF9500' : '#22C55E'; }
function errColor(v)  { return v > 0.03 ? '#FF3B5C' : v > 0.01 ? '#FF9500' : '#22C55E'; }

function MetricDetail({ label, value, color, bar = true, maxVal = 100, unit = '%' }) {
  const isNumber = typeof value === 'number';
  const displayVal = isNumber ? value.toFixed(2) : String(value ?? '—');
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">{label}</span>
        <span className="font-mono text-xs font-bold tabular-nums" style={{ color }}>
          {displayVal}{unit}
        </span>
      </div>
      {bar && (
        <div className="h-2 rounded-full bg-[#1C2333] overflow-hidden">
          <motion.div className="h-full rounded-full" style={{ backgroundColor: color }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, (value / maxVal) * 100)}%` }}
            transition={{ duration: 0.8, ease: EASE }} />
        </div>
      )}
    </div>
  );
}

export default function ServiceDetailModal({ serviceName, serviceData, onClose }) {
  const [incidents, setIncidents] = useState([]);
  const [incLoading, setIncLoading] = useState(true);
  const [prediction, setPrediction] = useState(null);
  const [predLoading, setPredLoading] = useState(false);
  const [predError, setPredError] = useState(null);
  const abortRef = useRef(null);
  const predAbort = useRef(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      abortRef.current?.abort();
      predAbort.current?.abort();
    };
  }, [onClose]);

  // Fetch incidents for this service
  useEffect(() => {
    if (!serviceName) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    api.get('/api/incidents', { signal: abortRef.current.signal })
      .then(({ data }) => {
        const all = Array.isArray(data) ? data : [];
        const filtered = all
          .filter((i) => (i?.service ?? i?.service_name ?? '') === serviceName)
          .slice(0, 10);
        setIncidents(filtered);
        setIncLoading(false);
      })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[ServiceDetailModal] incidents unavailable', e);
        setIncidents([]);
        setIncLoading(false);
      });

    return () => { abortRef.current?.abort(); };
  }, [serviceName]);

  // Run prediction
  const handlePredict = useCallback(async () => {
    if (predLoading) return;
    predAbort.current?.abort();
    predAbort.current = new AbortController();
    setPredLoading(true);
    setPredError(null);
    setPrediction(null);

    // Build mock cpu_pct_history: last 6 readings with small jitter around current
    const base = serviceData?.cpu_pct ?? 50;
    const cpuHistory = Array.from({ length: 6 }, (_, i) =>
      Math.max(0, Math.min(100, base + (Math.random() - 0.5) * 8 - i * 0.5))
    ).reverse();

    try {
      const { data } = await api.post('/api/predict', {
        service: serviceName,
        cpu_pct_history: cpuHistory,
      }, { signal: predAbort.current.signal });
      setPrediction(data ?? null);
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      setPredError(String(e?.response?.data?.detail ?? e?.message ?? 'Prediction failed'));
    } finally {
      if (!predAbort.current?.signal?.aborted) setPredLoading(false);
    }
  }, [serviceName, serviceData, predLoading]);

  const cpu  = serviceData?.cpu_pct   ?? 0;
  const disk = serviceData?.disk_pct  ?? 0;
  const err  = serviceData?.error_rate ?? 0;
  const health = serviceData?.health ?? 'unknown';
  const HEALTH_COLORS = { healthy: '#22C55E', degraded: '#FF9500', unhealthy: '#FF3B5C' };
  const hColor = HEALTH_COLORS[health.toLowerCase()] ?? '#9CA3AF';

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ ease: EASE, duration: 0.2 }}
    >
      {/* Backdrop */}
      <motion.div className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />

      {/* Modal */}
      <motion.div
        className="relative z-10 w-full max-w-2xl max-h-[90vh] bg-[#0D1117] border border-[#1C2333] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ boxShadow: '0 0 80px rgba(0,212,255,0.05)' }}
        initial={{ opacity: 0, y: 28, scale: 0.95 }}
        animate={{ opacity: 1, y: 0,  scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ ease: EASE, duration: 0.25 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1C2333] flex-shrink-0">
          <div className="flex items-center gap-3">
            <motion.div className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: hColor, boxShadow: `0 0 8px ${hColor}` }}
              animate={health !== 'healthy' ? { opacity: [1, 0.3, 1] } : {}}
              transition={{ duration: 1.5, repeat: Infinity }} />
            <div>
              <h2 className="text-white font-semibold text-sm">{serviceName}</h2>
              <p className="font-mono text-[10px] uppercase tracking-wider" style={{ color: hColor }}>
                {health}
                {serviceData?.fallback_active && <span className="text-[#FF9500] ml-2">· FALLBACK ACTIVE</span>}
              </p>
            </div>
          </div>
          <motion.button onClick={onClose}
            className="p-1.5 rounded-lg text-gray-600 hover:text-white hover:bg-white/[0.06] transition-colors"
            whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
            <X size={15} />
          </motion.button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1">
          {/* Metrics */}
          <div className="px-6 py-5 border-b border-[#1C2333] space-y-4">
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em]">Live Metrics</p>
            <div className="grid grid-cols-2 gap-4">
              <MetricDetail label="CPU %" value={cpu} color={cpuColor(cpu)} maxVal={100} unit="%" />
              <MetricDetail label="Disk %" value={disk} color={diskColor(disk)} maxVal={100} unit="%" />
            </div>
            <MetricDetail label="Error Rate" value={err * 100} color={errColor(err)} bar maxVal={10} unit="%" />
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Traffic</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase"
                style={{
                  color: serviceData?.traffic_level === 'high' ? '#FF3B5C' : serviceData?.traffic_level === 'elevated' ? '#FF9500' : '#9CA3AF',
                  backgroundColor: serviceData?.traffic_level === 'high' ? 'rgba(255,59,92,0.12)' : serviceData?.traffic_level === 'elevated' ? 'rgba(255,149,0,0.1)' : 'rgba(156,163,175,0.06)',
                }}>
                {serviceData?.traffic_level ?? 'unknown'}
              </span>
              <span className="text-[9px] font-mono text-gray-600 ml-auto">
                Updated {formatTimestamp(serviceData?.last_updated)}
              </span>
            </div>
          </div>

          {/* Recent incidents */}
          <div className="px-6 py-5 border-b border-[#1C2333]">
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em] mb-3">
              Recent Incidents
            </p>
            {incLoading ? (
              <div className="space-y-2">
                {[0,1,2].map((i) => <div key={i} className="skeleton h-10 rounded-lg animate-pulse" />)}
              </div>
            ) : incidents.length === 0 ? (
              <div className="flex items-center gap-2 py-4">
                <CheckCircle2 size={16} className="text-[#22C55E]" />
                <p className="text-gray-500 text-xs font-mono">No incidents for this service</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {incidents.map((inc, i) => {
                  const sc = SEVERITY_COLORS[(inc?.severity ?? 'low').toLowerCase()] ?? '#9CA3AF';
                  return (
                    <motion.div key={inc?.id ?? i}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[#1C2333] bg-[#080B14]"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05, ease: EASE, duration: 0.25 }}
                    >
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold flex-shrink-0"
                        style={{ backgroundColor: `${sc}18`, color: sc }}>
                        {(inc?.severity ?? 'N/A').toUpperCase()}
                      </span>
                      <span className="text-gray-300 text-xs font-mono flex-1 truncate capitalize">
                        {String(inc?.alert_type ?? '').replace(/_/g, ' ')}
                      </span>
                      <span className="text-gray-600 text-[9px] font-mono flex-shrink-0">
                        {formatTimestamp(inc?.created_at)}
                      </span>
                      <span className="text-gray-700 text-[9px] font-mono flex-shrink-0">
                        #{truncateId(inc?.id ?? inc?.incident_id)}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Prediction */}
          <div className="px-6 py-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em]">AI Prediction</p>
              <motion.button
                onClick={handlePredict}
                disabled={predLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-mono font-semibold border transition-all"
                style={{
                  backgroundColor: 'rgba(124,58,237,0.12)',
                  borderColor:     'rgba(124,58,237,0.35)',
                  color:           predLoading ? '#7C3AED80' : '#A78BFA',
                  cursor:          predLoading ? 'not-allowed' : 'pointer',
                }}
                whileHover={!predLoading ? { scale: 1.03 } : {}}
                whileTap={!predLoading ? { scale: 0.97 } : {}}
              >
                {predLoading
                  ? <><motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}><Loader2 size={12} /></motion.div> Predicting…</>
                  : <><Brain size={12} /> Run Prediction</>}
              </motion.button>
            </div>

            <AnimatePresence>
              {predError && (
                <motion.div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-lg border mb-3"
                  style={{ backgroundColor: 'rgba(255,59,92,0.08)', borderColor: 'rgba(255,59,92,0.3)' }}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <AlertTriangle size={12} className="text-[#FF3B5C]" />
                  <p className="text-[#FF3B5C] text-xs font-mono">{predError}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {prediction && prediction.prediction === null ? (
                <motion.div
                  className="rounded-xl border p-4"
                  style={{ backgroundColor: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.3)' }}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-[#22C55E]" />
                    <p className="font-mono text-xs text-[#22C55E]">No pattern detected — service metrics look stable</p>
                  </div>
                </motion.div>
              ) : prediction ? (
                <motion.div
                  className="rounded-xl border p-4 space-y-4"
                  style={{ backgroundColor: 'rgba(124,58,237,0.06)', borderColor: 'rgba(124,58,237,0.3)' }}
                  initial={{ opacity: 0, y: 8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ ease: EASE, duration: 0.3 }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <Brain size={14} className="text-[#7C3AED]" />
                       <span className="font-mono text-xs font-bold px-2 py-0.5 rounded text-[#A78BFA] bg-[#7C3AED]/20 capitalize">
                         {prediction.predicted_alert ? String(prediction.predicted_alert).replace(/_/g, ' ') : 'Predicted Alert'}
                       </span>
                    </div>
                    {prediction.confidence != null && (
                      <span className="font-mono text-xs font-bold" style={{ color: prediction.confidence >= 0.8 ? '#22C55E' : prediction.confidence >= 0.6 ? '#FF9500' : '#FF3B5C' }}>
                        {Math.round(prediction.confidence * 100)}% confidence
                      </span>
                    )}
                  </div>
                  
                  {prediction.eta_minutes != null && (
                    <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#FF9500]">
                      <Clock size={12} /> Breach in ~{prediction.eta_minutes} minutes
                    </div>
                  )}

                  {prediction.message && (
                    <p className="text-gray-300 text-xs italic leading-relaxed">{prediction.message}</p>
                  )}

                  {Array.isArray(prediction.findings) && prediction.findings.length > 0 && (
                    <ul className="space-y-1.5 pt-1">
                      {prediction.findings.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-300">
                          <span className="text-[#00D4FF] mt-0.5 flex-shrink-0">•</span> {f}
                        </li>
                      ))}
                    </ul>
                  )}

                  {Array.isArray(prediction.detection_methods) && prediction.detection_methods.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1 border-[#1C2333]">
                      {prediction.detection_methods.map((m, i) => (
                        <span key={i} className="px-2 py-0.5 rounded border border-[#1C2333] text-[9px] font-mono text-gray-400 capitalize">
                          {m.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}

                  {prediction.current_metrics && (
                    <div className="grid grid-cols-4 gap-2 pt-3 border-t border-[#1C2333]/50">
                      <MetricDetail label="CPU" value={prediction.current_metrics.cpu_pct} color={cpuColor(prediction.current_metrics.cpu_pct)} maxVal={100} unit="%" />
                      <MetricDetail label="Disk" value={prediction.current_metrics.disk_pct} color={diskColor(prediction.current_metrics.disk_pct)} maxVal={100} unit="%" />
                      <MetricDetail label="Err" value={(prediction.current_metrics.error_rate ?? 0) * 100} color={errColor(prediction.current_metrics.error_rate)} bar maxVal={10} unit="%" />
                      <MetricDetail label="Health" value={prediction.current_metrics.health} color={HEALTH_COLORS[prediction.current_metrics.health?.toLowerCase()] ?? '#9CA3AF'} bar={false} unit="" />
                    </div>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>

            {!prediction && !predLoading && !predError && (
              <p className="text-gray-600 text-xs font-mono text-center py-4">
                Run a prediction to detect future incidents before they happen
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
