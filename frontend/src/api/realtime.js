import { API_BASE_URL } from "./api";
import { getAccessToken } from "./auth";

const listeners = new Set();
let socket = null;
let reconnectTimer = null;
let pingTimer = null;
let reconnectAttempt = 0;
let authenticated = false;

const notify = (event) => {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch (error) {
      console.error("Realtime event handler failed:", error);
    }
  });
};

const realtimeUrl = () => {
  if (typeof window === "undefined") return "";
  const base = new URL(API_BASE_URL || window.location.origin, window.location.origin);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const prefix = base.pathname.replace(/\/+$/, "");
  base.pathname = `${prefix}/ws/realtime`.replace(/\/+/g, "/");
  base.search = "";
  base.hash = "";
  return base.toString();
};

const clearTimers = () => {
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  if (pingTimer) window.clearInterval(pingTimer);
  reconnectTimer = null;
  pingTimer = null;
};

const scheduleReconnect = () => {
  if (!listeners.size || reconnectTimer || !getAccessToken()) return;
  const delay = Math.min(15000, 800 * 2 ** Math.min(reconnectAttempt, 4));
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
};

const connect = () => {
  if (typeof window === "undefined" || !listeners.size) return;
  if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) return;
  const token = getAccessToken();
  const url = realtimeUrl();
  if (!token || !url) return;

  clearTimers();
  authenticated = false;
  socket = new WebSocket(url);
  socket.addEventListener("open", () => {
    socket?.send(JSON.stringify({ type: "auth", token }));
  });
  socket.addEventListener("message", (message) => {
    let event;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    if (event?.type === "realtime.ready") {
      authenticated = true;
      reconnectAttempt = 0;
      notify({ type: "realtime.status", connected: true });
      pingTimer = window.setInterval(() => sendRealtime({ type: "ping" }), 25000);
    }
    notify(event);
  });
  socket.addEventListener("close", () => {
    authenticated = false;
    socket = null;
    if (pingTimer) window.clearInterval(pingTimer);
    pingTimer = null;
    notify({ type: "realtime.status", connected: false });
    scheduleReconnect();
  });
  socket.addEventListener("error", () => {
    socket?.close();
  });
};

export const subscribeRealtime = (listener) => {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearTimers();
    authenticated = false;
    socket?.close();
    socket = null;
  };
};

export const sendRealtime = (event) => {
  if (!authenticated || socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(event));
  return true;
};

export const isRealtimeConnected = () => authenticated;
