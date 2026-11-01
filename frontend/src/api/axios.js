import axios from "axios";

const configuredApiUrl = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
const BASE_URL = configuredApiUrl.endsWith("/api/v1") ? configuredApiUrl : `${configuredApiUrl}/api/v1`;


let accessToken = null;
export const setAccessToken = (token) => { accessToken = typeof token === "string" && token ? token : null; };
export const getAccessToken = () => accessToken;

const API = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
});

API.interceptors.request.use((req) => {
  if (accessToken) req.headers.Authorization = `Bearer ${accessToken}`;
  else if (req.headers?.Authorization) delete req.headers.Authorization;


  const activeProjectId = localStorage.getItem("flagpilot_active_project_id");
  if (activeProjectId) req.headers["x-flagpilot-project-id"] = activeProjectId;
  else if (req.headers?.["x-flagpilot-project-id"]) delete req.headers["x-flagpilot-project-id"];


  const url = String(req.url || "");
  if (url.endsWith("/feature-flags/evaluate") || url.endsWith("/analytics/track")) {
    let body = req.data;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const environment = body?.environment === "prod" ? "prod" : "dev";
    const clientKey = localStorage.getItem(`flagpilot_client_key_${environment}`);
    if (clientKey) req.headers["x-flagpilot-client-key"] = clientKey;
  }
  return req;
});

let refreshPromise = null;

const doRefresh = async () => {
  try {
    const res = await axios.post(`${BASE_URL}/auth/refresh-token`, {}, { withCredentials: true });
    const newAccessToken = res.data?.data?.accessToken;
    if (typeof newAccessToken !== "string" || !newAccessToken) {
      setAccessToken(null);
      return null;
    }
    setAccessToken(newAccessToken);
    return newAccessToken;
  } catch {
    setAccessToken(null);
    return null;
  }
};

const requestRefresh = () => {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
};


export const restoreSession = () => requestRefresh();

API.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { response, config } = error;
    if (!response) return Promise.reject(error);

    const isAuthEndpoint = config?.url?.includes("/auth/login")
      || config?.url?.includes("/auth/register")
      || config?.url?.includes("/auth/refresh-token")
      || config?.url?.includes("/auth/logout");

    if (response.status === 401 && !config?._retried && !isAuthEndpoint) {
      config._retried = true;
      const newToken = await requestRefresh();
      if (newToken) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${newToken}`;
        return API(config);
      }

      setAccessToken(null);
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export const getErrorMessage = (err, fallback = "Something went wrong") => {
  if (!err?.response) return "Network error - request could not reach the server";
  const { status, data } = err.response;
  if (data?.message) return data.message;
  switch (status) {
    case 400: return "Invalid request";
    case 401: return "Your session has expired. Please log in again.";
    case 403: return "You don't have permission to do that";
    case 404: return "Not found";
    case 413: return "Request body is too large";
    case 429: return "Too many requests. Try again later.";
    case 500: return "Server error - please try again";
    default: return fallback;
  }
};

export default API;
