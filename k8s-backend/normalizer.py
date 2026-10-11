"""
normalizer.py — Normalize and correlate K8s observations into structured alerts.

Turns raw Kubernetes events, pod health snapshots, and log patterns into
structured K8sAlert objects that the main AETERNA ingest / deduplication
pipeline can accept.

Fields always set:
  cluster, namespace, pod, container, timestamp, severity, evidence (bounded)
"""

import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from models import (
    K8sAlert,
    K8sEvent,
    K8sSeverity,
    LogEntry,
    PodHealth,
    PodMetrics,
    PodPhase,
)
from k8s_client import k8s_client


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Reason → alert_type mapping
# ---------------------------------------------------------------------------

EVENT_REASON_MAP: Dict[str, str] = {
    "BackOff":             "crash_loop",
    "CrashLoopBackOff":    "crash_loop",
    "OOMKilled":           "oom_kill",
    "OOMKilling":          "oom_kill",
    "Evicted":             "pod_eviction",
    "FailedScheduling":    "pod_scheduling_failure",
    "Unhealthy":           "health_check_fail",
    "FailedMount":         "volume_mount_failure",
    "FailedAttachVolume":  "volume_mount_failure",
    "NodeNotReady":        "node_not_ready",
    "Killing":             "pod_terminated",
    "ImagePullBackOff":    "image_pull_failure",
    "ErrImagePull":        "image_pull_failure",
}

SEVERITY_FOR_ALERT_TYPE: Dict[str, K8sSeverity] = {
    "crash_loop":              K8sSeverity.CRITICAL,
    "oom_kill":                K8sSeverity.CRITICAL,
    "pod_eviction":            K8sSeverity.HIGH,
    "pod_scheduling_failure":  K8sSeverity.HIGH,
    "health_check_fail":       K8sSeverity.HIGH,
    "volume_mount_failure":    K8sSeverity.MEDIUM,
    "node_not_ready":          K8sSeverity.CRITICAL,
    "pod_terminated":          K8sSeverity.MEDIUM,
    "image_pull_failure":      K8sSeverity.HIGH,
    "high_cpu":                K8sSeverity.HIGH,
    "high_memory":             K8sSeverity.HIGH,
    "high_restart_count":      K8sSeverity.HIGH,
    "pod_not_ready":           K8sSeverity.MEDIUM,
    "service_down":            K8sSeverity.CRITICAL,
}


class K8sNormalizer:
    """
    Normalize raw K8s observations into structured K8sAlert objects
    suitable for the main AETERNA pipeline.
    """

    def __init__(self):
        self._seen_alerts: Dict[str, datetime] = {}  # dedup key → last-fired
        self._dedup_window_seconds = 120  # suppress duplicate alerts for 2 min

    # ------------------------------------------------------------------
    # Public API — call these from the polling loop
    # ------------------------------------------------------------------

    def normalize_events(self, events: List[K8sEvent]) -> List[K8sAlert]:
        """Convert K8s events into AETERNA alerts."""
        alerts: List[K8sAlert] = []
        for event in events:
            if event.event_type != "Warning":
                continue

            alert_type = EVENT_REASON_MAP.get(event.reason)
            if not alert_type:
                continue

            dedup_key = f"{event.namespace}/{event.involved_object_name}/{alert_type}"
            if self._is_duplicate(dedup_key):
                continue

            severity = SEVERITY_FOR_ALERT_TYPE.get(alert_type, K8sSeverity.MEDIUM)

            # Derive service name from the involved object
            service_name = event.involved_object_name
            # Strip pod hash suffix to get deployment name
            if event.involved_object_kind == "Pod":
                parts = service_name.rsplit("-", 2)
                if len(parts) >= 3:
                    service_name = parts[0]
                elif len(parts) == 2:
                    service_name = parts[0]

            evidence = (
                f"K8s event [{event.event_type}] reason={event.reason}: "
                f"{event.message[:300]}"
            )

            alerts.append(K8sAlert(
                alert_type=alert_type,
                severity=severity,
                service=service_name,
                cluster=k8s_client.cluster_name,
                namespace=event.namespace,
                pod=event.involved_object_name if event.involved_object_kind == "Pod" else None,
                evidence=evidence,
                evidence_source="k8s_event",
                raw_events=[{
                    "uid": event.uid,
                    "reason": event.reason,
                    "message": event.message[:500],
                    "count": event.count,
                }],
            ))

        return alerts

    def normalize_pod_health(self, pods: List[PodHealth]) -> List[K8sAlert]:
        """Detect unhealthy pods and emit alerts."""
        alerts: List[K8sAlert] = []

        for pod in pods:
            service_name = pod.owner_name or pod.name

            # CrashLoopBackOff detection
            for container in pod.containers:
                if container.reason == "CrashLoopBackOff":
                    dedup_key = f"{pod.namespace}/{pod.name}/crash_loop"
                    if self._is_duplicate(dedup_key):
                        continue
                    alerts.append(K8sAlert(
                        alert_type="crash_loop",
                        severity=K8sSeverity.CRITICAL,
                        service=service_name,
                        cluster=k8s_client.cluster_name,
                        namespace=pod.namespace,
                        pod=pod.name,
                        container=container.name,
                        evidence=(
                            f"Container '{container.name}' in CrashLoopBackOff. "
                            f"Restarts: {container.restart_count}. "
                            f"Last termination: {container.last_termination_reason or 'unknown'}"
                        ),
                        evidence_source="k8s_pod_health",
                    ))

                # OOMKilled detection
                if container.last_termination_reason == "OOMKilled":
                    dedup_key = f"{pod.namespace}/{pod.name}/oom_kill"
                    if self._is_duplicate(dedup_key):
                        continue
                    alerts.append(K8sAlert(
                        alert_type="oom_kill",
                        severity=K8sSeverity.CRITICAL,
                        service=service_name,
                        cluster=k8s_client.cluster_name,
                        namespace=pod.namespace,
                        pod=pod.name,
                        container=container.name,
                        evidence=(
                            f"Container '{container.name}' was OOMKilled. "
                            f"Restarts: {container.restart_count}"
                        ),
                        evidence_source="k8s_pod_health",
                    ))

            # High restart count
            if pod.restart_total >= 5:
                dedup_key = f"{pod.namespace}/{pod.name}/high_restart_count"
                if not self._is_duplicate(dedup_key):
                    alerts.append(K8sAlert(
                        alert_type="high_restart_count",
                        severity=K8sSeverity.HIGH,
                        service=service_name,
                        cluster=k8s_client.cluster_name,
                        namespace=pod.namespace,
                        pod=pod.name,
                        evidence=(
                            f"Pod has {pod.restart_total} total restarts across "
                            f"{len(pod.containers)} container(s)"
                        ),
                        evidence_source="k8s_pod_health",
                    ))

            # Pod not ready for over 2 minutes
            if (
                pod.phase == PodPhase.RUNNING
                and not pod.conditions.get("Ready", True)
                and pod.age_seconds > 120
            ):
                dedup_key = f"{pod.namespace}/{pod.name}/pod_not_ready"
                if not self._is_duplicate(dedup_key):
                    alerts.append(K8sAlert(
                        alert_type="pod_not_ready",
                        severity=K8sSeverity.MEDIUM,
                        service=service_name,
                        cluster=k8s_client.cluster_name,
                        namespace=pod.namespace,
                        pod=pod.name,
                        evidence=(
                            f"Pod running but not ready for {pod.age_seconds}s. "
                            f"Conditions: {pod.conditions}"
                        ),
                        evidence_source="k8s_pod_health",
                    ))

            # Pod Failed
            if pod.phase == PodPhase.FAILED:
                dedup_key = f"{pod.namespace}/{pod.name}/service_down"
                if not self._is_duplicate(dedup_key):
                    alerts.append(K8sAlert(
                        alert_type="service_down",
                        severity=K8sSeverity.CRITICAL,
                        service=service_name,
                        cluster=k8s_client.cluster_name,
                        namespace=pod.namespace,
                        pod=pod.name,
                        evidence=f"Pod phase=Failed. Containers: {[c.name for c in pod.containers]}",
                        evidence_source="k8s_pod_health",
                    ))

        return alerts

    def normalize_metrics(
        self, pod_metrics: List[PodMetrics], cpu_threshold: int = 800, mem_threshold: int = 512 * 1024 * 1024
    ) -> List[K8sAlert]:
        """Detect pods exceeding CPU or memory thresholds."""
        alerts: List[K8sAlert] = []

        for pm in pod_metrics:
            service_name = pm.name
            parts = service_name.rsplit("-", 2)
            if len(parts) >= 3:
                service_name = parts[0]

            if pm.cpu_millicores > cpu_threshold:
                dedup_key = f"{pm.namespace}/{pm.name}/high_cpu"
                if not self._is_duplicate(dedup_key):
                    alerts.append(K8sAlert(
                        alert_type="high_cpu",
                        severity=K8sSeverity.HIGH,
                        service=service_name,
                        cluster=k8s_client.cluster_name,
                        namespace=pm.namespace,
                        pod=pm.name,
                        evidence=(
                            f"CPU usage: {pm.cpu_millicores}m (threshold: {cpu_threshold}m). "
                            f"Memory: {pm.memory_bytes // (1024*1024)}Mi"
                        ),
                        evidence_source="k8s_metrics",
                        metrics_snapshot={
                            "cpu_millicores": pm.cpu_millicores,
                            "memory_bytes": pm.memory_bytes,
                        },
                    ))

            if pm.memory_bytes > mem_threshold:
                dedup_key = f"{pm.namespace}/{pm.name}/high_memory"
                if not self._is_duplicate(dedup_key):
                    alerts.append(K8sAlert(
                        alert_type="high_memory",
                        severity=K8sSeverity.HIGH,
                        service=service_name,
                        cluster=k8s_client.cluster_name,
                        namespace=pm.namespace,
                        pod=pm.name,
                        evidence=(
                            f"Memory usage: {pm.memory_bytes // (1024*1024)}Mi "
                            f"(threshold: {mem_threshold // (1024*1024)}Mi). "
                            f"CPU: {pm.cpu_millicores}m"
                        ),
                        evidence_source="k8s_metrics",
                        metrics_snapshot={
                            "cpu_millicores": pm.cpu_millicores,
                            "memory_bytes": pm.memory_bytes,
                        },
                    ))

        return alerts

    def attach_log_evidence(
        self, alerts: List[K8sAlert], logs: List[LogEntry], max_lines: int = 10
    ) -> List[K8sAlert]:
        """Attach relevant log excerpts to existing alerts."""
        for alert in alerts:
            if not alert.pod:
                continue
            relevant = [
                log for log in logs
                if log.pod == alert.pod and log.namespace == alert.namespace
            ][:max_lines]

            if relevant:
                excerpt = "\n".join(
                    f"  [{l.severity.value}] {l.line[:200]}" for l in relevant
                )
                alert.evidence += f"\n\nLog evidence ({len(relevant)} lines):\n{excerpt}"

        return alerts

    # ------------------------------------------------------------------
    # Deduplication
    # ------------------------------------------------------------------

    def _is_duplicate(self, key: str) -> bool:
        """Check if this alert was already fired within the dedup window."""
        now = _utc_now()
        if key in self._seen_alerts:
            elapsed = (now - self._seen_alerts[key]).total_seconds()
            if elapsed < self._dedup_window_seconds:
                return True
        self._seen_alerts[key] = now
        return False

    @staticmethod
    def evidence_hash(alert: K8sAlert) -> str:
        """SHA256 hash of the evidence for auditability."""
        content = f"{alert.cluster}:{alert.namespace}:{alert.pod}:{alert.evidence}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

normalizer = K8sNormalizer()
