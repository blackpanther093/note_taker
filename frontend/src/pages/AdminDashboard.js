import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../api/adminClient';
import { LogOut, Users, FileText, HardDrive, AlertCircle } from 'lucide-react';
import './AdminDashboard.css';

export default function AdminDashboard() {
  const [admin, setAdmin] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [show2FAModal, setShow2FAModal] = useState(false);
  const [twoFASecret, setTwoFASecret] = useState('');
  const [twoFAQr, setTwoFAQr] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFAError, setTwoFAError] = useState('');
  const [twoFALoading, setTwoFALoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminAuth = async () => {
      try {
        const adminData = localStorage.getItem('admin_user');
        if (!adminData) {
          navigate('/admin/login');
          return;
        }
        setAdmin(JSON.parse(adminData));

        try {
          const meRes = await adminAPI.me();
          setAdmin(meRes.data.admin);
        } catch {
          // Ignore and keep local cache fallback.
        }

        // Fetch dashboard stats
        const response = await adminAPI.getDashboard();
        setStats(response.data);
      } catch (err) {
        setError('Failed to load dashboard');
        console.error(err);
        setTimeout(() => navigate('/admin/login'), 2000);
      } finally {
        setLoading(false);
      }
    };

    checkAdminAuth();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await adminAPI.logout();
    } catch (err) {
      console.error(err);
    } finally {
      localStorage.removeItem('admin_session_token');
      localStorage.removeItem('admin_user');
      navigate('/admin/login');
    }
  };

  const handleStart2FASetup = async () => {
    setTwoFAError('');
    setTwoFALoading(true);
    try {
      const res = await adminAPI.setup2FA();
      setTwoFASecret(res.data.secret);
      setTwoFAQr(res.data.qr_code);
      setTwoFACode('');
      setShow2FAModal(true);
    } catch (err) {
      setTwoFAError(err.response?.data?.error || 'Failed to start 2FA setup');
    } finally {
      setTwoFALoading(false);
    }
  };

  const handleVerify2FA = async () => {
    if (twoFACode.length !== 6) {
      setTwoFAError('Enter a valid 6-digit code');
      return;
    }
    setTwoFAError('');
    setTwoFALoading(true);
    try {
      await adminAPI.verify2FA(twoFACode);
      const nextAdmin = { ...(admin || {}), totp_enabled: true };
      setAdmin(nextAdmin);
      localStorage.setItem('admin_user', JSON.stringify(nextAdmin));
      setShow2FAModal(false);
      setTwoFASecret('');
      setTwoFAQr('');
      setTwoFACode('');
    } catch (err) {
      setTwoFAError(err.response?.data?.error || 'Failed to verify 2FA code');
    } finally {
      setTwoFALoading(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-wrapper">
        <div className="admin-dashboard">
          <div className="admin-loading">
            <div className="spinner"></div>
            <p>Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-wrapper">
        <div className="admin-dashboard">
          <div className="admin-error">
            <AlertCircle size={48} />
            <h2>{error}</h2>
            <p>Redirecting...</p>
          </div>
        </div>
      </div>
    );
  }

  const storageUsedMb = Number(stats?.storage_used_mb ?? 0);
  const storageUsedLabel = Number.isFinite(storageUsedMb) ? storageUsedMb.toFixed(2) : '0.00';

  return (
    <div className="admin-wrapper">
      <div className="admin-dashboard">
        {/* Header */}
        <header className="admin-header">
          <div className="admin-header-content">
            <h1>📊 Admin Dashboard</h1>
            <p>Welcome, <strong>{admin?.username}</strong></p>
          </div>
          <button className="admin-logout-btn" onClick={handleLogout}>
            <LogOut size={16} />
            Logout
          </button>
        </header>

        {/* Stats Grid */}
        <section className="admin-stats-grid">
          <div className="stat-card">
            <div className="stat-icon is-users">
              <Users size={24} />
            </div>
            <div className="stat-content">
              <p className="stat-label">Total Users</p>
              <p className="stat-value">{stats?.total_users || 0}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon is-entries">
              <FileText size={24} />
            </div>
            <div className="stat-content">
              <p className="stat-label">Total Entries</p>
              <p className="stat-value">{stats?.total_entries || 0}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon is-storage">
              <HardDrive size={24} />
            </div>
            <div className="stat-content">
              <p className="stat-label">Storage Used</p>
              <p className="stat-value">{storageUsedLabel} MB</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon is-active">
              <Users size={24} />
            </div>
            <div className="stat-content">
              <p className="stat-label">Active Users (7d)</p>
              <p className="stat-value">{stats?.active_users || 0}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon is-kicked">
              <AlertCircle size={24} />
            </div>
            <div className="stat-content">
              <p className="stat-label">Kicked Out</p>
              <p className="stat-value">{stats?.kicked_users || 0}</p>
            </div>
          </div>
        </section>

        {/* Quick Actions */}
        <section className="admin-actions">
          <h2>Quick Actions</h2>
          <button 
            className="action-btn"
            onClick={() => navigate('/admin/users')}
          >
            <Users size={16} />
            Manage Users
          </button>
          {!admin?.totp_enabled && (
            <button
              className="action-btn secondary"
              onClick={handleStart2FASetup}
              disabled={twoFALoading}
            >
              <AlertCircle size={16} />
              {twoFALoading ? 'Starting 2FA...' : 'Enable Admin 2FA'}
            </button>
          )}
          {admin?.totp_enabled && <p className="twofa-enabled-note">Admin 2FA is enabled.</p>}
          {twoFAError && !show2FAModal && <p className="twofa-error-note">{twoFAError}</p>}
        </section>

        {/* Info Box */}
        <section className="admin-info">
          <div className="info-card">
            <h3>📝 Dashboard Features</h3>
            <ul>
              <li>View all users and their statistics</li>
              <li>Monitor storage usage per user</li>
              <li>Deactivate or kick out users</li>
              <li>View detailed user information</li>
              <li>Check user entry counts and creation dates</li>
            </ul>
          </div>
          <div className="info-card">
            <h3>⚙️ Configuration</h3>
            <p>To create an admin user, run:</p>
            <code>python create_admin.py &lt;username&gt; &lt;password&gt;</code>
            <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
              On the production server via Render shell
            </p>
          </div>
        </section>
      </div>

      {show2FAModal && (
        <div className="modal-overlay" onClick={() => setShow2FAModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Enable Admin 2FA</h2>
              <button className="modal-close" onClick={() => setShow2FAModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Scan this QR with Google Authenticator/Authy, then verify with a 6-digit code.</p>
              {twoFAQr && <img src={twoFAQr} alt="Admin 2FA QR" className="twofa-qr" />}
              <code className="twofa-secret">{twoFASecret}</code>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={twoFACode}
                onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit code"
                className="twofa-code-input"
              />
              {twoFAError && <p className="twofa-error-note">{twoFAError}</p>}
              <div className="modal-actions">
                <button className="action-btn" onClick={handleVerify2FA} disabled={twoFALoading}>
                  {twoFALoading ? 'Verifying...' : 'Verify & Enable'}
                </button>
                <button className="action-btn secondary" onClick={() => setShow2FAModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
