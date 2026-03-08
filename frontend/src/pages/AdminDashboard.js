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
              <p className="stat-value">{stats?.storage_used_mb?.toFixed(2) || 0} MB</p>
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
    </div>
  );
}
