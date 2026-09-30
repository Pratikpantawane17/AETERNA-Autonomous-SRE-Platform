import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import api from '../config/api';
import useWebSocket from '../hooks/useWebSocket';

const SystemContext = createContext(null);

const MOCK_HEALTH = {
  status: 'healthy', version: '1.0.0', uptime_seconds: 86400, services_online: 18,
};
const MOCK_KILL_SWITCH = { kill_switch_active: false, mode: 'AUTO', updated_at: new Date().toISOString() };
const HEALTH_REFRESH_MS = 60000;
const MAX_WS_EVENTS = 50;

export function SystemProvider({ children }) {
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [systemHealth, setSystemHealth]         = useState(null);
  const [lastWsEvent, setLastWsEvent]           = useState(null);
  const [wsEvents, setWsEvents]                 = useState([]);       // last 50

  const healthAbortRef     = useRef(null);
  const killSwitchAbortRef = useRef(null);

  // ── Subscriber registry ────────────────────────────────────────────────────
  // Map<eventType|'*', Set<callback>>
  const subsRef = useRef(new Map());

  const subscribe = useCallback((eventType, cb) => {
    if (!subsRef.current.has(eventType)) {
      subsRef.current.set(eventType, new Set());
    }
    subsRef.current.get(eventType).add(cb);
    // Return unsubscribe fn
    return () => { subsRef.current.get(eventType)?.delete(cb); };
  }, []);

  // ── WS message handler ────────────────────────────────────────────────────
  const handleWsMessage = useCallback((event) => {
    if (!event || typeof event !== 'object') return;

    // Normalize event type
    const type = event.type ?? event.event_type;
    const normalized = { ...event, type, data: event.data ?? event.payload };

    setLastWsEvent(normalized);
    setWsEvents((prev) => [normalized, ...prev].slice(0, MAX_WS_EVENTS));

    // Kill switch state sync
    if (type === 'KILL_SWITCH_TOGGLED') {
      const active = event?.data?.kill_switch_active ?? event?.kill_switch_active;
      if (active !== undefined) setKillSwitchActive(!!active);
      // Persist timestamp for audit
      try { localStorage.setItem('ks_last_toggle', new Date().toISOString()); } catch { /* ignore */ }
    }

    // Dispatch to wildcard subscribers
    subsRef.current.get('*')?.forEach((cb) => { try { cb(normalized); } catch { /* ignore */ } });

    // Dispatch to type-specific subscribers
    if (type) {
      subsRef.current.get(type)?.forEach((cb) => { try { cb(normalized); } catch { /* ignore */ } });
    }
  }, []);

  const { connected: wsConnected, reconnecting, reconnectIn } = useWebSocket(handleWsMessage);

  // ── Health ────────────────────────────────────────────────────────────────
  const fetchHealth = useCallback(async () => {
    healthAbortRef.current?.abort();
    healthAbortRef.current = new AbortController();
    const { signal } = healthAbortRef.current;
    try {
      const { data } = await api.get('/health', { signal });
      if (!signal.aborted) setSystemHealth(data ?? MOCK_HEALTH);
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[SystemContext] Health unavailable, using mock', e);
      setSystemHealth(MOCK_HEALTH);
    }
  }, []);

  // ── Kill switch ───────────────────────────────────────────────────────────
  const fetchKillSwitch = useCallback(async () => {
    killSwitchAbortRef.current?.abort();
    killSwitchAbortRef.current = new AbortController();
    const { signal } = killSwitchAbortRef.current;
    try {
      const { data } = await api.get('/api/kill-switch', { signal });
      if (!signal.aborted) {
        setKillSwitchActive(data?.kill_switch_active ?? MOCK_KILL_SWITCH.kill_switch_active);
      }
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[SystemContext] Kill-switch status unavailable, using mock', e);
      setKillSwitchActive(MOCK_KILL_SWITCH.kill_switch_active);
    }
  }, []);

  const toggleKillSwitch = useCallback(async () => {
    const ctrl = new AbortController();
    try {
      const { data } = await api.post('/api/kill-switch', {}, { signal: ctrl.signal });
      setKillSwitchActive(data?.kill_switch_active ?? !killSwitchActive);
      try { localStorage.setItem('ks_last_toggle', new Date().toISOString()); } catch { /* ignore */ }
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[SystemContext] Kill-switch toggle failed', e);
      setKillSwitchActive((prev) => !prev);
    }
    return () => ctrl.abort();
  }, [killSwitchActive]);

  useEffect(() => {
    fetchHealth();
    fetchKillSwitch();
    const t = setInterval(fetchHealth, HEALTH_REFRESH_MS);
    return () => {
      clearInterval(t);
      healthAbortRef.current?.abort();
      killSwitchAbortRef.current?.abort();
    };
  }, [fetchHealth, fetchKillSwitch]);

  const value = {
    // WS
    wsConnected, reconnecting, reconnectIn,
    lastWsEvent, wsEvents,
    subscribe,
    // System
    killSwitchActive, systemHealth,
    toggleKillSwitch,
  };

  return (
    <SystemContext.Provider value={value}>
      {children}
    </SystemContext.Provider>
  );
}

export function useSystem() {
  const ctx = useContext(SystemContext);
  if (!ctx) throw new Error('useSystem must be used within a SystemProvider');
  return ctx;
}
