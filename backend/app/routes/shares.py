"""
Share routes for public note viewing
Allows users to create shareable links with end-to-end encryption
"""
from flask import Blueprint, request, jsonify
from app import db
from app.models import SharedEntry, JournalEntry
from app.auth_utils import login_required
from datetime import datetime, timezone

shares_bp = Blueprint('shares', __name__)


@shares_bp.route('/create', methods=['POST'])
@login_required
def create_share(user_id):
    """
    Create a shareable link for an entry
    Frontend sends re-encrypted content with a new random share key
    The share key is NOT sent to server - it will be in URL fragment
    """
    data = request.get_json()
    
    # Validate required fields
    required = ['entry_id', 'encrypted_content', 'iv']
    if not all(k in data for k in required):
        return jsonify({'error': 'Missing required fields'}), 400
    
    entry_id = data['entry_id']
    encrypted_content = bytes.fromhex(data['encrypted_content'])
    iv = bytes.fromhex(data['iv'])
    allow_download = data.get('allow_download', False)
    
    # Optional encrypted metadata
    encrypted_metadata = None
    metadata_iv = None
    if 'encrypted_metadata' in data and 'metadata_iv' in data:
        encrypted_metadata = bytes.fromhex(data['encrypted_metadata'])
        metadata_iv = bytes.fromhex(data['metadata_iv'])
    
    # Verify the entry belongs to the user
    entry = JournalEntry.query.filter_by(id=entry_id, user_id=user_id).first()
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404
    
    # Check if share already exists for this entry
    existing_share = SharedEntry.query.filter_by(entry_id=entry_id).first()
    if existing_share:
        # Update existing share
        existing_share.encrypted_content = encrypted_content
        existing_share.iv = iv
        existing_share.encrypted_metadata = encrypted_metadata
        existing_share.metadata_iv = metadata_iv
        existing_share.allow_download = allow_download
        db.session.commit()
        
        return jsonify({
            'share_id': existing_share.id,
            'message': 'Share link updated successfully'
        }), 200
    
    # Create new share
    share = SharedEntry(
        entry_id=entry_id,
        user_id=user_id,
        encrypted_content=encrypted_content,
        iv=iv,
        encrypted_metadata=encrypted_metadata,
        metadata_iv=metadata_iv,
        allow_download=allow_download
    )
    
    db.session.add(share)
    db.session.commit()
    
    return jsonify({
        'share_id': share.id,
        'message': 'Share link created successfully'
    }), 201


@shares_bp.route('/<share_id>', methods=['GET'])
def get_share(share_id):
    """
    Get shared entry (public access, no authentication required)
    Server only returns encrypted content - decryption happens client-side
    """
    share = SharedEntry.query.filter_by(id=share_id).first()
    
    if not share:
        return jsonify({'error': 'Share not found'}), 404
    
    # Check expiration
    if share.expires_at and share.expires_at < datetime.now(timezone.utc):
        return jsonify({'error': 'Share has expired'}), 410
    
    # Increment view count
    share.view_count += 1
    db.session.commit()
    
    response_data = {
        'encrypted_content': share.encrypted_content.hex(),
        'iv': share.iv.hex(),
        'allow_download': share.allow_download,
        'created_at': share.created_at.isoformat()
    }
    
    # Include encrypted metadata if available
    if share.encrypted_metadata and share.metadata_iv:
        response_data['encrypted_metadata'] = share.encrypted_metadata.hex()
        response_data['metadata_iv'] = share.metadata_iv.hex()
    
    return jsonify(response_data), 200


@shares_bp.route('/<share_id>', methods=['DELETE'])
@login_required
def delete_share(user_id, share_id):
    """
    Delete a share (revoke access)
    """
    share = SharedEntry.query.filter_by(id=share_id, user_id=user_id).first()
    
    if not share:
        return jsonify({'error': 'Share not found'}), 404
    
    db.session.delete(share)
    db.session.commit()
    
    return jsonify({'message': 'Share deleted successfully'}), 200


@shares_bp.route('/entry/<entry_id>', methods=['GET'])
@login_required
def get_entry_share(user_id, entry_id):
    """
    Check if an entry has an active share
    """
    share = SharedEntry.query.filter_by(entry_id=entry_id, user_id=user_id).first()
    
    if not share:
        return jsonify({'has_share': False}), 200
    
    return jsonify({
        'has_share': True,
        'share_id': share.id,
        'allow_download': share.allow_download,
        'view_count': share.view_count,
        'created_at': share.created_at.isoformat()
    }), 200
