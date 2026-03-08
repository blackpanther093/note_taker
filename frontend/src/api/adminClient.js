/* Admin API Endpoints */
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const adminClient = axios.create({
  baseURL: `${API_BASE}/admin`,
  withCredentials: true,
});

// Intercept requests to add admin session token
adminClient.interceptors.request.use((config) => {
  const adminToken = localStorage.getItem('admin_session_token');
  if (adminToken) {
    config.headers['X-Admin-Session'] = adminToken;
  }
  return config;
});

// Intercept responses to handle 401
adminClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const requestUrl = String(error.config?.url || '');
    const isLoginRequest = requestUrl.includes('/login');
    const requires2FA = !!error.response?.data?.requires_2fa;

    // Let AdminLogin handle expected 401 challenge responses.
    if (status === 401 && isLoginRequest && requires2FA) {
      return Promise.reject(error);
    }

    if (status === 401) {
      localStorage.removeItem('admin_session_token');
      localStorage.removeItem('admin_user');
      window.location.href = '/admin/login';
    }
    return Promise.reject(error);
  }
);

export const adminAPI = {
  login: (username, password, totpCode = '') =>
    adminClient.post('/login', { username, password, totp_code: totpCode }),
  logout: () =>
    adminClient.post('/logout'),
  me: () =>
    adminClient.get('/me'),
  getDashboard: () =>
    adminClient.get('/dashboard'),
  setup2FA: () =>
    adminClient.post('/setup-2fa'),
  verify2FA: (totpCode) =>
    adminClient.post('/verify-2fa', { totp_code: totpCode }),
  getUsers: (page = 1, perPage = 20) =>
    adminClient.get('/users', { params: { page, per_page: perPage } }),
  getUserDetails: (userId) =>
    adminClient.get(`/user/${userId}`),
  kickUser: (userId) =>
    adminClient.post(`/user/${userId}/kick`),
  restoreUser: (userId) =>
    adminClient.post(`/user/${userId}/restore`),
};
