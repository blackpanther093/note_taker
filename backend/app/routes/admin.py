"""Admin routes for dashboard and user management."""
import base64
import os
import secrets
import io
from datetime import datetime, timedelta, timezone
from functools import wraps

from flask import Blueprint, request, jsonify, session, current_app
from sqlalchemy import func, desc
import pyotp
import qrcode

from app import db
from app.models import User, Admin, AdminSession, JournalEntry, EntryAsset, SharedEntry

admin_bp = Blueprint('admin', __name__, url_prefix='/api/admin')


def _as_utc(dt):
    """Normalize naive/aware datetimes to UTC-aware for safe comparison."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def admin_login_required(f):
    """Decorator to require admin login."""

    @wraps(f)
    def decorated(*args, **kwargs):
        admin_sid = request.headers.get('X-Admin-Session') or session.get('admin_sid')
        if not admin_sid:
            return jsonify({'error': 'Admin authentication required'}), 401

        admin_session = AdminSession.query.filter_by(session_token=admin_sid).first()
        expires_at = _as_utc(admin_session.expires_at) if admin_session else None
        if not admin_session or not expires_at or expires_at < datetime.now(timezone.utc):
            return jsonify({'error': 'Admin session invalid or expired'}), 401

        admin = admin_session.admin
        return f(admin_id=admin.id, *args, **kwargs)

    return decorated


@admin_bp.route('/login', methods=['POST'])
def admin_login():
    """Admin login with username and password."""
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request'}), 400

    username = data.get('username', '').strip()
    password = data.get('password', '')
    totp_code = data.get('totp_code', '').strip()

    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400

    admin = Admin.query.filter_by(username=username).first()
    if not admin:
        return jsonify({'error': 'Invalid credentials'}), 401

    # Simple password check (in production, use bcrypt)
    import bcrypt
    try:
        if not bcrypt.checkpw(password.encode(), admin.password_hash.encode()):
            return jsonify({'error': 'Invalid credentials'}), 401
    except Exception:
        return jsonify({'error': 'Invalid credentials'}), 401

    if admin.totp_enabled:
        if not totp_code:
            return jsonify({'error': '2FA code required', 'requires_2fa': True}), 401
        try:
            totp = pyotp.TOTP(admin.totp_secret)
            if not totp.verify(totp_code, valid_window=1):
                return jsonify({'error': 'Invalid 2FA code', 'requires_2fa': True}), 401
        except Exception:
            return jsonify({'error': 'Invalid 2FA setup'}), 400

    # Create session
    session_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=8)

    admin_session = AdminSession(
        admin_id=admin.id,
        session_token=session_token,
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent', ''),
        expires_at=expires_at,
    )
    db.session.add(admin_session)
    db.session.commit()

    session['admin_sid'] = session_token
    return jsonify({
        'message': 'Admin login successful',
        'session_token': session_token,
        'admin_id': admin.id,
        'username': admin.username,
        'totp_enabled': bool(admin.totp_enabled),
    }), 200


@admin_bp.route('/setup-2fa', methods=['POST'])
@admin_login_required
def setup_admin_2fa(admin_id):
    """Generate TOTP secret and QR code for admin 2FA setup."""
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({'error': 'Admin not found'}), 404

    if admin.totp_enabled and admin.totp_secret:
        return jsonify({'error': '2FA already enabled'}), 400

    secret = pyotp.random_base32()
    admin.totp_secret = secret
    admin.totp_enabled = False
    db.session.commit()

    issuer = 'My Journal Admin'
    account = admin.email or admin.username
    provisioning_uri = pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name=issuer)

    qr = qrcode.make(provisioning_uri)
    buffer = io.BytesIO()
    qr.save(buffer, format='PNG')
    qr_b64 = base64.b64encode(buffer.getvalue()).decode()

    return jsonify({
        'secret': secret,
        'qr_code': f'data:image/png;base64,{qr_b64}',
    }), 200


@admin_bp.route('/verify-2fa', methods=['POST'])
@admin_login_required
def verify_admin_2fa(admin_id):
    """Verify admin TOTP code and enable 2FA."""
    data = request.get_json(silent=True)
    if not data or not data.get('totp_code'):
        return jsonify({'error': 'TOTP code required'}), 400

    admin = Admin.query.get(admin_id)
    if not admin or not admin.totp_secret:
        return jsonify({'error': 'Setup 2FA first'}), 400

    totp = pyotp.TOTP(admin.totp_secret)
    if not totp.verify(data['totp_code'], valid_window=1):
        return jsonify({'error': 'Invalid code'}), 400

    admin.totp_enabled = True
    db.session.commit()

    return jsonify({'message': 'Admin 2FA enabled successfully'}), 200


@admin_bp.route('/logout', methods=['POST'])
@admin_login_required
def admin_logout(admin_id):
    """Admin logout."""
    admin_sid = request.headers.get('X-Admin-Session') or session.get('admin_sid')
    if admin_sid:
        admin_session = AdminSession.query.filter_by(session_token=admin_sid).first()
        if admin_session:
            db.session.delete(admin_session)
            db.session.commit()

    session.pop('admin_sid', None)
    return jsonify({'message': 'Admin logout successful'}), 200


@admin_bp.route('/me', methods=['GET'])
@admin_login_required
def admin_me(admin_id):
    """Get current admin profile for dashboard/session restore."""
    admin = Admin.query.get(admin_id)
    if not admin:
        return jsonify({'error': 'Admin not found'}), 404

    return jsonify({
        'admin': {
            'id': admin.id,
            'username': admin.username,
            'email': admin.email,
            'totp_enabled': bool(admin.totp_enabled),
        }
    }), 200


@admin_bp.route('/dashboard', methods=['GET'])
@admin_login_required
def get_dashboard(admin_id):
    """Get dashboard stats - total users, notes, storage usage, etc."""
    try:
        total_users = User.query.filter_by(is_active=True).count()
        total_entries = JournalEntry.query.count()
        
        # Calculate total storage used
        storage_result = db.session.query(func.sum(EntryAsset.file_size)).scalar() or 0
        storage_used_mb = storage_result / (1024 * 1024)

        # Active users (logged in last 7 days)
        seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
        active_users = User.query.join(User.sessions).filter(
            User.is_active == True,
        ).distinct().count()

        # Kicked out users
        kicked_users = User.query.filter_by(is_active=False).count()

        return jsonify({
            'total_users': total_users,
            'total_entries': total_entries,
            'storage_used_mb': round(storage_used_mb, 2),
            'active_users': active_users,
            'kicked_users': kicked_users,
        }), 200
    except Exception as e:
        current_app.logger.error(f"Dashboard stats error: {e}")
        return jsonify({'error': 'Failed to fetch dashboard stats'}), 500


@admin_bp.route('/users', methods=['GET'])
@admin_login_required
def list_users(admin_id):
    """List all users with their stats."""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)

        # Get all users with pagination
        query = User.query.order_by(desc(User.created_at))
        pagination = query.paginate(page=page, per_page=per_page)
        users = pagination.items

        users_data = []
        for user in users:
            entry_count = JournalEntry.query.filter_by(user_id=user.id).count()
            asset_size = db.session.query(func.sum(EntryAsset.file_size)).filter(
                EntryAsset.entry_id.in_(
                    db.session.query(JournalEntry.id).filter_by(user_id=user.id)
                )
            ).scalar() or 0

            users_data.append({
                'id': user.id,
                'email': user.email,
                'entries': entry_count,
                'storage_mb': round(asset_size / (1024 * 1024), 2),
                'is_active': user.is_active,
                'kicked_out_at': user.kicked_out_at.isoformat() if user.kicked_out_at else None,
                'created_at': user.created_at.isoformat(),
                'last_updated': user.updated_at.isoformat(),
            })

        return jsonify({
            'users': users_data,
            'total': pagination.total,
            'pages': pagination.pages,
            'current_page': page,
        }), 200
    except Exception as e:
        current_app.logger.error(f"List users error: {e}")
        return jsonify({'error': 'Failed to fetch users'}), 500


@admin_bp.route('/user/<user_id>', methods=['GET'])
@admin_login_required
def get_user_details(admin_id, user_id):
    """Get detailed info about a specific user."""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        entries = JournalEntry.query.filter_by(user_id=user_id).all()
        total_assets_size = db.session.query(func.sum(EntryAsset.file_size)).filter(
            EntryAsset.entry_id.in_(
                db.session.query(JournalEntry.id).filter_by(user_id=user_id)
            )
        ).scalar() or 0

        shares = SharedEntry.query.filter_by(user_id=user_id).count()

        return jsonify({
            'id': user.id,
            'email': user.email,
            'is_active': user.is_active,
            'kicked_out_at': user.kicked_out_at.isoformat() if user.kicked_out_at else None,
            'entries': len(entries),
            'shares': shares,
            'storage_mb': round(total_assets_size / (1024 * 1024), 2),
            'totp_enabled': user.totp_enabled,
            'created_at': user.created_at.isoformat(),
            'updated_at': user.updated_at.isoformat(),
            'entries_list': [
                {
                    'id': e.id,
                    # Title/body are encrypted client-side and unavailable to admin backend.
                    'title': 'Encrypted entry',
                    'created_at': e.created_at.isoformat(),
                    'word_count': 0,
                }
                for e in entries[:10]  # Last 10 entries
            ],
        }), 200
    except Exception as e:
        current_app.logger.error(f"Get user details error: {e}")
        return jsonify({'error': 'Failed to fetch user details'}), 500


@admin_bp.route('/user/<user_id>/kick', methods=['POST'])
@admin_login_required
def kick_user(admin_id, user_id):
    """Kick a user out - mark as inactive."""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        user.is_active = False
        user.kicked_out_at = datetime.now(timezone.utc)

        # Clear all active sessions for this user
        from app.models import UserSession
        UserSession.query.filter_by(user_id=user_id).delete()

        db.session.commit()

        return jsonify({
            'message': 'User kicked out successfully',
            'user_id': user_id,
            'kicked_out_at': user.kicked_out_at.isoformat(),
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Kick user error: {e}")
        return jsonify({'error': 'Failed to kick user'}), 500


@admin_bp.route('/user/<user_id>/restore', methods=['POST'])
@admin_login_required
def restore_user(admin_id, user_id):
    """Restore a kicked-out user."""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        user.is_active = True
        user.kicked_out_at = None
        db.session.commit()

        return jsonify({
            'message': 'User restored successfully',
            'user_id': user_id,
        }), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Restore user error: {e}")
        return jsonify({'error': 'Failed to restore user'}), 500
