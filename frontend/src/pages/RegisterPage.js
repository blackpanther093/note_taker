import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, Mail, Eye, EyeOff, BookOpen, Shield } from 'lucide-react';

export default function RegisterPage() {
  const { register, requestRegisterOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpMessage, setOtpMessage] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const getPasswordStrength = (pw) => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    return score;
  };

  const strength = getPasswordStrength(password);
  const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  const strengthColors = ['', '#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#7c4dff'];

  const handleSendOtp = async () => {
    setError('');
    setOtpMessage('');
    if (!email) {
      setError('Please enter your email first');
      return;
    }

    setSendingOtp(true);
    try {
      const result = await requestRegisterOtp(email);
      setOtpSent(true);
      setOtpMessage(result?.message || 'OTP sent to your email');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (strength < 3) {
      setError('Please choose a stronger password');
      return;
    }

    if (!otpCode || otpCode.length !== 6) {
      setError('Enter the 6-digit OTP sent to your email');
      return;
    }

    setLoading(true);

    try {
      await register(email, password, otpCode);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
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
          <p>Create your encrypted journal</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <h2>Create Account</h2>

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

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleSendOtp}
            disabled={loading || sendingOtp}
          >
            {sendingOtp ? 'Sending OTP...' : (otpSent ? 'Resend OTP' : 'Send OTP')}
          </button>

          {otpMessage && <div className="success-message">{otpMessage}</div>}

          <div className="input-group">
            <Shield size={20} />
            <input
              type="text"
              placeholder="6-digit OTP"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              disabled={loading}
            />
          </div>

          <div className="input-group">
            <Lock size={20} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password (min 8 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
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

          {password && (
            <div className="password-strength">
              <div className="strength-bar">
                <div
                  className="strength-fill"
                  style={{
                    width: `${(strength / 5) * 100}%`,
                    backgroundColor: strengthColors[strength],
                  }}
                />
              </div>
              <span style={{ color: strengthColors[strength] }}>
                {strengthLabels[strength]}
              </span>
            </div>
          )}

          <div className="input-group">
            <Lock size={20} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? (
              <>
                <span className="loading-spinner small" />
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </button>

          <p className="auth-link">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>

          <div className="security-note">
            <Shield size={14} />
            <span>
              Your password is used to derive encryption keys locally.
              It is never sent to our servers. If you lose your password,
              your data cannot be recovered.
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
