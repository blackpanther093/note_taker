"""Database migration script to add user_agent_hash column for session binding."""
import hashlib

from app import create_app, db

app = create_app()

with app.app_context():
    try:
        print("Adding user_agent_hash column to user_sessions table...")
        
        with db.engine.connect() as conn:
            # Add the new column
            conn.execute(db.text('ALTER TABLE user_sessions ADD COLUMN user_agent_hash VARCHAR(64) NULL;'))
            conn.commit()
            print("✓ Added user_agent_hash column")

            # Update existing sessions with hashed user agents
            conn.execute(db.text('''
                UPDATE user_sessions 
                SET user_agent_hash = SHA2(user_agent, 256) 
                WHERE user_agent IS NOT NULL AND user_agent != '';
            '''))
            conn.commit()
            print("✓ Updated existing sessions with user agent hashes")

        print("\n✓ Database migration completed successfully!")
        print("Sessions are now bound to IP address + User-Agent hash for enhanced security.")
    except Exception as e:
        print(f"✗ Migration failed: {e}")
        print("Note: If column already exists, this is expected.")
