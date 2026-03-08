# My Journal

A zero-knowledge encrypted personal journaling platform.

## What Is New (Production)

- Cross-origin cookie auth hardened for Render frontend/backend split
- API CSRF exemptions for JSON endpoints (auth, entries, assets, shares)
- Rich entry support with encrypted image upload + clipboard image paste (`Ctrl/Cmd+V`)
- IST-aware streak computation and dashboard counters
- Share links with end-to-end encrypted payloads and live sync on save
- Encrypted server-backed share-key vault (keys are encrypted client-side before upload)
- Public share page improvements (view count + shared timestamp)

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or .\venv\Scripts\Activate.ps1 on Windows
pip install -r requirements.txt
cp ../.env.example ../.env  # edit with your settings
python run.py
```

### Frontend
```bash
cd frontend
npm install
npm start
```

### Database Setup
```sql
CREATE DATABASE my_journal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'journal_user'@'localhost' IDENTIFIED BY 'strongpassword';
GRANT ALL PRIVILEGES ON my_journal.* TO 'journal_user'@'localhost';
FLUSH PRIVILEGES;
```

Then run migrations:
```bash
cd backend
python init_db.py
```

## Production Runbook

### 1. Required one-time schema setup

Run these in backend shell after deploy:

```bash
cd backend
python init_tables.py
python migrate_to_longblob.py
python migrate_add_share_vault.py
```

### 2. Environment notes

- `SESSION_COOKIE_SAMESITE=None` in production for cross-site cookie auth
- `SESSION_COOKIE_SECURE=true` in production
- `ALLOWED_ORIGINS` must include deployed frontend URL

### 3. Share Vault (Cross-device share key sync)

- Share keys are never sent in plaintext to server.
- Browser derives a vault key from user encryption key.
- Vault JSON is encrypted client-side with AES-GCM and uploaded as opaque blob.
- On login, client fetches/decrypts/merges remote vault with local vault.
- On save/share updates, vault is re-encrypted and synced.
- On password change, vault is re-encrypted with the new derived key.

### 4. Security model for sharing

- Public share URL contains only share id + fragment key (`#k=...`).
- URL fragment key is never sent to backend.
- Backend stores encrypted shared payload only.
- Server cannot decrypt entries or share vault content.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design.
