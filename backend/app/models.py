import uuid
from datetime import datetime, timezone
from app import db
from sqlalchemy.dialects.mysql import LONGBLOB


def generate_uuid():
    return str(uuid.uuid4())


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    auth_key_hash = db.Column(db.String(255), nullable=False)
    key_salt = db.Column(db.LargeBinary(32), nullable=False)
    totp_secret = db.Column(db.String(255), nullable=True)
    totp_enabled = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    entries = db.relationship('JournalEntry', backref='user', lazy='dynamic', cascade='all, delete-orphan')
    sessions = db.relationship('UserSession', backref='user', lazy='dynamic', cascade='all, delete-orphan')


class JournalEntry(db.Model):
    __tablename__ = 'journal_entries'

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    encrypted_content = db.Column(db.LargeBinary, nullable=False)  # MEDIUMBLOB
    iv = db.Column(db.LargeBinary(12), nullable=False)
    encrypted_metadata = db.Column(db.LargeBinary, nullable=True)  # encrypted title/mood/tags
    metadata_iv = db.Column(db.LargeBinary(12), nullable=True)
    entry_date = db.Column(db.Date, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    assets = db.relationship('EntryAsset', backref='entry', lazy='dynamic', cascade='all, delete-orphan')

    __table_args__ = (
        db.Index('idx_user_date', 'user_id', 'entry_date'),
        db.Index('idx_user_created', 'user_id', 'created_at'),
    )


class EntryAsset(db.Model):
    __tablename__ = 'entry_assets'

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    entry_id = db.Column(db.String(36), db.ForeignKey('journal_entries.id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    encrypted_data = db.Column(
        db.LargeBinary().with_variant(LONGBLOB, 'mysql'),
        nullable=False
    )
    iv = db.Column(db.LargeBinary(12), nullable=False)
    asset_type = db.Column(db.String(50), nullable=False)
    file_size = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.Index('idx_entry', 'entry_id'),
    )


class LoginAttempt(db.Model):
    __tablename__ = 'login_attempts'

    id = db.Column(db.BigInteger, primary_key=True, autoincrement=True)
    email = db.Column(db.String(255), nullable=False)
    ip_address = db.Column(db.String(45), nullable=False)
    success = db.Column(db.Boolean, default=False)
    attempted_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.Index('idx_email_time', 'email', 'attempted_at'),
        db.Index('idx_ip_time', 'ip_address', 'attempted_at'),
    )


class UserSession(db.Model):
    __tablename__ = 'user_sessions'

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    ip_address = db.Column(db.String(45), nullable=False)
    user_agent = db.Column(db.String(512), nullable=True)
    user_agent_hash = db.Column(db.String(64), nullable=True)  # SHA256 hash for validation
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = db.Column(db.DateTime, nullable=False)

    __table_args__ = (
        db.Index('idx_session_user', 'user_id'),
        db.Index('idx_session_expires', 'expires_at'),
    )


class DailyMetadata(db.Model):
    __tablename__ = 'daily_metadata'

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    entry_date = db.Column(db.Date, nullable=False)
    has_entry = db.Column(db.Boolean, default=True)
    encrypted_mood = db.Column(db.LargeBinary(128), nullable=True)
    mood_iv = db.Column(db.LargeBinary(12), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'entry_date', name='uq_user_date'),
    )


class SignupOTP(db.Model):
    __tablename__ = 'signup_otps'

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    email = db.Column(db.String(255), nullable=False, unique=True, index=True)
    otp_hash = db.Column(db.String(64), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    attempts = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class SharedEntry(db.Model):
    __tablename__ = 'shared_entries'

    id = db.Column(db.String(36), primary_key=True, default=generate_uuid)
    entry_id = db.Column(db.String(36), db.ForeignKey('journal_entries.id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.String(36), db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    encrypted_content = db.Column(
        db.LargeBinary().with_variant(LONGBLOB, 'mysql'),
        nullable=False,
    )  # Re-encrypted with share key; can be large when entry includes images
    iv = db.Column(db.LargeBinary(12), nullable=False)
    encrypted_metadata = db.Column(
        db.LargeBinary().with_variant(LONGBLOB, 'mysql'),
        nullable=True,
    )  # Title, mood, tags
    metadata_iv = db.Column(db.LargeBinary(12), nullable=True)
    allow_download = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = db.Column(db.DateTime, nullable=True)  # Optional expiration
    view_count = db.Column(db.Integer, default=0)

    __table_args__ = (
        db.Index('idx_entry', 'entry_id'),
        db.Index('idx_user', 'user_id'),
    )
