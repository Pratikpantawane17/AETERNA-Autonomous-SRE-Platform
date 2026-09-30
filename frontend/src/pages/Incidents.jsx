import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Filter, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  RefreshCw, Download, AlertTriangle, CheckSquare, Square, Zap,
  ArrowUpDown, ArrowUp, ArrowDown, Activity,
} from 'lucide-react';
import api, { WS_URL } from '../config/api';
import IncidentDrawer from '../components/incidents/IncidentDrawer';
import { useSystem } from '../context/SystemContext';
import { formatTimestamp, truncateId } from '../utils/formatters';
import { SEVERITY_COLORS, STATUS_COLORS } from '../config/constants';

const EASE = [0.25, 0.46, 0.45, 0.94];
const PAGE_SIZE = 25;

// ─── MOCK DATA ────────────────────────────────────────────────────────────────
const T = (m) => new Date(Date.now() - m * 60000).toISOString();
const ALERT_TYPES = ['cpu_spike','memory_leak','disk_full','network_latency','high_error_rate','pod_crash_loop','service_down','db_connection_pool','ssl_expiry','deployment_failed'];
const SERVICES    = ['payment-service','auth-service','api-gateway','db-primary','cache-layer','notification-svc','order-service','ml-inference'];
const SEVERITIES  = ['critical','high','medium','low'];
const STATUSES    = ['new','processing','awaiting_review','resolved','escalated'];
const MODES       = ['AUTO','REVIEW','ESCALATE'];
const ACTIONS     = ['scale_service','restart_service','cleanup_logs','reroute_traffic','circuit_break','escalate'];

const MOCK_INCIDENTS = Array.from({ length: 68 }, (_, i) => ({
  id:         `INC-${String(i + 1).padStart(4, '0')}`,
  service:    SERVICES[i % SERVICES.length],
  alert_type: ALERT_TYPES[i % ALERT_TYPES.length],
  severity:   SEVERITIES[i % 4],
  status:     STATUSES[i % 5],
  is_predictive: i % 7 === 0,
  confidence: 0.45 + Math.random() * 0.55,
  created_at: T(i * 22),
  triage_result: {
    autonomy_mode: MODES[i % 3],
    recommended_action: ACTIONS[i % ACTIONS.length],
    why: { final_confidence: 0.45 + Math.random() * 0.55 },
  },
}));

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const str = (v) => (v != null ? String(v) : '');
const cap = (v) => str(v).replace(/_/g, ' ');

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_LABELS  = {
  new: 'New', processing: 'Processing', awaiting_review: 'Awaiting Review',
  resolved: 'Resolved', escalated: 'Escalated',
};
const MODE_COLORS = { AUTO: '#22C55E', REVIEW: '#FF9500', ESCALATE: '#FF3B5C' };
const CONF_COLOR  = (c) => c >= 0.85 ? '#22C55E' : c >= 0.6 ? '#FF9500' : '#FF3B5C';

const DATE_RANGES = [
  { label: 'Today',      value: 'today',   mins: 1440   },
  { label: 'Last 7d',   value: '7d',      mins: 10080  },
  { label: 'Last 30d',  value: '30d',     mins: 43200  },
  { label: 'All time',  value: 'all',     mins: Infinity },
];

// Download helper
function downloadCsv(rows) {
  const header = 'id,service,alert_type,severity,status,autonomy_mode,confidence,created_at';
  const lines  = rows.map(r =>
    [r.id, r.service, r.alert_type, r.severity, r.status,
     r.triage_result?.autonomy_mode ?? '', (r.confidence ?? 0).toFixed(3), r.created_at]
    .map(v => `"${str(v).replace(/"/g, '""')}"`).join(',')
  );
  const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `incidents-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── SORT HEADER ─────────────────────────────────────────────────────────────
function SortTh({ label, col, sortCol, sortDir, onSort, className = '' }) {
  const active = sortCol === col;
  return (
    <th
      className={`px-3 py-2.5 text-left text-[9px] font-mono uppercase tracking-wider cursor-pointer select-none hover:text-gray-300 transition-colors ${className}`}
      style={{ color: active ? '#00D4FF' : '#6B7280' }}
      onClick={() => onSort(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active
          ? (sortDir === 'asc' ? <ArrowUp size={9} /> : <ArrowDown size={9} />)
          : <ArrowUpDown size={9} className="opacity-30" />}
      </span>
    </th>
  );
}

// ─── SKELETON ROW ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="animate-pulse border-b border-[#1C2333]">
      {[40, 60, 80, 100, 80, 70, 60, 55, 55].map((w, i) => (
        <td key={i} className="px-3 py-3">
          <div className="skeleton h-3 rounded" style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ─── STAT PILLS ───────────────────────────────────────────────────────────────
function StatPills({ incidents, onStatusFilter, activeStatuses }) {
  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = incidents.filter(i => i?.status === s).length;
    return acc;
  }, {});
  const colors = { new: '#00D4FF', processing: '#FF9500', awaiting_review: '#7C3AED', resolved: '#22C55E', escalated: '#FF3B5C' };

  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUSES.map(s => {
        const c = colors[s] ?? '#9CA3AF';
        const active = activeStatuses.includes(s);
        return (
          <motion.button key={s}
            onClick={() => onStatusFilter(s)}
            className="px-2.5 py-1 rounded-full text-[9px] font-mono font-bold border transition-all"
            style={{
              backgroundColor: active ? `${c}18` : 'transparent',
              borderColor:     active ? `${c}50` : '#1C2333',
              color:           active ? c : '#6B7280',
            }}
            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            {counts[s]} {STATUS_LABELS[s] ?? s}
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function Incidents() {
  // ── Data & WS ─────────────────────────────────────────────────────────────
  const [incidents, setIncidents]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [newCount, setNewCount]     = useState(0);
  const [flashIds, setFlashIds]     = useState(new Set());
  const abortRef                    = useRef(null);
  const wsRef                       = useRef(null);
  const listRef                     = useRef(null);
  const { subscribe }               = useSystem();

  // ── Filters ───────────────────────────────────────────────────────────────
  const [search, setSearch]             = useState('');
  const [severities, setSeverities]     = useState([]);      // [] = all
  const [statuses, setStatuses]         = useState([]);
  const [modes, setModes]               = useState([]);
  const [predictiveOnly, setPredictive] = useState(false);
  const [dateRange, setDateRange]       = useState('all');

  // ── Sort & page ───────────────────────────────────────────────────────────
  const [sortCol, setSortCol]   = useState('created_at');
  const [sortDir, setSortDir]   = useState('desc');
  const [page, setPage]         = useState(0);

  // ── Drawer ────────────────────────────────────────────────────────────────
  const [drawerIncidentId, setDrawerIncidentId] = useState(null);

  // ── Selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState(new Set());
  const [focusIdx, setFocusIdx] = useState(-1);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true); setError(null); setPage(0); setNewCount(0);

    api.get('/api/incidents', { signal: abortRef.current.signal })
      .then(({ data }) => {
        setIncidents(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[Incidents] API unavailable, using mock', e);
        setIncidents(MOCK_INCIDENTS);
        setError('Live data unavailable — showing mock'); setLoading(false);
      });
  }, []);

  const dataLoadedRef = useRef(false);

  useEffect(() => {
    // Skip refetch if data already loaded and dateRange hasn't changed
    if (dataLoadedRef.current && incidents.length > 0) return;
    fetch();
    return () => { abortRef.current?.abort(); };
  }, [fetch, dateRange]); // dateRange triggers forced refetch

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return subscribe('*', (msg) => {
      const type = msg?.type ?? msg?.event_type;
      const inc  = msg?.data ?? msg?.payload ?? {};

      const flashFor = (id) => {
        setFlashIds(p => new Set([...p, id]));
        setTimeout(() => setFlashIds(p => { const n = new Set(p); n.delete(id); return n; }), 1500);
      };

      if (type === 'INCIDENT_CREATED') {
        const atBottom = !listRef.current || listRef.current.scrollTop < 60;
        if (atBottom) {
          setIncidents(p => [inc, ...p]);
          flashFor(inc?.id);
        } else {
          setNewCount(c => c + 1);
        }
      } else if (type === 'INCIDENT_UPDATED' || type === 'INCIDENT_RESOLVED') {
        setIncidents(p => p.map(i => (i?.id === inc?.id ? { ...i, ...inc } : i)));
        flashFor(inc?.id);
      }
    });
  }, [subscribe]);

  // ── Keyboard nav ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (drawerIncidentId) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx(i => Math.min(i + 1, visible.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && focusIdx >= 0) {
        const inc = visible[focusIdx];
        if (inc?.id) setDrawerIncidentId(str(inc.id));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }); // runs each render to keep visible in scope

  // ── Filter + sort + page logic ────────────────────────────────────────────
  const cutoff = useMemo(() => {
    const range = DATE_RANGES.find(r => r.value === dateRange);
    if (!range || range.mins === Infinity) return null;
    return new Date(Date.now() - range.mins * 60000);
  }, [dateRange]);

  const filtered = useMemo(() => {
    const q = typeof search === 'string' ? search.toLowerCase().trim() : '';
    return incidents.filter(inc => {
      if (q && ![str(inc?.id), str(inc?.service), str(inc?.alert_type)].some(f => typeof f === 'string' && f.toLowerCase().includes(q))) return false;
      if (severities.length && !severities.includes(typeof inc?.severity === 'string' ? inc.severity.toLowerCase() : '')) return false;
      if (statuses.length  && !statuses.includes(inc?.status ?? '')) return false;
      if (modes.length     && !modes.includes(inc?.triage_result?.autonomy_mode ?? '')) return false;
      if (predictiveOnly   && !inc?.is_predictive) return false;
      if (cutoff && inc?.created_at && new Date(inc.created_at) < cutoff) return false;
      return true;
    });
  }, [incidents, search, severities, statuses, modes, predictiveOnly, cutoff]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av, bv;
      if (sortCol === 'severity')    { av = SEVERITY_ORDER[a?.severity] ?? 99; bv = SEVERITY_ORDER[b?.severity] ?? 99; }
      else if (sortCol === 'confidence') { av = a?.confidence ?? 0; bv = b?.confidence ?? 0; }
      else { av = str(a?.[sortCol] ?? ''); bv = str(b?.[sortCol] ?? ''); }
      const cmp = typeof av === 'number' ? av - bv : av.localeCompare(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const visible    = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir(col === 'created_at' ? 'desc' : 'asc'); }
    setPage(0);
  };

  const toggleSeverity = (s) => { setSeverities(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]); setPage(0); };
  const toggleStatus   = (s) => { setStatuses(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]); setPage(0); };
  const toggleMode     = (m) => { setModes(p => p.includes(m) ? p.filter(x => x !== m) : [...p, m]); setPage(0); };

  const clearAll = () => {
    setSearch(''); setSeverities([]); setStatuses([]); setModes([]);
    setPredictive(false); setDateRange('all'); setPage(0);
  };
  const activeFilterCount = search.length > 0 ? 1 : 0
    + severities.length + statuses.length + modes.length
    + (predictiveOnly ? 1 : 0)
    + (dateRange !== 'all' ? 1 : 0);

  // Selection
  const allPageSelected = visible.length > 0 && visible.every(i => selected.has(i?.id));
  const toggleAll = () => {
    if (allPageSelected) setSelected(p => { const n = new Set(p); visible.forEach(i => n.delete(i?.id)); return n; });
    else setSelected(p => { const n = new Set(p); visible.forEach(i => i?.id && n.add(i.id)); return n; });
  };
  const toggleRow = (id) => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedRows = incidents.filter(i => selected.has(i?.id));

  const chip = `flex-shrink-0 px-2.5 py-1 rounded-full text-[9px] font-mono font-semibold border cursor-pointer select-none transition-all`;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: '#080B14' }}>

      {/* ── Top: filter bar ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b border-[#1C2333] px-4 py-3 space-y-2.5">

        {/* Row 1: search + date + refresh */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-40">
            <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" />
            <input type="text" value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search ID, service, alert type…"
              className="w-full bg-[#0D1117] border border-[#1C2333] text-gray-200 text-xs font-mono rounded-lg pl-8 pr-3 py-2 placeholder-gray-700 focus:outline-none focus:border-[#00D4FF]/40 transition-colors"
            />
          </div>

          {/* Date range */}
          <div className="flex gap-1">
            {DATE_RANGES.map(r => (
              <motion.button key={r.value}
                onClick={() => { setDateRange(r.value); setPage(0); }}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-mono border transition-all"
                style={{
                  backgroundColor: dateRange === r.value ? 'rgba(0,212,255,0.1)' : 'transparent',
                  borderColor:     dateRange === r.value ? 'rgba(0,212,255,0.4)' : '#1C2333',
                  color:           dateRange === r.value ? '#00D4FF' : '#6B7280',
                }}
                whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                {r.label}
              </motion.button>
            ))}
          </div>

          <motion.button onClick={fetch}
            className="p-2 rounded-lg border border-[#1C2333] text-gray-600 hover:text-[#00D4FF] hover:border-[#00D4FF]/30 transition-colors"
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95, rotate: -25 }}>
            <RefreshCw size={12} />
          </motion.button>
        </div>

        {/* Row 2: severity + status + mode + predictive chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] font-mono text-gray-700 uppercase mr-1">Severity:</span>
          {SEVERITIES.map(s => {
            const c = SEVERITY_COLORS[s] ?? '#9CA3AF';
            const on = severities.includes(s);
            return (
              <span key={s} onClick={() => toggleSeverity(s)}
                className={chip}
                style={{ backgroundColor: on ? `${c}18` : 'transparent', borderColor: on ? `${c}50` : '#1C2333', color: on ? c : '#6B7280' }}>
                {s.toUpperCase()}
              </span>
            );
          })}

          <span className="text-[9px] font-mono text-gray-700 uppercase ml-2 mr-1">Mode:</span>
          {MODES.map(m => {
            const c = MODE_COLORS[m] ?? '#9CA3AF';
            const on = modes.includes(m);
            return (
              <span key={m} onClick={() => toggleMode(m)}
                className={chip}
                style={{ backgroundColor: on ? `${c}18` : 'transparent', borderColor: on ? `${c}50` : '#1C2333', color: on ? c : '#6B7280' }}>
                {m}
              </span>
            );
          })}

          <span
            onClick={() => { setPredictive(v => !v); setPage(0); }}
            className={chip + ' ml-2'}
            style={{
              backgroundColor: predictiveOnly ? 'rgba(124,58,237,0.15)' : 'transparent',
              borderColor:     predictiveOnly ? 'rgba(124,58,237,0.45)' : '#1C2333',
              color:           predictiveOnly ? '#A78BFA' : '#6B7280',
            }}>
            🔮 Predictive Only
          </span>

          {activeFilterCount > 0 && (
            <motion.button onClick={clearAll}
              className="ml-auto flex items-center gap-1 text-[10px] font-mono text-gray-600 hover:text-[#FF3B5C] transition-colors"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.03 }}>
              <X size={10} /> Clear all ({activeFilterCount})
            </motion.button>
          )}
        </div>

        {/* Row 3: stat pills */}
        <StatPills
          incidents={filtered}
          onStatusFilter={(s) => { toggleStatus(s); }}
          activeStatuses={statuses}
        />
      </div>

      {/* ── New incidents toast ───────────────────────────────────────────── */}
      <AnimatePresence>
        {newCount > 0 && (
          <motion.button
            className="flex-shrink-0 w-full flex items-center justify-center gap-2 py-2 text-[11px] font-mono font-semibold"
            style={{ backgroundColor: 'rgba(0,212,255,0.1)', color: '#00D4FF' }}
            onClick={fetch}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.2 }}>
            <Zap size={12} /> {newCount} new incident{newCount > 1 ? 's' : ''} — click to refresh
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="flex-shrink-0 flex items-center gap-2 px-4 py-2 text-[10px] font-mono"
            style={{ backgroundColor: 'rgba(255,149,0,0.08)', color: '#FF9500', borderBottom: '1px solid rgba(255,149,0,0.2)' }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}>
            <AlertTriangle size={11} /> {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main: table ──────────────────────────────────────────────────── */}
      <div ref={listRef} className="flex-1 overflow-auto">
        {loading ? (
          <table className="w-full"><tbody>
            {Array.from({ length: 12 }).map((_, i) => <SkeletonRow key={i} />)}
          </tbody></table>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24">
            <motion.div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)' }}
              animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 3, repeat: Infinity }}>
              <Activity size={30} className="text-gray-600" />
            </motion.div>
            <p className="text-gray-500 text-sm font-mono">No incidents match your filters</p>
            <motion.button onClick={clearAll}
              className="flex items-center gap-1.5 text-xs font-mono text-[#00D4FF] hover:underline"
              whileHover={{ scale: 1.03 }}>
              <X size={11} /> Clear filters
            </motion.button>
          </div>
        ) : (
          <table className="w-full border-collapse min-w-[860px]">
            <thead className="sticky top-0 z-10" style={{ backgroundColor: '#080B14' }}>
              <tr className="border-b border-[#1C2333]">
                <th className="w-10 px-3 py-2.5">
                  <motion.div onClick={toggleAll}
                    className="cursor-pointer text-gray-600 hover:text-[#00D4FF] transition-colors"
                    whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                    {allPageSelected
                      ? <CheckSquare size={13} className="text-[#00D4FF]" />
                      : <Square size={13} />}
                  </motion.div>
                </th>
                {[
                  { label: 'Severity',   col: 'severity'    },
                  { label: 'Status',     col: 'status'      },
                  { label: 'Service',    col: 'service'      },
                  { label: 'Alert Type', col: 'alert_type'  },
                  { label: 'Action',     col: null           },
                  { label: 'Confidence', col: 'confidence'  },
                  { label: 'Mode',       col: null           },
                  { label: 'Time',       col: 'created_at'  },
                ].map(({ label, col }) =>
                  col
                    ? <SortTh key={label} label={label} col={col} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    : <th key={label} className="px-3 py-2.5 text-left text-[9px] font-mono text-gray-600 uppercase tracking-wider">{label}</th>
                )}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {visible.map((inc, i) => {
                  const sev   = typeof inc?.severity === 'string' ? inc.severity.toLowerCase() : 'low';
                  const sc    = SEVERITY_COLORS[sev] ?? '#9CA3AF';
                  const stc   = STATUS_COLORS[inc?.status] ?? '#9CA3AF';
                  const conf  = inc?.confidence ?? inc?.triage_result?.why?.final_confidence ?? 0;
                  const cc    = CONF_COLOR(conf);
                  const mode  = inc?.triage_result?.autonomy_mode ?? '—';
                  const mc    = MODE_COLORS[mode] ?? '#9CA3AF';
                  const isSel = selected.has(inc?.id);
                  const isFlash = flashIds.has(inc?.id);
                  const isFocus = focusIdx === i;
                  const incId = str(inc?.id ?? '');

                  return (
                    <motion.tr
                      key={incId || i}
                      layout
                      className="border-b border-[#1C2333] cursor-pointer transition-colors relative"
                      style={{
                        backgroundColor: isFlash
                          ? 'rgba(0,212,255,0.08)'
                          : isSel
                          ? 'rgba(0,212,255,0.04)'
                          : isFocus
                          ? 'rgba(255,255,255,0.02)'
                          : 'transparent',
                        outline: isFocus ? '1px solid rgba(0,212,255,0.25)' : 'none',
                        outlineOffset: -1,
                      }}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ delay: Math.min(i * 0.015, 0.25), ease: EASE, duration: 0.2 }}
                      onClick={(e) => {
                        if (e.target.closest('[data-checkbox]')) return;
                        setDrawerIncidentId(incId);
                        setFocusIdx(i);
                      }}
                      whileHover={{ backgroundColor: isSel ? 'rgba(0,212,255,0.07)' : 'rgba(255,255,255,0.025)' }}
                    >
                      {/* Checkbox */}
                      <td className="w-10 px-3 py-3" data-checkbox onClick={e => { e.stopPropagation(); if (incId) toggleRow(incId); }}>
                        <motion.div className="cursor-pointer text-gray-600 hover:text-[#00D4FF] transition-colors"
                          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                          {isSel ? <CheckSquare size={13} className="text-[#00D4FF]" /> : <Square size={13} />}
                        </motion.div>
                      </td>

                      {/* Severity */}
                      <td className="px-3 py-3">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase"
                          style={{ backgroundColor: `${sc}18`, color: sc }}>
                          {sev}
                        </span>
                        {inc?.is_predictive && <span className="ml-1 text-[8px] font-mono text-[#A78BFA]">🔮</span>}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-3">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono capitalize"
                          style={{ backgroundColor: `${stc}12`, color: stc }}>
                          {cap(inc?.status ?? '—')}
                        </span>
                      </td>

                      {/* Service */}
                      <td className="px-3 py-3 font-mono text-[11px] text-gray-300 max-w-[120px] truncate">
                        {inc?.service ?? '—'}
                      </td>

                      {/* Alert Type */}
                      <td className="px-3 py-3 font-mono text-[11px] text-gray-400 capitalize max-w-[130px] truncate">
                        {cap(inc?.alert_type)}
                      </td>

                      {/* Action */}
                      <td className="px-3 py-3 font-mono text-[11px] text-gray-600 capitalize max-w-[120px] truncate">
                        {cap(inc?.triage_result?.recommended_action ?? '—')}
                      </td>

                      {/* Confidence */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5 w-20">
                          <div className="flex-1 h-1.5 bg-[#1C2333] rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(conf * 100).toFixed(0)}%`, backgroundColor: cc }} />
                          </div>
                          <span className="text-[9px] font-mono tabular-nums" style={{ color: cc }}>
                            {(conf * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>

                      {/* Mode */}
                      <td className="px-3 py-3">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold"
                          style={{ backgroundColor: `${mc}12`, color: mc }}>
                          {mode}
                        </span>
                      </td>

                      {/* Time */}
                      <td className="px-3 py-3 text-[10px] font-mono text-gray-600 whitespace-nowrap">
                        {formatTimestamp(inc?.created_at)}
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </div>

      {/* ── Bottom bar: count + pagination ───────────────────────────────── */}
      {!loading && sorted.length > 0 && (
        <div className="flex-shrink-0 border-t border-[#1C2333] px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-[10px] font-mono text-gray-600">
            Showing <span className="text-white">{visible.length}</span> of <span className="text-white">{sorted.length}</span> incidents
          </span>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <motion.button onClick={() => setPage(0)} disabled={page === 0}
                className="p-1.5 rounded-lg border border-[#1C2333] text-gray-700 disabled:opacity-30 hover:text-white hover:border-[#00D4FF]/30 transition-colors"
                whileHover={page > 0 ? { scale: 1.05 } : {}}>
                <ChevronLeft size={12} />
              </motion.button>

              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const base = Math.max(0, Math.min(page - 3, totalPages - 7));
                const pg = base + i;
                if (pg >= totalPages) return null;
                return (
                  <motion.button key={pg} onClick={() => setPage(pg)}
                    className="w-6 h-6 rounded text-[10px] font-mono border transition-all"
                    style={{
                      backgroundColor: pg === page ? 'rgba(0,212,255,0.15)' : 'transparent',
                      borderColor:     pg === page ? 'rgba(0,212,255,0.4)'  : '#1C2333',
                      color:           pg === page ? '#00D4FF' : '#6B7280',
                    }}
                    whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                    {pg + 1}
                  </motion.button>
                );
              })}

              <motion.button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg border border-[#1C2333] text-gray-700 disabled:opacity-30 hover:text-white hover:border-[#00D4FF]/30 transition-colors"
                whileHover={page < totalPages - 1 ? { scale: 1.05 } : {}}>
                <ChevronRight size={12} />
              </motion.button>
            </div>
          )}
        </div>
      )}

      {/* ── Batch action bar ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-t border-[#1C2333]"
            style={{ backgroundColor: 'rgba(0,212,255,0.07)' }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.2 }}>
            <span className="text-[11px] font-mono text-[#00D4FF] font-bold">
              {selected.size} selected
            </span>
            <motion.button
              onClick={() => downloadCsv(selectedRows)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-mono font-semibold"
              style={{ backgroundColor: 'rgba(0,212,255,0.12)', color: '#00D4FF', borderColor: 'rgba(0,212,255,0.35)' }}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Download size={12} /> Export CSV
            </motion.button>
            <motion.button onClick={() => setSelected(new Set())}
              className="ml-auto text-gray-600 hover:text-white transition-colors"
              whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
              <X size={14} />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Incident Drawer ───────────────────────────────────────────────── */}
      <IncidentDrawer
        incidentId={drawerIncidentId}
        onClose={() => setDrawerIncidentId(null)}
      />
    </div>
  );
}