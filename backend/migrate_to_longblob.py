"""
Migration script to update BLOB columns to LONGBLOB for large encrypted content.

This script alters the database schema to support larger encrypted content (up to 4GB).
Run this ONCE on your production database after deploying the updated models.

Usage:
    python migrate_to_longblob.py
"""
import os
import sys
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

# Load environment variables
from dotenv import load_dotenv
load_dotenv()

def get_db_url():
    """Build database URL from environment variables."""
    return URL.create(
        drivername='mysql+pymysql',
        username=os.environ.get('DB_USER', 'root'),
        password=os.environ.get('DB_PASSWORD'),
        host=os.environ.get('DB_HOST', 'localhost'),
        port=int(os.environ.get('DB_PORT', 3306)),
        database=os.environ.get('DB_NAME', 'my_journal'),
        query={'charset': 'utf8mb4'},
    )


TARGET_COLUMNS = [
    ('journal_entries', 'encrypted_content', 'LONGBLOB', False),
    ('journal_entries', 'encrypted_metadata', 'LONGBLOB', True),
    ('entry_assets', 'encrypted_data', 'LONGBLOB', False),
]


def get_column_type(conn, table_name, column_name, db_name):
    """Return current MySQL column_type (e.g., blob/mediumblob/longblob)."""
    row = conn.execute(
        text(
            """
            SELECT column_type
            FROM information_schema.columns
            WHERE table_schema = :db_name
              AND table_name = :table_name
              AND column_name = :column_name
            """
        ),
        {
            'db_name': db_name,
            'table_name': table_name,
            'column_name': column_name,
        },
    ).fetchone()
    return row[0] if row else None


def migrate_to_longblob():
    """Alter target columns from BLOB/MEDIUMBLOB to LONGBLOB."""
    engine = create_engine(get_db_url())
    db_name = os.environ.get('DB_NAME', 'my_journal')

    print("Starting LONGBLOB migration...")

    with engine.connect() as conn:
        for i, (table_name, column_name, target_type, nullable) in enumerate(TARGET_COLUMNS, 1):
            current_type = get_column_type(conn, table_name, column_name, db_name)

            if current_type is None:
                print(f"[{i}/{len(TARGET_COLUMNS)}] {table_name}.{column_name}: not found, skipping")
                continue

            print(
                f"[{i}/{len(TARGET_COLUMNS)}] {table_name}.{column_name}: "
                f"current={current_type}, target={target_type.lower()}"
            )

            if current_type.lower() == target_type.lower():
                print("  -> Already migrated, skipping")
                continue

            null_sql = 'NULL' if nullable else 'NOT NULL'
            sql = (
                f"ALTER TABLE {table_name} "
                f"MODIFY {column_name} {target_type} {null_sql}"
            )

            try:
                conn.execute(text(sql))
                conn.commit()
                after_type = get_column_type(conn, table_name, column_name, db_name)
                print(f"  -> Migrated successfully (now {after_type})")
            except Exception as e:
                print(f"  -> Error: {e}")
                if "doesn't exist" in str(e).lower():
                    print("  -> Skipping (table/column doesn't exist)")
                    continue
                else:
                    conn.rollback()
                    raise
    
    print("\nMigration completed.")
    print("Your database now supports entries up to 4GB in size.")

if __name__ == '__main__':
    try:
        migrate_to_longblob()
    except KeyboardInterrupt:
        print("\n\nMigration cancelled by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n✗ Migration failed: {e}")
        print("\nPlease check your database connection and try again.")
        sys.exit(1)
