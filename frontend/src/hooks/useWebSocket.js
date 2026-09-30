import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_URL } from '../config/api';

const MAX_BACKOFF_MS = 30000;

export default function useWebSocket(onMessage) {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectIn, setReconnectIn] = useState(0);

  const socketRef = useRef(null);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const unmountedRef = useRef(false);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (unmountedRef.current) return;

    clearTimers();

    const ws = new WebSocket(WS_URL);
    socketRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) return;
      console.info('[useWebSocket] Connected to', WS_URL);
      setConnected(true);
      setReconnecting(false);
      setReconnectIn(0);
      retryCountRef.current = 0;
    };

    ws.onmessage = (event) => {
      if (unmountedRef.current) return;
      try {
        const parsed = JSON.parse(event.data);
        onMessageRef.current?.(parsed);
      } catch {
        onMessageRef.current?.(event.data);
      }
    };

    ws.onclose = (event) => {
      if (unmountedRef.current) return;
      console.info('[useWebSocket] Disconnected. Code:', event.code);
      setConnected(false);

      const delayMs = Math.min(
        1000 * Math.pow(2, retryCountRef.current),
        MAX_BACKOFF_MS
      );
      retryCountRef.current += 1;

      setReconnecting(true);
      setReconnectIn(Math.round(delayMs / 1000));

      let remaining = Math.round(delayMs / 1000);
      countdownTimerRef.current = setInterval(() => {
        remaining -= 1;
        if (unmountedRef.current) {
          clearInterval(countdownTimerRef.current);
          return;
        }
        setReconnectIn(remaining);
        if (remaining <= 0) clearInterval(countdownTimerRef.current);
      }, 1000);

      console.info(`[useWebSocket] Reconnecting in ${Math.round(delayMs / 1000)}s (attempt ${retryCountRef.current})`);
      reconnectTimerRef.current = setTimeout(connect, delayMs);
    };

    ws.onerror = () => {
      if (unmountedRef.current) return;
      console.info('[useWebSocket] Connection encountered an error, will attempt reconnect');
      ws.close();
    };
  }, [clearTimers]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      clearTimers();
      if (socketRef.current) {
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        socketRef.current.onmessage = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect, clearTimers]);

  return { connected, reconnecting, reconnectIn };
}
