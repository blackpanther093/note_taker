#!/usr/bin/env python
"""Create an admin user."""
import os
import sys
from getpass import getpass

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app, db
from app.models import Admin
import bcrypt


def create_admin(username, password, email=None):
    """Create admin user."""
    app = create_app()
    with app.app_context():
        # Check if admin exists
        existing = Admin.query.filter_by(username=username).first()
        if existing:
            print(f"✗ Admin with username '{username}' already exists")
            return False

        # Hash password
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

        # Create admin
        admin = Admin(
            username=username,
            password_hash=password_hash,
            email=email or '',
        )
        db.session.add(admin)
        db.session.commit()

        print(f"✓ Admin user '{username}' created successfully!")
        print(f"  Admin ID: {admin.id}")
        return True


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python create_admin.py <username> [password] [email]")
        print("\nIf password not provided, you will be prompted interactively.")
        sys.exit(1)

    username = sys.argv[1]
    password = sys.argv[2] if len(sys.argv) > 2 else None
    email = sys.argv[3] if len(sys.argv) > 3 else None

    if not password:
        password = getpass(f"Enter password for '{username}': ")
        password_confirm = getpass("Confirm password: ")
        if password != password_confirm:
            print("✗ Passwords do not match")
            sys.exit(1)

    create_admin(username, password, email)
