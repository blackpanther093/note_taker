"""Secure asset (image) upload routes."""
import base64

from flask import Blueprint, request, jsonify, current_app

from app import db, csrf
from app.models import EntryAsset, JournalEntry
from app.auth_utils import login_required

assets_bp = Blueprint('assets', __name__)

# Allowed MIME types for images (SVG excluded for XSS safety)
ALLOWED_TYPES = {
    'image/jpeg', 'image/png', 'image/gif', 'image/webp'
}

# Maximum encrypted asset size (10 MB)
MAX_ASSET_SIZE = 10 * 1024 * 1024


@assets_bp.route('/upload', methods=['POST'])
@login_required
def upload_asset(user_id):
    """Upload an encrypted image asset.

    The image is encrypted client-side before upload.
    The server only stores the encrypted blob.

    Expects JSON:
    {
        "entry_id": "journal-entry-uuid",
        "encrypted_data": "<base64 encoded encrypted image bytes>",
        "iv": "<base64 encoded 12-byte IV>",
        "asset_type": "image/jpeg",
        "file_size": 123456  (original file size for validation)
    }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request'}), 400

    entry_id = data.get('entry_id', '')
    encrypted_data_b64 = data.get('encrypted_data', '')
    iv_b64 = data.get('iv', '')
    asset_type = data.get('asset_type', '')
    file_size = data.get('file_size', 0)

    # Validate required fields
    if not all([entry_id, encrypted_data_b64, iv_b64, asset_type]):
        return jsonify({'error': 'Missing required fields'}), 400

    # Validate asset type
    if asset_type not in ALLOWED_TYPES:
        return jsonify({'error': f'Unsupported file type. Allowed: {", ".join(ALLOWED_TYPES)}'}), 400

    # Verify entry belongs to user
    entry = JournalEntry.query.filter_by(id=entry_id, user_id=user_id).first()
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    try:
        encrypted_data = base64.b64decode(encrypted_data_b64)
        iv = base64.b64decode(iv_b64)
    except Exception:
        return jsonify({'error': 'Invalid data encoding'}), 400

    if len(iv) != 12:
        return jsonify({'error': 'IV must be 12 bytes'}), 400

    if len(encrypted_data) > MAX_ASSET_SIZE:
        return jsonify({'error': f'File too large. Max size: {MAX_ASSET_SIZE // (1024*1024)} MB'}), 413

    if file_size > MAX_ASSET_SIZE:
        return jsonify({'error': 'Reported file size exceeds limit'}), 413

    asset = EntryAsset(
        entry_id=entry_id,
        user_id=user_id,
        encrypted_data=encrypted_data,
        iv=iv,
        asset_type=asset_type,
        file_size=file_size,
    )
    db.session.add(asset)
    db.session.commit()

    return jsonify({
        'message': 'Asset uploaded',
        'asset': {
            'id': asset.id,
            'entry_id': asset.entry_id,
            'asset_type': asset.asset_type,
            'file_size': asset.file_size,
        }
    }), 201


@assets_bp.route('/<asset_id>', methods=['GET'])
@login_required
def get_asset(user_id, asset_id):
    """Get an encrypted asset."""
    asset = EntryAsset.query.filter_by(id=asset_id, user_id=user_id).first()
    if not asset:
        return jsonify({'error': 'Asset not found'}), 404

    return jsonify({
        'asset': {
            'id': asset.id,
            'entry_id': asset.entry_id,
            'encrypted_data': base64.b64encode(asset.encrypted_data).decode(),
            'iv': base64.b64encode(asset.iv).decode(),
            'asset_type': asset.asset_type,
            'file_size': asset.file_size,
        }
    })


@assets_bp.route('/<asset_id>', methods=['DELETE'])
@login_required
def delete_asset(user_id, asset_id):
    """Delete an asset."""
    asset = EntryAsset.query.filter_by(id=asset_id, user_id=user_id).first()
    if not asset:
        return jsonify({'error': 'Asset not found'}), 404

    db.session.delete(asset)
    db.session.commit()

    return jsonify({'message': 'Asset deleted'})


@assets_bp.route('/entry/<entry_id>', methods=['GET'])
@login_required
def list_entry_assets(user_id, entry_id):
    """List all assets for an entry (metadata only, not encrypted data)."""
    entry = JournalEntry.query.filter_by(id=entry_id, user_id=user_id).first()
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    assets = EntryAsset.query.filter_by(entry_id=entry_id, user_id=user_id).all()

    return jsonify({
        'assets': [
            {
                'id': a.id,
                'asset_type': a.asset_type,
                'file_size': a.file_size,
                'created_at': a.created_at.isoformat() if a.created_at else None,
            }
            for a in assets
        ]
    })
