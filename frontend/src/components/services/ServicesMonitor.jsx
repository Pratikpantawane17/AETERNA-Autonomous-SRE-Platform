import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, AlertTriangle, CheckCircle2, XCircle,
  RefreshCw, Cpu, HardDrive, MemoryStick, Box,
  Server, RotateCcw, Loader2,
} from 'lucide-react';
import api from '../../config/api';
import { formatTimestamp } from '../../utils/formatters';
import { useSystem } from '../../context/SystemContext';

const EASE = [0.25, 0.46, 0.45, 0.94];

// K8s backend on port 8001
const K8S_BASE = 'http://localhost:8001';
const K8S_API_KEY = import.meta.env.VITE_AETERNA_API_KEY || 'cummins-demo-key';

async function k8sFetch(path) {
  try {
    const { data } = await api.get(path);
    return data;
  } catch (e) {
    const resp = await fetch(`${K8S_BASE}${path}`, {
      headers: { 'X-Api-Key': K8S_API_KEY },
    });
    if (!resp.ok) throw new Error(`K8s API ${resp.status}`);
    return resp.json();
  }
}

// ─── HEALTH CONFIG ───────────────────────────────────────────────────────────
const PHASE_CONFIG = {
  Running:    { color: '#22C55E', label: 'RUNNING',    bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.35)' },
  Succeeded:  { color: '#22C55E', label: 'SUCCEEDED',  bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.35)' },
  Pending:    { color: '#FF9500', label: 'PENDING',    bg: 'rgba(255,149,0,0.1)',   border: 'rgba(255,149,0,0.35)' },
  Failed:     { color: '#FF3B5C', label: 'FAILED',     bg: 'rgba(255,59,92,0.1)',   border: 'rgba(255,59,92,0.35)' },
  Unknown:    { color: '#9CA3AF', label: 'UNKNOWN',    bg: 'rgba(156,163,175,0.1)', border: 'rgba(156,163,175,0.35)' },
};

const phaseCfg = (phase) => PHASE_CONFIG[phase] ?? PHASE_CONFIG.Unknown;

// ─── METRIC COLOR HELPERS ─────────────────────────────────────────────────────
function cpuColor(pct)  { return pct > 85 ? '#FF3B5C' : pct > 60 ? '#FF9500' : '#22C55E'; }
function memColor(pct)  { return pct > 85 ? '#FF3B5C' : pct > 60 ? '#FF9500' : '#22C55E'; }

// ─── FORMAT HELPERS ──────────────────────────────────────────────────────────
function formatCpu(millicores) {
  if (millicores >= 1000) return `${(millicores / 1000).toFixed(1)} cores`;
  return `${millicores}m`;
}

function formatMem(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} Gi`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} Mi`;
  if (bytes >= 1024)      return `${(bytes / 1024).toFixed(0)} Ki`;
  return `${bytes} B`;
}

function formatAge(seconds) {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d`;
  if (seconds >= 3600)  return `${Math.floor(seconds / 3600)}h`;
  if (seconds >= 60)    return `${Math.floor(seconds / 60)}m`;
  return `${seconds}s`;
}

// ─── METRIC BAR ──────────────────────────────────────────────────────────────
function MetricBar({ label, value = 0, color, displayValue, maxVal = 100 }) {
  const pct = Math.min(100, Math.max(0, (value / maxVal) * 100));
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center">
        <span className="text-[9px] font-mono text-gray-600 uppercase">{label}</span>
        <span className="text-[10px] font-mono font-semibold tabular-nums" style={{ color }}>
          {displayValue}
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

// ─── POD CARD ────────────────────────────────────────────────────────────────
function PodCard({ pod, metrics, flash, onClick }) {
  const cfg   = phaseCfg(pod.phase);
  const cpu   = metrics?.cpu_millicores ?? 0;
  const mem   = metrics?.memory_bytes ?? 0;
  const cpuLimit = 200; // 200m from deployment spec
  const memLimit = 256 * 1024 * 1024; // 256Mi from deployment spec
  const cpuPct = cpuLimit > 0 ? (cpu / cpuLimit) * 100 : 0;
  const memPct = memLimit > 0 ? (mem / memLimit) * 100 : 0;

  const hasRestarts = pod.restart_total > 0;
  const isUnhealthy = pod.phase === 'Failed' || pod.phase === 'Unknown';
  const isPending = pod.phase === 'Pending';

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

      {/* Restart warning banner */}
      <AnimatePresence>
        {hasRestarts && (
          <motion.div
            className="absolute top-0 left-0 right-0 flex items-center justify-center gap-1.5 py-1 text-[9px] font-mono font-bold"
            style={{ backgroundColor: 'rgba(255,149,0,0.18)', color: '#FF9500' }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ ease: EASE, duration: 0.2 }}
          >
            <RotateCcw size={9} />
            {pod.restart_total} RESTART{pod.restart_total !== 1 ? 'S' : ''}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card header */}
      <div className={`flex items-start justify-between gap-2 ${hasRestarts ? 'mt-5' : ''}`}>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{pod.name}</p>
          <p className="text-gray-600 text-[10px] font-mono truncate">{pod.namespace}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Status badge */}
          <div className="flex items-center gap-1.5">
            <motion.div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: cfg.color, boxShadow: `0 0 6px ${cfg.color}` }}
              animate={isUnhealthy || isPending ? { opacity: [1, 0.3, 1], scale: [1, 1.3, 1] } : {}}
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
        <MetricBar
          label="CPU"
          value={cpuPct}
          color={cpuColor(cpuPct)}
          displayValue={`${formatCpu(cpu)} / ${formatCpu(cpuLimit)}`}
          maxVal={100}
        />
        <MetricBar
          label="Memory"
          value={memPct}
          color={memColor(memPct)}
          displayValue={`${formatMem(mem)} / ${formatMem(memLimit)}`}
          maxVal={100}
        />

        {/* Container statuses */}
        <div className="flex items-center gap-2 flex-wrap">
          {pod.containers?.map((c) => (
            <span key={c.name} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#1C2333]"
              style={{
                color: c.ready ? '#22C55E' : '#FF3B5C',
                backgroundColor: c.ready ? 'rgba(34,197,94,0.08)' : 'rgba(255,59,92,0.08)',
              }}
            >
              {c.name}: {c.state}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <p className="text-gray-700 text-[9px] font-mono">
          Age: {formatAge(pod.age_seconds)}
        </p>
        {pod.node_name && (
          <p className="text-gray-700 text-[9px] font-mono flex items-center gap-1">
            <Server size={8} /> {pod.node_name}
          </p>
        )}
      </div>
    </motion.div>
  );
}


// ─── NODE METRICS CARD ───────────────────────────────────────────────────────
function NodeMetricsCard({ node }) {
  return (
    <motion.div
      className="rounded-xl border border-[#1C2333] p-4 bg-[#0D1117] space-y-3"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE, duration: 0.3 }}
    >
      <div className="flex items-center gap-2">
        <Server size={13} className="text-[#00D4FF]" />
        <span className="text-white font-semibold text-xs font-mono">{node.name}</span>
        <span className="text-[9px] font-mono text-gray-600 ml-auto">NODE</span>
      </div>
      <MetricBar
        label="CPU"
        value={node.cpu_pct}
        color={cpuColor(node.cpu_pct)}
        displayValue={`${node.cpu_pct.toFixed(1)}%`}
        maxVal={100}
      />
      <MetricBar
        label="Memory"
        value={node.memory_pct}
        color={memColor(node.memory_pct)}
        displayValue={`${node.memory_pct.toFixed(1)}%`}
        maxVal={100}
      />
      <div className="flex items-center gap-3 text-[9px] font-mono text-gray-600">
        <span>CPU: {formatCpu(node.cpu_millicores)} / {formatCpu(node.cpu_capacity_millicores)}</span>
        <span>Mem: {formatMem(node.memory_bytes)} / {formatMem(node.memory_capacity_bytes)}</span>
      </div>
    </motion.div>
  );
}


// ─── SUMMARY CARDS ───────────────────────────────────────────────────────────
function SummaryCard({ icon: Icon, label, value, color, subtext }) {
  return (
    <motion.div
      className="rounded-xl border border-[#1C2333] p-3 bg-[#0D1117] flex items-center gap-3"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE, duration: 0.3 }}
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div>
        <p className="text-white text-lg font-bold font-mono tabular-nums">{value}</p>
        <p className="text-gray-600 text-[9px] font-mono uppercase tracking-wider">{label}</p>
        {subtext && <p className="text-gray-700 text-[9px] font-mono">{subtext}</p>}
      </div>
    </motion.div>
  );
}


// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
const FILTERS = ['ALL', 'RUNNING', 'PENDING', 'FAILED'];

export default function ServicesMonitor({ onServiceClick }) {
  const [pods, setPods]               = useState([]);
  const [podMetrics, setPodMetrics]   = useState([]);
  const [nodeMetrics, setNodeMetrics] = useState([]);
  const [clusterInfo, setClusterInfo] = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [filter, setFilter]           = useState('ALL');
  const [flashMap, setFlashMap]       = useState({});
  const timerRef                      = useRef(null);

  // ── Fetch all K8s data ────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [podsResp, podMetResp, nodeMetResp, statusResp] = await Promise.allSettled([
        k8sFetch('/api/k8s/pods?namespace=aeterna-sample'),
        k8sFetch('/api/k8s/metrics/pods?namespace=aeterna-sample'),
        k8sFetch('/api/k8s/metrics/nodes'),
        k8sFetch('/api/k8s/status'),
      ]);

      if (podsResp.status === 'fulfilled') {
        const newPods = podsResp.value?.pods ?? [];
        // Detect changes for flash
        setPods((prev) => {
          const prevMap = Object.fromEntries(prev.map(p => [p.name, p]));
          newPods.forEach(p => {
            const old = prevMap[p.name];
            if (old && (old.phase !== p.phase || old.restart_total !== p.restart_total)) {
              setFlashMap(fm => ({ ...fm, [p.name]: true }));
              setTimeout(() => setFlashMap(fm => ({ ...fm, [p.name]: false })), 1500);
            }
          });
          return newPods;
        });
      }

      if (podMetResp.status === 'fulfilled') {
        setPodMetrics(podMetResp.value?.metrics ?? []);
      }

      if (nodeMetResp.status === 'fulfilled') {
        setNodeMetrics(nodeMetResp.value?.metrics ?? []);
      }

      if (statusResp.status === 'fulfilled') {
        setClusterInfo(statusResp.value);
      }

      setLoading(false);
    } catch (e) {
      console.warn('[ServicesMonitor] K8s API unavailable', e);
      setError('K8s data unavailable — is k8s-backend running?');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 10000);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  // ── Derived ────────────────────────────────────────────────────────────
  const metricsMap = Object.fromEntries(podMetrics.map(m => [m.name, m]));
  const running    = pods.filter(p => p.phase === 'Running').length;
  const pending    = pods.filter(p => p.phase === 'Pending').length;
  const failed     = pods.filter(p => p.phase === 'Failed' || p.phase === 'Unknown').length;
  const totalRestarts = pods.reduce((acc, p) => acc + (p.restart_total ?? 0), 0);
  const totalCpu   = podMetrics.reduce((acc, m) => acc + (m.cpu_millicores ?? 0), 0);
  const totalMem   = podMetrics.reduce((acc, m) => acc + (m.memory_bytes ?? 0), 0);

  const visible = pods.filter(p => {
    if (filter === 'ALL') return true;
    if (filter === 'FAILED') return p.phase === 'Failed' || p.phase === 'Unknown';
    return p.phase?.toUpperCase() === filter;
  });

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="skeleton h-10 w-64 rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0,1,2,3].map((i) => <div key={i} className="skeleton h-20 rounded-xl animate-pulse" />)}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0,1,2].map((i) => <div key={i} className="skeleton h-52 rounded-xl animate-pulse" />)}
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
              Kubernetes Resources
            </h1>
          </div>
          {clusterInfo && (
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-[11px] font-mono text-gray-500">
                Cluster: <span className={clusterInfo.connected ? 'text-[#22C55E]' : 'text-[#FF3B5C]'}>
                  {clusterInfo.cluster_name ?? 'unknown'}
                </span>
              </span>
              <span className="text-[11px] font-mono text-gray-500">
                Namespaces: {clusterInfo.namespaces?.join(', ')}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Error badge */}
          {error && (
            <span className="text-[10px] font-mono px-2 py-1 rounded-lg border"
              style={{ color: '#FF9500', backgroundColor: 'rgba(255,149,0,0.08)', borderColor: 'rgba(255,149,0,0.3)' }}>
              <AlertTriangle size={9} className="inline mr-1" />{error}
            </span>
          )}

          {/* Refresh */}
          <motion.button onClick={fetchData}
            className="p-2 rounded-lg border border-[#1C2333] text-gray-600 hover:text-[#00D4FF] hover:border-[#00D4FF]/30 transition-colors"
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95, rotate: -30 }}>
            <RefreshCw size={13} />
          </motion.button>

          {/* Live indicator */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#1C2333]">
            <motion.div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]"
              animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }} />
            <span className="text-[10px] font-mono text-gray-500">Live · 10s</span>
          </div>
        </div>
      </div>

      {/* ── Summary Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard icon={Box} label="Pods" value={pods.length} color="#00D4FF" />
        <SummaryCard icon={CheckCircle2} label="Running" value={running} color="#22C55E" />
        <SummaryCard icon={AlertTriangle} label="Pending" value={pending} color="#FF9500" />
        <SummaryCard icon={XCircle} label="Failed" value={failed} color="#FF3B5C" />
        <SummaryCard icon={Cpu} label="Total CPU" value={formatCpu(totalCpu)} color="#7C3AED" />
        <SummaryCard icon={MemoryStick} label="Total Mem" value={formatMem(totalMem)} color="#00D4FF" />
      </div>

      {/* ── Node Metrics ───────────────────────────────────────────── */}
      {nodeMetrics.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono text-gray-600 uppercase tracking-[0.2em]">Node Resources</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {nodeMetrics.map(node => (
              <NodeMetricsCard key={node.name} node={node} />
            ))}
          </div>
        </div>
      )}

      {/* ── Filter ───────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => {
          const isActive = filter === f;
          const col = f === 'RUNNING' ? '#22C55E' : f === 'PENDING' ? '#FF9500' : f === 'FAILED' ? '#FF3B5C' : '#00D4FF';
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

      {/* ── Pod Grid ─────────────────────────────────────────────────── */}
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
          {pods.length === 0 ? (
            <>
              <p className="text-gray-400 text-sm font-mono font-medium">No pods found in cluster</p>
              <p className="text-gray-600 text-xs font-mono">Deploy workloads to see them here</p>
            </>
          ) : (
            <p className="text-gray-500 text-sm font-mono">No {filter.toLowerCase()} pods found</p>
          )}
        </motion.div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((pod) => (
              <PodCard
                key={pod.name}
                pod={pod}
                metrics={metricsMap[pod.name]}
                flash={!!flashMap[pod.name]}
                onClick={() => onServiceClick?.(pod.name, {
                  ...pod,
                  ...metricsMap[pod.name],
                  health: pod.phase === 'Running' ? 'healthy' : pod.phase === 'Pending' ? 'degraded' : 'unhealthy',
                  cpu_pct: metricsMap[pod.name] ? (metricsMap[pod.name].cpu_millicores / 200) * 100 : 0,
                  disk_pct: 0,
                  error_rate: 0,
                  traffic_level: 'normal',
                })}
              />
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
