import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { sharesAPI } from '../api/client';
import { decryptWithShareKey, base64ToArray } from '../crypto/encryption';
import { Download, Lock, Copy, ChevronLeft, Clock, Eye } from 'lucide-react';
import { downloadEntry } from '../utils/download';
import { formatIST } from '../utils/timezone';
import './ShareView.css';

export default function ShareView() {
  const { shareId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [allowDownload, setAllowDownload] = useState(false);
  const [shareCreatedAt, setShareCreatedAt] = useState(null);
  const [viewCount, setViewCount] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const loadSharedEntry = async () => {
      try {
        // Extract share key from URL fragment.
        // Supports both legacy "#<base64>" and newer "#k=<base64url>" formats.
        const hash = window.location.hash.slice(1);
        if (!hash) {
          setError('Invalid share link. Missing decryption key.');
          setLoading(false);
          return;
        }

        const token = hash.startsWith('k=') ? hash.slice(2) : hash;
        const normalizedBase64 = token.replace(/-/g, '+').replace(/_/g, '/');
        const padding = '='.repeat((4 - (normalizedBase64.length % 4)) % 4);
        const shareKey = base64ToArray(normalizedBase64 + padding);

        // Fetch encrypted data from server
        const response = await sharesAPI.get(shareId);
        const data = response.data;
        setShareCreatedAt(data.created_at || null);
        setViewCount(data.view_count || 0);

        // Decrypt content client-side
        const decryptedContent = await decryptWithShareKey(
          data.encrypted_content,
          data.iv,
          shareKey
        );

        const parsedContent = JSON.parse(decryptedContent);
        setEntry(parsedContent);
        setAllowDownload(data.allow_download);

        // Decrypt metadata if available
        if (data.encrypted_metadata && data.metadata_iv) {
          try {
            const decryptedMeta = await decryptWithShareKey(
              data.encrypted_metadata,
              data.metadata_iv,
              shareKey
            );
            setMetadata(JSON.parse(decryptedMeta));
          } catch (metaErr) {
            if (process.env.NODE_ENV === 'development') {
              console.warn('Metadata decryption failed:', metaErr);
            }
          }
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to load shared entry:', err);
        }
        setError(err.response?.data?.error || 'Failed to load shared entry');
      } finally {
        setLoading(false);
      }
    };

    loadSharedEntry();
  }, [shareId]);

  const handleDownload = async () => {
    if (!allowDownload || !entry) return;

    try {
      await downloadEntry(
        metadata?.title || 'Shared Entry',
        entry.editorContent,
        'shared-entry-content',
        {
          mood: metadata?.mood || '',
          tags: metadata?.tags || [],
          date: 'Shared Entry'
        }
      );
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download entry');
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const calculateReadingTime = () => {
    if (!entry?.editorContent?.content) return 0;
    let wordCount = 0;
    
    const countWords = (node) => {
      if (node.type === 'text' && node.text) {
        return node.text.split(/\s+/).length;
      }
      if (node.content && Array.isArray(node.content)) {
        return node.content.reduce((sum, child) => sum + countWords(child), 0);
      }
      return 0;
    };

    entry.editorContent.content.forEach(node => {
      wordCount += countWords(node);
    });

    return Math.max(1, Math.ceil(wordCount / 200));
  };

  const renderInlineNode = (node, key) => {
    if (!node) return null;

    if (node.type === 'text') {
      let element = <span>{node.text || ''}</span>;

      if (node.marks) {
        node.marks.forEach(mark => {
          if (mark.type === 'bold') {
            element = <strong key={key}>{element}</strong>;
          } else if (mark.type === 'italic') {
            element = <em key={key}>{element}</em>;
          } else if (mark.type === 'code') {
            element = <code key={key}>{element}</code>;
          } else if (mark.type === 'underline') {
            element = <u key={key}>{element}</u>;
          }
        });
      }

      return element;
    }

    if (node.type === 'hardBreak') {
      return <br key={key} />;
    }

    if (node.type === 'image') {
      return (
        <figure key={key} className="share-figure">
          <img
            src={node.attrs?.src}
            alt={node.attrs?.alt || 'Shared content'}
            className="share-image"
          />
          {node.attrs?.alt && <figcaption>{node.attrs.alt}</figcaption>}
        </figure>
      );
    }

    return null;
  };

  const renderBlockNode = (node, index) => {
    if (!node) return null;

    if (node.type === 'paragraph') {
      return (
        <p key={index} className="share-paragraph">
          {(node.content || []).map((child, childIndex) =>
            renderInlineNode(child, `p-${index}-${childIndex}`)
          )}
        </p>
      );
    }

    if (node.type === 'heading') {
      const level = node.attrs?.level || 1;
      const children = (node.content || []).map((child, childIndex) =>
        renderInlineNode(child, `h-${index}-${childIndex}`)
      );
      const HeadingTag = `h${level}`;
      return <HeadingTag key={index} className={`share-heading share-h${level}`}>{children}</HeadingTag>;
    }

    if (node.type === 'bulletList') {
      return (
        <ul key={index} className="share-list">
          {(node.content || []).map((item, itemIndex) => renderBlockNode(item, `ul-${index}-${itemIndex}`))}
        </ul>
      );
    }

    if (node.type === 'orderedList') {
      return (
        <ol key={index} className="share-list">
          {(node.content || []).map((item, itemIndex) => renderBlockNode(item, `ol-${index}-${itemIndex}`))}
        </ol>
      );
    }

    if (node.type === 'listItem') {
      return (
        <li key={index} className="share-list-item">
          {(node.content || []).map((child, childIndex) => {
            if (child.type === 'paragraph') {
              return (
                <p key={`li-p-${index}-${childIndex}`}>
                  {(child.content || []).map((inlineNode, inlineIndex) =>
                    renderInlineNode(inlineNode, `li-inline-${index}-${childIndex}-${inlineIndex}`)
                  )}
                </p>
              );
            }
            return renderBlockNode(child, `li-${index}-${childIndex}`);
          })}
        </li>
      );
    }

    if (node.type === 'codeBlock') {
      const code = (node.content || [])
        .map(c => c.text || '')
        .join('\n');
      return (
        <pre key={index} className="share-code-block">
          <code>{code}</code>
        </pre>
      );
    }

    if (node.type === 'blockquote') {
      return (
        <blockquote key={index} className="share-blockquote">
          {(node.content || []).map((child, childIndex) => renderBlockNode(child, `bq-${index}-${childIndex}`))}
        </blockquote>
      );
    }

    if (node.type === 'image') {
      return renderInlineNode(node, `img-${index}`);
    }

    return null;
  };

  if (loading) {
    return (
      <div className="share-view-wrapper">
        <div className="share-loading-screen">
          <div className="share-spinner"></div>
          <p>Decrypting shared entry...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="share-view-wrapper">
        <div className="share-error-card">
          <Lock size={48} />
          <h2>Unable to Open Shared Entry</h2>
          <p>{error}</p>
          <button className="btn btn-secondary" onClick={() => navigate('/')}>
            <ChevronLeft size={16} />
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const readingTime = calculateReadingTime();

  return (
    <div className="share-view-wrapper">
      <div className="share-view-container">
        {/* Header */}
        <header className="share-header">
          <div className="share-header-content">
            <h1 className="share-title">{metadata?.title || 'Shared Entry'}</h1>
            <p className="share-subtitle">🔒 Encrypted end-to-end • Read-only shared note</p>
          </div>

          <div className="share-header-actions">
            {allowDownload && (
              <button 
                className="share-btn share-btn-secondary" 
                onClick={handleDownload}
                title="Download entry as markdown"
              >
                <Download size={16} />
                <span>Download</span>
              </button>
            )}
            <button 
              className="share-btn share-btn-secondary" 
              onClick={handleCopyLink}
              title="Copy share link"
            >
              <Copy size={16} />
              <span>{copied ? 'Copied!' : 'Share'}</span>
            </button>
          </div>
        </header>

        {/* Meta Information */}
        <div className="share-info-bar">
          {shareCreatedAt && (
            <div className="share-info-item">
              <span className="share-info-label">Shared</span>
              <span className="share-info-value">{formatIST(shareCreatedAt, 'datetime')}</span>
            </div>
          )}
          <div className="share-info-item">
            <Eye size={14} />
            <span className="share-info-value">{viewCount} {viewCount === 1 ? 'view' : 'views'}</span>
          </div>
          <div className="share-info-item">
            <Clock size={14} />
            <span className="share-info-value">{readingTime} min read</span>
          </div>
          {metadata?.mood && (
            <div className="share-info-item">
              <span className="share-info-label">Mood</span>
              <span className="share-info-value">{metadata.mood}</span>
            </div>
          )}
        </div>

        {/* Tags */}
        {metadata?.tags && metadata.tags.length > 0 && (
          <div className="share-tags">
            {metadata.tags.map((tag, idx) => (
              <span key={idx} className="share-tag">{tag}</span>
            ))}
          </div>
        )}

        {/* Content */}
        <article
          id="shared-entry-content"
          className="share-content"
          style={{
            backgroundColor: entry?.bgColor || '#ffffff',
            backgroundImage: entry?.bgPattern !== 'none' ? entry?.bgPattern : 'none',
            backgroundSize: entry?.bgPattern !== 'none' ? '20px 20px' : 'auto',
            backgroundRepeat: entry?.bgPattern !== 'none' ? 'repeat' : 'no-repeat',
            backgroundPosition: 'center',
            fontFamily: entry?.fontFamily || 'inherit',
            fontSize: entry?.fontSize || '16px',
            lineHeight: entry?.lineHeight || '1.6',
            letterSpacing: entry?.letterSpacing || '0px',
          }}
        >
          {entry?.editorContent?.content && entry.editorContent.content.length > 0 ? (
            entry.editorContent.content.map((node, index) => renderBlockNode(node, index))
          ) : (
            <p className="share-empty">No content available</p>
          )}
        </article>

        {/* Footer */}
        <footer className="share-footer">
          <p>
            This note is encrypted end-to-end. The encryption key is in the link fragment (#key) and never sent to the server.
          </p>
        </footer>
      </div>
    </div>
  );
}

