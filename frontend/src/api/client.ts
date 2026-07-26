import axios from "axios";

const BASE = import.meta.env.VITE_API_URL ?? "/api/v1";

export const apiClient = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
  timeout: 15_000,
});

// ── Request: attach access token ──────────────────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Response: auto-refresh on 401 ────────────────────────────────────────────
let isRefreshing = false;
let queue: Array<(token: string) => void> = [];
let hasRedirected = false; // prevent redirect loop

apiClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;

    // Skip retry for auth endpoints themselves to avoid loops
    const isAuthEndpoint = original?.url?.includes("/auth/");
    if (isAuthEndpoint) {
      return Promise.reject(err);
    }

    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(apiClient(original));
          });
        });
      }

      isRefreshing = true;
      const rt = localStorage.getItem("refreshToken");

      if (!rt) {
        isRefreshing = false;
        clearAuth();
        return Promise.reject(err);
      }

      try {
        const { data } = await axios.post(`${BASE}/auth/refresh`, { refreshToken: rt });
        const { accessToken, refreshToken } = data.data as {
          accessToken: string; refreshToken: string;
        };
        localStorage.setItem("accessToken",  accessToken);
        localStorage.setItem("refreshToken", refreshToken);
        queue.forEach((cb) => cb(accessToken));
        queue = [];
        original.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(original);
      } catch {
        queue = [];
        clearAuth();
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(err);
  }
);

function clearAuth() {
  // Prevent multiple redirects
  if (hasRedirected) return;
  hasRedirected = true;

  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");

  // Clear Zustand persisted auth store
  try {
    const stored = localStorage.getItem("lv-auth");
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.state.isAuthenticated = false;
      parsed.state.accessToken     = null;
      parsed.state.refreshToken    = null;
      parsed.state.user            = null;
      localStorage.setItem("lv-auth", JSON.stringify(parsed));
    }
  } catch {}

  // Use React Router instead of hard reload to avoid loop
  // Small delay to let current request settle
  setTimeout(() => {
    hasRedirected = false;
    window.location.replace("/login");
  }, 100);
}

export default apiClient;