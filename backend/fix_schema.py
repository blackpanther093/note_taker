"""Fix database schema to support reasonable encrypted content."""
from app import create_app, db

app = create_app()

with app.app_context():
    print("Updating database schema...")
    
    # Update journal_entries table - MEDIUMBLOB supports up to 16MB
    # This is reasonable for journal entries with embedded images
    with db.engine.connect() as conn:
        conn.execute(db.text('ALTER TABLE journal_entries MODIFY encrypted_content MEDIUMBLOB;'))
        print("✓ Updated journal_entries.encrypted_content to MEDIUMBLOB (16MB limit)")
        
        conn.execute(db.text('ALTER TABLE journal_entries MODIFY encrypted_metadata MEDIUMBLOB;'))
        print("✓ Updated journal_entries.encrypted_metadata to MEDIUMBLOB")
        
        # Update entry_assets table
        conn.execute(db.text('ALTER TABLE entry_assets MODIFY encrypted_data MEDIUMBLOB;'))
        print("✓ Updated entry_assets.encrypted_data to MEDIUMBLOB")
        
        conn.commit()
    
    print("\n✓ Database schema updated successfully!")
    print("MEDIUMBLOB columns can store up to 16MB of encrypted data.")
