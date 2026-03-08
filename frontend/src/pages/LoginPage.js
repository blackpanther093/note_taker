import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, Mail, Eye, EyeOff, BookOpen } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password, totpCode);
    } catch (err) {
      const data = err.response?.data;
      if (data?.requires_2fa) {
        setRequires2FA(true);
        setError('Please enter your 2FA code');
      } else {
        setError(data?.error || 'Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <BookOpen size={48} className="auth-logo" />
          <h1>My Journal</h1>
          <p>Your private, encrypted journal</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <h2>Sign In</h2>

          {error && <div className="error-message">{error}</div>}

          <div className="input-group">
            <Mail size={20} />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className="input-group">
            <Lock size={20} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              disabled={loading}
            />
            <button
              type="button"
              className="toggle-password"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {requires2FA && (
            <div className="input-group">
              <Lock size={20} />
              <input
                type="text"
                placeholder="2FA Code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                maxLength={6}
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                disabled={loading}
              />
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? (
              <>
                <span className="loading-spinner small" />
                Deriving keys...
              </>
            ) : (
              'Sign In'
            )}
          </button>

          <p className="auth-link">
            Don't have an account? <Link to="/register">Sign up</Link>
          </p>

          <div className="security-note">
            <Lock size={14} />
            <span>Your password never leaves your device. All encryption happens locally.</span>
          </div>
        </form>
      </div>
    </div>
  );
}
