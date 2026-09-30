export const SEVERITY_COLORS = {
  critical: '#FF3B5C',
  high: '#FF6B35',
  medium: '#FF9500',
  low: '#00D4FF',
};

export const SEVERITY_BG = {
  critical: 'bg-red-500/20 border-red-500/30',
  high: 'bg-orange-500/20 border-orange-500/30',
  medium: 'bg-amber-500/20 border-amber-500/30',
  low: 'bg-cyan-500/20 border-cyan-500/30',
};

export const STATUS_COLORS = {
  new: '#9CA3AF',
  processing: '#FF9500',
  resolved: '#22C55E',
  escalated: '#FF3B5C',
  awaiting_review: '#7C3AED',
  in_progress: '#00D4FF',
  verifying: '#FF9500',
  triaged: '#00D4FF',
  detected: '#9CA3AF',
  failed: '#FF3B5C',
};

export const ALERT_TYPES = [
  'cpu_spike',
  'memory_leak',
  'disk_full',
  'network_latency',
  'service_down',
  'pod_crash_loop',
  'high_error_rate',
  'db_connection_pool',
  'api_timeout',
  'ssl_expiry',
  'deployment_failure',
  'scaling_failure',
  'load_balancer_error',
  'cache_miss_rate',
  'queue_depth_high',
  'replication_lag',
  'health_check_failure',
  'circuit_breaker_open',
  'dependency_timeout',
  'security_anomaly',
  'data_pipeline_failure',
];

export const AUTONOMY_MODE_LABELS = {
  AUTO: 'Autonomous',
  REVIEW: 'Needs Review',
  ESCALATE: 'Escalated',
};
