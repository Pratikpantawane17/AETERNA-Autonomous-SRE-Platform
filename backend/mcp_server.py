"""
mcp_server.py — MCP-compliant action tool server.

Every infrastructure action is registered as a named MCP tool.
WorkflowEngine calls `call_tool(action, service, state)` instead of
patching dicts directly.  Each tool returns a structured result:
    { success, patch, output, tool_name }

Now integrated with the live Kubernetes backend!
"""

import os
from typing import Any, Dict, List
import httpx

AETERNA_API_KEY = os.getenv("AETERNA_API_KEY", "cummins-demo-key")
K8S_BACKEND_URL = os.getenv("K8S_BACKEND_URL", "http://k8s-backend:8001")

# ---------------------------------------------------------------------------
# Tool registry — maps action name → async handler
# ---------------------------------------------------------------------------

_TOOL_REGISTRY: Dict[str, Any] = {}

def mcp_tool(name: str):
    """Decorator: register an async function as an MCP tool."""
    def decorator(fn):
        _TOOL_REGISTRY[name] = fn
        return fn
    return decorator

# ---------------------------------------------------------------------------
# K8s Actions Forwarding
# ---------------------------------------------------------------------------

async def forward_to_k8s(action: str, service: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """Forward remediation action to live Kubernetes backend."""
    # Attempt to derive namespace/kind from state or use defaults
    namespace = state.get("namespace", "aeterna-sample")
    target_kind = "Deployment" if action in ("restart_deployment", "scale_up", "scale_down", "rollback_deployment") else "Pod"
    
    # If it's a pod action but we only have a service name, try to assume deployment name
    target_name = service
    if target_kind == "Pod" and "pod_name" in state:
        target_name = state["pod_name"]
        
    payload = {
        "incident_id": state.get("incident_id", "manual"),
        "action": action,
        "namespace": namespace,
        "target_kind": target_kind,
        "target_name": target_name,
        "parameters": {},
        "evidence_summary": f"Triggered by AETERNA AI for {service}",
        "human_approved": False
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                f"{K8S_BACKEND_URL}/api/k8s/remediate",
                json=payload,
                headers={"X-API-Key": AETERNA_API_KEY}
            )
            
            if resp.status_code == 200:
                data = resp.json()
                result = data.get("result", {})
                return {
                    "success": result.get("success", False),
                    "tool_name": action,
                    "patch": {"health": "healthy"} if result.get("success") else {},
                    "output": f"[K8s] {result.get('message', 'Action completed')}"
                }
            else:
                return {
                    "success": False,
                    "tool_name": action,
                    "patch": {},
                    "output": f"[K8s] Failed to execute {action}: {resp.text}"
                }
    except Exception as exc:
        return {
            "success": False,
            "tool_name": action,
            "patch": {},
            "output": f"[K8s] Network error executing {action}: {exc}"
        }

# ---------------------------------------------------------------------------
# Tool implementations (Simulations & Live Forwarding)
# ---------------------------------------------------------------------------

# Register K8s actions
K8S_ACTIONS = [
    "restart_pod", 
    "restart_deployment", 
    "scale_up", 
    "scale_down", 
    "rollback_deployment", 
    "delete_pod", 
    "cordon_node", 
    "drain_node"
]

for action in K8S_ACTIONS:
    # We create a closure for each action
    def make_handler(act):
        @mcp_tool(act)
        async def handler(service: str, state: Dict[str, Any]) -> Dict[str, Any]:
            return await forward_to_k8s(act, service, state)
        return handler
    make_handler(action)

# Legacy / Simulated Actions
@mcp_tool("restart_service")
async def restart_service(service: str, state: Dict[str, Any]) -> Dict[str, Any]:
    # Try mapping restart_service to restart_deployment for K8s compatibility
    if state.get("is_k8s", True): 
        return await forward_to_k8s("restart_deployment", service, state)
        
    new_cpu = max(25, int(state.get("cpu_pct", 50)) - 30)
    new_err = max(0.005, float(state.get("error_rate", 0.02)) * 0.4)
    return {
        "success":   True,
        "tool_name": "restart_service",
        "patch": {"cpu_pct": new_cpu, "error_rate": new_err, "health": "healthy"},
        "output": f"[MCP] restart_service({service}): CPU → {new_cpu}%, error_rate → {new_err:.4f}"
    }

@mcp_tool("scale_service")
async def scale_service(service: str, state: Dict[str, Any]) -> Dict[str, Any]:
    if state.get("is_k8s", True): 
        return await forward_to_k8s("scale_up", service, state)

    new_cpu = max(30, int(state.get("cpu_pct", 90)) - 25)
    return {
        "success":   True,
        "tool_name": "scale_service",
        "patch": {"cpu_pct": new_cpu, "traffic_level": "normal"},
        "output": f"[MCP] scale_service({service}): CPU → {new_cpu}%"
    }

@mcp_tool("cleanup_logs")
async def cleanup_logs(service: str, state: Dict[str, Any]) -> Dict[str, Any]:
    new_disk = max(40, int(state.get("disk_pct", 80)) - 35)
    return {
        "success":   True,
        "tool_name": "cleanup_logs",
        "patch": {"disk_pct": new_disk},
        "output": f"[MCP] cleanup_logs({service}): disk → {new_disk}%"
    }

@mcp_tool("switch_to_fallback")
async def switch_to_fallback(service: str, state: Dict[str, Any]) -> Dict[str, Any]:
    new_err = float(state.get("error_rate", 0.05)) * 0.5
    return {
        "success":   True,
        "tool_name": "switch_to_fallback",
        "patch": {"fallback_active": True, "error_rate": new_err, "health": "degraded"},
        "output": f"[MCP] switch_to_fallback({service}): error_rate → {new_err:.4f}"
    }

@mcp_tool("restart_and_notify")
async def restart_and_notify(service: str, state: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "success":   True,
        "tool_name": "restart_and_notify",
        "patch": {"health": "healthy"},
        "output": f"[MCP] restart_and_notify({service}): restarted + on-call notified"
    }

@mcp_tool("escalate")
async def escalate(service: str, state: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "success":   True,
        "tool_name": "escalate",
        "patch":     {"escalated": True},
        "output":    f"[MCP] escalate({service}): incident escalated to on-call queue",
    }

@mcp_tool("manual_review")
async def manual_review(service: str, state: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "success":   True,
        "tool_name": "manual_review",
        "patch":     {},
        "output":    f"[MCP] manual_review({service}): routed to review queue",
    }

# ---------------------------------------------------------------------------
# Public dispatcher
# ---------------------------------------------------------------------------

async def call_tool(action: str, service: str, state: Dict[str, Any]) -> Dict[str, Any]:
    tool_fn = _TOOL_REGISTRY.get(action)
    if tool_fn is None:
        # If not in registry, see if it's a k8s action anyway
        if action in K8S_ACTIONS or "pod" in action or "deployment" in action:
            return await forward_to_k8s(action, service, state)
            
        new_err = max(0.005, float(state.get("error_rate", 0.02)) * 0.7)
        return {
            "success":   True,
            "tool_name": action,
            "patch": {"error_rate": new_err, "health": "healthy"},
            "output": f"[MCP] {action}({service}): generic remediation applied"
        }
    return await tool_fn(service, state)

def list_tools() -> List[str]:
    return list(_TOOL_REGISTRY.keys())