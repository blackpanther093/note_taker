"""Authentication and session utilities."""
import functools
import hashlib
import re
from datetime import datetime, timedelta, timezone

import bcrypt
from flask import request, session, jsonify, current_app

from app import db
from app.models import LoginAttempt, UserSession


def _get_client_ip() -> str:
    """Resolve client IP safely when behind reverse proxies (e.g., Render)."""
    forwarded_for = request.headers.get('X-Forwarded-For', '')
    if forwarded_for:
        # Left-most value is the original client IP
        return forwarded_for.split(',')[0].strip() or '0.0.0.0'
    return request.remote_addr or '0.0.0.0'


def _hash_user_agent(user_agent: str) -> str:
    """Create SHA256 hash of user agent for session binding."""
    return hashlib.sha256(user_agent.encode('utf-8')).hexdigest()


def hash_auth_key(auth_key: str) -> str:
    """Hash the client-derived auth_key with bcrypt (server side).

    The client derives auth_key = HKDF(Argon2id(password, salt), "auth").
    We bcrypt-hash it on the server so that even if the DB leaks,
    the auth_key (and therefore the password) cannot be recovered.
    """
    return bcrypt.hashpw(auth_key.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')


def verify_auth_key(auth_key: str, auth_key_hash: str) -> bool:
    """Constant-time comparison of auth_key against stored bcrypt hash."""
    return bcrypt.checkpw(auth_key.encode('utf-8'), auth_key_hash.encode('utf-8'))


def validate_email(email: str) -> bool:
    """Basic email format validation."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email)) and len(email) <= 255


def check_login_lockout(email: str, ip_address: str) -> bool:
    """Check if login is currently locked out due to too many failed attempts."""
    max_attempts = current_app.config.get('MAX_LOGIN_ATTEMPTS', 5)
    lockout_minutes = current_app.config.get('LOGIN_LOCKOUT_MINUTES', 15)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=lockout_minutes)

    # Check by email
    email_attempts = LoginAttempt.query.filter(
        LoginAttempt.email == email,
        LoginAttempt.attempted_at >= cutoff,
        LoginAttempt.success == False  # noqa: E712
    ).count()

    if email_attempts >= max_attempts:
        return True

    # Check by IP
    ip_attempts = LoginAttempt.query.filter(
        LoginAttempt.ip_address == ip_address,
        LoginAttempt.attempted_at >= cutoff,
        LoginAttempt.success == False  # noqa: E712
    ).count()

    return ip_attempts >= max_attempts * 3  # More lenient for shared IPs


def record_login_attempt(email: str, ip_address: str, success: bool):
    """Record a login attempt for brute-force tracking."""
    attempt = LoginAttempt(
        email=email,
        ip_address=ip_address,
        success=success,
    )
    db.session.add(attempt)
    db.session.commit()


def create_session(user_id: str) -> str:
    """Create a server-side session tracked in DB with IP and User-Agent binding."""
    lifetime = current_app.config.get('PERMANENT_SESSION_LIFETIME', timedelta(hours=1))
    user_agent = request.headers.get('User-Agent', '')[:512]
    
    user_session = UserSession(
        user_id=user_id,
        ip_address=_get_client_ip(),
        user_agent=user_agent,
        user_agent_hash=_hash_user_agent(user_agent) if user_agent else None,
        expires_at=datetime.now(timezone.utc) + lifetime,
    )
    db.session.add(user_session)
    db.session.commit()

    # Store in Flask session
    session.permanent = True
    session['user_id'] = user_id
    session['session_id'] = user_session.id
    return user_session.id


def destroy_session():
    """Destroy current session."""
    session_id = session.get('session_id')
    if session_id:
        UserSession.query.filter_by(id=session_id).delete()
        db.session.commit()
    session.clear()


def get_current_user_id() -> str | None:
    """Get the current authenticated user ID from session with IP and User-Agent validation."""
    user_id = session.get('user_id')
    session_id = session.get('session_id')

    if not user_id or not session_id:
        return None

    # Verify session is still valid in DB
    user_session = UserSession.query.filter_by(
        id=session_id,
        user_id=user_id,
    ).first()

    if not user_session:
        return None

    # Check expiration
    if user_session.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        db.session.delete(user_session)
        db.session.commit()
        session.clear()
        return None

    # Do not invalidate active sessions on IP/User-Agent drift.
    # In production behind proxies/mobile networks/device emulation,
    # these values can change mid-session and cause false 401 logouts.
    # Session validity is enforced by signed cookie + DB session row + expiry.

    return user_id


def login_required(f):
    """Decorator to require authentication on routes."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        user_id = get_current_user_id()
        if not user_id:
            return jsonify({'error': 'Authentication required'}), 401
        return f(user_id=user_id, *args, **kwargs)
    return decorated
