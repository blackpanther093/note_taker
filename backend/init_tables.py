#!/usr/bin/env python3
"""
Safe table initialization script for production.
Run this once manually or as a post-deploy hook.
"""
import sys
from app import create_app, db
from sqlalchemy import inspect

def init_tables():
    """Create tables only if they don't exist."""
    app = create_app('production')
    
    with app.app_context():
        # Import all models so SQLAlchemy knows about them
        from app import models
        
        # Check existing tables
        inspector = inspect(db.engine)
        existing_tables = inspector.get_table_names()
        
        # Get all model tables
        model_tables = db.metadata.tables.keys()
        
        missing_tables = [t for t in model_tables if t not in existing_tables]
        
        if missing_tables:
            print(f"Creating {len(missing_tables)} missing table(s): {', '.join(missing_tables)}")
            try:
                db.create_all()
                print("✓ Tables created successfully!")
            except Exception as e:
                print(f"✗ Error creating tables: {e}")
                sys.exit(1)
        else:
            print("✓ All tables already exist. Nothing to do.")
        
        return 0

if __name__ == '__main__':
    sys.exit(init_tables())
