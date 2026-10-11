"""
collector.py — Collects live signals from a Kubernetes cluster.

Responsibilities:
  - Pod and workload health snapshots
  - Kubernetes events (Watch-based + poll fallback)
  - Resource metrics from metrics-server
  - Container logs with filters, time windows, and size limits

All data is returned as structured Pydantic models defined in models.py.
"""

import asyncio
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from kubernetes.client.rest import ApiException

from k8s_client import k8s_client
from models import (
    ContainerStatus,
    K8sEvent,
    K8sSeverity,
    LogEntry,
    NodeMetrics,
    PodHealth,
    PodMetrics,
    PodPhase,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

LOG_MAX_LINES = 200        # max lines per container per collection cycle
LOG_SINCE_SECONDS = 300    # look back 5 minutes
LOG_MAX_BYTES = 64 * 1024  # 64 KB per container


class K8sCollector:
    """Collects pod health, events, metrics, and logs from the cluster."""

    def __init__(self):
        self._event_seen: Dict[str, datetime] = {}  # uid → last-seen
        self._event_cache_ttl = timedelta(minutes=10)

    # ------------------------------------------------------------------
    # 1. Pod and workload health
    # ------------------------------------------------------------------

    async def collect_pod_health(
        self, namespace: Optional[str] = None
    ) -> List[PodHealth]:
        """Snapshot the health of all pods in configured namespaces."""
        namespaces = [namespace] if namespace else k8s_client.namespaces
        results: List[PodHealth] = []

        for ns in namespaces:
            try:
                pods = await asyncio.to_thread(
                    k8s_client.core_v1.list_namespaced_pod, ns
                )
            except ApiException as exc:
                print(f"[Collector] Failed to list pods in {ns}: {exc.reason}")
                continue

            for pod in pods.items:
                # Container statuses
                containers: List[ContainerStatus] = []
                restart_total = 0
                if pod.status and pod.status.container_statuses:
                    for cs in pod.status.container_statuses:
                        state_str = "unknown"
                        reason = None
                        last_term_reason = None

                        if cs.state:
                            if cs.state.running:
                                state_str = "running"
                            elif cs.state.waiting:
                                state_str = "waiting"
                                reason = cs.state.waiting.reason
                            elif cs.state.terminated:
                                state_str = "terminated"
                                reason = cs.state.terminated.reason

                        if cs.last_state and cs.last_state.terminated:
                            last_term_reason = cs.last_state.terminated.reason

                        containers.append(ContainerStatus(
                            name=cs.name,
                            ready=cs.ready or False,
                            restart_count=cs.restart_count or 0,
                            state=state_str,
                            reason=reason,
                            last_termination_reason=last_term_reason,
                            image=cs.image or "",
                        ))
                        restart_total += cs.restart_count or 0

                # Pod conditions
                conditions: Dict[str, bool] = {}
                if pod.status and pod.status.conditions:
                    for cond in pod.status.conditions:
                        conditions[cond.type] = cond.status == "True"

                # Owner reference
                owner_kind = None
                owner_name = None
                if pod.metadata.owner_references:
                    ref = pod.metadata.owner_references[0]
                    owner_kind = ref.kind
                    owner_name = ref.name

                # Age
                age_seconds = 0
                if pod.metadata.creation_timestamp:
                    created = pod.metadata.creation_timestamp
                    if created.tzinfo is None:
                        created = created.replace(tzinfo=timezone.utc)
                    age_seconds = int((_utc_now() - created).total_seconds())

                results.append(PodHealth(
                    name=pod.metadata.name,
                    namespace=ns,
                    phase=PodPhase(pod.status.phase) if pod.status and pod.status.phase else PodPhase.UNKNOWN,
                    node_name=pod.spec.node_name if pod.spec else None,
                    containers=containers,
                    conditions=conditions,
                    restart_total=restart_total,
                    age_seconds=age_seconds,
                    labels=dict(pod.metadata.labels or {}),
                    owner_kind=owner_kind,
                    owner_name=owner_name,
                ))

        return results

    # ------------------------------------------------------------------
    # 2. Kubernetes events
    # ------------------------------------------------------------------

    async def collect_events(
        self, namespace: Optional[str] = None, since_minutes: int = 10
    ) -> List[K8sEvent]:
        """Collect recent events, deduplicating by UID."""
        namespaces = [namespace] if namespace else k8s_client.namespaces
        results: List[K8sEvent] = []
        cutoff = _utc_now() - timedelta(minutes=since_minutes)

        # Prune stale entries from dedup cache
        self._event_seen = {
            uid: ts
            for uid, ts in self._event_seen.items()
            if (_utc_now() - ts) < self._event_cache_ttl
        }

        for ns in namespaces:
            try:
                events = await asyncio.to_thread(
                    k8s_client.core_v1.list_namespaced_event, ns
                )
            except ApiException as exc:
                print(f"[Collector] Failed to list events in {ns}: {exc.reason}")
                continue

            for event in events.items:
                uid = event.metadata.uid or ""
                event_time = (
                    event.last_timestamp
                    or event.event_time
                    or event.metadata.creation_timestamp
                )
                if event_time and event_time.tzinfo is None:
                    event_time = event_time.replace(tzinfo=timezone.utc)

                if event_time and event_time < cutoff:
                    continue

                if uid in self._event_seen:
                    continue
                self._event_seen[uid] = _utc_now()

                involved = event.involved_object
                results.append(K8sEvent(
                    uid=uid,
                    timestamp=event_time or _utc_now(),
                    namespace=ns,
                    involved_object_kind=involved.kind or "Unknown",
                    involved_object_name=involved.name or "unknown",
                    reason=event.reason or "",
                    message=event.message or "",
                    event_type=event.type or "Normal",
                    count=event.count or 1,
                    source_component=(
                        event.source.component if event.source else None
                    ),
                ))

        return results

    # ------------------------------------------------------------------
    # 3. Resource metrics (requires metrics-server)
    # ------------------------------------------------------------------

    async def collect_pod_metrics(
        self, namespace: Optional[str] = None
    ) -> List[PodMetrics]:
        """Read pod-level CPU and memory from metrics.k8s.io."""
        namespaces = [namespace] if namespace else k8s_client.namespaces
        results: List[PodMetrics] = []

        for ns in namespaces:
            try:
                raw = await asyncio.to_thread(
                    k8s_client.custom.list_namespaced_custom_object,
                    group="metrics.k8s.io",
                    version="v1beta1",
                    namespace=ns,
                    plural="pods",
                )
            except ApiException as exc:
                if exc.status == 404:
                    print(f"[Collector] metrics-server not installed — skipping pod metrics for {ns}")
                else:
                    print(f"[Collector] Pod metrics error in {ns}: {exc.reason}")
                continue

            for item in raw.get("items", []):
                name = item["metadata"]["name"]
                containers: Dict[str, Dict[str, int]] = {}
                total_cpu = 0
                total_mem = 0
                for c in item.get("containers", []):
                    cpu_str = c.get("usage", {}).get("cpu", "0n")
                    mem_str = c.get("usage", {}).get("memory", "0Ki")
                    cpu_m = self._parse_cpu(cpu_str)
                    mem_b = self._parse_memory(mem_str)
                    containers[c["name"]] = {"cpu_millicores": cpu_m, "memory_bytes": mem_b}
                    total_cpu += cpu_m
                    total_mem += mem_b

                results.append(PodMetrics(
                    name=name,
                    namespace=ns,
                    cpu_millicores=total_cpu,
                    memory_bytes=total_mem,
                    containers=containers,
                ))

        return results

    async def collect_node_metrics(self) -> List[NodeMetrics]:
        """Read node-level CPU and memory from metrics.k8s.io."""
        results: List[NodeMetrics] = []
        try:
            raw = await asyncio.to_thread(
                k8s_client.custom.list_cluster_custom_object,
                group="metrics.k8s.io",
                version="v1beta1",
                plural="nodes",
            )
        except ApiException as exc:
            print(f"[Collector] Node metrics error: {exc.reason}")
            return results

        # Also read node capacity
        try:
            nodes = await asyncio.to_thread(k8s_client.core_v1.list_node)
            capacity_map = {}
            for node in nodes.items:
                cap = node.status.capacity or {}
                capacity_map[node.metadata.name] = {
                    "cpu": self._parse_cpu(cap.get("cpu", "0")),
                    "memory": self._parse_memory(cap.get("memory", "0Ki")),
                }
        except Exception:
            capacity_map = {}

        for item in raw.get("items", []):
            name = item["metadata"]["name"]
            usage = item.get("usage", {})
            cpu_m = self._parse_cpu(usage.get("cpu", "0n"))
            mem_b = self._parse_memory(usage.get("memory", "0Ki"))
            cap = capacity_map.get(name, {})
            cap_cpu = cap.get("cpu", 1)
            cap_mem = cap.get("memory", 1)

            results.append(NodeMetrics(
                name=name,
                cpu_millicores=cpu_m,
                cpu_capacity_millicores=cap_cpu,
                memory_bytes=mem_b,
                memory_capacity_bytes=cap_mem,
                cpu_pct=round(cpu_m / cap_cpu * 100, 1) if cap_cpu > 0 else 0.0,
                memory_pct=round(mem_b / cap_mem * 100, 1) if cap_mem > 0 else 0.0,
            ))

        return results

    # ------------------------------------------------------------------
    # 4. Container logs
    # ------------------------------------------------------------------

    async def collect_logs(
        self,
        namespace: str,
        pod_name: str,
        container: Optional[str] = None,
        since_seconds: int = LOG_SINCE_SECONDS,
        tail_lines: int = LOG_MAX_LINES,
    ) -> List[LogEntry]:
        """
        Collect bounded container logs.

        Guards against log storms:
          - tail_lines caps row count
          - since_seconds limits time window
          - LOG_MAX_BYTES limits response size
        """
        results: List[LogEntry] = []
        try:
            log_text = await asyncio.to_thread(
                k8s_client.core_v1.read_namespaced_pod_log,
                name=pod_name,
                namespace=namespace,
                container=container or "",
                since_seconds=since_seconds,
                tail_lines=tail_lines,
                limit_bytes=LOG_MAX_BYTES,
                timestamps=True,
            )
        except ApiException as exc:
            print(f"[Collector] Log read failed for {namespace}/{pod_name}: {exc.reason}")
            return results

        if not log_text:
            return results

        for line in log_text.strip().split("\n"):
            if not line.strip():
                continue
            # Kubernetes log lines with timestamps= True have format:
            # 2024-01-15T10:30:45.123456Z <actual log line>
            parts = line.split(" ", 1)
            ts = None
            content = line
            if len(parts) == 2:
                try:
                    ts = datetime.fromisoformat(parts[0].replace("Z", "+00:00"))
                    content = parts[1]
                except ValueError:
                    pass

            severity = self._infer_log_severity(content)
            results.append(LogEntry(
                pod=pod_name,
                container=container or "default",
                namespace=namespace,
                timestamp=ts,
                line=content[:500],  # Bound individual line length
                severity=severity,
            ))

        return results

    async def collect_error_logs_for_pods(
        self,
        pods: List[PodHealth],
        since_seconds: int = LOG_SINCE_SECONDS,
    ) -> List[LogEntry]:
        """Collect logs from pods that are unhealthy or have restarts."""
        results: List[LogEntry] = []
        for pod in pods:
            if pod.restart_total > 0 or pod.phase in (PodPhase.FAILED, PodPhase.UNKNOWN):
                for container in pod.containers:
                    if not container.ready or container.restart_count > 0:
                        logs = await self.collect_logs(
                            namespace=pod.namespace,
                            pod_name=pod.name,
                            container=container.name,
                            since_seconds=since_seconds,
                            tail_lines=50,  # Fewer lines per unhealthy container
                        )
                        # Only keep warning/error/critical lines
                        results.extend(
                            l for l in logs
                            if l.severity in (K8sSeverity.HIGH, K8sSeverity.CRITICAL, K8sSeverity.MEDIUM)
                        )
        return results

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_cpu(value: str) -> int:
        """Parse K8s CPU to millicores: '250m' → 250, '1' → 1000, '500n' → 0."""
        value = str(value).strip()
        if value.endswith("n"):
            return int(int(value[:-1]) / 1_000_000)
        elif value.endswith("m"):
            return int(value[:-1])
        else:
            try:
                return int(float(value) * 1000)
            except ValueError:
                return 0

    @staticmethod
    def _parse_memory(value: str) -> int:
        """Parse K8s memory to bytes: '128Mi' → 134217728, '1Gi' → 1073741824."""
        value = str(value).strip()
        multipliers = {
            "Ki": 1024,
            "Mi": 1024 ** 2,
            "Gi": 1024 ** 3,
            "Ti": 1024 ** 4,
            "K": 1000,
            "M": 1000 ** 2,
            "G": 1000 ** 3,
        }
        for suffix, mult in multipliers.items():
            if value.endswith(suffix):
                try:
                    return int(float(value[: -len(suffix)]) * mult)
                except ValueError:
                    return 0
        try:
            return int(value)
        except ValueError:
            return 0

    @staticmethod
    def _infer_log_severity(line: str) -> K8sSeverity:
        """Heuristic severity from log content."""
        lower = line.lower()
        if any(kw in lower for kw in ["fatal", "panic", "oom", "killed"]):
            return K8sSeverity.CRITICAL
        if any(kw in lower for kw in ["error", "err ", "exception", "traceback", "fail"]):
            return K8sSeverity.HIGH
        if any(kw in lower for kw in ["warn", "warning", "timeout", "retry"]):
            return K8sSeverity.MEDIUM
        return K8sSeverity.INFO


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

collector = K8sCollector()
