import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../api/adminClient';
import { ChevronLeft, Search, Trash2, RotateCcw, Eye } from 'lucide-react';
import './AdminUsers.css';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionLoading, setActionLoading] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminAuth = async () => {
      const adminData = localStorage.getItem('admin_user');
      if (!adminData) {
        navigate('/admin/login');
        return;
      }
      fetchUsers(1);
    };
    checkAdminAuth();
  }, [navigate]);

  const fetchUsers = async (pageNum) => {
    try {
      setLoading(true);
      const response = await adminAPI.getUsers(pageNum, 20);
      setUsers(response.data.users);
      setTotalPages(response.data.pages);
      setPage(pageNum);
    } catch (err) {
      setError('Failed to load users');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadUserDetails = async (userId) => {
    try {
      const response = await adminAPI.getUserDetails(userId);
      setSelectedUser(response.data);
      setShowUserModal(true);
    } catch (err) {
      console.error('Failed to load user details:', err);
      alert('Failed to load user details');
    }
  };

  const handleKickUser = async (userId) => {
    if (!window.confirm('Are you sure you want to kick out this user?')) {
      return;
    }

    try {
      setActionLoading(userId);
      await adminAPI.kickUser(userId);
      setUsers(users.map(u => u.id === userId ? { ...u, is_active: false } : u));
      if (selectedUser?.id === userId) {
        setSelectedUser({ ...selectedUser, is_active: false });
      }
      alert('User has been kicked out');
    } catch (err) {
      alert('Failed to kick user');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestoreUser = async (userId) => {
    try {
      setActionLoading(userId);
      await adminAPI.restoreUser(userId);
      setUsers(users.map(u => u.id === userId ? { ...u, is_active: true } : u));
      if (selectedUser?.id === userId) {
        setSelectedUser({ ...selectedUser, is_active: true });
      }
      alert('User has been restored');
    } catch (err) {
      alert('Failed to restore user');
    } finally {
      setActionLoading(null);
    }
  };

  const filteredUsers = users.filter(u =>
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="admin-wrapper">
      <div className="admin-users">
        {/* Header */}
        <div className="admin-users-header">
          <button className="back-btn" onClick={() => navigate('/admin/dashboard')}>
            <ChevronLeft size={16} />
            Back to Dashboard
          </button>
          <h1>👥 Manage Users</h1>
        </div>

        {/* Search */}
        <div className="users-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search by email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {error && (
          <div className="users-error" role="alert">
            {error}
          </div>
        )}

        {/* Users Table */}
        <div className="users-table-container">
          {loading ? (
            <div className="users-loading">
              <div className="spinner"></div>
              <p>Loading users...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="users-empty">
              <p>No users found</p>
            </div>
          ) : (
            <>
              <table className="users-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Entries</th>
                    <th>Storage</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(user => (
                    <tr key={user.id} className={!user.is_active ? 'is-inactive' : ''}>
                      <td className="email-cell">
                        <strong>{user.email}</strong>
                      </td>
                      <td className="center">{user.entries}</td>
                      <td className="center">{user.storage_mb} MB</td>
                      <td className="center">
                        <span className={`status-badge ${user.is_active ? 'active' : 'inactive'}`}>
                          {user.is_active ? '✓ Active' : '✗ Kicked'}
                        </span>
                      </td>
                      <td className="center">{new Date(user.created_at).toLocaleDateString()}</td>
                      <td className="actions-cell">
                        <button
                          className="action-icon-btn"
                          onClick={() => loadUserDetails(user.id)}
                          title="View details"
                        >
                          <Eye size={16} />
                        </button>
                        {user.is_active ? (
                          <button
                            className="action-icon-btn danger"
                            onClick={() => handleKickUser(user.id)}
                            disabled={actionLoading === user.id}
                            title="Kick user"
                          >
                            <Trash2 size={16} />
                          </button>
                        ) : (
                          <button
                            className="action-icon-btn success"
                            onClick={() => handleRestoreUser(user.id)}
                            disabled={actionLoading === user.id}
                            title="Restore user"
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    onClick={() => fetchUsers(page - 1)}
                    disabled={page === 1}
                    className="page-btn"
                  >
                    Previous
                  </button>
                  <span className="page-info">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => fetchUsers(page + 1)}
                    disabled={page === totalPages}
                    className="page-btn"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* User Details Modal */}
        {showUserModal && selectedUser && (
          <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>{selectedUser.email}</h2>
                <button className="modal-close" onClick={() => setShowUserModal(false)}>
                  ✕
                </button>
              </div>

              <div className="modal-body">
                <div className="user-detail-grid">
                  <div className="detail-item">
                    <label>Status</label>
                    <span className={`status-badge ${selectedUser.is_active ? 'active' : 'inactive'}`}>
                      {selectedUser.is_active ? '✓ Active' : '✗ Kicked'}
                    </span>
                  </div>

                  <div className="detail-item">
                    <label>Entries</label>
                    <span>{selectedUser.entries}</span>
                  </div>

                  <div className="detail-item">
                    <label>Shares</label>
                    <span>{selectedUser.shares}</span>
                  </div>

                  <div className="detail-item">
                    <label>Storage Used</label>
                    <span>{selectedUser.storage_mb} MB</span>
                  </div>

                  <div className="detail-item">
                    <label>2FA Enabled</label>
                    <span>{selectedUser.totp_enabled ? '✓ Yes' : '✗ No'}</span>
                  </div>

                  <div className="detail-item">
                    <label>Joined</label>
                    <span>{new Date(selectedUser.created_at).toLocaleDateString()}</span>
                  </div>

                  {selectedUser.kicked_out_at && (
                    <div className="detail-item">
                      <label>Kicked Out</label>
                      <span>{new Date(selectedUser.kicked_out_at).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>

                {selectedUser.entries_list && selectedUser.entries_list.length > 0 && (
                  <div className="entries-section">
                    <h3>Recent Entries</h3>
                    <ul className="entries-list">
                      {selectedUser.entries_list.map(entry => (
                        <li key={entry.id}>
                          <div className="entry-title">{entry.title || 'Untitled'}</div>
                          <div className="entry-meta">
                            {entry.word_count} words • {new Date(entry.created_at).toLocaleDateString()}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="modal-actions">
                  {selectedUser.is_active ? (
                    <button
                      className="btn btn-danger"
                      onClick={() => handleKickUser(selectedUser.id)}
                      disabled={actionLoading === selectedUser.id}
                    >
                      <Trash2 size={16} />
                      Kick Out User
                    </button>
                  ) : (
                    <button
                      className="btn btn-success"
                      onClick={() => handleRestoreUser(selectedUser.id)}
                      disabled={actionLoading === selectedUser.id}
                    >
                      <RotateCcw size={16} />
                      Restore User
                    </button>
                  )}
                  <button className="btn btn-secondary" onClick={() => setShowUserModal(false)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
