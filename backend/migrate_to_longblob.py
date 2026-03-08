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

def migrate_to_longblob():
    """Alter columns from BLOB/MEDIUMBLOB to LONGBLOB."""
    engine = create_engine(get_db_url())
    
    migrations = [
        # Journal entries - encrypted content and metadata
        "ALTER TABLE journal_entries MODIFY encrypted_content LONGBLOB NOT NULL",
        "ALTER TABLE journal_entries MODIFY encrypted_metadata LONGBLOB",
        
        # Entry assets - encrypted image data
        "ALTER TABLE entry_assets MODIFY encrypted_data LONGBLOB NOT NULL",
    ]
    
    print("Starting LONGBLOB migration...")
    
    with engine.connect() as conn:
        for i, sql in enumerate(migrations, 1):
            print(f"[{i}/{len(migrations)}] Executing: {sql}")
            try:
                conn.execute(text(sql))
                conn.commit()
                print(f"  ✓ Success")
            except Exception as e:
                print(f"  ✗ Error: {e}")
                if "doesn't exist" in str(e).lower():
                    print(f"  → Skipping (table/column doesn't exist)")
                    continue
                else:
                    conn.rollback()
                    raise
    
    print("\n✓ Migration completed successfully!")
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
