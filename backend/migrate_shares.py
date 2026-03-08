"""
Migration script to add shared_entries table
Run this to update the database schema
"""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app import create_app, db


def _ensure_mysql_blob_sizes():
    """Upgrade share payload columns for MySQL so large encrypted notes fit."""
    if db.engine.dialect.name != 'mysql':
        return

    with db.engine.begin() as conn:
        conn.exec_driver_sql(
            "ALTER TABLE shared_entries MODIFY encrypted_content LONGBLOB NOT NULL"
        )
        conn.exec_driver_sql(
            "ALTER TABLE shared_entries MODIFY encrypted_metadata LONGBLOB NULL"
        )

def migrate():
    app = create_app()
    
    with app.app_context():
        print("Creating shared_entries table...")
        db.create_all()
        print("Ensuring shared_entries blob column sizes...")
        _ensure_mysql_blob_sizes()
        print("✅ Migration completed successfully!")

if __name__ == '__main__':
    migrate()
