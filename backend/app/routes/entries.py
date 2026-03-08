"""Journal entry routes."""
import base64
from datetime import datetime, timedelta, timezone
try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except Exception:  # pragma: no cover
    ZoneInfo = None
    ZoneInfoNotFoundError = Exception

from flask import Blueprint, request, jsonify, current_app

from app import db, csrf
from app.models import JournalEntry, DailyMetadata
from app.auth_utils import login_required

entries_bp = Blueprint('entries', __name__)

ENTRIES_PER_PAGE = 20
try:
    IST = ZoneInfo('Asia/Kolkata') if ZoneInfo else timezone(timedelta(hours=5, minutes=30))
except ZoneInfoNotFoundError:
    IST = timezone(timedelta(hours=5, minutes=30))


@entries_bp.route('', methods=['GET'])
@login_required
def list_entries(user_id):
    """List all encrypted journal entries (paginated).

    Query params:
        page (int): page number (default 1)
        per_page (int): items per page (default 20, max 100)
        sort (str): 'asc' or 'desc' (default 'desc')
        start_date (str): filter from date (YYYY-MM-DD)
        end_date (str): filter to date (YYYY-MM-DD)
    """
    page = request.args.get('page', 1, type=int)
    per_page = min(request.args.get('per_page', ENTRIES_PER_PAGE, type=int), 100)
    sort_order = request.args.get('sort', 'desc')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    query = JournalEntry.query.filter_by(user_id=user_id)

    if start_date:
        try:
            query = query.filter(JournalEntry.entry_date >= datetime.strptime(start_date, '%Y-%m-%d').date())
        except ValueError:
            pass

    if end_date:
        try:
            query = query.filter(JournalEntry.entry_date <= datetime.strptime(end_date, '%Y-%m-%d').date())
        except ValueError:
            pass

    if sort_order == 'asc':
        query = query.order_by(JournalEntry.entry_date.asc(), JournalEntry.created_at.asc())
    else:
        query = query.order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())

    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    entries = []
    for entry in pagination.items:
        entry_data = {
            'id': entry.id,
            'entry_date': entry.entry_date.isoformat(),
            'encrypted_content': base64.b64encode(entry.encrypted_content).decode(),
            'iv': base64.b64encode(entry.iv).decode(),
            'created_at': entry.created_at.isoformat() if entry.created_at else None,
            'updated_at': entry.updated_at.isoformat() if entry.updated_at else None,
        }
        if entry.encrypted_metadata:
            entry_data['encrypted_metadata'] = base64.b64encode(entry.encrypted_metadata).decode()
            entry_data['metadata_iv'] = base64.b64encode(entry.metadata_iv).decode() if entry.metadata_iv else None

        entries.append(entry_data)

    return jsonify({
        'entries': entries,
        'total': pagination.total,
        'page': pagination.page,
        'pages': pagination.pages,
        'per_page': per_page,
    })


@entries_bp.route('', methods=['POST'])
@login_required
def create_entry(user_id):
    """Create a new encrypted journal entry.

    Expects JSON:
    {
        "id": "client-generated-uuid",
        "encrypted_content": "<base64 encoded ciphertext>",
        "iv": "<base64 encoded 12-byte IV>",
        "entry_date": "2025-01-15",
        "encrypted_metadata": "<base64 encoded>",  (optional)
        "metadata_iv": "<base64 encoded>"  (optional)
    }
    """
    # Max 10MB for encrypted content (reasonable for rich text with embedded images)
    MAX_CONTENT_SIZE = 10 * 1024 * 1024
    
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request'}), 400

    required_fields = ['id', 'encrypted_content', 'iv', 'entry_date']
    for field in required_fields:
        if not data.get(field):
            return jsonify({'error': f'Missing field: {field}'}), 400

    try:
        encrypted_content = base64.b64decode(data['encrypted_content'])
        iv = base64.b64decode(data['iv'])
        entry_date = datetime.strptime(data['entry_date'], '%Y-%m-%d').date()
    except (ValueError, Exception) as e:
        return jsonify({'error': 'Invalid data encoding'}), 400

    if len(iv) != 12:
        return jsonify({'error': 'IV must be 12 bytes'}), 400
    
    # Validate content size
    if len(encrypted_content) > MAX_CONTENT_SIZE:
        return jsonify({
            'error': f'Entry too large. Maximum size is {MAX_CONTENT_SIZE // (1024*1024)}MB. Consider moving images to separate assets.'
        }), 413

    # Validate UUID format
    entry_id = data['id']
    if len(entry_id) != 36:
        return jsonify({'error': 'Invalid entry ID format'}), 400

    # Check for duplicate
    existing = JournalEntry.query.filter_by(id=entry_id).first()
    if existing:
        return jsonify({'error': 'Entry already exists'}), 409

    entry = JournalEntry(
        id=entry_id,
        user_id=user_id,
        encrypted_content=encrypted_content,
        iv=iv,
        entry_date=entry_date,
    )

    if data.get('encrypted_metadata') and data.get('metadata_iv'):
        entry.encrypted_metadata = base64.b64decode(data['encrypted_metadata'])
        entry.metadata_iv = base64.b64decode(data['metadata_iv'])

    db.session.add(entry)

    # Update daily metadata
    daily = DailyMetadata.query.filter_by(user_id=user_id, entry_date=entry_date).first()
    if not daily:
        daily = DailyMetadata(user_id=user_id, entry_date=entry_date, has_entry=True)
        db.session.add(daily)

    db.session.commit()

    return jsonify({
        'message': 'Entry created',
        'entry': {
            'id': entry.id,
            'entry_date': entry.entry_date.isoformat(),
            'created_at': entry.created_at.isoformat() if entry.created_at else None,
        }
    }), 201


@entries_bp.route('/<entry_id>', methods=['GET'])
@login_required
def get_entry(user_id, entry_id):
    """Get a single encrypted entry."""
    entry = JournalEntry.query.filter_by(id=entry_id, user_id=user_id).first()
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    result = {
        'id': entry.id,
        'entry_date': entry.entry_date.isoformat(),
        'encrypted_content': base64.b64encode(entry.encrypted_content).decode(),
        'iv': base64.b64encode(entry.iv).decode(),
        'created_at': entry.created_at.isoformat() if entry.created_at else None,
        'updated_at': entry.updated_at.isoformat() if entry.updated_at else None,
    }
    if entry.encrypted_metadata:
        result['encrypted_metadata'] = base64.b64encode(entry.encrypted_metadata).decode()
        result['metadata_iv'] = base64.b64encode(entry.metadata_iv).decode() if entry.metadata_iv else None

    return jsonify({'entry': result})


@entries_bp.route('/<entry_id>', methods=['PUT'])
@login_required
def update_entry(user_id, entry_id):
    """Update an encrypted entry.

    Expects same JSON structure as create.
    """
    MAX_CONTENT_SIZE = 10 * 1024 * 1024
    
    entry = JournalEntry.query.filter_by(id=entry_id, user_id=user_id).first()
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'Invalid request'}), 400

    try:
        if data.get('encrypted_content'):
            encrypted_content = base64.b64decode(data['encrypted_content'])
            # Validate content size
            if len(encrypted_content) > MAX_CONTENT_SIZE:
                return jsonify({
                    'error': f'Entry too large. Maximum size is {MAX_CONTENT_SIZE // (1024*1024)}MB. Consider moving images to separate assets.'
                }), 413
            entry.encrypted_content = encrypted_content
        if data.get('iv'):
            iv = base64.b64decode(data['iv'])
            if len(iv) != 12:
                return jsonify({'error': 'IV must be 12 bytes'}), 400
            entry.iv = iv
        if data.get('entry_date'):
            entry.entry_date = datetime.strptime(data['entry_date'], '%Y-%m-%d').date()
        if data.get('encrypted_metadata') and data.get('metadata_iv'):
            entry.encrypted_metadata = base64.b64decode(data['encrypted_metadata'])
            entry.metadata_iv = base64.b64decode(data['metadata_iv'])
    except (ValueError, Exception) as e:
        return jsonify({'error': 'Invalid data encoding'}), 400

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.exception('Database error updating entry')

        err_text = str(e).lower()
        if 'data too long' in err_text or 'out of range value' in err_text:
            return jsonify({
                'error': 'Entry data exceeds current database column size. Run backend/migrate_to_longblob.py in production shell, then retry.'
            }), 413

        return jsonify({'error': 'Database error while saving entry'}), 500

    return jsonify({
        'message': 'Entry updated',
        'entry': {
            'id': entry.id,
            'entry_date': entry.entry_date.isoformat(),
            'updated_at': entry.updated_at.isoformat() if entry.updated_at else None,
        }
    })


@entries_bp.route('/<entry_id>', methods=['DELETE'])
@login_required
def delete_entry(user_id, entry_id):
    """Delete a journal entry and all associated assets."""
    entry = JournalEntry.query.filter_by(id=entry_id, user_id=user_id).first()
    if not entry:
        return jsonify({'error': 'Entry not found'}), 404

    entry_date = entry.entry_date

    db.session.delete(entry)

    # Check if there are other entries for this date
    remaining = JournalEntry.query.filter_by(
        user_id=user_id,
        entry_date=entry_date,
    ).count()

    if remaining <= 1:  # The entry being deleted is still counted
        daily = DailyMetadata.query.filter_by(
            user_id=user_id,
            entry_date=entry_date,
        ).first()
        if daily:
            daily.has_entry = False

    db.session.commit()

    return jsonify({'message': 'Entry deleted'})


@entries_bp.route('/calendar/<int:year>/<int:month>', methods=['GET'])
@login_required
def calendar_view(user_id, year, month):
    """Get entry dates for a calendar month.

    Returns dates that have entries (without decrypting content).
    """
    if month < 1 or month > 12 or year < 2000 or year > 2100:
        return jsonify({'error': 'Invalid date'}), 400

    entries = db.session.query(
        JournalEntry.entry_date,
        db.func.count(JournalEntry.id).label('count'),
    ).filter(
        JournalEntry.user_id == user_id,
        db.extract('year', JournalEntry.entry_date) == year,
        db.extract('month', JournalEntry.entry_date) == month,
    ).group_by(JournalEntry.entry_date).all()

    calendar_data = [
        {
            'date': entry_date.isoformat(),
            'count': count,
        }
        for entry_date, count in entries
    ]

    return jsonify({'calendar': calendar_data, 'year': year, 'month': month})


@entries_bp.route('/streak', methods=['GET'])
@login_required
def get_streak(user_id):
    """Calculate the user's current writing streak."""
    # Use IST day boundaries so dashboard streak matches user expectation.
    today_ist = datetime.now(IST).date()

    # Build streak from actual entries (more reliable than derived metadata rows).
    rows = db.session.query(JournalEntry.entry_date).filter(
        JournalEntry.user_id == user_id,
    ).distinct().order_by(JournalEntry.entry_date.asc()).all()

    entry_dates = [row[0] for row in rows]
    total_entries = JournalEntry.query.filter_by(user_id=user_id).count()

    if not entry_dates:
        return jsonify({'current_streak': 0, 'longest_streak': 0, 'total_entries': total_entries})

    entry_set = set(entry_dates)

    # Current streak: consecutive days ending today. If no today entry, allow yesterday as day 1.
    current_streak = 0
    cursor = today_ist
    while cursor in entry_set:
        current_streak += 1
        cursor -= timedelta(days=1)

    if current_streak == 0 and (today_ist - timedelta(days=1)) in entry_set:
        current_streak = 1

    # Longest streak across all distinct entry dates.
    longest_streak = 1
    running = 1
    for i in range(1, len(entry_dates)):
        if (entry_dates[i] - entry_dates[i - 1]).days == 1:
            running += 1
        else:
            if running > longest_streak:
                longest_streak = running
            running = 1
    if running > longest_streak:
        longest_streak = running

    return jsonify({
        'current_streak': current_streak,
        'longest_streak': longest_streak,
        'total_entries': total_entries,
    })
