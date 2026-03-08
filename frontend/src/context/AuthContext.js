/**
 * Authentication Context
 *
 * Manages user authentication state and encryption keys.
 * SECURITY: Encryption key stored in sessionStorage (cleared on tab close).
 * Provides balance between security and usability - persists across page refreshes
 * but cleared when browser tab closes.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../api/client';
import {
  deriveMasterKey,
  deriveAuthKey,
  deriveEncryptionKey,
  generateSalt,
  arrayToBase64,
  base64ToArray,
} from '../crypto/encryption';

const AuthContext = createContext(null);

const ENC_KEY_STORAGE = 'enc_key';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [encryptionKey, setEncryptionKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const initRef = React.useRef(false);
  const loggingOutRef = React.useRef(false);

  // Check if session is still valid on mount and restore encryption key
  useEffect(() => {
    // Prevent double initialization in React StrictMode
    if (initRef.current) return;
    initRef.current = true;

    const initializeAuth = async () => {
      try {
        const res = await authAPI.me();
        const storedKey = sessionStorage.getItem(ENC_KEY_STORAGE);
        if (storedKey) {
          setUser(res.data.user);
          setEncryptionKey(base64ToArray(storedKey));
        } else {
          console.warn('Valid session but no encryption key');
          setUser(res.data.user);
          setEncryptionKey(null);
        }
      } catch {
        // Retry once to avoid false logout on transient startup/network errors
        try {
          const res = await authAPI.me();
          const storedKey = sessionStorage.getItem(ENC_KEY_STORAGE);
          if (storedKey) {
            setUser(res.data.user);
            setEncryptionKey(base64ToArray(storedKey));
          } else {
            setUser(res.data.user);
            setEncryptionKey(null);
          }
        } catch {
          setUser(null);
          sessionStorage.removeItem(ENC_KEY_STORAGE);
        }
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const storeEncryptionKey = useCallback((key) => {
    // Store in both memory and sessionStorage
    // sessionStorage is cleared when tab closes, providing reasonable security
    setEncryptionKey(key);
    sessionStorage.setItem(ENC_KEY_STORAGE, arrayToBase64(key));
  }, []);

  const requestRegisterOtp = useCallback(async (email) => {
    const response = await authAPI.requestRegisterOtp(email);
    return response.data;
  }, []);

  const register = useCallback(async (email, password, otpCode) => {
    const salt = generateSalt();
    const masterKey = await deriveMasterKey(password, salt);
    const authKey = await deriveAuthKey(masterKey);
    const encKey = await deriveEncryptionKey(masterKey);

    const response = await authAPI.register(email, authKey, arrayToBase64(salt), otpCode);
    setUser(response.data.user);
    storeEncryptionKey(encKey);
    return response.data;
  }, [storeEncryptionKey]);

  const login = useCallback(async (email, password, totpCode = '') => {
    // Step 1: Get salt
    const saltRes = await authAPI.getSalt(email);
    const salt = base64ToArray(saltRes.data.salt);

    // Step 2: Derive keys
    const masterKey = await deriveMasterKey(password, salt);
    const authKey = await deriveAuthKey(masterKey);
    const encKey = await deriveEncryptionKey(masterKey);

    // Step 3: Login
    const response = await authAPI.login(email, authKey, totpCode);
    setUser(response.data.user);
    storeEncryptionKey(encKey);
    return response.data;
  }, [storeEncryptionKey]);

  const logout = useCallback(async () => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    
    try {
      await authAPI.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setUser(null);
      setEncryptionKey(null);
      sessionStorage.removeItem(ENC_KEY_STORAGE);
      loggingOutRef.current = false;
    }
  }, []);

  const changePassword = useCallback(async (oldPassword, newPassword, reencryptCallback) => {
    if (!user || !encryptionKey) {
      throw new Error('Must be authenticated to change password');
    }

    // Get current salt
    const saltRes = await authAPI.getSalt(user.email);
    const oldSalt = base64ToArray(saltRes.data.salt);

    // Derive old auth key for verification
    const oldMasterKey = await deriveMasterKey(oldPassword, oldSalt);
    const oldAuthKey = await deriveAuthKey(oldMasterKey);

    // Derive new keys
    const newSalt = generateSalt();
    const newMasterKey = await deriveMasterKey(newPassword, newSalt);
    const newAuthKey = await deriveAuthKey(newMasterKey);
    const newEncKey = await deriveEncryptionKey(newMasterKey);

    // Let caller handle re-encryption of entries
    const reencryptedEntries = await reencryptCallback(encryptionKey, newEncKey);

    // Send to server
    const response = await authAPI.changePassword(
      oldAuthKey,
      newAuthKey,
      arrayToBase64(newSalt),
      reencryptedEntries
    );

    // Update encryption key in memory
    storeEncryptionKey(newEncKey);

    return response.data;
  }, [user, encryptionKey, storeEncryptionKey]);

  const value = {
    user,
    encryptionKey,
    loading,
    isAuthenticated: !!user && !!encryptionKey,
    requestRegisterOtp,
    register,
    login,
    logout,
    changePassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
