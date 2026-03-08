/**
 * Timezone utilities for IST (Indian Standard Time, UTC+5:30)
 */

function toDate(value) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Format date in IST for display
 * @param {string|Date} utcDate - UTC date string or Date object
 * @param {string} format - Format type: 'full', 'date', 'time', 'datetime'
 * @returns {string} Formatted IST string
 */
export function formatIST(utcDate, format = 'datetime') {
  const date = toDate(utcDate);
  if (!date || Number.isNaN(date.getTime())) return 'N/A';
  
  const options = {
    timeZone: 'Asia/Kolkata',
  };
  
  switch (format) {
    case 'full':
      return date.toLocaleString('en-IN', {
        ...options,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    
    case 'date':
      return date.toLocaleDateString('en-IN', {
        ...options,
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    
    case 'time':
      return date.toLocaleTimeString('en-IN', {
        ...options,
        hour: '2-digit',
        minute: '2-digit',
      });
    
    case 'datetime':
    default:
      return date.toLocaleString('en-IN', {
        ...options,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
  }
}

/**
 * Get relative time in IST (e.g., "2 hours ago", "just now")
 * @param {string|Date} utcDate - UTC date string or Date object
 * @returns {string} Relative time string
 */
export function getRelativeTimeIST(utcDate) {
  const date = toDate(utcDate);
  if (!date || Number.isNaN(date.getTime())) return 'N/A';

  // Relative difference is timezone-agnostic; compare actual timestamps.
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  
  return formatIST(utcDate, 'date');
}

/**
 * Get current IST date for input fields (YYYY-MM-DD format)
 * @returns {string} Current IST date in YYYY-MM-DD format
 */
export function getCurrentISTDate() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return `${year}-${month}-${day}`;
}
