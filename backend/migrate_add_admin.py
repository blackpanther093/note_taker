#!/usr/bin/env python
"""Migration: Add admin tables and user status fields."""
import os
import sys
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app, db
from app.models import User, Admin, AdminSession
from sqlalchemy import inspect, MetaData, text


def has_column(table_name, column_name):
    """Check if a table has a column."""
    inspector = inspect(db.engine)
    if table_name not in inspector.get_table_names():
        return False
    columns = [col['name'] for col in inspector.get_columns(table_name)]
    return column_name in columns


def migrate():
    """Run migrations."""
    app = create_app()
    with app.app_context():
        inspector = inspect(db.engine)
        tables = inspector.get_table_names()

        print("Running migrations...")

        # 1. Add is_active and kicked_out_at to users table if not present
        if 'users' in tables:
            if not has_column('users', 'is_active'):
                print("  - Adding is_active column to users...")
                with db.engine.connect() as connection:
                    connection.execute(text('ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE'))
                    connection.commit()
                print("    ✓ is_active added")

            if not has_column('users', 'kicked_out_at'):
                print("  - Adding kicked_out_at column to users...")
                with db.engine.connect() as connection:
                    connection.execute(text('ALTER TABLE users ADD COLUMN kicked_out_at DATETIME NULL'))
                    connection.commit()
                print("    ✓ kicked_out_at added")

        # 2. Create admins table if not present
        if 'admins' not in tables:
            print("  - Creating admins table...")
            Admin.__table__.create(db.engine, checkfirst=True)
            print("    ✓ admins table created")
        else:
            if not has_column('admins', 'totp_secret'):
                print("  - Adding totp_secret column to admins...")
                with db.engine.connect() as connection:
                    connection.execute(text('ALTER TABLE admins ADD COLUMN totp_secret VARCHAR(255) NULL'))
                    connection.commit()
                print("    ✓ totp_secret added")

            if not has_column('admins', 'totp_enabled'):
                print("  - Adding totp_enabled column to admins...")
                with db.engine.connect() as connection:
                    connection.execute(text('ALTER TABLE admins ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE'))
                    connection.commit()
                print("    ✓ totp_enabled added")

        # 3. Create admin_sessions table if not present
        if 'admin_sessions' not in tables:
            print("  - Creating admin_sessions table...")
            AdminSession.__table__.create(db.engine, checkfirst=True)
            print("    ✓ admin_sessions table created")

        print("\n✓ Migration complete!")
        print("\nNext steps:")
        print("1. Create admin user: python create_admin.py <username> <password> <email>")


if __name__ == '__main__':
    migrate()