/**
 * API client with secure defaults including CSRF protection.
 * All requests go through this module.
 */
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // Send cookies for session management
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// CSRF Token management
let csrfToken = null;

const fetchCsrfToken = async () => {
  try {
    const response = await axios.get(`${API_BASE}/auth/csrf`, { withCredentials: true });
    csrfToken = response.data.csrf_token;
    return csrfToken;
  } catch (error) {
    console.error('Failed to fetch CSRF token:', error);
    return null;
  }
};

// Request interceptor to add CSRF token to mutating requests
api.interceptors.request.use(
  async (config) => {
    // Add CSRF token to non-GET requests
    if (config.method !== 'get') {
      // Fetch token if we don't have one
      if (!csrfToken) {
        await fetchCsrfToken();
      }
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for auth errors and CSRF token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    // If CSRF token is invalid, refetch and retry once
    if (error.response?.status === 400 && error.response?.data?.error?.includes('CSRF') && !originalRequest._retry) {
      originalRequest._retry = true;
      csrfToken = null;
      await fetchCsrfToken();
      if (csrfToken) {
        originalRequest.headers['X-CSRF-Token'] = csrfToken;
        return api(originalRequest);
      }
    }
    
    if (error.response?.status === 401) {
      // Clear CSRF token on auth failures.
      // Do not hard-redirect here; page-level handlers can preserve UI state.
      csrfToken = null;
    }
    return Promise.reject(error);
  }
);

// Initialize CSRF token on module load (for authenticated sessions)
fetchCsrfToken().catch(() => {
  // Silent fail - token will be fetched on first request if needed
});

// --- Auth API ---

export const authAPI = {
  requestRegisterOtp: (email) =>
    api.post('/auth/register/request-otp', { email }),

  register: (email, authKey, salt, otpCode) =>
    api.post('/auth/register', { email, auth_key: authKey, salt, otp_code: otpCode }),

  getSalt: (email) =>
    api.post('/auth/salt', { email }),

  login: (email, authKey, totpCode) =>
    api.post('/auth/login', { email, auth_key: authKey, totp_code: totpCode }),

  logout: () =>
    api.post('/auth/logout'),

  me: () =>
    api.get('/auth/me'),

  setup2FA: () =>
    api.post('/auth/setup-2fa'),

  verify2FA: (totpCode) =>
    api.post('/auth/verify-2fa', { totp_code: totpCode }),

  changePassword: (oldAuthKey, newAuthKey, newSalt, reencryptedEntries) =>
    api.post('/auth/change-password', {
      old_auth_key: oldAuthKey,
      new_auth_key: newAuthKey,
      new_salt: newSalt,
      reencrypted_entries: reencryptedEntries,
    }),
};

// --- Entries API ---

export const entriesAPI = {
  list: (params = {}) =>
    api.get('/entries', { params }),

  create: (entryData) =>
    api.post('/entries', entryData),

  get: (entryId) =>
    api.get(`/entries/${entryId}`),

  update: (entryId, entryData) =>
    api.put(`/entries/${entryId}`, entryData),

  delete: (entryId) =>
    api.delete(`/entries/${entryId}`),

  calendar: (year, month) =>
    api.get(`/entries/calendar/${year}/${month}`),

  streak: () =>
    api.get('/entries/streak'),
};

// --- Assets API ---

export const assetsAPI = {
  upload: (assetData) =>
    api.post('/assets/upload', assetData),

  get: (assetId) =>
    api.get(`/assets/${assetId}`),

  delete: (assetId) =>
    api.delete(`/assets/${assetId}`),

  listForEntry: (entryId) =>
    api.get(`/assets/entry/${entryId}`),
};

// --- Shares API ---

export const sharesAPI = {
  create: (shareData) =>
    api.post('/shares/create', shareData),

  get: (shareId) =>
    api.get(`/shares/${shareId}`),

  delete: (shareId) =>
    api.delete(`/shares/${shareId}`),

  getEntryShare: (entryId) =>
    api.get(`/shares/entry/${entryId}`),
};

export default api;
