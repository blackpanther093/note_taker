#!/usr/bin/env python3
"""
Create the user_share_vaults table if missing.

Run once in production after deploying share vault feature:
    python migrate_add_share_vault.py
"""
import sys
from sqlalchemy import inspect

from app import create_app, db


def migrate_add_share_vault_table():
    app = create_app('production')

    with app.app_context():
        # Ensure model metadata is loaded
        from app.models import UserShareVault  # noqa: F401

        inspector = inspect(db.engine)
        existing = set(inspector.get_table_names())

        if 'user_share_vaults' in existing:
            print('✓ user_share_vaults already exists. Nothing to do.')
            return 0

        print('Creating table: user_share_vaults')
        try:
            db.create_all()
            print('✓ user_share_vaults created successfully')
            return 0
        except Exception as e:
            print(f'✗ Failed to create user_share_vaults: {e}')
            return 1


if __name__ == '__main__':
    sys.exit(migrate_add_share_vault_table())
