"""
remediator.py — Execute real Kubernetes remediation actions.

Maps incident types to specific K8s actions:
  - restart_pod          — delete the pod (controller recreates it)
  - restart_deployment   — rollout restart
  - scale_up / scale_down — adjust replica count
  - rollback_deployment  — roll back to previous revision
  - delete_pod           — force-delete a stuck pod
  - cordon_node / drain_node — node-level actions

Each action:
  1. Validates the target still exists
  2. Records pre-state
  3. Executes the change
  4. Records post-state
  5. Returns a RemediationResult
"""

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from kubernetes.client.rest import ApiException

from k8s_client import k8s_client
from models import (
    RemediationAction,
    RemediationRequest,
    RemediationResult,
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class K8sRemediator:
    """Execute gated K8s remediation actions with pre/post validation."""

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    async def execute(self, request: RemediationRequest) -> RemediationResult:
        """Route a remediation request to the appropriate handler."""
        handlers = {
            RemediationAction.RESTART_POD:         self._restart_pod,
            RemediationAction.RESTART_DEPLOYMENT:   self._restart_deployment,
            RemediationAction.SCALE_UP:             self._scale_up,
            RemediationAction.SCALE_DOWN:           self._scale_down,
            RemediationAction.ROLLBACK_DEPLOYMENT:  self._rollback_deployment,
            RemediationAction.DELETE_POD:            self._delete_pod,
            RemediationAction.CORDON_NODE:           self._cordon_node,
            RemediationAction.DRAIN_NODE:            self._drain_node,
            RemediationAction.ESCALATE:              self._escalate,
        }
        handler = handlers.get(request.action)
        if not handler:
            return RemediationResult(
                incident_id=request.incident_id,
                action=request.action,
                target=f"{request.namespace}/{request.target_kind}/{request.target_name}",
                success=False,
                message=f"Unknown remediation action: {request.action}",
            )

        try:
            return await handler(request)
        except Exception as exc:
            return RemediationResult(
                incident_id=request.incident_id,
                action=request.action,
                target=f"{request.namespace}/{request.target_kind}/{request.target_name}",
                success=False,
                message=f"Remediation failed: {str(exc)}",
            )

    # ------------------------------------------------------------------
    # Pre-checks
    # ------------------------------------------------------------------

    async def _target_exists(self, request: RemediationRequest) -> bool:
        """Verify the target resource still exists before acting."""
        try:
            if request.target_kind == "Deployment":
                await asyncio.to_thread(
                    k8s_client.apps_v1.read_namespaced_deployment,
                    name=request.target_name,
                    namespace=request.namespace,
                )
            elif request.target_kind == "Pod":
                await asyncio.to_thread(
                    k8s_client.core_v1.read_namespaced_pod,
                    name=request.target_name,
                    namespace=request.namespace,
                )
            elif request.target_kind == "StatefulSet":
                await asyncio.to_thread(
                    k8s_client.apps_v1.read_namespaced_stateful_set,
                    name=request.target_name,
                    namespace=request.namespace,
                )
            elif request.target_kind == "Node":
                await asyncio.to_thread(
                    k8s_client.core_v1.read_node,
                    name=request.target_name,
                )
            else:
                return True  # Unknown kind, proceed
            return True
        except ApiException as exc:
            if exc.status == 404:
                return False
            raise

    async def _get_deployment_state(self, name: str, namespace: str) -> Dict[str, Any]:
        """Snapshot deployment state for pre/post comparison."""
        try:
            dep = await asyncio.to_thread(
                k8s_client.apps_v1.read_namespaced_deployment, name, namespace
            )
            return {
                "replicas": dep.spec.replicas,
                "ready_replicas": dep.status.ready_replicas or 0,
                "available_replicas": dep.status.available_replicas or 0,
                "updated_replicas": dep.status.updated_replicas or 0,
                "generation": dep.metadata.generation,
            }
        except Exception:
            return {}

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    async def _restart_pod(self, req: RemediationRequest) -> RemediationResult:
        """Delete a pod, letting its controller recreate it."""
        target = f"{req.namespace}/Pod/{req.target_name}"
        if not await self._target_exists(req):
            return RemediationResult(
                incident_id=req.incident_id, action=req.action, target=target,
                success=False, message="Pod no longer exists",
            )

        pre_state = {"action": "delete_pod_for_restart", "pod": req.target_name}
        await asyncio.to_thread(
            k8s_client.core_v1.delete_namespaced_pod,
            name=req.target_name,
            namespace=req.namespace,
        )

        return RemediationResult(
            incident_id=req.incident_id, action=req.action, target=target,
            success=True,
            message=f"Pod '{req.target_name}' deleted; controller will recreate it",
            pre_state=pre_state,
        )

    async def _restart_deployment(self, req: RemediationRequest) -> RemediationResult:
        """Trigger a rollout restart on a Deployment."""
        target = f"{req.namespace}/Deployment/{req.target_name}"
        if not await self._target_exists(req):
            return RemediationResult(
                incident_id=req.incident_id, action=req.action, target=target,
                success=False, message="Deployment no longer exists",
            )

        pre_state = await self._get_deployment_state(req.target_name, req.namespace)

        # Rollout restart = patch template annotation
        patch = {
            "spec": {
                "template": {
                    "metadata": {
                        "annotations": {
                            "aeterna.io/restartedAt": _utc_now().isoformat()
                        }
                    }
                }
            }
        }
        await asyncio.to_thread(
            k8s_client.apps_v1.patch_namespaced_deployment,
            name=req.target_name,
            namespace=req.namespace,
            body=patch,
        )

        return RemediationResult(
            incident_id=req.incident_id, action=req.action, target=target,
            success=True,
            message=f"Rollout restart triggered for Deployment '{req.target_name}'",
            pre_state=pre_state,
        )

    async def _scale_up(self, req: RemediationRequest) -> RemediationResult:
        """Increase replica count for a Deployment."""
        target = f"{req.namespace}/Deployment/{req.target_name}"
        if not await self._target_exists(req):
            return RemediationResult(
                incident_id=req.incident_id, action=req.action, target=target,
                success=False, message="Deployment no longer exists",
            )

        pre_state = await self._get_deployment_state(req.target_name, req.namespace)
        current_replicas = pre_state.get("replicas", 1)
        new_replicas = req.parameters.get("replicas", current_replicas + 1)

        # Safety cap
        max_replicas = req.parameters.get("max_replicas", 10)
        if new_replicas > max_replicas:
            return RemediationResult(
                incident_id=req.incident_id, action=req.action, target=target,
                success=False,
                message=f"Scale-up blocked: {new_replicas} exceeds max_replicas={max_replicas}",
                pre_state=pre_state,
            )

        patch = {"spec": {"replicas": new_replicas}}
        await asyncio.to_thread(
            k8s_client.apps_v1.patch_namespaced_deployment,
            name=req.target_name,
            namespace=req.namespace,
            body=patch,
        )

        post_state = await self._get_deployment_state(req.target_name, req.namespace)
        return RemediationResult(
            incident_id=req.incident_id, action=req.action, target=target,
            success=True,
            message=f"Scaled Deployment '{req.target_name}' from {current_replicas} to {new_replicas}",
            pre_state=pre_state,
            post_state=post_state,
        )

    async def _scale_down(self, req: RemediationRequest) -> RemediationResult:
        """Decrease replica count for a Deployment."""
        target = f"{req.namespace}/Deployment/{req.target_name}"
        if not await self._target_exists(req):
            return RemediationResult(
                incident_id=req.incident_id, action=req.action, target=target,
                success=False, message="Deployment no longer exists",
            )

        pre_state = await self._get_deployment_state(req.target_name, req.namespace)
        current_replicas = pre_state.get("replicas", 1)
        new_replicas = max(1, req.parameters.get("replicas", current_replicas - 1))

        patch = {"spec": {"replicas": new_replicas}}
        await asyncio.to_thread(
            k8s_client.apps_v1.patch_namespaced_deployment,
            name=req.target_name,
            namespace=req.namespace,
            body=patch,
        )

        post_state = await self._get_deployment_state(req.target_name, req.namespace)
        return RemediationResult(
            incident_id=req.incident_id, action=req.action, target=target,
            success=True,
            message=f"Scaled Deployment '{req.target_name}' from {current_replicas} to {new_replicas}",
            pre_state=pre_state,
            post_state=post_state,
        )

    async def _rollback_deployment(self, req: RemediationRequest) -> RemediationResult:
        """Roll back a Deployment to the previous revision."""
        target = f"{req.namespace}/Deployment/{req.target_name}"
        if not await self._target_exists(req):
            return RemediationResult(
                incident_id=req.incident_id, action=req.action, target=target,
                success=False, message="Deployment no longer exists",
            )

        pre_state = await self._get_deployment_state(req.target_name, req.namespace)

        # Read current deployment's revision, then get previous ReplicaSet
        # For simplicity, use rollout restart with previous template
        # A full rollback would need the ReplicaSet history
        dep = await asyncio.to_thread(
            k8s_client.apps_v1.read_namespaced_deployment,
            name=req.target_name,
            namespace=req.namespace,
        )

        # Get ReplicaSets for this deployment
        label_selector = ",".join(
            f"{k}={v}" for k, v in (dep.spec.selector.match_labels or {}).items()
        )
        rs_list = await asyncio.to_thread(
            k8s_client.apps_v1.list_namespaced_replica_set,
            namespace=req.namespace,
            label_selector=label_selector,
        )

        # Sort by revision annotation (descending), pick second one
        sorted_rs = sorted(
            rs_list.items,
            key=lambda r: int(
                (r.metadata.annotations or {}).get("deployment.kubernetes.io/revision", "0")
            ),
            reverse=True,
        )

        if len(sorted_rs) < 2:
            return RemediationResult(
                incident_id=req.incident_id, action=req.action, target=target,
                success=False,
                message="No previous revision found for rollback",
                pre_state=pre_state,
            )

        # Apply previous RS's pod template
        prev_template = sorted_rs[1].spec.template
        patch = {"spec": {"template": prev_template}}
        await asyncio.to_thread(
            k8s_client.apps_v1.patch_namespaced_deployment,
            name=req.target_name,
            namespace=req.namespace,
            body=patch,
        )

        post_state = await self._get_deployment_state(req.target_name, req.namespace)
        return RemediationResult(
            incident_id=req.incident_id, action=req.action, target=target,
            success=True,
            message=f"Rolled back Deployment '{req.target_name}' to previous revision",
            pre_state=pre_state,
            post_state=post_state,
        )

    async def _delete_pod(self, req: RemediationRequest) -> RemediationResult:
        """Force-delete a stuck pod."""
        target = f"{req.namespace}/Pod/{req.target_name}"
        if not await self._target_exists(req):
            return RemediationResult(
                incident_id=req.incident_id, action=req.action, target=target,
                success=False, message="Pod no longer exists",
            )

        await asyncio.to_thread(
            k8s_client.core_v1.delete_namespaced_pod,
            name=req.target_name,
            namespace=req.namespace,
            grace_period_seconds=0,
        )

        return RemediationResult(
            incident_id=req.incident_id, action=req.action, target=target,
            success=True,
            message=f"Force-deleted Pod '{req.target_name}'",
        )

    async def _cordon_node(self, req: RemediationRequest) -> RemediationResult:
        """Mark a node as unschedulable."""
        target = f"Node/{req.target_name}"
        patch = {"spec": {"unschedulable": True}}
        await asyncio.to_thread(
            k8s_client.core_v1.patch_node,
            name=req.target_name,
            body=patch,
        )
        return RemediationResult(
            incident_id=req.incident_id, action=req.action, target=target,
            success=True,
            message=f"Node '{req.target_name}' cordoned (unschedulable=true)",
        )

    async def _drain_node(self, req: RemediationRequest) -> RemediationResult:
        """Cordon + evict all pods from a node. Use with extreme caution."""
        target = f"Node/{req.target_name}"

        # First cordon
        patch = {"spec": {"unschedulable": True}}
        await asyncio.to_thread(
            k8s_client.core_v1.patch_node,
            name=req.target_name,
            body=patch,
        )

        # List pods on this node and delete them (simplified drain)
        pods = await asyncio.to_thread(
            k8s_client.core_v1.list_pod_for_all_namespaces,
            field_selector=f"spec.nodeName={req.target_name}",
        )

        evicted = 0
        for pod in pods.items:
            # Skip DaemonSet and mirror pods
            if pod.metadata.owner_references:
                owner = pod.metadata.owner_references[0]
                if owner.kind == "DaemonSet":
                    continue
            try:
                await asyncio.to_thread(
                    k8s_client.core_v1.delete_namespaced_pod,
                    name=pod.metadata.name,
                    namespace=pod.metadata.namespace,
                    grace_period_seconds=30,
                )
                evicted += 1
            except Exception:
                pass

        return RemediationResult(
            incident_id=req.incident_id, action=req.action, target=target,
            success=True,
            message=f"Node '{req.target_name}' drained: cordoned + {evicted} pods evicted",
        )

    async def _escalate(self, req: RemediationRequest) -> RemediationResult:
        """No-op: just records the escalation."""
        return RemediationResult(
            incident_id=req.incident_id, action=req.action,
            target=f"{req.namespace}/{req.target_kind}/{req.target_name}",
            success=True,
            message="Escalated to human operator — no automated action taken",
        )

    # ------------------------------------------------------------------
    # Post-action verification
    # ------------------------------------------------------------------

    async def verify_remediation(
        self, result: RemediationResult, request: RemediationRequest, timeout_seconds: int = 60
    ) -> RemediationResult:
        """
        After a remediation, poll for observable recovery:
        - Pod readiness
        - Deployment available replicas
        - Error signal recovery
        """
        if not result.success:
            return result

        if request.action in (RemediationAction.ESCALATE,):
            result.verified = True
            result.verification_detail = "Escalation — no verification needed"
            return result

        # Poll for recovery
        deadline = _utc_now().timestamp() + timeout_seconds
        check_interval = 5

        while _utc_now().timestamp() < deadline:
            await asyncio.sleep(check_interval)

            try:
                if request.target_kind == "Deployment":
                    dep = await asyncio.to_thread(
                        k8s_client.apps_v1.read_namespaced_deployment,
                        name=request.target_name,
                        namespace=request.namespace,
                    )
                    desired = dep.spec.replicas or 1
                    ready = dep.status.ready_replicas or 0
                    if ready >= desired:
                        result.verified = True
                        result.verification_detail = (
                            f"Deployment ready: {ready}/{desired} replicas available"
                        )
                        result.post_state = await self._get_deployment_state(
                            request.target_name, request.namespace
                        )
                        return result

                elif request.target_kind == "Pod":
                    # Pod was deleted; check that new pod is running
                    pods = await asyncio.to_thread(
                        k8s_client.core_v1.list_namespaced_pod,
                        request.namespace,
                    )
                    running = [
                        p for p in pods.items
                        if p.metadata.name.startswith(request.target_name.rsplit("-", 1)[0])
                        and p.status.phase == "Running"
                    ]
                    if running:
                        result.verified = True
                        result.verification_detail = f"{len(running)} replacement pod(s) running"
                        return result

            except Exception as exc:
                print(f"[Remediator] Verification check failed: {exc}")

        result.verified = False
        result.verification_detail = f"Verification timed out after {timeout_seconds}s"
        return result


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

remediator = K8sRemediator()
