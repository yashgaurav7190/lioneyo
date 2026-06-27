import axios from "axios";

// Prefer runtime-injected value (window.__ENV__) so backend URL can be changed
// without rebuilding the frontend. Fall back to build-time env var, then the local backend.
const runtimeEnv = (typeof window !== "undefined" && window.__ENV__) || {};
const hostname = typeof window !== "undefined" ? window.location.hostname : "";
const defaultBackendUrl =
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
    ? "http://localhost:4000"
    : typeof window !== "undefined"
      ? window.location.origin
      : "";
const BACKEND_URL =
  runtimeEnv.REACT_APP_BACKEND_URL ||
  process.env.REACT_APP_BACKEND_URL ||
  defaultBackendUrl;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("lioneyo_admin_token");
  if (token && cfg.url?.includes("/admin"))
    cfg.headers.Authorization = `Bearer ${token}`;
  const userToken = localStorage.getItem("lioneyo_user_token");
  if (userToken && !cfg.url?.includes("/admin"))
    cfg.headers.Authorization = `Bearer ${userToken}`;
  return cfg;
});

export default api;
