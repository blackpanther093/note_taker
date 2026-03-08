import { encryptShareVault, decryptShareVault } from '../crypto/encryption';
import { authAPI } from '../api/client';

export const SHARE_KEY_STORE = 'share_keys_by_entry_v1';

function normalizeVault(vault) {
  const normalized = vault && typeof vault === 'object' ? vault : {};
  return {
    version: 1,
    updatedAt: Number(normalized.updatedAt || 0),
    entries: normalized.entries && typeof normalized.entries === 'object' ? normalized.entries : {},
  };
}

export function readLocalShareVault() {
  try {
    const raw = localStorage.getItem(SHARE_KEY_STORE);
    if (!raw) return normalizeVault(null);
    return normalizeVault(JSON.parse(raw));
  } catch {
    return normalizeVault(null);
  }
}

export function writeLocalShareVault(vault) {
  localStorage.setItem(SHARE_KEY_STORE, JSON.stringify(normalizeVault(vault)));
}

export function getShareVaultEntry(vault, entryId) {
  if (!vault?.entries) return null;
  return vault.entries[entryId] || null;
}

export function mergeShareVaults(localVault, remoteVault) {
  const local = normalizeVault(localVault);
  const remote = normalizeVault(remoteVault);

  const mergedEntries = { ...remote.entries };
  for (const [entryId, localEntry] of Object.entries(local.entries)) {
    const remoteEntry = remote.entries[entryId];
    const localTs = Number(localEntry?.updatedAt || 0);
    const remoteTs = Number(remoteEntry?.updatedAt || 0);
    if (!remoteEntry || localTs >= remoteTs) {
      mergedEntries[entryId] = localEntry;
    }
  }

  return {
    version: 1,
    updatedAt: Math.max(Number(local.updatedAt || 0), Number(remote.updatedAt || 0), Date.now()),
    entries: mergedEntries,
  };
}

export async function fetchRemoteShareVault(encryptionKey) {
  const res = await authAPI.getShareVault();
  if (!res?.data?.exists) {
    return normalizeVault(null);
  }
  const decrypted = await decryptShareVault(res.data.encrypted_vault, res.data.iv, encryptionKey);
  return normalizeVault(decrypted);
}

export async function pushRemoteShareVault(vault, encryptionKey) {
  const payload = await encryptShareVault(normalizeVault(vault), encryptionKey);
  await authAPI.upsertShareVault(payload.encrypted_vault, payload.iv);
}
