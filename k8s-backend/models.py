"""
models.py — Kubernetes-specific data models for the AETERNA SRE platform.

All structured observations, alerts, and audit records that flow between
the collector, normalizer, remediator, and the main backend.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class K8sSeverity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class PodPhase(str, Enum):
    PENDING = "Pending"
    RUNNING = "Running"
    SUCCEEDED = "Succeeded"
    FAILED = "Failed"
    UNKNOWN = "Unknown"


class RemediationAction(str, Enum):
    RESTART_POD = "restart_pod"
    RESTART_DEPLOYMENT = "restart_deployment"
    SCALE_UP = "scale_up"
    SCALE_DOWN = "scale_down"
    ROLLBACK_DEPLOYMENT = "rollback_deployment"
    DELETE_POD = "delete_pod"
    CORDON_NODE = "cordon_node"
    DRAIN_NODE = "drain_node"
    ESCALATE = "escalate"


# ---------------------------------------------------------------------------
# Pod / Container health snapshots
# ---------------------------------------------------------------------------

class ContainerStatus(BaseModel):
    name: str
    ready: bool
    restart_count: int = 0
    state: str = "unknown"  # running | waiting | terminated
    reason: Optional[str] = None  # CrashLoopBackOff, OOMKilled, etc.
    last_termination_reason: Optional[str] = None
    image: str = ""


class PodHealth(BaseModel):
    name: str
    namespace: str
    phase: PodPhase
    node_name: Optional[str] = None
    containers: List[ContainerStatus] = Field(default_factory=list)
    conditions: Dict[str, bool] = Field(default_factory=dict)  # Ready, Scheduled, etc.
    restart_total: int = 0
    age_seconds: int = 0
    labels: Dict[str, str] = Field(default_factory=dict)
    owner_kind: Optional[str] = None  # Deployment, ReplicaSet, StatefulSet, Job
    owner_name: Optional[str] = None
    collected_at: datetime = Field(default_factory=_utc_now)


# ---------------------------------------------------------------------------
# Resource metrics (from metrics-server)
# ---------------------------------------------------------------------------

class PodMetrics(BaseModel):
    name: str
    namespace: str
    cpu_millicores: int = 0
    memory_bytes: int = 0
    containers: Dict[str, Dict[str, int]] = Field(default_factory=dict)
    collected_at: datetime = Field(default_factory=_utc_now)


class NodeMetrics(BaseModel):
    name: str
    cpu_millicores: int = 0
    cpu_capacity_millicores: int = 0
    memory_bytes: int = 0
    memory_capacity_bytes: int = 0
    cpu_pct: float = 0.0
    memory_pct: float = 0.0
    collected_at: datetime = Field(default_factory=_utc_now)


# ---------------------------------------------------------------------------
# Kubernetes events (normalized)
# ---------------------------------------------------------------------------

class K8sEvent(BaseModel):
    uid: str
    timestamp: datetime = Field(default_factory=_utc_now)
    namespace: str
    involved_object_kind: str  # Pod, Deployment, Node, etc.
    involved_object_name: str
    reason: str  # Killing, BackOff, FailedScheduling, etc.
    message: str
    event_type: str = "Normal"  # Normal | Warning
    count: int = 1
    source_component: Optional[str] = None


# ---------------------------------------------------------------------------
# Structured K8s alert — feeds the main AETERNA ingest pipeline
# ---------------------------------------------------------------------------

class K8sAlert(BaseModel):
    """
    A normalized Kubernetes observation that the main AETERNA alert pipeline
    can accept.  Maps directly to the existing Alert model's fields with
    additional k8s-specific evidence.
    """
    id: str = Field(default_factory=lambda: f"k8s-{__import__('uuid').uuid4().hex[:8]}")
    timestamp: datetime = Field(default_factory=_utc_now)
    alert_type: str  # crash_loop, oom_kill, pod_eviction, high_cpu, etc.
    severity: K8sSeverity
    service: str  # owner workload name (deployment/statefulset)
    cluster: str
    namespace: str
    pod: Optional[str] = None
    container: Optional[str] = None
    evidence: str = ""  # bounded excerpt of logs / events
    evidence_source: str = "k8s_collector"  # always "observed", never "hypothesis"
    raw_events: List[Dict[str, Any]] = Field(default_factory=list)
    metrics_snapshot: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Remediation request / result
# ---------------------------------------------------------------------------

class RemediationRequest(BaseModel):
    incident_id: str
    action: RemediationAction
    cluster: str
    namespace: str
    target_kind: str  # Deployment, StatefulSet, Pod
    target_name: str
    parameters: Dict[str, Any] = Field(default_factory=dict)  # e.g. {"replicas": 3}
    evidence_summary: str = ""
    requested_by: str = "ai_triage"
    requested_at: datetime = Field(default_factory=_utc_now)


class RemediationResult(BaseModel):
    incident_id: str
    action: RemediationAction
    target: str  # "namespace/kind/name"
    success: bool
    message: str = ""
    pre_state: Dict[str, Any] = Field(default_factory=dict)
    post_state: Dict[str, Any] = Field(default_factory=dict)
    executed_at: datetime = Field(default_factory=_utc_now)
    verified: bool = False
    verification_detail: str = ""


# ---------------------------------------------------------------------------
# Container log entry
# ---------------------------------------------------------------------------

class LogEntry(BaseModel):
    pod: str
    container: str
    namespace: str
    timestamp: Optional[datetime] = None
    line: str
    severity: K8sSeverity = K8sSeverity.INFO


# ---------------------------------------------------------------------------
# Audit record — every action taken
# ---------------------------------------------------------------------------

class K8sAuditRecord(BaseModel):
    timestamp: datetime = Field(default_factory=_utc_now)
    incident_id: str
    cluster: str
    namespace: str
    action: str
    target: str
    actor: str  # "ai_auto" | "human_operator" | "system"
    evidence_hash: str = ""  # SHA256 of evidence at decision time
    result: str = ""  # success | failed | blocked
    detail: str = ""
    approved_by: Optional[str] = None
