/**
 * lib/api/client.ts
 *
 * Axios API Client with JWT Interceptor
 * ======================================
 * Features:
 *   - Base URL from NEXT_PUBLIC_API_URL env variable
 *   - Automatic Bearer token injection from localStorage
 *   - 401 response interceptor: attempts token refresh, then logs out
 *   - Request/response logging in development mode
 *   - Typed API error wrapper
 */

import axios, {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';

// ── Constants ──────────────────────────────────────────────────────────────

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/api';

const TOKEN_KEY         = 'zkfs_access_token';
const REFRESH_TOKEN_KEY = 'zkfs_refresh_token';

// ── Typed API Error ────────────────────────────────────────────────────────

export interface ApiError {
  status:    number;
  message:   string;
  timestamp: string;
  path?:     string;
}

export class ZkfsApiError extends Error {
  constructor(
    public readonly status:  number,
    public readonly message: string,
    public readonly data?:   ApiError
  ) {
    super(message);
    this.name = 'ZkfsApiError';
  }
}

// ── Token Helpers ──────────────────────────────────────────────────────────

const COOKIE_NAME = 'zkfs_access_token';

function setCookie(name: string, value: string, days = 1): void {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Strict`;
}

function deleteCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
}

export const tokenStorage = {
  getAccessToken:  (): string | null => localStorage.getItem(TOKEN_KEY),
  getRefreshToken: (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY),

  setTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem(TOKEN_KEY,         accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    // Mirror access token into a cookie so Next.js middleware can read it
    setCookie(COOKIE_NAME, accessToken, 1);
  },

  clearTokens(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    deleteCookie(COOKIE_NAME);
  },
};


// ── Axios Instance ─────────────────────────────────────────────────────────

const apiClient: AxiosInstance = axios.create({
  baseURL:         API_BASE_URL,   // e.g. http://localhost:8080/api — /v1 is in each path
  timeout:         30_000,
  headers: {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
  },
  withCredentials: true,
});

// ── Request Interceptor: Inject JWT ───────────────────────────────────────

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = tokenStorage.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (process.env.NODE_ENV === 'development') {
      console.debug(`[API →] ${config.method?.toUpperCase()} ${config.url}`);
    }

    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

// ── Response Interceptor: Handle 401 / Token Refresh ─────────────────────

/** Flag to prevent multiple simultaneous refresh calls */
let isRefreshing       = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject:  (error: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else if (token) {
      resolve(token);
    }
  });
  failedQueue = [];
}

apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[API ←] ${response.status} ${response.config.url}`);
    }
    return response;
  },

  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // ── 401 Unauthorized → attempt token refresh ──────────────────────────
    if (error.response?.status === 401 && !originalRequest._retry) {
      const refreshToken = tokenStorage.getRefreshToken();

      if (!refreshToken) {
        tokenStorage.clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Queue subsequent 401s until refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing            = true;

      try {
        const response = await axios.post<{ accessToken: string; refreshToken: string }>(
          `${API_BASE_URL}/v1/auth/refresh`,
          { refreshToken }
        );

        const { accessToken, refreshToken: newRefreshToken } = response.data;
        tokenStorage.setTokens(accessToken, newRefreshToken);

        processQueue(null, accessToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);

      } catch (refreshError) {
        processQueue(refreshError, null);
        tokenStorage.clearTokens();
        window.location.href = '/login';
        return Promise.reject(refreshError);

      } finally {
        isRefreshing = false;
      }
    }

    // ── Retry Logic for 5xx / Network Errors ──────────────────────────────
    const shouldRetry =
      error.response == null || // Network error
      (error.response.status >= 500 && error.response.status <= 599);

    if (shouldRetry) {
      const retryCount = (originalRequest as any)._retryCount || 0;
      const MAX_API_RETRIES = 3;

      if (retryCount < MAX_API_RETRIES) {
        (originalRequest as any)._retryCount = retryCount + 1;
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[API ↻] Retrying request in ${delay}ms... (Attempt ${retryCount + 1} of ${MAX_API_RETRIES})`);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
        return apiClient(originalRequest);
      }
    }

    // ── Other errors → wrap and re-throw ──────────────────────────────────
    const status  = error.response?.status ?? 0;
    const message = error.response?.data?.message ?? error.message ?? 'An unexpected error occurred';

    return Promise.reject(new ZkfsApiError(status, message, error.response?.data));
  }
);

export default apiClient;
