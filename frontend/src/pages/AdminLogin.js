import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../api/adminClient';
import { Lock, AlertCircle } from 'lucide-react';
import './AdminLogin.css';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await adminAPI.login(username, password);
      const { session_token, admin_id, username: adminUsername } = response.data;

      // Store admin credentials
      localStorage.setItem('admin_session_token', session_token);
      localStorage.setItem('admin_user', JSON.stringify({
        id: admin_id,
        username: adminUsername,
      }));

      navigate('/admin/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-wrapper">
      <div className="admin-login-container">
        <div className="admin-login-logo">
          <Lock size={32} />
        </div>
        <h1>Admin Panel</h1>
        <p>Enter your credentials to access the dashboard</p>

        {error && (
          <div className="admin-error-banner">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="admin-login-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter admin username"
              disabled={loading}
              autoComplete="username"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password"
              disabled={loading}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" disabled={loading} className="admin-login-btn">
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="admin-login-footer">
          This admin panel is for authorized personnel only.
        </p>
      </div>
    </div>
  );
}
