import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { authAPI } from '../api/client';
import {
  ArrowLeft,
  Shield,
  Key,
  Lock,
  Save,
  User,
  CheckCircle,
  AlertCircle,
  Loader,
  Moon,
  Sun,
  LogOut,
} from 'lucide-react';
import { formatIST } from '../utils/timezone';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => {
    return localStorage.getItem('autoSaveEnabled') !== 'false';
  });

  const [twoFASetup, setTwoFASetup] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [twoFAMessage, setTwoFAMessage] = useState('');
  const [loading2FA, setLoading2FA] = useState(false);

  const handleAutoSaveToggle = () => {
    const newValue = !autoSaveEnabled;
    setAutoSaveEnabled(newValue);
    localStorage.setItem('autoSaveEnabled', String(newValue));
  };

  const handleSetup2FA = async () => {
    setLoading2FA(true);
    try {
      const res = await authAPI.setup2FA();
      setTwoFASetup(res.data);
      setTwoFAMessage('');
    } catch (err) {
      setTwoFAMessage(err.response?.data?.error || 'Failed to setup 2FA');
    } finally {
      setLoading2FA(false);
    }
  };

  const handleVerify2FA = async () => {
    setLoading2FA(true);
    try {
      await authAPI.verify2FA(totpCode);
      setTwoFAMessage('2FA enabled successfully!');
      setTwoFASetup(null);
      setTotpCode('');
    } catch (err) {
      setTwoFAMessage(err.response?.data?.error || 'Invalid code');
    } finally {
      setLoading2FA(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const messageSuccess = twoFAMessage.toLowerCase().includes('success');

  return (
    <div className="settings-page">
      <div className="settings-container">
        <header className="settings-header">
          <div className="settings-title-wrap">
            <button onClick={() => navigate('/')} className="btn btn-icon" title="Back to dashboard">
              <ArrowLeft size={20} />
            </button>
            <h1 className="settings-title">
              <User size={26} />
              Settings
            </h1>
          </div>

          <button
            onClick={toggleTheme}
            className="btn btn-icon"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </header>

        <div className="settings-grid">
          <section className="settings-card">
            <h2 className="settings-card-title">
              <User size={20} />
              Account Information
            </h2>

            <div className="settings-kv-list">
              <div className="settings-kv-row">
                <span>Email</span>
                <span>{user?.email || 'N/A'}</span>
              </div>

              <div className="settings-kv-row">
                <span>Member Since</span>
                <span>{user?.created_at ? formatIST(user.created_at, 'date') : 'N/A'}</span>
              </div>

              <div className="settings-kv-row">
                <span>2FA Status</span>
                <span className={user?.totp_enabled ? 'status-ok' : 'status-warning'}>
                  {user?.totp_enabled ? (
                    <>
                      <CheckCircle size={16} /> Enabled
                    </>
                  ) : (
                    <>
                      <AlertCircle size={16} /> Disabled
                    </>
                  )}
                </span>
              </div>
            </div>
          </section>

          <section className="settings-card">
            <h2 className="settings-card-title">
              <Key size={20} />
              Quick Actions
            </h2>

            <button className="btn btn-primary settings-action-btn" onClick={() => navigate('/change-password')}>
              <span>
                <Lock size={18} />
                Change Password
              </span>
              <span aria-hidden="true">{'->'}</span>
            </button>
          </section>

          <section className="settings-card">
            <h2 className="settings-card-title">
              <Save size={20} />
              Editor Preferences
            </h2>

            <div className="settings-toggle-row">
              <div>
                <div className="settings-toggle-title">Auto-Save</div>
                <div className="settings-toggle-subtitle">Automatically save changes while you write</div>
              </div>

              <label className="switch" aria-label="Toggle auto save">
                <input type="checkbox" checked={autoSaveEnabled} onChange={handleAutoSaveToggle} />
                <span className="slider" />
              </label>
            </div>
          </section>

          <section className="settings-card">
            <h2 className="settings-card-title">
              <Shield size={20} />
              Two-Factor Authentication
            </h2>

            {user?.totp_enabled ? (
              <div className="settings-alert success">
                <CheckCircle size={20} />
                <span>Two-factor authentication is enabled and active.</span>
              </div>
            ) : (
              <>
                {!twoFASetup ? (
                  <div className="settings-block-stack">
                    <p className="settings-muted">
                      Add an extra layer of security by enabling two-factor authentication.
                    </p>
                    <button className="btn btn-primary" onClick={handleSetup2FA} disabled={loading2FA}>
                      {loading2FA ? (
                        <>
                          <Loader size={16} className="spin-icon" /> Loading...
                        </>
                      ) : (
                        <>
                          <Shield size={16} /> Enable 2FA
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="settings-block-stack">
                    <p className="settings-muted">Scan this QR code with your authenticator app.</p>

                    <div className="settings-qr-box">
                      <img src={twoFASetup.qr_code} alt="2FA QR Code" className="settings-qr-image" />
                    </div>

                    <div className="settings-secret-box">
                      <strong>Manual entry key:</strong>
                      <br />
                      {twoFASetup.secret}
                    </div>

                    <div className="settings-verify-row">
                      <input
                        type="text"
                        placeholder="Enter 6-digit code"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        maxLength={6}
                        className="settings-code-input"
                      />
                      <button
                        className="btn btn-primary"
                        onClick={handleVerify2FA}
                        disabled={loading2FA || totpCode.length !== 6}
                      >
                        {loading2FA ? 'Verifying...' : 'Verify'}
                      </button>
                    </div>
                  </div>
                )}

                {twoFAMessage && (
                  <div className={`settings-alert ${messageSuccess ? 'success' : 'error'}`}>
                    {messageSuccess ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
                    <span>{twoFAMessage}</span>
                  </div>
                )}
              </>
            )}
          </section>

          <section className="settings-card">
            <h2 className="settings-card-title">
              <Shield size={20} />
              Security Information
            </h2>

            <div className="settings-info-box">
              <h3>Zero-Knowledge Encryption</h3>
              <ul>
                <li>Password-derived keys using Argon2id.</li>
                <li>Entries encrypted with AES-256-GCM.</li>
                <li>Unique per-entry key derivation via HKDF.</li>
                <li>Server never sees plaintext note content.</li>
                <li>If password is lost, encrypted data cannot be recovered.</li>
              </ul>
            </div>
          </section>

          <section className="settings-card danger">
            <h2 className="settings-card-title">Danger Zone</h2>
            <button
              className="btn btn-danger-outline"
              onClick={() => {
                if (window.confirm('Are you sure you want to log out?')) {
                  handleLogout();
                }
              }}
            >
              <LogOut size={16} /> Logout from Account
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
