import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../config/api';

const MOCK_DATA = {
  total_incidents: 142,
  resolved: 118,
  pending: 12,
  escalated: 3,
  avg_resolution_mins: 4.7,
  mttr_formatted: '4m 42s',
  alerts_by_severity: { critical: 8, high: 34, medium: 67, low: 33 },
  alerts_by_type: { high_cpu: 28, disk_full: 19, memory_leak: 15, network_latency: 22, service_down: 8 },
  automation_rate_pct: 83.1,
  incidents_last_hour: 7,
  pending_review: 4,
  learning_updates: [],
  chronic_services: [],
};

const REFETCH_INTERVAL_MS = 30000;

export default function useDashboardStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const abortControllerRef = useRef(null);

  const fetchStats = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading(true);
    setError(null);

    try {
      const { data } = await api.get('/api/dashboard/stats', { signal });
      if (!signal.aborted) {
        setStats(data ?? MOCK_DATA);
        setError(null);
      }
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') return;
      console.warn('[useDashboardStats] API unavailable, using mock', e);
      setStats(MOCK_DATA);
      setError(e?.response?.data?.detail ?? e.message ?? 'Failed to fetch dashboard stats');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let intervalId;
    const init = setTimeout(() => {
      fetchStats();
      intervalId = setInterval(fetchStats, REFETCH_INTERVAL_MS);
    }, 500);

    return () => {
      clearTimeout(init);
      if (intervalId) clearInterval(intervalId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}
