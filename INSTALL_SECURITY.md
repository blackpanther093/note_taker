# 🚀 Security Updates Installation Guide

## Quick Setup for Enhanced Security Features

### Step 1: Install Frontend Dependencies

```bash
cd frontend
npm install
```

This installs:
- `dompurify@^3.2.3` for HTML sanitization

### Step 2: Run Backend Database Migrations

```bash
cd backend

# Activate virtual environment first
.venv\Scripts\activate  # Windows
# OR
source .venv/bin/activate  # Linux/Mac

# Run migrations
python migrate_session_binding.py
```

This adds the `user_agent_hash` column to the `user_sessions` table for session binding.

### Step 3: Restart Backend Server

```bash
# In backend directory with .venv activated
python run.py
```

### Step 4: Restart Frontend (if running)

```bash
# In frontend directory
npm start
```

### Step 5: Test Security Features

1. **Login** - Encryption key should NOT be in sessionStorage
2. **Create Entry** - Should work normally with CSRF tokens
3. **Go to Settings** - Test Change Password feature
4. **Refresh Page** - Should require re-login (memory-only keys)

---

## What Changed?

### ✅ Frontend Changes
- Removed sessionStorage for encryption keys (memory only)
- Added automatic CSRF token handling
- Added Change Password UI in Settings
- Added DOMPurify dependency

### ✅ Backend Changes
- Added CSRF token endpoint (`/api/auth/csrf`)
- Removed `@csrf.exempt` from authenticated endpoints
- Added session binding with IP + User-Agent hash
- Enhanced password change with re-encryption
- Blocked SVG uploads for security

---

## Important Notes

⚠️ **Breaking Change:** Users will need to re-login after page refresh (encryption keys no longer persist in sessionStorage for security)

✅ **Benefit:** Much more secure - XSS attacks can't steal keys from storage

---

## Troubleshooting

### "CSRF token missing" error
- Frontend should automatically fetch and include tokens
- Check browser console for errors
- Try clearing cookies and re-logging in

### "Session invalid" after changing IP
- This is expected! Session binding prevents hijacking
- Your session is tied to your IP and browser
- Log in again from the new location

### Password change fails
- Make sure you enter correct old password
- Check backend console for detailed error logs
- Ensure all entries are accessible before changing

---

## Security Best Practices

1. **Strong Passwords**: Use 16+ characters with mixed case, numbers, symbols
2. **Enable 2FA**: Go to Settings and enable two-factor authentication
3. **Regular Password Changes**: Change password quarterly
4. **Close Tabs**: Encryption key is lost on page refresh (memory only)
5. **HTTPS in Production**: Required for secure session cookies

---

## Need Help?

Check `SECURITY.md` for comprehensive security documentation.
