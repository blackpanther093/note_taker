"""Authentication routes."""
import base64
import hashlib
import hmac
import os
import random
from datetime import datetime, timedelta, timezone

import pyotp
import qrcode
import io
from flask import Blueprint, request, jsonify, session
from flask_wtf.csrf import generate_csrf
import sib_api_v3_sdk
from sib_api_v3_sdk.rest import ApiException

from app import db, limiter, csrf
from app.models import User, SignupOTP, UserShareVault
from app.auth_utils import (
    hash_auth_key,
    verify_auth_key,
    validate_email,
    check_login_lockout,
    record_login_attempt,
    create_session,
    destroy_session,
    login_required,
)

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/csrf', methods=['GET'])
def get_csrf_token():
    """Get CSRF token for subsequent requests."""
    token = generate_csrf()
    return jsonify({'csrf_token': token})


def _now_utc():
    return datetime.now(timezone.utc)


def _otp_hash(email: str, otp_code: str, secret: str) -> str:
    payload = f"{email}:{otp_code}:{secret}".encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def _get_brevo_api_client():
    """Initialize and return a Brevo transactional email client."""
    api_key = os.environ.get('BREVO_API_KEY', '').strip()
    if not api_key:
        raise ValueError('BREVO_API_KEY environment variable not set.')

    configuration = sib_api_v3_sdk.Configuration()
    configuration.api_key['api-key'] = api_key
    return sib_api_v3_sdk.TransactionalEmailsApi(sib_api_v3_sdk.ApiClient(configuration))


def _send_brevo_otp_email(to_email: str, otp_code: str) -> None:
    sender_email = os.environ.get('SENDER_EMAIL', '').strip() or os.environ.get('BREVO_SENDER_EMAIL', '').strip()
    sender_name = os.environ.get('BREVO_SENDER_NAME', 'My Journal').strip()

    if not sender_email:
        raise ValueError('SENDER_EMAIL or BREVO_SENDER_EMAIL environment variable not set.')

    html_content = (
        '<div style="font-family: sans-serif; padding: 20px; color: #333;">'
        '<h2 style="color: #0052cc;">Verify your email</h2>'
        '<p>Your My Journal verification code is:</p>'
        f'<h1 style="letter-spacing: 4px; margin: 16px 0;">{otp_code}</h1>'
        '<p>For your security, this OTP expires in 10 minutes.</p>'
        '</div>'
    )

    send_smtp_email = sib_api_v3_sdk.SendSmtpEmail(
        to=[{'email': to_email}],
        sender={'name': sender_name, 'email': sender_email},
        subject='Your My Journal signup OTP',
        html_content=html_content,
    )

    api_instance = _get_brevo_api_client()
    api_instance.send_transac_email(send_smtp_email)


@auth_bp.route('/register/request-otp', methods=['POST'])
@limiter.limit("3 per 10 minute")
@csrf.exempt
def request_register_otp():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    email = data.get('email', '').strip().lower()
    if not email or not validate_email(email):
        return jsonify({'error': 'Invalid email format'}), 400

    existing = User.query.filter_by(email=email).first()
    if existing:
        return jsonify({'error': 'Email is already registered'}), 409

    otp_code = f"{random.randint(0, 999999):06d}"
    otp_secret = os.environ.get('OTP_SERVER_SECRET', '') or os.environ.get('SECRET_KEY', '')
    if not otp_secret:
        return jsonify({'error': 'Server configuration error'}), 500

    otp_record = SignupOTP.query.filter_by(email=email).first()
    if not otp_record:
        otp_record = SignupOTP(email=email)
        db.session.add(otp_record)

    otp_record.otp_hash = _otp_hash(email, otp_code, otp_secret)
    otp_record.expires_at = _now_utc() + timedelta(minutes=10)
    otp_record.attempts = 0

    # In development mode, skip email and log OTP to console
    is_dev = os.environ.get('FLASK_ENV', '').lower() == 'development'
    
    if is_dev:
        print(f"\n{'='*60}")
        print(f"[DEV MODE] OTP for {email}: {otp_code}")
        print(f"{'='*60}\n")
        db.session.commit()
        return jsonify({
            'message': 'OTP sent to your email',
            'dev_note': 'Check console for OTP code'
        }), 200

    try:
        _send_brevo_otp_email(email, otp_code)
    except ApiException as exc:
        db.session.rollback()
        body_text = exc.body or str(exc)
        if exc.status == 401 and 'Key not found' in body_text:
            return jsonify({
                'error': 'Brevo API key is invalid. Use a valid API v3 key (starts with xkeysib-) in BREVO_API_KEY.'
            }), 500
        return jsonify({'error': f'Brevo API error: {body_text}'}), 500
    except Exception as exc:
        db.session.rollback()
        return jsonify({'error': f'Failed to send OTP email: {str(exc)}'}), 500

    db.session.commit()
    return jsonify({'message': 'OTP sent to your email'}), 200


@auth_bp.route('/register', methods=['POST'])
@limiter.limit("5 per minute")
@csrf.exempt  # CSRF exempt for API — we use SameSite cookies + auth_key
def register():
    """Register a new user.

    Expects JSON:
    {
        "email": "user@example.com",
        "auth_key": "<base64 encoded HKDF-derived auth key>",
        "salt": "<base64 encoded 32-byte salt>",
        "otp_code": "123456"
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request body'}), 400

    email = data.get('email', '').strip().lower()
    auth_key = data.get('auth_key', '')
    salt_b64 = data.get('salt', '')
    otp_code = data.get('otp_code', '').strip()
    # print(otp_code)
    # Validate inputs
    if not email or not auth_key or not salt_b64 or not otp_code:
        return jsonify({'error': 'Missing required fields'}), 400

    if not validate_email(email):
        return jsonify({'error': 'Invalid email format'}), 400

    if len(auth_key) < 32:
        return jsonify({'error': 'Invalid auth key'}), 400

    try:
        salt = base64.b64decode(salt_b64)
        if len(salt) != 32:
            return jsonify({'error': 'Invalid salt'}), 400
    except Exception:
        return jsonify({'error': 'Invalid salt encoding'}), 400

    # Check if user already exists
    existing = User.query.filter_by(email=email).first()
    if existing:
        # Return generic error to prevent email enumeration
        return jsonify({'error': 'Registration failed'}), 409

    otp_record = SignupOTP.query.filter_by(email=email).first()
    if not otp_record:
        return jsonify({'error': 'Please request OTP first'}), 400

    expires_at = otp_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < _now_utc():
        db.session.delete(otp_record)
        db.session.commit()
        return jsonify({'error': 'OTP expired. Request a new one.'}), 400

    if otp_record.attempts >= 5:
        return jsonify({'error': 'Too many invalid OTP attempts. Request a new OTP.'}), 429

    otp_secret = os.environ.get('OTP_SERVER_SECRET', '') or os.environ.get('SECRET_KEY', '')
    if not otp_secret:
        return jsonify({'error': 'Server configuration error'}), 500
    expected_hash = _otp_hash(email, otp_code, otp_secret)
    if not hmac.compare_digest(expected_hash, otp_record.otp_hash):
        otp_record.attempts += 1
        db.session.commit()
        return jsonify({'error': 'Invalid OTP code'}), 400

    # Create user
    user = User(
        email=email,
        auth_key_hash=hash_auth_key(auth_key),
        key_salt=salt,
    )
    db.session.add(user)
    db.session.delete(otp_record)
    db.session.commit()

    # Auto-login after registration
    create_session(user.id)

    return jsonify({
        'message': 'Registration successful',
        'user': {
            'id': user.id,
            'email': user.email,
        }
    }), 201


@auth_bp.route('/salt', methods=['POST'])
@limiter.limit("10 per minute")
@csrf.exempt
def get_salt():
    """Get the key derivation salt for a user.

    This must be available before login so the client can derive keys.
    Rate-limited to prevent enumeration.

    Expects JSON: {"email": "user@example.com"}
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request'}), 400

    email = data.get('email', '').strip().lower()
    if not email:
        return jsonify({'error': 'Email required'}), 400

    user = User.query.filter_by(email=email).first()
    if not user:
        # Return a deterministic fake salt to prevent email enumeration.
        # We derive it so the same email always gets the same fake salt.
        import hashlib
        fake_salt = hashlib.sha256(f"fake-salt-{email}".encode()).digest()
        return jsonify({'salt': base64.b64encode(fake_salt).decode()})

    return jsonify({'salt': base64.b64encode(user.key_salt).decode()})


@auth_bp.route('/login', methods=['POST'])
@limiter.limit("10 per minute")
@csrf.exempt
def login():
    """Login with email and client-derived auth_key.

    Expects JSON:
    {
        "email": "user@example.com",
        "auth_key": "<base64 encoded auth key>",
        "totp_code": "123456"  (optional, required if 2FA enabled)
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request'}), 400

    email = data.get('email', '').strip().lower()
    auth_key = data.get('auth_key', '')
    totp_code = data.get('totp_code', '')
    ip = request.remote_addr or '0.0.0.0'

    if not email or not auth_key:
        return jsonify({'error': 'Missing credentials'}), 400

    # Check lockout
    if check_login_lockout(email, ip):
        return jsonify({'error': 'Too many login attempts. Please try again later.'}), 429

    user = User.query.filter_by(email=email).first()

    # Use generic error to prevent enumeration
    if not user or not verify_auth_key(auth_key, user.auth_key_hash):
        record_login_attempt(email, ip, success=False)
        return jsonify({'error': 'Invalid credentials'}), 401

    # 2FA check
    if user.totp_enabled:
        if not totp_code:
            return jsonify({'error': '2FA code required', 'requires_2fa': True}), 401
        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(totp_code, valid_window=1):
            record_login_attempt(email, ip, success=False)
            return jsonify({'error': 'Invalid 2FA code'}), 401

    record_login_attempt(email, ip, success=True)
    create_session(user.id)

    return jsonify({
        'message': 'Login successful',
        'user': {
            'id': user.id,
            'email': user.email,
        }
    })


@auth_bp.route('/logout', methods=['POST'])
def logout():
    """Destroy session and log out."""
    destroy_session()
    return jsonify({'message': 'Logged out'})


@auth_bp.route('/me', methods=['GET'])
@login_required
def me(user_id):
    """Get current user info."""
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    return jsonify({
        'user': {
            'id': user.id,
            'email': user.email,
            'totp_enabled': user.totp_enabled,
            'created_at': user.created_at.isoformat() if user.created_at else None,
        }
    })


@auth_bp.route('/share-vault', methods=['GET'])
@login_required
def get_share_vault(user_id):
    """Fetch encrypted share key vault for the logged in user.

    The server stores only opaque ciphertext + IV.
    Decryption always happens client-side with a key derived from user's password.
    """
    vault = UserShareVault.query.filter_by(user_id=user_id).first()
    if not vault:
        return jsonify({'exists': False}), 200

    return jsonify({
        'exists': True,
        'encrypted_vault': base64.b64encode(vault.encrypted_vault).decode(),
        'iv': base64.b64encode(vault.iv).decode(),
        'updated_at': vault.updated_at.isoformat() if vault.updated_at else None,
    }), 200


@auth_bp.route('/share-vault', methods=['PUT'])
@login_required
def upsert_share_vault(user_id):
    """Upsert encrypted share key vault payload.

    Expects JSON:
    {
        "encrypted_vault": "<base64 ciphertext>",
        "iv": "<base64 12-byte IV>"
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request'}), 400

    encrypted_vault_b64 = data.get('encrypted_vault', '')
    iv_b64 = data.get('iv', '')
    if not encrypted_vault_b64 or not iv_b64:
        return jsonify({'error': 'Missing required fields'}), 400

    try:
        encrypted_vault = base64.b64decode(encrypted_vault_b64)
        iv = base64.b64decode(iv_b64)
    except Exception:
        return jsonify({'error': 'Invalid vault encoding'}), 400

    if len(iv) != 12:
        return jsonify({'error': 'IV must be 12 bytes'}), 400

    vault = UserShareVault.query.filter_by(user_id=user_id).first()
    if not vault:
        vault = UserShareVault(user_id=user_id, encrypted_vault=encrypted_vault, iv=iv)
        db.session.add(vault)
    else:
        vault.encrypted_vault = encrypted_vault
        vault.iv = iv

    db.session.commit()
    return jsonify({'message': 'Share vault updated'}), 200


@auth_bp.route('/setup-2fa', methods=['POST'])
@login_required
def setup_2fa(user_id):
    """Generate TOTP secret and QR code for 2FA setup."""
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    if user.totp_enabled:
        return jsonify({'error': '2FA already enabled'}), 400

    secret = pyotp.random_base32()
    user.totp_secret = secret
    db.session.commit()

    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(
        name=user.email,
        issuer_name='My Journal'
    )

    # Generate QR code as base64
    qr = qrcode.make(provisioning_uri)
    buffer = io.BytesIO()
    qr.save(buffer, format='PNG')
    qr_b64 = base64.b64encode(buffer.getvalue()).decode()

    return jsonify({
        'secret': secret,
        'qr_code': f'data:image/png;base64,{qr_b64}',
    })


@auth_bp.route('/verify-2fa', methods=['POST'])
@login_required
def verify_2fa(user_id):
    """Verify TOTP code to enable 2FA."""
    data = request.get_json(silent=True)
    if not data or not data.get('totp_code'):
        return jsonify({'error': 'TOTP code required'}), 400

    user = User.query.get(user_id)
    if not user or not user.totp_secret:
        return jsonify({'error': 'Setup 2FA first'}), 400

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(data['totp_code'], valid_window=1):
        return jsonify({'error': 'Invalid code'}), 400

    user.totp_enabled = True
    db.session.commit()

    return jsonify({'message': '2FA enabled successfully'})


@auth_bp.route('/change-password', methods=['POST'])
@login_required
@limiter.limit("3 per hour")
def change_password(user_id):
    """Change password and re-key all entries.

    Expects JSON:
    {
        "old_auth_key": "<current auth key>",
        "new_auth_key": "<new auth key>",
        "new_salt": "<new salt base64>",
        "reencrypted_entries": [
            {
                "id": "entry-uuid",
                "encrypted_content": "<base64>",
                "iv": "<base64>",
                "encrypted_metadata": "<base64>",
                "metadata_iv": "<base64>"
            }
        ]
    }
    """
    from app.models import JournalEntry

    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request'}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    # Verify old password
    if not verify_auth_key(data.get('old_auth_key', ''), user.auth_key_hash):
        return jsonify({'error': 'Current password incorrect'}), 401

    try:
        new_salt = base64.b64decode(data['new_salt'])
        if len(new_salt) != 32:
            return jsonify({'error': 'Invalid salt'}), 400
    except Exception:
        return jsonify({'error': 'Invalid salt'}), 400

    # Update auth key and salt
    user.auth_key_hash = hash_auth_key(data['new_auth_key'])
    user.key_salt = new_salt

    # Re-encrypt all entries (transactional)
    for entry_data in data.get('reencrypted_entries', []):
        entry = JournalEntry.query.filter_by(
            id=entry_data['id'],
            user_id=user_id,
        ).first()
        if entry:
            entry.encrypted_content = base64.b64decode(entry_data['encrypted_content'])
            entry.iv = base64.b64decode(entry_data['iv'])
            if entry_data.get('encrypted_metadata'):
                entry.encrypted_metadata = base64.b64decode(entry_data['encrypted_metadata'])
                entry.metadata_iv = base64.b64decode(entry_data['metadata_iv'])

    db.session.commit()

    # Invalidate all existing sessions except current
    from app.models import UserSession
    current_session_id = session.get('session_id')
    UserSession.query.filter(
        UserSession.user_id == user_id,
        UserSession.id != current_session_id,
    ).delete()
    db.session.commit()

    return jsonify({'message': 'Password changed successfully'})
