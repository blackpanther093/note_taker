import os
from datetime import timedelta
from dotenv import load_dotenv
from sqlalchemy.engine import URL

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

# Build MySQL URL safely (avoids special character issues in passwords)
_db_url = URL.create(
    drivername='mysql+pymysql',
    username=os.environ.get('DB_USER', 'root'),
    password=os.environ.get('DB_PASSWORD', 'Goy@l123'),
    host=os.environ.get('DB_HOST', 'localhost'),
    port=int(os.environ.get('DB_PORT', 3306)),
    database=os.environ.get('DB_NAME', 'my_journal'),
    query={'charset': 'utf8mb4'},
)

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', os.urandom(64).hex())

    # Database
    SQLALCHEMY_DATABASE_URI = _db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_size': 10,
        'pool_recycle': 3600,
        'pool_pre_ping': True,
    }

    # Redis
    REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')

    # Session
    SESSION_COOKIE_NAME = 'journal_session'
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SECURE = os.environ.get('FLASK_ENV') == 'production'
    SESSION_COOKIE_SAMESITE = 'Lax'
    PERMANENT_SESSION_LIFETIME = timedelta(
        minutes=int(os.environ.get('SESSION_LIFETIME_MINUTES', 60))
    )

    # Security
    WTF_CSRF_TIME_LIMIT = 3600
    MAX_LOGIN_ATTEMPTS = int(os.environ.get('MAX_LOGIN_ATTEMPTS', 5))
    LOGIN_LOCKOUT_MINUTES = int(os.environ.get('LOGIN_LOCKOUT_MINUTES', 15))

    # Upload
    MAX_CONTENT_LENGTH = int(os.environ.get('MAX_UPLOAD_SIZE_MB', 10)) * 1024 * 1024
    UPLOAD_DIR = os.environ.get('UPLOAD_DIR', 'uploads')

    # CORS
    ALLOWED_ORIGINS = os.environ.get('ALLOWED_ORIGINS', 'http://localhost:3000').split(',')


class DevelopmentConfig(Config):
    DEBUG = True
    SESSION_COOKIE_SECURE = False


class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = True
    # Render often serves frontend and backend on different hostnames.
    # Use None+Secure so auth cookies are accepted in cross-site XHR.
    SESSION_COOKIE_SAMESITE = os.environ.get('SESSION_COOKIE_SAMESITE', 'None')


config_map = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
}