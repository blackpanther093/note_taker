import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import EntryEditor from './pages/EntryEditor';
import CalendarView from './pages/CalendarView';
import SettingsPage from './pages/SettingsPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import ShareView from './pages/ShareView';
import './App.css';

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
      </div>
    );
  }

  return !isAuthenticated ? children : <Navigate to="/" />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
        <Route path="/share/:shareId" element={<ShareView />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/entry/new" element={<ProtectedRoute><EntryEditor /></ProtectedRoute>} />
      <Route path="/entry/:id" element={<ProtectedRoute><EntryEditor /></ProtectedRoute>} />
      <Route path="/calendar" element={<ProtectedRoute><CalendarView /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <AppRoutes />
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
