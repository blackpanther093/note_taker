# 🎯 Admin Panel & Production Deployment Guide

## New Features Added

### 1. **Fixed Database Issues**
- ✅ Made vault endpoints resilient to missing `user_share_vaults` table
- ✅ Auto-creates table on first successful write if missing
- ✅ Graceful fallback for GET requests when table doesn't exist

### 2. **Improved Public Share UI**
- ✅ Beautiful, responsive share page design
- ✅ Better typography and spacing
- ✅ Added view count, reading time estimate, and share timestamp
- ✅ Copy share link button
- ✅ Better metadata display (mood, tags)
- ✅ Improved image rendering with figure captions
- ✅ Mobile-responsive layout
- ✅ Print-friendly styles

### 3. **Complete Admin Panel**
- ✅ Admin authentication system (separate from user auth)
- ✅ Admin dashboard with statistics
- ✅ User management (list, view, kick out, restore)
- ✅ User detailed view (entries, storage, 2FA status, etc.)
- ✅ Storage monitoring per user
- ✅ Kick-out functionality with session invalidation
- ✅ User deactivation message on login attempt

---

## Deployment Steps

### Step 1: Backend Migrations

Run in Render Shell:

```bash
# Navigate to backend directory
cd /app

# Run admin table migration
python migrate_add_admin.py

# Create admin user (replace with your credentials)
python create_admin.py admin_user secure_password admin@example.com
```

You should see:
```
✓ Migration complete!
✓ Admin user 'admin_user' created successfully!
  Admin ID: <some-uuid>
```

### Step 2: Frontend Deployment

No additional build steps needed - the admin panel is integrated into the React app.

Deploy/rebuild the frontend and it will automatically include:
- `/admin/login` - Admin login page
- `/admin/dashboard` - Admin dashboard
- `/admin/users` - User management page

### Step 3: Verify Everything Works

1. **Public Share Link**
   - Open a shared entry on production
   - Verify new UI with metadata badges
   - Test copy link functionality

2. **Admin Panel**
   - Navigate to `https://your-app.com/admin/login`
   - Login with credentials from Step 1
   - Verify dashboard loads with stats
   - Check user list and filters

3. **Kicked User Message**
   - In admin panel, kick out a test user
   - Try logging in with that user's credentials
   - Verify they see: "Your account has been deactivated by an administrator."

---

## Architecture

### Backend Updates

**New Models:**
- `Admin` - Admin user accounts with password hashing
- `AdminSession` - Session tokens for admin authentication
- User fields: `is_active`, `kicked_out_at` - Track user status

**New Routes (`/api/admin/`):**
- `POST /login` - Admin authentication
- `POST /logout` - Admin logout
- `GET /dashboard` - Dashboard statistics
- `GET /users` - List users with pagination
- `GET /user/{id}` - View user details
- `POST /user/{id}/kick` - Deactivate user
- `POST /user/{id}/restore` - Reactivate user

**Updated Routes:**
- `POST /auth/login` - Now checks `is_active` field
  - Returns 403 if user is kicked out
  - Includes kick timestamp in error message

**Resilience:**
- Share vault endpoints handle missing table gracefully
- Auto-create table on first PUT request if needed

### Frontend Updates

**New Components:**
- `AdminLogin.js` - Secure admin login form
- `AdminDashboard.js` - Stats and quick actions
- `AdminUsers.js` - User management with modal details
- `ShareView.js` - Enhanced public share page (new CSS)

**New API Client:**
- `adminClient.js` - Admin API with token management

**Routes:**
- `/admin/login` - Not protected (public)
- `/admin/dashboard` - Protected by admin token
- `/admin/users` - Protected by admin token

---

## File Changes Summary

### Backend Files

**New Files:**
- `backend/app/routes/admin.py` - Admin API endpoints
- `backend/migrate_add_admin.py` - Admin tables migration
- `backend/create_admin.py` - Create admin user utility

**Modified Files:**
- `backend/app/models.py`
  - Added `Admin` model
  - Added `AdminSession` model
  - Added `is_active` field to `User`
  - Added `kicked_out_at` field to `User`
  
- `backend/app/routes/auth.py`
  - Added resilience for missing vault table
  - Added `is_active` check in login endpoint
  - Returns descriptive message when user is kicked out

- `backend/app/__init__.py`
  - Registered `admin_bp` blueprint

### Frontend Files

**New Files:**
- `frontend/src/pages/AdminLogin.js` - Admin login page
- `frontend/src/pages/AdminLogin.css` - Admin login styles
- `frontend/src/pages/AdminDashboard.js` - Admin stats dashboard
- `frontend/src/pages/AdminDashboard.css` - Admin dashboard styles
- `frontend/src/pages/AdminUsers.js` - User management page
- `frontend/src/pages/AdminUsers.css` - User management styles
- `frontend/src/pages/ShareView.css` - Enhanced share view styles
- `frontend/src/api/adminClient.js` - Admin API client

**Modified Files:**
- `frontend/src/pages/ShareView.js` - Rewritten with:
  - Better typography and layout
  - Reading time calculation
  - Copy link button
  - Enhanced metadata display
  - Responsive design
  - Improved content rendering

- `frontend/src/App.js`
  - Added admin route imports
  - Added `/admin/login`, `/admin/dashboard`, `/admin/users` routes

---

## Admin Panel Features

### Dashboard
- **Total Users**: Count of active users
- **Total Entries**: Total journal entries across app
- **Storage Used**: Total MB used in database
- **Active Users**: Users active in last 7 days
- **Kicked Users**: Deactivated users count

### User Management
- **Search**: Filter users by email
- **List View**: See all users with key metrics
  - Entry count
  - Storage usage
  - Status badge
  - Join date
  - Quick actions (view, kick/restore)

- **User Details Modal**:
  - Complete user profile
  - Last 10 entries with word counts
  - Shares count
  - 2FA status
  - Timestamp of kick-out (if applicable)
  - Action buttons to kick out or restore

### User Actions
- **Kick Out**: Deactivate user (invalidates all sessions)
- **Restore**: Reactivate previously kicked user

---

## Security Considerations

✅ **Admin password**: Hashed with bcrypt
✅ **Admin sessions**: Token-based, 8-hour expiration
✅ **Session validation**: Required for all admin routes
✅ **User deactivation**: Immediate session invalidation
✅ **Error messages**: Descriptive but don't expose system info

⚠️ **Recommendations:**
- Regularly audit admin actions (future: add audit logging)
- Use strong admin passwords
- Consider TOTP 2FA for admin accounts (future enhancement)
- Monitor admin login attempts

---

## Troubleshooting

**Admin table doesn't exist:**
```bash
# Run migration again
python migrate_add_admin.py
```

**Can't create admin user:**
```bash
# Verify migration ran successfully
# Make sure bcrypt is installed
pip install bcrypt
```

**Getting "Database sync required" error:**
- This happens when the migration script is running
- Try again in a few moments
- If persists, manually run the migration script

**Admin login always fails:**
- Verify admin user was created: Check `admins` table in MySQL
- Check the hashed password format
- Try recreating the admin user with stronger password

**User can still login after being kicked:**
- Check that `is_active` field is set to `False`
- Check that all sessions were cleared
- User may need to force-refresh/clear cache

---

## Advanced: Manual Database Changes

If migrations don't work, you can manually add columns:

```sql
-- Add columns to users table
ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN kicked_out_at DATETIME NULL;

-- Create admins table
CREATE TABLE admins (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username)
);

-- Create admin_sessions table
CREATE TABLE admin_sessions (
  id VARCHAR(36) PRIMARY KEY,
  admin_id VARCHAR(36) NOT NULL,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  INDEX idx_admin (admin_id),
  INDEX idx_token (session_token)
);
```

---

## What's Next

**Optional Enhancements:**
- [ ] Admin audit logging (log all admin actions with timestamps)
- [ ] TOTP 2FA for admin accounts
- [ ] Admin role system (read-only, limited edit, full control)
- [ ] User activity logs (last login, entry creation history)
- [ ] Storage usage charts per user
- [ ] Bulk user actions (delete, export data)
- [ ] Email notifications for admin actions
- [ ] Admin activity dashboard

---

## Support

If you encounter issues:
1. Check logs in Render dashboard
2. Verify all migrations ran (`user_share_vaults`, `admins`, `admin_sessions` tables exist)
3. Test admin login on `/admin/login`
4. Check browser console for frontend errors
5. Verify API endpoints respond on `/api/admin/*`
