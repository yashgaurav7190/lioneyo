(function (window) {
  // Runtime config: can be replaced on the hosting server before serving
  window.__ENV__ = window.__ENV__ || {};

  const hostname = window.location.hostname;
  const defaultBackendUrl =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
      ? "http://localhost:4000"
      : window.location.origin;

  // Backend URL used by the frontend. If not set by the host, default to the local backend.
  window.__ENV__.REACT_APP_BACKEND_URL =
    window.__ENV__.REACT_APP_BACKEND_URL || defaultBackendUrl;
})(window);
