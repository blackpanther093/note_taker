import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';

import { useAuth } from '../context/AuthContext';
import { authAPI, entriesAPI, assetsAPI, sharesAPI } from '../api/client';
import {
  encryptEntry,
  decryptEntry,
  encryptMetadata,
  decryptMetadata,
  encryptAsset,
  generateUUID,
  generateShareKey,
  encryptWithShareKey,
  arrayToBase64,
  base64ToArray,
} from '../crypto/encryption';
import {
  ArrowLeft, Save, Bold, Italic, Underline as UnderlineIcon,
  Heading1, Heading2, List, Image as ImageIcon, Palette, Type,
  Smile, Download, Share2, Copy, X
} from 'lucide-react';
import { format } from 'date-fns';
import { downloadEntry } from '../utils/download';
import { formatIST } from '../utils/timezone';
import { useTheme } from '../context/ThemeContext';

const MOOD_OPTIONS = [
  { value: 'happy', emoji: '😊', label: 'Happy' },
  { value: 'sad', emoji: '😢', label: 'Sad' },
  { value: 'excited', emoji: '🎉', label: 'Excited' },
  { value: 'anxious', emoji: '😰', label: 'Anxious' },
  { value: 'calm', emoji: '😌', label: 'Calm' },
  { value: 'grateful', emoji: '🙏', label: 'Grateful' },
  { value: 'angry', emoji: '😠', label: 'Angry' },
  { value: 'neutral', emoji: '😐', label: 'Neutral' },
];

const FONT_FAMILIES = [
  'Default',
  'Georgia, serif',
  'Courier New, monospace',
  'Arial, sans-serif',
  'Verdana, sans-serif',
];

const BG_COLORS = [
  '#ffffff', '#fff8e7', '#f0f8ff', '#f5f0ff', '#fff0f5',
  '#f0fff0', '#fffaf0', '#f8f8ff', '#fffff0', '#fdf5e6',
  '#1f2937', '#111827', '#0f172a', '#1e293b',
];

const BG_PATTERNS = [
  { name: 'None', value: 'none' },
  { name: 'Dots', value: 'radial-gradient(circle, #ddd 1px, transparent 1px)' },
  { name: 'Lines', value: 'repeating-linear-gradient(0deg, transparent, transparent 19px, #eee 19px, #eee 20px)' },
  { name: 'Grid', value: 'linear-gradient(#eee 1px, transparent 1px), linear-gradient(90deg, #eee 1px, transparent 1px)' },
];

function toBase64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token) {
  const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
  return normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
}

function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  const cleaned = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(cleaned)) return null;

  const normalized = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned;

  const int = parseInt(normalized, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function getContrastTextColor(backgroundHex) {
  const rgb = hexToRgb(backgroundHex);
  if (!rgb) return '#1f2937';

  // Perceived luminance for readable foreground selection
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.6 ? '#1f2937' : '#f8fafc';
}

export default function EntryEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    encryptionKey,
    isAuthenticated,
    loading: authLoading,
    getShareInfo,
    upsertShareInfo,
  } = useAuth();
  const { theme } = useTheme();

  const isNew = !id || id === 'new';
  const defaultBgColor = theme === 'dark' ? '#111827' : '#ffffff';
  const [entryId] = useState(() => isNew ? generateUUID() : id);
  const [title, setTitle] = useState('');
  const [mood, setMood] = useState('');
  const [tags, setTags] = useState('');
  const [entryDate, setEntryDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [bgColor, setBgColor] = useState(defaultBgColor);
  const [isBgColorCustomized, setIsBgColorCustomized] = useState(false);
  const [bgPattern, setBgPattern] = useState('none');
  const [bgImage, setBgImage] = useState('');
  const [fontFamily, setFontFamily] = useState('Default');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [showMoodPicker, setShowMoodPicker] = useState(false);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [allowDownload, setAllowDownload] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const lastSavedSnapshotRef = useRef('');
  const autosaveDebounceRef = useRef(null);
  const autosavePeriodicRef = useRef(null);
  const hydrationRef = useRef(true);
  const dirtyCheckDebounceRef = useRef(null);
  const lastAutoSaveTimeRef = useRef(0);
  const hasLoadedEntryRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        inline: true, 
        allowBase64: true,
      }),
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: 'Start writing your thoughts...' }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'journal-editor-content',
      },
    },
  });

  const buildSnapshot = useCallback((contentJsonOverride = null, metadataOverride = null) => {
    const normalizedTags = (metadataOverride?.tags ?? tags)
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
      .join(',');

    const payload = {
      title: metadataOverride?.title ?? title,
      mood: metadataOverride?.mood ?? mood,
      tags: normalizedTags,
      entryDate: metadataOverride?.entryDate ?? entryDate,
      bgColor: metadataOverride?.bgColor ?? bgColor,
      bgPattern: metadataOverride?.bgPattern ?? bgPattern,
      bgImage: metadataOverride?.bgImage ?? bgImage,
      fontFamily: metadataOverride?.fontFamily ?? fontFamily,
      content: contentJsonOverride ?? editor?.getJSON() ?? null,
    };

    return JSON.stringify(payload);
  }, [title, mood, tags, entryDate, bgColor, bgPattern, bgImage, fontFamily, editor]);

  // Load existing entry
  const loadEntry = useCallback(async () => {
    if (isNew || !editor) return false;
    
    // Wait for encryption key if not available yet
    if (!encryptionKey) {
      return false;
    }
    
    setLoading(true);

    try {
      const res = await entriesAPI.get(id);
      const entry = res.data.entry;

      // Decrypt content
      const content = await decryptEntry(
        entry.encrypted_content,
        entry.iv,
        encryptionKey,
        entry.id
      );

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = content;
      }

      let loadedTitle = '';
      let loadedMood = '';
      let loadedTags = '';
      let loadedBgColor = defaultBgColor;
      let loadedBgPattern = 'none';
      let loadedBgImage = '';
      let loadedFontFamily = 'Default';
      let loadedEditorContent = parsed;
      let loadedBgColorCustomized = false;

      // Handle the case where parsed content includes bg settings
      if (parsed && typeof parsed === 'object' && parsed.editorContent) {
        editor.commands.setContent(parsed.editorContent);
        loadedBgColor = parsed.bgColor || defaultBgColor;
        loadedBgPattern = parsed.bgPattern || 'none';
        loadedBgImage = parsed.bgImage || '';
        loadedFontFamily = parsed.fontFamily || 'Default';
        loadedEditorContent = parsed.editorContent;
        loadedBgColorCustomized = !!parsed.bgColor;
        setBgColor(loadedBgColor);
        setIsBgColorCustomized(loadedBgColorCustomized);
        setBgPattern(loadedBgPattern);
        setBgImage(loadedBgImage);
        setFontFamily(loadedFontFamily);
      } else {
        editor.commands.setContent(parsed);
        setBgColor(defaultBgColor);
        setIsBgColorCustomized(false);
      }

      setEntryDate(entry.entry_date);

      // Decrypt metadata
      if (entry.encrypted_metadata && entry.metadata_iv) {
        try {
          const meta = await decryptMetadata(
            entry.encrypted_metadata,
            entry.metadata_iv,
            encryptionKey,
            entry.id
          );
          loadedTitle = meta.title || '';
          loadedMood = meta.mood || '';
          loadedTags = (meta.tags || []).join(', ');
          setTitle(loadedTitle);
          setMood(loadedMood);
          setTags(loadedTags);
        } catch {
          // Metadata decryption failed
        }
      }

      lastSavedSnapshotRef.current = buildSnapshot(loadedEditorContent, {
        title: loadedTitle,
        mood: loadedMood,
        tags: loadedTags,
        entryDate: entry.entry_date,
        bgColor: loadedBgColor,
        bgPattern: loadedBgPattern,
        bgImage: loadedBgImage,
        fontFamily: loadedFontFamily,
      });
      hydrationRef.current = false;
      setHasUnsavedChanges(false);
      return true;
    } catch (err) {
      console.error('Failed to load entry:', err);
      alert('Failed to load entry');
      navigate('/');
      return false;
    } finally {
      setLoading(false);
    }
  }, [id, isNew, encryptionKey, editor, navigate, buildSnapshot, defaultBgColor]);

  useEffect(() => {
    hasLoadedEntryRef.current = false;
  }, [id]);

  useEffect(() => {
    if (!editor || isNew || authLoading || !encryptionKey || hasLoadedEntryRef.current) {
      return;
    }

    let isCancelled = false;
    loadEntry().then((loaded) => {
      if (!isCancelled && loaded) {
        hasLoadedEntryRef.current = true;
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [editor, isNew, authLoading, encryptionKey, loadEntry]);

  useEffect(() => {
    if (!editor || !isNew) return;
    hydrationRef.current = false;
    const initialSnapshot = buildSnapshot(editor.getJSON());
    lastSavedSnapshotRef.current = initialSnapshot;
    setHasUnsavedChanges(false);
  }, [editor, isNew, buildSnapshot]);

  useEffect(() => {
    if (!isBgColorCustomized) {
      setBgColor(defaultBgColor);
    }
  }, [defaultBgColor, isBgColorCustomized]);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !encryptionKey) {
      if (autosaveDebounceRef.current) clearTimeout(autosaveDebounceRef.current);
      if (autosavePeriodicRef.current) clearInterval(autosavePeriodicRef.current);
      navigate('/login', { replace: true });
    }
  }, [authLoading, isAuthenticated, encryptionKey, navigate]);

  const handleSave = useCallback(async () => {
    if (!editor || saving) return;
    
    // Prevent consecutive saves within 5 seconds (safety guard against rapid operations like cut/paste)
    const now = Date.now();
    if (now - lastAutoSaveTimeRef.current < 5000) {
      return;
    }
    lastAutoSaveTimeRef.current = now;
    
    if (!isAuthenticated || !encryptionKey) {
      navigate('/login', { replace: true });
      return;
    }
    setSaving(true);
    setSaved(false);

    try {
      // Build content with visual settings
      const contentPayload = JSON.stringify({
        editorContent: editor.getJSON(),
        bgColor,
        bgPattern,
        bgImage,
        fontFamily,
      });

      // Encrypt content
      const { encrypted_content, iv } = await encryptEntry(
        contentPayload,
        encryptionKey,
        entryId
      );

      // Encrypt metadata
      const metadata = {
        title: title || 'Untitled',
        mood,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      };
      const { encrypted_metadata, metadata_iv } = await encryptMetadata(
        metadata,
        encryptionKey,
        entryId
      );

      const payload = {
        id: entryId,
        encrypted_content,
        iv,
        entry_date: entryDate,
        encrypted_metadata,
        metadata_iv,
      };

      if (isNew) {
        await entriesAPI.create(payload);
      } else {
        await entriesAPI.update(entryId, payload);
      }

      // Keep shared link content in sync with latest edits when share key is available locally.
      try {
        const shareInfo = getShareInfo(entryId);
        if (shareInfo?.key) {
          const shareKey = base64ToArray(fromBase64Url(shareInfo.key));
          const shareContent = await encryptWithShareKey(contentPayload, shareKey);
          const shareMeta = await encryptWithShareKey(JSON.stringify(metadata), shareKey);

          await sharesAPI.create({
            entry_id: entryId,
            encrypted_content: shareContent.encrypted_content,
            iv: shareContent.iv,
            encrypted_metadata: shareMeta.encrypted_content,
            metadata_iv: shareMeta.iv,
            allow_download: !!shareInfo.allowDownload,
          });
        }
      } catch (shareSyncErr) {
        // Non-blocking: entry save already succeeded.
        console.warn('Share sync skipped:', shareSyncErr);
      }

      lastSavedSnapshotRef.current = buildSnapshot(editor.getJSON());
      hydrationRef.current = false;
      setHasUnsavedChanges(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

      if (isNew) {
        navigate(`/entry/${entryId}`, { replace: true });
      }
    } catch (err) {
      console.error('Failed to save entry:', err);
      
      // Reset save throttle on error to allow retry
      lastAutoSaveTimeRef.current = 0;
      
      // Handle 401 Unauthorized - session expired
      if (err.response?.status === 401) {
        alert('Session expired. Please log in again.');
        // Clear auto-save intervals
        if (autosaveDebounceRef.current) clearTimeout(autosaveDebounceRef.current);
        if (autosavePeriodicRef.current) clearInterval(autosavePeriodicRef.current);
        navigate('/login', { replace: true });
        return;
      }
      
      alert('Failed to save entry: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  }, [
    editor,
    saving,
    isAuthenticated,
    encryptionKey,
    navigate,
    bgColor,
    bgPattern,
    bgImage,
    fontFamily,
    getShareInfo,
    entryId,
    title,
    mood,
    tags,
    entryDate,
    isNew,
    buildSnapshot,
  ]);

  const handleDownload = async () => {
    if (!editor || !isAuthenticated || !encryptionKey) {
      navigate('/login', { replace: true });
      return;
    }

    try {
      await authAPI.me();
      const metadata = {
        date: formatIST(entryDate, 'date'),
        mood,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      };

      await downloadEntry(
        title || 'Untitled',
        editor.getJSON(),
        'journal-editor-content',
        metadata
      );
    } catch (err) {
      console.error('Failed to download entry:', err);
      alert('Failed to download entry: ' + err.message);
    }
  };

  const handleOpenShareModal = () => {
    if (!editor || !isAuthenticated || !encryptionKey) {
      alert('You must be logged in to share');
      return;
    }

    if (isNew || hasUnsavedChanges) {
      alert('Please save the entry first before sharing');
      return;
    }

    setShowShareModal(true);
    setShareLink('');
    setLinkCopied(false);
  };

  const handleCreateShareLink = async () => {
    if (!editor || !isAuthenticated || !encryptionKey) return;

    setSharing(true);

    try {
      const existing = getShareInfo(entryId);
      const shareKey = existing?.key
        ? base64ToArray(fromBase64Url(existing.key))
        : generateShareKey();
      const contentPayload = JSON.stringify({
        editorContent: editor.getJSON(),
        bgColor,
        bgPattern,
        bgImage,
        fontFamily,
      });

      const { encrypted_content, iv } = await encryptWithShareKey(contentPayload, shareKey);

      const metadata = {
        title: title || 'Untitled',
        mood,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      };

      const { encrypted_content: encrypted_metadata, iv: metadata_iv } = await encryptWithShareKey(
        JSON.stringify(metadata),
        shareKey
      );

      const response = await sharesAPI.create({
        entry_id: entryId,
        encrypted_content,
        iv,
        encrypted_metadata,
        metadata_iv,
        allow_download: allowDownload,
      });

      const shareKeyBase64Url = toBase64Url(arrayToBase64(shareKey));

      // Persist encrypted share vault so other devices can sync after login.
      await upsertShareInfo(entryId, {
        shareId: response.data.share_id,
        key: shareKeyBase64Url,
        allowDownload,
      });

      const baseUrl = window.location.origin;
      const link = `${baseUrl}/share/${response.data.share_id}#k=${shareKeyBase64Url}`;
      setShareLink(link);
    } catch (err) {
      console.error('Failed to create share link:', err);
      alert('Failed to create share link: ' + (err.response?.data?.error || err.message));
    } finally {
      setSharing(false);
    }
  };

  const handleCopyLink = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleCloseShareModal = () => {
    setShowShareModal(false);
    setShareLink('');
    setLinkCopied(false);
    setSharing(false);
  };

  const markDirtyIfChanged = useCallback(() => {
    if (!editor || loading || hydrationRef.current) return;
    const currentSnapshot = buildSnapshot(editor.getJSON());
    setHasUnsavedChanges(currentSnapshot !== lastSavedSnapshotRef.current);
  }, [editor, loading, buildSnapshot]);

  // Debounced dirty check to prevent excessive snapshot comparisons during rapid edits (e.g., undo)
  const markDirtyIfChangedDebounced = useCallback(() => {
    if (dirtyCheckDebounceRef.current) {
      clearTimeout(dirtyCheckDebounceRef.current);
    }
    dirtyCheckDebounceRef.current = setTimeout(() => {
      markDirtyIfChanged();
    }, 150);
  }, [markDirtyIfChanged]);

  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => markDirtyIfChangedDebounced();
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
      if (dirtyCheckDebounceRef.current) {
        clearTimeout(dirtyCheckDebounceRef.current);
      }
    };
  }, [editor, markDirtyIfChangedDebounced]);

  useEffect(() => {
    markDirtyIfChanged();
  }, [title, mood, tags, entryDate, bgColor, bgPattern, bgImage, fontFamily, markDirtyIfChanged]);

  // Auto-save functionality
  useEffect(() => {
    const autoSaveEnabled = localStorage.getItem('autoSaveEnabled') !== 'false';
    const canAutoSave = autoSaveEnabled && hasUnsavedChanges && !loading && !saving && isAuthenticated && !!encryptionKey;

    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
      autosaveDebounceRef.current = null;
    }

    if (autosavePeriodicRef.current) {
      clearInterval(autosavePeriodicRef.current);
      autosavePeriodicRef.current = null;
    }

    if (!canAutoSave) {
      return;
    }

    // Wait 5 seconds after user stops making changes before saving (much longer delay for image operations)
    autosaveDebounceRef.current = setTimeout(() => {
      handleSave();
    }, 5000);

    // Also save periodically while dirty, but with longer interval
    autosavePeriodicRef.current = setInterval(() => {
      if (!saving && hasUnsavedChanges) {
        handleSave();
      }
    }, 20000);

    return () => {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
        autosaveDebounceRef.current = null;
      }
      if (autosavePeriodicRef.current) {
        clearInterval(autosavePeriodicRef.current);
        autosavePeriodicRef.current = null;
      }
    };
  }, [hasUnsavedChanges, loading, saving, isAuthenticated, encryptionKey, handleSave]);

  // Handle manual save - reset unsaved changes flag
  useEffect(() => {
    if (saved) {
      setHasUnsavedChanges(false);
    }
  }, [saved]);

  // Warn before leaving page if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges && isAuthenticated) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, isAuthenticated]);

  const navigateBackSafely = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm('You have unsaved changes. Leave without saving?');
      if (!confirmed) return;
    }
    navigate('/');
  }, [hasUnsavedChanges, navigate]);

  const uploadEditorImage = useCallback(async (file) => {
    if (!file) return;

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image too large. Maximum size is 10MB.');
      return;
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('Unsupported image type.');
      return;
    }

    try {
      // Ensure entry exists before uploading assets
      if (isNew || hasUnsavedChanges) {
        await handleSave();
      }

      const arrayBuffer = await file.arrayBuffer();
      const fileBytes = new Uint8Array(arrayBuffer);
      const assetId = generateUUID();

      // Encrypt the image
      const { encrypted_data, iv } = await encryptAsset(
        fileBytes,
        encryptionKey,
        entryId,
        assetId
      );

      // Upload encrypted image
      await assetsAPI.upload({
        entry_id: entryId,
        encrypted_data,
        iv,
        asset_type: file.type,
        file_size: file.size,
      });

      // For display, convert to base64 data URL (stays in browser only)
      const reader = new FileReader();
      reader.onload = () => {
        editor.chain().focus().setImage({ src: reader.result, width: 640, fit: 'contain' }).run();
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Failed to upload image:', err);
      alert('Failed to upload image: ' + (err.response?.data?.error || err.message));
    }
  }, [isNew, hasUnsavedChanges, handleSave, encryptionKey, entryId, editor]);

  const handleImageUpload = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      await uploadEditorImage(file);
    };
    input.click();
  };

  // Paste image support (Ctrl/Cmd+V and clipboard paste on supported browsers/devices)
  useEffect(() => {
    if (!editor) return;

    const handlePasteImage = (event) => {
      const items = event.clipboardData?.items;
      if (!items || !items.length) return;

      const imageItem = Array.from(items).find(
        (item) => item.kind === 'file' && item.type.startsWith('image/')
      );

      if (!imageItem) return;

      const file = imageItem.getAsFile();
      if (!file) return;

      event.preventDefault();
      void uploadEditorImage(file);
    };

    let dom = null;
    try {
      // TipTap can throw while view is not mounted yet; guard explicitly.
      dom = editor.view?.dom || null;
    } catch {
      return undefined;
    }

    if (!dom) return undefined;

    dom.addEventListener('paste', handlePasteImage);
    return () => {
      try {
        dom.removeEventListener('paste', handlePasteImage);
      } catch {
        // Ignore cleanup race if editor unmounts before listener removal.
      }
    };
  }, [editor, uploadEditorImage]);

  const handleBgImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        alert('Background image too large. Max 5MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setBgImage(reader.result);
        setBgPattern('none');
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);



  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Decrypting entry...</p>
      </div>
    );
  }

  const editorTextColor = getContrastTextColor(bgColor);
  const editorPlaceholderColor = editorTextColor === '#1f2937' ? '#6b7280' : '#aeb9c7';

  const editorBgStyle = {
    backgroundColor: bgColor,
    backgroundImage: bgPattern !== 'none' ? bgPattern : (bgImage ? `url(${bgImage})` : 'none'),
    backgroundSize: bgPattern !== 'none' ? '20px 20px' : 'cover',
    backgroundPosition: 'center',
    fontFamily: fontFamily !== 'Default' ? fontFamily : undefined,
    color: editorTextColor,
    '--editor-text-color': editorTextColor,
    '--editor-placeholder-color': editorPlaceholderColor,
  };

  return (
    <div className="entry-editor-page">
      {/* Top Bar */}
      <div className="editor-topbar">
        <button className="btn btn-icon" onClick={navigateBackSafely}>
          <ArrowLeft size={20} />
        </button>

        <input
          type="text"
          className="entry-title-input"
          placeholder="Entry title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <input
          type="date"
          className="entry-date-input"
          value={entryDate}
          onChange={(e) => setEntryDate(e.target.value)}
        />

        <div className="mood-picker-wrapper">
          <button
            className="btn btn-icon"
            onClick={() => setShowMoodPicker(!showMoodPicker)}
            title="Set mood"
          >
            <Smile size={20} />
            {mood && <span className="mood-badge">{MOOD_OPTIONS.find(m => m.value === mood)?.emoji}</span>}
          </button>
          {showMoodPicker && (
            <div className="mood-dropdown">
              {MOOD_OPTIONS.map(m => (
                <button
                  key={m.value}
                  className={`mood-option ${mood === m.value ? 'active' : ''}`}
                  onClick={() => { setMood(m.value); setShowMoodPicker(false); }}
                >
                  <span>{m.emoji}</span> {m.label}
                </button>
              ))}
              {mood && (
                <button
                  className="mood-option clear"
                  onClick={() => { setMood(''); setShowMoodPicker(false); }}
                >
                  Clear mood
                </button>
              )}
            </div>
          )}
        </div>

        <button
          className="btn btn-primary save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          <Save size={16} />
          {saving ? 'Encrypting...' : saved ? 'Saved!' : hasUnsavedChanges ? 'Save *' : 'Save'}
        </button>

        <button
          className="btn btn-secondary"
          onClick={handleDownload}
          disabled={loading}
          style={{ marginLeft: '0.5rem' }}
          title="Download this entry"
        >
          <Download size={16} />
          Download
        </button>

        <button
          className="btn btn-secondary"
          onClick={handleOpenShareModal}
          disabled={loading || isNew || hasUnsavedChanges}
          style={{ marginLeft: '0.5rem' }}
          title={isNew || hasUnsavedChanges ? 'Save the entry first' : 'Share this entry'}
        >
          <Share2 size={16} />
          Share
        </button>
      </div>

      {/* Tags */}
      <div className="tags-bar">
        <input
          type="text"
          placeholder="Tags (comma-separated)..."
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="tags-input"
        />
      </div>

      {/* Toolbar */}
      <div className="editor-toolbar">
        <button
          className={`toolbar-btn ${editor?.isActive('bold') ? 'active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
        >
          <Bold size={16} />
        </button>
        <button
          className={`toolbar-btn ${editor?.isActive('italic') ? 'active' : ''}`}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
        >
          <Italic size={16} />
        </button>
        <button
          className={`toolbar-btn ${editor?.isActive('underline') ? 'active' : ''}`}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon size={16} />
        </button>

        <span className="toolbar-divider" />

        <button
          className={`toolbar-btn ${editor?.isActive('heading', { level: 1 }) ? 'active' : ''}`}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Heading 1"
        >
          <Heading1 size={16} />
        </button>
        <button
          className={`toolbar-btn ${editor?.isActive('heading', { level: 2 }) ? 'active' : ''}`}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading 2"
        >
          <Heading2 size={16} />
        </button>
        <button
          className={`toolbar-btn ${editor?.isActive('bulletList') ? 'active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          title="Bullet List"
        >
          <List size={16} />
        </button>

        <span className="toolbar-divider" />

        <button
          className="toolbar-btn"
          onClick={handleImageUpload}
          title="Insert Image"
        >
          <ImageIcon size={16} />
        </button>

        {/* Font Picker */}
        <div className="toolbar-dropdown-wrapper">
          <button
            className="toolbar-btn"
            onClick={() => setShowFontPicker(!showFontPicker)}
            title="Font"
          >
            <Type size={16} />
          </button>
          {showFontPicker && (
            <div className="toolbar-dropdown">
              {FONT_FAMILIES.map(f => (
                <button
                  key={f}
                  className={`dropdown-option ${fontFamily === f ? 'active' : ''}`}
                  style={{ fontFamily: f !== 'Default' ? f : undefined }}
                  onClick={() => { setFontFamily(f); setShowFontPicker(false); }}
                >
                  {f.split(',')[0]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Text Color */}
        <input
          type="color"
          className="color-input"
          onChange={(e) => editor?.chain().focus().setColor(e.target.value).run()}
          title="Text Color"
          defaultValue="#000000"
        />

        <span className="toolbar-divider" />

        {/* Background Picker */}
        <div className="toolbar-dropdown-wrapper">
          <button
            className="toolbar-btn"
            onClick={() => setShowBgPicker(!showBgPicker)}
            title="Background"
          >
            <Palette size={16} />
          </button>
          {showBgPicker && (
            <div className="toolbar-dropdown bg-picker-dropdown">
              <div className="bg-section">
                <label>Background Color</label>
                <div className="bg-colors">
                  {BG_COLORS.map(c => (
                    <button
                      key={c}
                      className={`bg-color-swatch ${bgColor === c ? 'active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => {
                        setBgColor(c);
                        setIsBgColorCustomized(true);
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="bg-section">
                <label>Pattern</label>
                <div className="bg-patterns">
                  {BG_PATTERNS.map(p => (
                    <button
                      key={p.name}
                      className={`bg-pattern-btn ${bgPattern === p.value ? 'active' : ''}`}
                      onClick={() => { setBgPattern(p.value); setBgImage(''); }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-section">
                <label>Background Image</label>
                <button className="btn btn-small" onClick={handleBgImageUpload}>
                  Upload Image
                </button>
                {bgImage && (
                  <button className="btn btn-small btn-danger" onClick={() => setBgImage('')}>
                    Remove
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Editor */}
      <div id="journal-editor-content" className="editor-area" style={editorBgStyle}>
        <EditorContent editor={editor} />

            {/* Share Modal */}
            {showShareModal && (
              <div className="modal-overlay" onClick={handleCloseShareModal}>
                <div className="modal-content share-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h3>Share Entry</h3>
                    <button className="close-btn" onClick={handleCloseShareModal}>
                      <X size={20} />
                    </button>
                  </div>
            
                  {sharing ? (
                    <div className="modal-body">
                      <div style={{ textAlign: 'center', padding: '2rem' }}>
                        <div className="spinner"></div>
                        <p>Creating secure share link...</p>
                      </div>
                    </div>
                  ) : shareLink ? (
                    <div className="modal-body">
                      <div className="share-info">
                        <p className="share-description">
                          🔒 <strong>Secure sharing enabled</strong> - Your note is encrypted end-to-end. 
                          The decryption key is embedded in the link fragment (#key) and never sent to the server.
                        </p>
                  
                        <div className="share-options">
                          <label className="share-option-label">
                            <input
                              type="checkbox"
                              checked={allowDownload}
                              onChange={(e) => setAllowDownload(e.target.checked)}
                              disabled
                            />
                            <span>Allow viewers to download this entry</span>
                          </label>
                          <p className="share-hint">
                            (To change this, close and create a new share link)
                          </p>
                        </div>
                  
                        <div className="share-link-container">
                          <div className="share-link-row">
                            <input
                              type="text"
                              value={shareLink}
                              readOnly
                              className="share-link-input"
                              title={shareLink}
                              onFocus={(e) => e.target.select()}
                            />
                            <button
                              className="btn btn-primary share-copy-btn"
                              onClick={handleCopyLink}
                            >
                              <Copy size={16} />
                              {linkCopied ? 'Copied!' : 'Copy'}
                            </button>
                          </div>
                          <p className="share-hint">
                            Keep the full link including <code>#k=...</code>. That key unlocks decryption.
                          </p>
                        </div>
                  
                        <div className="share-warning">
                          ⚠️ Anyone with this link can view the entry. Share responsibly.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="modal-body">
                      <div className="share-config">
                        <p className="share-description">
                          Create a secure shareable link for this entry. Choose whether viewers can download it.
                        </p>
                  
                        <div className="share-options">
                          <label className="share-option-label">
                            <input
                              type="checkbox"
                              checked={allowDownload}
                              onChange={(e) => setAllowDownload(e.target.checked)}
                            />
                            <span>Allow viewers to download this entry</span>
                          </label>
                        </div>
                  
                        <button
                          className="btn btn-primary"
                          onClick={handleCreateShareLink}
                          disabled={sharing}
                          style={{ width: '100%', marginTop: '1rem' }}
                        >
                          Generate Share Link
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
      </div>
    </div>
  );
}
