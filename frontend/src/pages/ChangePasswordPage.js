import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { entriesAPI } from '../api/client';
import { decryptEntry, encryptEntry, decryptMetadata, encryptMetadata } from '../crypto/encryption';
import { ArrowLeft, Lock, AlertCircle, CheckCircle, Loader, Shield } from 'lucide-react';

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { changePassword } = useAuth();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordProgress, setPasswordProgress] = useState('');

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    setPasswordProgress('');

    // Validation
    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordError('All fields are required');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (oldPassword === newPassword) {
      setPasswordError('New password must be different from current password');
      return;
    }

    setChangingPassword(true);

    try {
      // Step 1: Fetch all entries
      setPasswordProgress('Fetching your journal entries...');
      const response = await entriesAPI.list({ per_page: 1000 });
      const entries = response.data.entries;

      if (entries.length === 0) {
        setPasswordProgress('No entries to re-encrypt...');
      } else {
        setPasswordProgress(`Re-encrypting ${entries.length} entries...`);
      }

      // Step 2: Re-encrypt callback
      const reencryptCallback = async (oldEncKey, newEncKey) => {
        const reencrypted = [];

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          setPasswordProgress(`Re-encrypting entry ${i + 1} of ${entries.length}...`);

          // Decrypt with old key
          const decryptedContent = await decryptEntry(
            entry.encrypted_content,
            entry.iv,
            oldEncKey,
            entry.id
          );

          let decryptedMetadata = null;
          if (entry.encrypted_metadata && entry.metadata_iv) {
            decryptedMetadata = await decryptMetadata(
              entry.encrypted_metadata,
              entry.metadata_iv,
              oldEncKey,
              entry.id
            );
          }

          // Encrypt with new key
          const { encrypted_content, iv } = await encryptEntry(
            decryptedContent,
            newEncKey,
            entry.id
          );

          const reencryptedEntry = {
            id: entry.id,
            encrypted_content,
            iv,
          };

          if (decryptedMetadata) {
            const { encrypted_metadata, metadata_iv } = await encryptMetadata(
              decryptedMetadata,
              newEncKey,
              entry.id
            );
            reencryptedEntry.encrypted_metadata = encrypted_metadata;
            reencryptedEntry.metadata_iv = metadata_iv;
          }

          reencrypted.push(reencryptedEntry);
        }

        return reencrypted;
      };

      // Step 3: Change password on server
      setPasswordProgress('Updating password on server...');
      await changePassword(oldPassword, newPassword, reencryptCallback);

      setPasswordSuccess('Password changed successfully! All entries have been re-encrypted.');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');

      // Redirect after 2 seconds
      setTimeout(() => {
        navigate('/settings');
      }, 2000);
    } catch (err) {
      setPasswordError(err.response?.data?.error || err.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
      setPasswordProgress('');
    }
  };

  return (
    <div className="change-password-page">
      <div className="change-password-container">
        {/* Header */}
        <div className="change-password-header">
          <button
            onClick={() => navigate('/settings')}
            className="change-password-back-btn"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="change-password-title">
            <Lock size={32} className="change-password-title-icon" />
            Change Password
          </h1>
        </div>

        {/* Card */}
        <div className="change-password-card">
          {/* Security Notice */}
          <div className="change-password-security">
            <Shield size={24} className="change-password-security-icon" />
            <div>
              <strong className="change-password-security-title">
                Important: Zero-Knowledge Encryption
              </strong>
              <p className="change-password-security-text">
                Changing your password will re-encrypt all your journal entries with a new key. 
                This process may take a moment if you have many entries. Your data remains secure throughout.
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleChangePassword}>
            <div className="change-password-field">
              <label className="change-password-label">
                Current Password
              </label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Enter your current password"
                disabled={changingPassword}
                className="change-password-input"
              />
            </div>

            <div className="change-password-field">
              <label className="change-password-label">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 8 characters)"
                disabled={changingPassword}
                className="change-password-input"
              />
            </div>

            <div className="change-password-field">
              <label className="change-password-label">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your new password"
                disabled={changingPassword}
                className="change-password-input"
              />
            </div>

            {/* Progress Message */}
            {passwordProgress && (
              <div className="change-password-alert warning">
                <Loader size={20} className="spin-icon" />
                <span>{passwordProgress}</span>
              </div>
            )}

            {/* Error Message */}
            {passwordError && (
              <div className="change-password-alert error">
                <AlertCircle size={20} />
                <span>{passwordError}</span>
              </div>
            )}

            {/* Success Message */}
            {passwordSuccess && (
              <div className="change-password-alert success">
                <CheckCircle size={20} />
                <span>{passwordSuccess}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={changingPassword}
              className="change-password-submit"
            >
              {changingPassword ? (
                <>
                  <Loader size={20} className="spin-icon" />
                  Changing Password...
                </>
              ) : (
                <>
                  <Lock size={20} />
                  Change Password
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
