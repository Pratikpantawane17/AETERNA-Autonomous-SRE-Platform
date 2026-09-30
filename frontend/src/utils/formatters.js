/**
 * Formats duration in minutes to a human-readable string.
 * < 60 mins → "2m 30s"
 * >= 60 mins → "1h 15m"
 */
export function formatDuration(mins) {
  if (mins == null || isNaN(mins)) return '—';
  const totalSeconds = Math.round(mins * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Formats an ISO timestamp to relative ("2 min ago") or absolute date if > 1 day old.
 */
export function formatTimestamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Formats a float confidence value (0.0–1.0) to a percentage string.
 */
export function formatConfidence(float) {
  if (float == null || isNaN(float)) return '—';
  return `${Math.round(float * 100)}%`;
}

/**
 * Formats a numeric metric value with an optional unit label.
 */
export function formatMetric(value, unit) {
  if (value == null || isNaN(value)) return '—';
  const formatted = Number(value).toFixed(1);
  if (!unit) return formatted;
  return `${formatted} ${unit}`;
}

/**
 * Truncates an incident/alert ID to the first 8 characters.
 */
export function truncateId(id) {
  if (!id) return '—';
  return String(id).substring(0, 8);
}

/**
 * Returns a human-readable label for a given status string.
 */
export function getStatusLabel(status) {
  const labels = {
    new: 'New',
    processing: 'Processing',
    resolved: 'Resolved',
    escalated: 'Escalated',
    awaiting_review: 'Awaiting Review',
    in_progress: 'In Progress',
    verifying: 'Verifying',
    triaged: 'Triaged',
    detected: 'Detected',
    failed: 'Failed',
  };
  return labels[status] ?? (status ? String(status).replace(/_/g, ' ') : 'Unknown');
}

/**
 * Returns the lucide-react icon component name appropriate for a given severity.
 */
export function getSeverityIcon(severity) {
  const iconMap = {
    critical: 'Flame',
    high: 'AlertTriangle',
    medium: 'AlertCircle',
    low: 'Info',
  };
  return iconMap[severity?.toLowerCase()] ?? 'AlertCircle';
}
