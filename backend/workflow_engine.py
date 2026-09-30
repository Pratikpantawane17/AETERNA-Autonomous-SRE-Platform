import asyncio
from datetime import datetime, timezone
from typing import Awaitable, Callable, Dict, Any

import mcp_server
from memory import memory_store
from storage import store


# ---------------------------------------------------------------------------
# Fallback chain: if an action fails, try this next
# ---------------------------------------------------------------------------

FALLBACK_ACTION = {
    "restart_service":    "scale_service",
    "scale_service":      "escalate",
    "cleanup_logs":       "escalate",
    "switch_to_fallback": "escalate",
    "restart_and_notify": "escalate",
    "manual_review":      "escalate",
}

# ---------------------------------------------------------------------------
# Contextual success thresholds — shadow_execute uses this to gate the
# workflow before touching production. If the metrics don't warrant the
# action, shadow blocks it here rather than discovering that later.
# ---------------------------------------------------------------------------

def _contextual_success(state: Dict[str, Any], action: str) -> bool:
    cpu   = float(state.get("cpu_pct", 0))
    disk  = float(state.get("disk_pct", 0))
    error = float(state.get("error_rate", 0))

    thresholds = {
        "restart_service":    cpu > 65 or error > 0.03 or state.get("health") != "healthy",
        "cleanup_logs":       disk > 70,
        "scale_service":      cpu > 75 or error > 0.02,
        "switch_to_fallback": error > 0.02,
        "restart_and_notify": state.get("health") != "healthy" or cpu > 65,
        "escalate":           True,
        "manual_review":      True,
    }
    return thresholds.get(action, True)


def _verify_effect(state: Dict[str, Any], action: str) -> bool:
    """Post-action health check: confirm the fix actually worked."""
    checks = {
        "restart_service":    lambda s: s.get("cpu_pct", 100) < 75 and s.get("health") == "healthy",
        "scale_service":      lambda s: s.get("cpu_pct", 100) < 80,
        "cleanup_logs":       lambda s: s.get("disk_pct", 100) < 80,
        "switch_to_fallback": lambda s: s.get("error_rate", 1) < 0.05,
        "restart_and_notify": lambda s: s.get("health") == "healthy",
        "escalate":           lambda s: True,
        "manual_review":      lambda s: True,
    }
    fn = checks.get(action)
    return fn(state) if fn else True


class WorkflowEngine:
    """
    Multi-step workflow executor with:
      - Per-service locking   (no two workflows fight over the same service)
      - Dynamic step loading  (from storage, not hardcoded)
      - shadow_execute gate   (blocks workflow if metrics don't warrant action)
      - MCP tool execution    (all state changes go through mcp_server.call_tool)
      - Post-action verify    (health re-check after MCP execution)
      - Fallback chaining     (failed action → next best action)
    """

    def __init__(self):
        self._service_locks: Dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

    async def _get_service_lock(self, service: str) -> asyncio.Lock:
        async with self._global_lock:
            if service not in self._service_locks:
                self._service_locks[service] = asyncio.Lock()
            return self._service_locks[service]

    async def _transition(self, incident_id: str, status: str, actor: str, note: str):
        return await store.transition_incident(incident_id, status, actor, note)

    async def _build_steps(self, action: str) -> list:
        """
        Build execution steps dynamically from the workflow table.
        Steps: shadow_execute (gate) → action (validate) → post_verify (MCP execute).
        """
        workflows = await store.get_workflows()
        matching = [wf for wf in workflows if wf["action"] == action]

        if matching:
            duration_ms = int(matching[0].get("estimated_time_mins", 2.0) * 600)
        else:
            duration_ms = 800

        return [
            {
                "step":        "shadow_execute",
                "description": "Dry-run: verify action is warranted by current metrics",
                "duration_ms": 400,
            },
            {
                "step":        action,
                "description": f"Validate pre-conditions for {action}",
                "duration_ms": duration_ms,
            },
            {
                "step":        "post_verify",
                "description": "Execute via MCP + verify service health",
                "duration_ms": 500,
            },
        ]

    async def execute(
        self,
        incident_id: str,
        action: str,
        service: str,
        broadcast_fn: Callable[[Dict[str, Any]], Awaitable[None]],
    ):
        service_lock = await self._get_service_lock(service)
        async with service_lock:
            await self._run_workflow(incident_id, action, service, broadcast_fn)

    async def _run_workflow(
        self,
        incident_id: str,
        action: str,
        service: str,
        broadcast_fn: Callable[[Dict[str, Any]], Awaitable[None]],
    ):
        incident = await store.get_incident(incident_id)
        if not incident:
            return

        steps = await self._build_steps(action)

        await self._transition(incident_id, "in_progress", "workflow_engine", f"Executing {action}")
        incident["active_workflow"] = action
        incident["action_taken"]    = action
        await store.save()
        await broadcast_fn({"type": "INCIDENT_UPDATED", "payload": incident})

        created_at = datetime.fromisoformat(incident["created_at"].replace("Z", "+00:00"))
        incident.setdefault("execution_log", [])

        workflow_failed = False

        for step in steps:
            step_name = step["step"]

            await broadcast_fn({
                "type":    "WORKFLOW_STEP_STARTED",
                "payload": {"incidentId": incident_id, "step": step_name},
            })

            await asyncio.sleep(step["duration_ms"] / 1000)

            mcp_output = None

            # ── shadow_execute: dry-run gate ─────────────────────────────────
            # Checks whether the current service metrics actually warrant this
            # action. If they don't (e.g. alert was a false positive that already
            # self-healed), the workflow is blocked here — never touches production.
            if step_name == "shadow_execute":
                state   = await store.get_service_state(service)
                success = _contextual_success(state, action)
                # Log the actual dry-run result — no override
                mcp_output = (
                    f"[shadow] {action} warranted by metrics: {success} "
                    f"(cpu={state.get('cpu_pct')}%, "
                    f"disk={state.get('disk_pct')}%, "
                    f"error_rate={state.get('error_rate')}, "
                    f"health={state.get('health')})"
                )

            # ── main action step: pre-condition validation only ──────────────
            # No state change here. All state mutations happen in post_verify
            # via the MCP tool call — this prevents the double-apply bug.
            elif step_name == "post_verify":
                # ── post_verify: single MCP execution + health check ─────────
                state       = await store.get_service_state(service)
                tool_result = await mcp_server.call_tool(action, service, state)
                mcp_output  = tool_result.get("output", "")

                # Apply the MCP tool's state patch — ONCE, here only
                if tool_result.get("patch"):
                    await store.update_service_state(
                        service,
                        tool_result["patch"],
                        reason=f"mcp:{action}",
                    )

                # Re-read state post-patch and verify effect
                state   = await store.get_service_state(service)
                success = _verify_effect(state, action)

            else:
                # Main action step: validate pre-conditions, no state change
                state   = await store.get_service_state(service)
                success = _contextual_success(state, action)
                mcp_output = f"[pre-check] {action} pre-conditions validated: {success}"

            log_entry = {
                "step":       step_name,
                "status":     "success" if success else "failed",
                "timestamp":  datetime.now(timezone.utc).isoformat(),
                "mcp_output": mcp_output,
            }
            incident["execution_log"].append(log_entry)
            await store.save()

            if not success:
                workflow_failed = True
                await self._transition(
                    incident_id, "failed", "workflow_engine",
                    f"{action} failed at step '{step_name}'"
                )
                await broadcast_fn({"type": "INCIDENT_UPDATED", "payload": incident})
                break

            await broadcast_fn({
                "type":    "WORKFLOW_STEP_COMPLETED",
                "payload": {"incidentId": incident_id, "step": step_name},
            })

        # ── Fallback chaining ────────────────────────────────────────────────
        if workflow_failed:
            fallback = FALLBACK_ACTION.get(action)
            await store.record_action_metric(
                incident.get("alert_type", ""), action, False,
                incident_id=incident_id, service=service,
            )
            memory_store.store_resolved_incident(incident)

            if fallback and fallback != action:
                print(f"[Workflow] {action} failed → chaining to {fallback} for {incident_id}")
                await self._run_workflow(incident_id, fallback, service, broadcast_fn)
            else:
                await self._transition(
                    incident_id, "escalated", "workflow_engine", "No fallback available"
                )
                await broadcast_fn({"type": "INCIDENT_UPDATED", "payload": incident})
            return

        # ── Success ───────────────────────────────────────────────────────────
        now = datetime.now(timezone.utc)
        incident["resolved_at"]   = now.isoformat()
        incident["duration_mins"] = round((now - created_at).total_seconds() / 60, 2)

        await self._transition(incident_id, "resolved", "workflow_engine", "MCP execution successful")
        await store.record_action_metric(
            incident.get("alert_type", ""), action, True,
            incident_id=incident_id, service=service,
        )
        memory_store.store_resolved_incident(incident)
        await store.save()

        await broadcast_fn({"type": "INCIDENT_RESOLVED", "payload": incident})

    def list_definitions(self):
        return {
            "dynamic":       True,
            "service_locks": list(self._service_locks.keys()),
            "mcp_tools":     mcp_server.list_tools(),
        }


engine = WorkflowEngine()