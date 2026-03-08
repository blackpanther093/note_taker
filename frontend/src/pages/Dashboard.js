import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { entriesAPI } from '../api/client';
import { decryptEntry, decryptMetadata } from '../crypto/encryption';
import {
  Plus, Search, Calendar, Settings, LogOut, BookOpen,
  Flame, TrendingUp, SortDesc, SortAsc, ChevronLeft, ChevronRight, Moon, Sun
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { formatIST } from '../utils/timezone';

export default function Dashboard() {
  const { encryptionKey, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const [decryptedEntries, setDecryptedEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [streak, setStreak] = useState({ current_streak: 0, longest_streak: 0, total_entries: 0 });

  const fetchEntries = useCallback(async () => {
    if (!encryptionKey) {
      console.warn('Cannot fetch entries: encryption key not available');
      return;
    }
    
    setLoading(true);
    try {
      const res = await entriesAPI.list({ page, sort: sortOrder, per_page: 20 });
      setTotalPages(res.data.pages);

      // Decrypt entries client-side
      const decrypted = await Promise.all(
        res.data.entries.map(async (entry) => {
          try {
            const content = await decryptEntry(
              entry.encrypted_content,
              entry.iv,
              encryptionKey,
              entry.id
            );

            let metadata = { title: 'Untitled', mood: '', tags: [] };
            if (entry.encrypted_metadata && entry.metadata_iv) {
              try {
                metadata = await decryptMetadata(
                  entry.encrypted_metadata,
                  entry.metadata_iv,
                  encryptionKey,
                  entry.id
                );
              } catch {
                // Metadata decryption failed, use defaults
              }
            }

            // Parse content (it's JSON from the editor)
            let parsedContent;
            try {
              parsedContent = JSON.parse(content);
            } catch {
              parsedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }] };
            }

            // Extract preview text from editor JSON
            const preview = extractPreview(parsedContent);

            return {
              ...entry,
              title: metadata.title || 'Untitled',
              mood: metadata.mood || '',
              tags: metadata.tags || [],
              preview,
              decrypted: true,
            };
          } catch (err) {
            console.error('Failed to decrypt entry:', entry.id, err);
            return {
              ...entry,
              title: 'Unable to decrypt',
              mood: '',
              tags: [],
              preview: 'This entry could not be decrypted.',
              decrypted: false,
            };
          }
        })
      );

      setDecryptedEntries(decrypted);
    } catch (err) {
      console.error('Failed to fetch entries:', err);
    } finally {
      setLoading(false);
    }
  }, [encryptionKey, page, sortOrder]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    entriesAPI.streak()
      .then(res => setStreak(res.data))
      .catch(() => {});
  }, []);

  // Filter entries by search (client-side since content is decrypted)
  const filteredEntries = decryptedEntries.filter((entry) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      entry.title.toLowerCase().includes(q) ||
      entry.preview.toLowerCase().includes(q) ||
      (entry.tags || []).some(t => t.toLowerCase().includes(q))
    );
  });

  const moodEmojis = {
    happy: '😊',
    sad: '😢',
    excited: '🎉',
    anxious: '😰',
    calm: '😌',
    grateful: '🙏',
    angry: '😠',
    neutral: '😐',
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleDelete = async (entryId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this entry? This cannot be undone.')) return;
    try {
      await entriesAPI.delete(entryId);
      fetchEntries();
    } catch (err) {
      alert('Failed to delete entry');
    }
  };

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <BookOpen size={28} />
          <h1>My Journal</h1>
        </div>
        <nav className="header-nav">
          <button
            onClick={toggleTheme}
            className="nav-btn"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <Link to="/calendar" className="nav-btn" title="Calendar">
            <Calendar size={20} />
          </Link>
          <Link to="/settings" className="nav-btn" title="Settings">
            <Settings size={20} />
          </Link>
          <button onClick={handleLogout} className="nav-btn" title="Logout">
            <LogOut size={20} />
          </button>
        </nav>
      </header>

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat">
          <Flame size={18} />
          <span>{streak.current_streak} day streak</span>
        </div>
        <div className="stat">
          <TrendingUp size={18} />
          <span>Longest: {streak.longest_streak} days</span>
        </div>
        <div className="stat">
          <BookOpen size={18} />
          <span>{streak.total_entries} entries</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="dashboard-toolbar">
        <div className="search-bar">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="toolbar-actions">
          <button
            className="btn btn-icon"
            onClick={() => setSortOrder(s => s === 'desc' ? 'asc' : 'desc')}
            title={`Sort ${sortOrder === 'desc' ? 'oldest first' : 'newest first'}`}
          >
            {sortOrder === 'desc' ? <SortDesc size={18} /> : <SortAsc size={18} />}
          </button>

          <button
            className="btn btn-primary"
            onClick={() => navigate('/entry/new')}
          >
            <Plus size={18} />
            New Entry
          </button>
        </div>
      </div>

      {/* Entry Cards */}
      {loading ? (
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p>Decrypting entries...</p>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={64} />
          <h2>{searchQuery ? 'No matching entries' : 'Start your journal'}</h2>
          <p>{searchQuery ? 'Try a different search term' : 'Write your first entry to get started'}</p>
          {!searchQuery && (
            <button className="btn btn-primary" onClick={() => navigate('/entry/new')}>
              <Plus size={18} /> Write First Entry
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="entries-grid">
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className={`entry-card ${!entry.decrypted ? 'entry-card-error' : ''}`}
                onClick={() => navigate(`/entry/${entry.id}`)}
              >
                <div className="entry-card-header">
                  <span className="entry-date">
                    {format(parseISO(entry.entry_date), 'MMM d, yyyy')}
                  </span>
                  {entry.mood && (
                    <span className="entry-mood" title={entry.mood}>
                      {moodEmojis[entry.mood] || '📝'}
                    </span>
                  )}
                </div>
                <h3 className="entry-title">{entry.title}</h3>
                <p className="entry-preview">{entry.preview}</p>
                {entry.tags && entry.tags.length > 0 && (
                  <div className="entry-tags">
                    {entry.tags.map((tag, i) => (
                      <span key={i} className="tag">{tag}</span>
                    ))}
                  </div>
                )}
                <div className="entry-card-footer">
                  <span className="entry-time">
                    {formatIST(entry.updated_at || entry.created_at, 'time')}
                  </span>
                  <button
                    className="btn-delete"
                    onClick={(e) => handleDelete(entry.id, e)}
                    title="Delete entry"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-icon"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                className="btn btn-icon"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Extract plain text preview from TipTap JSON content.
 */
function extractPreview(doc, maxLength = 150) {
  if (!doc || !doc.content) return '';

  let text = '';
  const walk = (node) => {
    if (text.length >= maxLength) return;
    if (node.type === 'text') {
      text += node.text;
    }
    if (node.content) {
      for (const child of node.content) {
        walk(child);
        if (text.length >= maxLength) break;
      }
      // Add space between block elements
      if (['paragraph', 'heading', 'bulletList', 'listItem'].includes(node.type)) {
        text += ' ';
      }
    }
  };

  walk(doc);
  return text.trim().substring(0, maxLength) + (text.length > maxLength ? '...' : '');
}
