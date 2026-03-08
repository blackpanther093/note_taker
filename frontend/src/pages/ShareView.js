import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { sharesAPI } from '../api/client';
import { decryptWithShareKey, base64ToArray } from '../crypto/encryption';
import { Download, Lock } from 'lucide-react';
import { downloadEntry } from '../utils/download';
import { formatIST } from '../utils/timezone';

export default function ShareView() {
  const { shareId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entry, setEntry] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [allowDownload, setAllowDownload] = useState(false);
  const [shareCreatedAt, setShareCreatedAt] = useState(null);
  const [viewCount, setViewCount] = useState(0);

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
            console.error('Metadata decryption failed:', metaErr);
          }
        }
      } catch (err) {
        console.error('Failed to load shared entry:', err);
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

  const renderInlineNode = (node, key) => {
    if (!node) return null;

    if (node.type === 'text') {
      return <span key={key}>{node.text || ''}</span>;
    }

    if (node.type === 'hardBreak') {
      return <br key={key} />;
    }

    if (node.type === 'image') {
      return (
        <img
          key={key}
          src={node.attrs?.src}
          alt={node.attrs?.alt || 'Shared content'}
          style={{ maxWidth: '100%', borderRadius: '8px', margin: '0.5rem 0' }}
        />
      );
    }

    return null;
  };

  const renderBlockNode = (node, index) => {
    if (!node) return null;

    if (node.type === 'paragraph') {
      return (
        <p key={index}>
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
      if (level === 1) return <h1 key={index}>{children}</h1>;
      if (level === 2) return <h2 key={index}>{children}</h2>;
      return <h3 key={index}>{children}</h3>;
    }

    if (node.type === 'bulletList') {
      return (
        <ul key={index}>
          {(node.content || []).map((item, itemIndex) => renderBlockNode(item, `ul-${index}-${itemIndex}`))}
        </ul>
      );
    }

    if (node.type === 'orderedList') {
      return (
        <ol key={index}>
          {(node.content || []).map((item, itemIndex) => renderBlockNode(item, `ol-${index}-${itemIndex}`))}
        </ol>
      );
    }

    if (node.type === 'listItem') {
      return (
        <li key={index}>
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

    if (node.type === 'image') {
      return renderInlineNode(node, `img-${index}`);
    }

    return null;
  };

  if (loading) {
    return (
      <div className="share-view-container">
        <div className="loading-screen">
          <div className="spinner"></div>
          <p>Decrypting shared entry...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="share-view-container">
        <div className="error-card">
          <Lock size={48} />
          <h2>Unable to Open Shared Entry</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="share-view-container">
      <div className="share-header">
        <div>
          <h1>{metadata?.title || 'Shared Entry'}</h1>
          <p className="share-subtitle">Read-only shared note</p>
          <div className="share-header-meta">
            <span className="meta-chip">Views: {viewCount}</span>
            {shareCreatedAt && <span className="meta-chip">Shared: {formatIST(shareCreatedAt, 'datetime')}</span>}
          </div>
        </div>
        {allowDownload && (
          <button className="btn btn-primary" onClick={handleDownload}>
            <Download size={16} />
            Download
          </button>
        )}
      </div>

      {metadata && (
        <div className="share-meta">
          {metadata.mood && <span className="meta-chip">Mood: {metadata.mood}</span>}
          {metadata.tags && metadata.tags.length > 0 && (
            <span className="meta-chip">Tags: {metadata.tags.join(', ')}</span>
          )}
        </div>
      )}

      <div
        id="shared-entry-content"
        className="editor-area"
        style={{
          backgroundColor: entry?.bgColor || '#ffffff',
          backgroundImage: entry?.bgPattern !== 'none' ? entry?.bgPattern : 'none',
          backgroundSize: entry?.bgPattern !== 'none' ? '20px 20px' : 'auto',
          backgroundRepeat: entry?.bgPattern !== 'none' ? 'repeat' : 'no-repeat',
          backgroundPosition: 'center',
          fontFamily: entry?.fontFamily || 'inherit',
        }}
      >
        <div className="journal-editor-content">
          {entry?.editorContent?.content?.map((node, index) => renderBlockNode(node, index))}
        </div>
      </div>
    </div>
  );
}
