# My Journal — System Architecture Document

## 1. System Overview

My Journal is a zero-knowledge encrypted personal journaling platform. The server never has access to plaintext journal content. All encryption/decryption happens client-side using keys derived from the user's password.

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                         │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────────────┐    │
│  │  React   │  │  WebCrypto │  │  Rich Text Editor (Tiptap)│   │
│  │  SPA     │──│  API       │  │  + Image handling          │   │
│  └──────────┘  └────────────┘  └──────────────────────────┘    │
│         │              │                    │                    │
│         │    ┌─────────┴─────────┐          │                   │
│         │    │ Key Derivation    │          │                    │
│         │    │ Argon2id→HKDF    │          │                    │
│         │    │ AES-256-GCM      │          │                    │
│         │    └───────────────────┘          │                    │
└─────────┼──────────────────────────────────┼────────────────────┘
          │         HTTPS (TLS 1.3)          │
┌─────────┼──────────────────────────────────┼────────────────────┐
│         ▼              NGINX               ▼                    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Reverse Proxy + Rate Limiting               │    │
│  │              Static File Serving                         │    │
│  │              TLS Termination                              │   │
│  └──────────────────────┬──────────────────────────────────┘    │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────────────┐
│                    FLASK APPLICATION                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐    │
│  │  Auth    │  │  Journal  │  │  Upload  │  │  Security    │    │
│  │  Routes  │  │  Routes   │  │  Routes  │  │  Middleware  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │  CSRF    │  │  Rate    │  │  Session  │                      │
│  │  Guard   │  │  Limiter │  │  Manager  │                      │
│  └──────────┘  └──────────┘  └──────────┘                      │
│         │              │              │                          │
└─────────┼──────────────┼──────────────┼─────────────────────────┘
          │              │              │
┌─────────┼──────────────┼──────────────┼─────────────────────────┐
│  ┌──────▼──────┐ ┌─────▼─────┐  ┌────▼───────┐                 │
│  │   MySQL     │ │   Redis   │  │ File Store │                  │
│  │  Database   │ │  Sessions │  │  (uploads) │                  │
│  │             │ │  + Cache  │  │            │                  │
│  └─────────────┘ └───────────┘  └────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Security Architecture

### 2.1 Zero-Knowledge Encryption Model

The core security principle: **the server is untrusted storage**. It stores encrypted blobs and never possesses decryption keys.

**Key Hierarchy:**
```
User Password
     │
     ▼
Argon2id(password, salt, t=3, m=65536, p=4)
     │
     ├──► auth_key = HKDF(master_key, "auth")     → sent to server for login
     │
     └──► encryption_key = HKDF(master_key, "enc") → NEVER leaves browser
              │
              ▼
         Per-entry keys:
         entry_key = HKDF(encryption_key, entry_id)
              │
              ▼
         AES-256-GCM(plaintext, entry_key, random_iv)
              │
              ▼
         {ciphertext, iv, auth_tag} → stored on server
```

### 2.2 Why Two Derived Keys?

- **auth_key**: A key derived for authentication. The server stores a hash of this (double-hashed: Argon2id on client → bcrypt on server). This way the server never sees the raw password nor can derive the encryption key.
- **encryption_key**: Used solely for encrypting/decrypting journal data. Never transmitted.

### 2.3 Per-Entry Key Derivation

Using HKDF with the entry ID as context ensures:
- Each entry has a unique encryption key
- Compromise of one entry's key doesn't affect others
- No need to store additional key material

### 2.4 Password Change Flow

When a user changes their password:
1. Derive old encryption_key from old password
2. Decrypt all entries client-side
3. Derive new encryption_key from new password
4. Re-encrypt all entries
5. Send re-encrypted entries + new auth_key to server in a single transaction

## 3. Encryption Flow (Step-by-Step)

### 3.1 Registration
1. User enters email + password
2. Client generates a random 32-byte salt (stored on server)
3. Client derives: `master_key = Argon2id(password, salt)`
4. Client derives: `auth_key = HKDF(master_key, "auth")`
5. Client derives: `encryption_key = HKDF(master_key, "enc")` — kept in memory only
6. Client sends `{email, auth_key, salt}` to server
7. Server hashes auth_key with bcrypt and stores `{email, bcrypt(auth_key), salt}`

### 3.2 Login
1. Client requests salt for email from server
2. Client derives master_key → auth_key using Argon2id + HKDF
3. Client sends `{email, auth_key}` to server
4. Server verifies `bcrypt(auth_key)` matches stored hash
5. Server creates session, returns session cookie
6. Client keeps encryption_key in memory (sessionStorage or derived on each login)

### 3.3 Creating an Entry
1. User writes entry in rich text editor
2. Client serializes editor state to JSON
3. Client generates a temporary entry UUID
4. Client derives: `entry_key = HKDF(encryption_key, entry_uuid)`
5. Client generates random 12-byte IV
6. Client encrypts: `{ciphertext, tag} = AES-256-GCM(json, entry_key, iv)`
7. Client sends `{encrypted_content: base64(ciphertext+tag), iv: base64(iv), entry_uuid}` to server
8. Server stores the encrypted blob — cannot read it

### 3.4 Reading an Entry
1. Client requests encrypted entry from server
2. Client derives: `entry_key = HKDF(encryption_key, entry_id)`
3. Client decrypts: `plaintext = AES-256-GCM.decrypt(ciphertext, entry_key, iv)`
4. Client renders the decrypted JSON in the editor

## 4. Database Schema

```sql
-- Core user table
CREATE TABLE users (
    id CHAR(36) PRIMARY KEY,               -- UUID v4
    email VARCHAR(255) NOT NULL UNIQUE,
    auth_key_hash VARCHAR(255) NOT NULL,    -- bcrypt hash of auth_key
    key_salt BINARY(32) NOT NULL,           -- salt for Argon2id key derivation
    totp_secret VARCHAR(255) DEFAULT NULL,  -- optional 2FA
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email)
);

-- Encrypted journal entries
CREATE TABLE journal_entries (
    id CHAR(36) PRIMARY KEY,                -- UUID (used in key derivation)
    user_id CHAR(36) NOT NULL,
    encrypted_content MEDIUMBLOB NOT NULL,   -- AES-256-GCM ciphertext
    iv BINARY(12) NOT NULL,                  -- GCM initialization vector
    encrypted_metadata BLOB DEFAULT NULL,    -- encrypted title/mood/tags for client-side search
    entry_date DATE NOT NULL,                -- unencrypted for calendar view
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_date (user_id, entry_date DESC),
    INDEX idx_user_created (user_id, created_at DESC)
);

-- Encrypted assets (images)
CREATE TABLE entry_assets (
    id CHAR(36) PRIMARY KEY,
    entry_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    encrypted_data LONGBLOB NOT NULL,        -- encrypted file bytes
    iv BINARY(12) NOT NULL,
    asset_type VARCHAR(50) NOT NULL,          -- e.g., 'image/jpeg'
    file_size INT UNSIGNED NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_entry (entry_id)
);

-- Login attempt tracking for brute-force protection
CREATE TABLE login_attempts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_time (email, attempted_at),
    INDEX idx_ip_time (ip_address, attempted_at)
);

-- Active sessions (supplement to Redis)
CREATE TABLE user_sessions (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent VARCHAR(512),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_expires (expires_at)
);

-- Writing streak and mood tracking (unencrypted metadata)
CREATE TABLE daily_metadata (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    entry_date DATE NOT NULL,
    has_entry BOOLEAN DEFAULT TRUE,
    encrypted_mood VARBINARY(128) DEFAULT NULL,  -- encrypted mood value
    mood_iv BINARY(12) DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE INDEX idx_user_date (user_id, entry_date)
);
```

**Schema Design Decisions:**
- UUIDs instead of auto-increment: prevents enumeration attacks
- `encrypted_content` as MEDIUMBLOB: supports large rich-text entries
- `entry_date` is unencrypted: enables calendar view without decryption (acceptable trade-off — only reveals that an entry exists on a date)
- Separate `entry_assets` table: images encrypted independently, referenced by entry
- `login_attempts` table: enables brute-force detection
- `daily_metadata`: allows streak calculation without decrypting entries

## 5. API Design

### Authentication
```
POST   /api/auth/register         Register new user
POST   /api/auth/salt             Get user's salt (by email)
POST   /api/auth/login            Login with auth_key
POST   /api/auth/logout           Destroy session
POST   /api/auth/refresh          Refresh session
GET    /api/auth/me               Get current user info
POST   /api/auth/change-password  Re-key all entries
POST   /api/auth/setup-2fa        Setup TOTP 2FA
POST   /api/auth/verify-2fa       Verify TOTP code
```

### Journal Entries
```
GET    /api/entries                List entries (encrypted, paginated)
POST   /api/entries               Create new entry
GET    /api/entries/:id            Get single entry (encrypted)
PUT    /api/entries/:id            Update entry
DELETE /api/entries/:id            Delete entry
GET    /api/entries/calendar/:year/:month   Calendar view data
GET    /api/entries/streak         Get writing streak info
```

### Assets
```
POST   /api/assets/upload          Upload encrypted image
GET    /api/assets/:id             Get encrypted image
DELETE /api/assets/:id             Delete image
```

## 6. Attack Vectors and Mitigations

| Attack Vector | Mitigation |
|---|---|
| SQL Injection | SQLAlchemy ORM with parameterized queries only |
| XSS | React auto-escapes, CSP headers, DOMPurify on render |
| CSRF | SameSite cookies + CSRF tokens via Flask-WTF |
| Brute Force | Rate limiting (5 attempts/15min), exponential backoff |
| Session Hijacking | Secure/HttpOnly/SameSite cookies, session binding to IP |
| Server DB Compromise | Zero-knowledge: only encrypted blobs stored |
| Man-in-the-Middle | TLS 1.3, HSTS headers |
| File Upload Attacks | Type validation, size limits, encrypted storage |
| Timing Attacks | Constant-time comparison for auth_key verification |
| Enumeration | Generic error messages, rate limiting on salt endpoint |

## 7. Deployment Architecture

```
Internet → Cloudflare (DDoS) → Nginx (TLS + Rate Limit)
    → Gunicorn (Flask workers) → MySQL + Redis
    → Static files served by Nginx
```

- **Nginx**: TLS termination, rate limiting, static serving, reverse proxy
- **Gunicorn**: Multi-worker WSGI server for Flask
- **MySQL**: Primary data store with encrypted blobs
- **Redis**: Session store + rate limit counters + caching
- **Docker Compose**: For local development and deployment
