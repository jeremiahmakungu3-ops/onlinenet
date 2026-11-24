import { useCallback, useEffect, useRef, useState } from 'react';
import type { RadiusSession } from '../../packages/shared/types';
import { apiRequest } from '../services/api';

export interface UseSessionPollingOptions {
  token: string;
  initialSessions?: RadiusSession[];
  intervalMs?: number;
  enabled?: boolean;
}

export interface UseSessionPollingResult {
  sessions: RadiusSession[];
  isPolling: boolean;
  isPaused: boolean;
  pollIntervalMs: number;
  lastUpdatedAt: Date | null;
  error: string | null;
  nowMs: number;
  togglePause: () => void;
  setPollIntervalMs: (ms: number) => void;
  refreshNow: () => Promise<void>;
  disconnectSession: (sessionId: string) => Promise<void>;
}

export function useSessionPolling({
  token,
  initialSessions = [],
  intervalMs = 5000,
  enabled = true,
}: UseSessionPollingOptions): UseSessionPollingResult {
  const [sessions, setSessions] = useState<RadiusSession[]>(initialSessions);
  const [isPolling, setIsPolling] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [pollIntervalMs, setPollIntervalMs] = useState(intervalMs);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(() =>
    initialSessions.length > 0 ? new Date() : null
  );
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const requestSeqRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSessions(initialSessions);
  }, [initialSessions]);

  const fetchSessions = useCallback(async () => {
    if (!token || !enabled) return;
    const seq = ++requestSeqRef.current;
    setIsPolling(true);
    try {
      const res = await apiRequest<{ sessions: RadiusSession[]; serverTime?: string }>('/api/sessions', {
        token,
      });
      if (!mountedRef.current || seq !== requestSeqRef.current) return;
      setSessions(res.sessions);
      setLastUpdatedAt(res.serverTime ? new Date(res.serverTime) : new Date());
      setNowMs(Date.now());
      setError(null);
    } catch (err) {
      if (!mountedRef.current || seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Unable to sync live RADIUS sessions.');
    } finally {
      if (mountedRef.current && seq === requestSeqRef.current) {
        setIsPolling(false);
      }
    }
  }, [enabled, token]);

  useEffect(() => {
    if (!enabled || !token || isPaused) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchSessions();
      }
    }, pollIntervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchSessions();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, fetchSessions, isPaused, pollIntervalMs, token]);

  useEffect(() => {
    if (!enabled || isPaused) return;
    const clock = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setNowMs(Date.now());
      }
    }, 1000);
    return () => window.clearInterval(clock);
  }, [enabled, isPaused]);

  const togglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      if (!next) {
        void fetchSessions();
      }
      return next;
    });
  }, [fetchSessions]);

  const disconnectSession = useCallback(
    async (sessionId: string) => {
      await apiRequest(`/api/sessions/${sessionId}/disconnect`, { method: 'POST', token });
      await fetchSessions();
    },
    [fetchSessions, token]
  );

  return {
    sessions,
    isPolling,
    isPaused,
    pollIntervalMs,
    lastUpdatedAt,
    error,
    nowMs,
    togglePause,
    setPollIntervalMs,
    refreshNow: fetchSessions,
    disconnectSession,
  };
}
