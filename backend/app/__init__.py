import os
import logging
from flask import Flask
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
import redis
from sqlalchemy import inspect, text

db = SQLAlchemy()
csrf = CSRFProtect()
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["200 per minute"],
)


def _ensure_critical_schema(app: Flask) -> None:
    """Best-effort schema bootstrap for production safety.

    Keeps app startup resilient when one-time migrations were missed.
    """
    with app.app_context():
        try:
            if db.engine.dialect.name != 'mysql':
                return

            inspector = inspect(db.engine)
            tables = set(inspector.get_table_names())

            if 'users' in tables:
                user_cols = {col['name'] for col in inspector.get_columns('users')}
                with db.engine.begin() as connection:
                    if 'is_active' not in user_cols:
                        app.logger.warning('Schema sync: adding users.is_active')
                        connection.execute(text('ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE'))
                    if 'kicked_out_at' not in user_cols:
                        app.logger.warning('Schema sync: adding users.kicked_out_at')
                        connection.execute(text('ALTER TABLE users ADD COLUMN kicked_out_at DATETIME NULL'))

            # Ensure critical tables used by current API routes exist.
            from app.models import Admin, AdminSession, UserShareVault

            if 'admins' not in tables:
                app.logger.warning('Schema sync: creating admins table')
                Admin.__table__.create(db.engine, checkfirst=True)
            else:
                admin_cols = {col['name'] for col in inspector.get_columns('admins')}
                with db.engine.begin() as connection:
                    if 'totp_secret' not in admin_cols:
                        app.logger.warning('Schema sync: adding admins.totp_secret')
                        connection.execute(text('ALTER TABLE admins ADD COLUMN totp_secret VARCHAR(255) NULL'))
                    if 'totp_enabled' not in admin_cols:
                        app.logger.warning('Schema sync: adding admins.totp_enabled')
                        connection.execute(text('ALTER TABLE admins ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE'))

            if 'admin_sessions' not in tables:
                app.logger.warning('Schema sync: creating admin_sessions table')
                AdminSession.__table__.create(db.engine, checkfirst=True)

            if 'user_share_vaults' not in tables:
                app.logger.warning('Schema sync: creating user_share_vaults table')
                UserShareVault.__table__.create(db.engine, checkfirst=True)
        except Exception as exc:
            # Non-fatal: startup should continue even if bootstrap cannot run.
            app.logger.error('Schema sync skipped due to error: %s', exc)


def _resolve_rate_limit_storage(redis_url: str) -> str:
    """Use Redis when reachable; otherwise fall back to in-memory limits."""
    if not redis_url:
        return 'memory://'
    try:
        client = redis.Redis.from_url(redis_url, socket_connect_timeout=1, socket_timeout=1)
        client.ping()
        return redis_url
    except Exception:
        return 'memory://'


def create_app(config_name=None):
    app = Flask(__name__)

    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'development')

    from app.config import config_map
    app.config.from_object(config_map.get(config_name, config_map['development']))
    app.config['RATELIMIT_STORAGE_URI'] = _resolve_rate_limit_storage(app.config.get('REDIS_URL'))

    # Configure logging
    if not app.debug:
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
        )
        app.logger.setLevel(logging.INFO)
        app.logger.info('Journal API startup')

    # Initialize extensions
    db.init_app(app)
    csrf.init_app(app)
    limiter.init_app(app)

    CORS(app, origins=app.config['ALLOWED_ORIGINS'], supports_credentials=True)

    # Security headers middleware
    @app.after_request
    def set_security_headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        if app.config.get('SESSION_COOKIE_SECURE'):
            response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        csp = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: blob:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self';"
        )
        response.headers['Content-Security-Policy'] = csp
        return response

    # Global error handler
    @app.errorhandler(500)
    def internal_error(error):
        app.logger.error(f'Internal server error: {error}')
        db.session.rollback()
        return {'error': 'Internal server error'}, 500

    # Register blueprints
    from app.routes.auth import auth_bp
    from app.routes.entries import entries_bp
    from app.routes.assets import assets_bp
    from app.routes.shares import shares_bp
    from app.routes.admin import admin_bp

    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(entries_bp, url_prefix='/api/entries')
    app.register_blueprint(assets_bp, url_prefix='/api/assets')
    app.register_blueprint(shares_bp, url_prefix='/api/shares')
    app.register_blueprint(admin_bp, url_prefix='/api/admin')

    # API is consumed by SPA over CORS with credentialed sessions.
    # Exempt JSON API blueprints from Flask-WTF CSRF form checks to avoid
    # false 400s in cross-origin production deployments.
    csrf.exempt(auth_bp)
    csrf.exempt(entries_bp)
    csrf.exempt(assets_bp)
    csrf.exempt(shares_bp)
    csrf.exempt(admin_bp)

    # Create tables automatically only in development
    # In production, run init_db.py once via shell or temporary startup script
    if app.config.get('DEBUG', False):
        with app.app_context():
            from app import models  # noqa: F401
            db.create_all()
    else:
        _ensure_critical_schema(app)

    return app
