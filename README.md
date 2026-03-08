# My Journal

A zero-knowledge encrypted personal journaling platform.

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

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full system design.
