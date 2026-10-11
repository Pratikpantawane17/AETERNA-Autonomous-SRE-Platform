"""
main.py — K8s backend server: live Kubernetes integration for AETERNA.

This server runs alongside the main AETERNA backend and provides:
  - Cluster connectivity (kubeconfig / in-cluster)
  - Background collection loops (pod health, events, metrics, logs)
  - Normalized alert forwarding to the main AETERNA pipeline
  - Remediation execution with pre/post validation
  - Authentication (JWT-based login/signup)
  - Audit logging for every action
  - RBAC with narrowly scoped K8s permissions

Environment variables:
  K8S_MODE, K8S_KUBECONFIG_PATH, K8S_CONTEXT, K8S_NAMESPACES
  DATABASE_URL, AETERNA_CORE_URL, JWT_SECRET, AETERNA_API_KEY
"""

import asyncio
import hashlib
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
load_dotenv()

import httpx
from fastapi import Depends, FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from k8s_client import k8s_client
from collector import collector
from normalizer import normalizer
from remediator import remediator
from db import k8s_db
from models import (
    K8sAlert,
    K8sAuditRecord,
    RemediationAction,
    RemediationRequest,
)

# Auth
try:
    import jwt as pyjwt
except ImportError:
    pyjwt = None

try:
    import bcrypt
except ImportError:
    bcrypt = None


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

AETERNA_CORE_URL = os.getenv("AETERNA_CORE_URL", "http://localhost:8000")
AETERNA_API_KEY = os.getenv("AETERNA_API_KEY", "cummins-demo-key")
JWT_SECRET = os.getenv("JWT_SECRET", "aeterna-k8s-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24
COLLECTION_INTERVAL = int(os.getenv("K8S_COLLECTION_INTERVAL", "30"))
start_time = time.time()


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_jwt_token(user_data: Dict) -> str:
    if not pyjwt:
        raise HTTPException(500, "PyJWT not installed")
    payload = {
        "sub": user_data["username"],
        "role": user_data.get("role", "operator"),
        "user_id": user_data.get("id"),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt_token(token: str) -> Dict:
    if not pyjwt:
        raise HTTPException(500, "PyJWT not installed")
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


def hash_password(password: str) -> str:
    if bcrypt:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(password: str, hashed: str) -> bool:
    if bcrypt:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    return hashlib.sha256(password.encode()).hexdigest() == hashed


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

async def get_current_user(authorization: str = Header(default="")):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Authorization header")
    token = authorization[7:]
    return decode_jwt_token(token)


def verify_api_key(x_api_key: str = Header(default="")):
    if x_api_key != AETERNA_API_KEY:
        raise HTTPException(401, "Missing or invalid API key")


# ---------------------------------------------------------------------------
# Background collection loop
# ---------------------------------------------------------------------------

async def _forward_alert_to_core(alert: K8sAlert):
    """Send a normalized K8s alert to the main AETERNA ingest pipeline."""
    try:
        payload = {
            "alert_type": alert.alert_type,
            "severity": alert.severity.value,
            "service": alert.service,
            "enrichment": {
                "k8s_cluster": alert.cluster,
                "k8s_namespace": alert.namespace,
                "k8s_pod": alert.pod,
                "k8s_container": alert.container,
                "k8s_evidence": alert.evidence[:1000],
                "k8s_evidence_source": alert.evidence_source,
                "k8s_metrics": alert.metrics_snapshot,
                "source": "k8s_collector",
            },
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{AETERNA_CORE_URL}/api/alerts",
                json=payload,
                headers={"X-API-Key": AETERNA_API_KEY},
            )
            if resp.status_code == 200:
                print(f"[K8s→Core] Forwarded alert: {alert.alert_type} for {alert.service}")
            else:
                print(f"[K8s→Core] Forward failed ({resp.status_code}): {resp.text[:200]}")
    except Exception as exc:
        print(f"[K8s→Core] Forward error: {exc}")


async def _collection_loop():
    """Background loop: collect K8s signals, normalize, forward to AETERNA core."""
    await asyncio.sleep(5)  # Wait for startup
    print(f"[K8s Collector] Starting collection loop (interval={COLLECTION_INTERVAL}s)")

    while True:
        try:
            if not k8s_client.connected:
                print("[K8s Collector] Not connected to cluster — skipping cycle")
                await asyncio.sleep(COLLECTION_INTERVAL)
                continue

            # 1. Collect pod health
            pods = await collector.collect_pod_health()
            print(f"[K8s Collector] Collected health for {len(pods)} pods")

            # 2. Collect events
            events = await collector.collect_events(since_minutes=5)
            print(f"[K8s Collector] Collected {len(events)} events")

            # 3. Collect metrics
            pod_metrics = await collector.collect_pod_metrics()
            node_metrics = await collector.collect_node_metrics()
            print(f"[K8s Collector] Collected metrics for {len(pod_metrics)} pods, {len(node_metrics)} nodes")

            # Forward live resource metrics to core backend
            try:
                metrics_map = {m.name: m for m in pod_metrics}
                for pod in pods:
                    m = metrics_map.get(pod.name)
                    cpu_m = m.cpu_millicores if m else 0
                    mem_b = m.memory_bytes if m else 0
                    cpu_pct = round(min(100.0, (cpu_m / 200.0) * 100.0), 1)
                    mem_pct = round(min(100.0, (mem_b / (256 * 1024 * 1024)) * 100.0), 1)
                    svc_names = set([pod.labels.get("app") or pod.name, pod.name])
                    for svc in svc_names:
                        async with httpx.AsyncClient(timeout=4) as client:
                            await client.post(
                                f"{AETERNA_CORE_URL}/api/ingest/metrics",
                                json={
                                    "service": svc,
                                    "cpu_pct": cpu_pct,
                                    "disk_pct": mem_pct,
                                    "error_rate": 0.0,
                                    "traffic_level": "high" if cpu_pct > 70 else "normal",
                                },
                                headers={"X-API-Key": AETERNA_API_KEY},
                            )
            except Exception as e:
                print(f"[K8s Collector] Metric sync error: {e}")

            # 4. Collect error logs from unhealthy pods
            error_logs = await collector.collect_error_logs_for_pods(pods)
            print(f"[K8s Collector] Collected {len(error_logs)} error log entries")

            # 5. Normalize into alerts
            alerts: List[K8sAlert] = []
            alerts.extend(normalizer.normalize_events(events))
            alerts.extend(normalizer.normalize_pod_health(pods))
            alerts.extend(normalizer.normalize_metrics(pod_metrics))

            # 6. Attach log evidence
            if error_logs:
                alerts = normalizer.attach_log_evidence(alerts, error_logs)

            # 7. Save to DB and forward to core
            for alert in alerts:
                await k8s_db.save_k8s_alert(alert.model_dump(mode="json"))
                await _forward_alert_to_core(alert)

            if alerts:
                print(f"[K8s Collector] Generated {len(alerts)} alerts from this cycle")

        except Exception as exc:
            print(f"[K8s Collector] Loop error: {exc}")

        await asyncio.sleep(COLLECTION_INTERVAL)


# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Connect to K8s cluster
    print("[K8s Lifespan] Connecting to Kubernetes cluster...")
    connected = k8s_client.connect()
    if connected:
        k8s_client.ping()
    else:
        print("[K8s Lifespan] WARNING: K8s not connected — running in degraded mode")

    # Start collection loop
    collection_task = asyncio.create_task(_collection_loop())

    yield

    collection_task.cancel()
    try:
        await collection_task
    except asyncio.CancelledError:
        pass


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="AETERNA K8s Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

class SignupRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


@app.post("/api/auth/signup")
async def signup(req: SignupRequest):
    """Register a new user."""
    # Check existing
    existing = await k8s_db.get_user_by_username(req.username)
    if existing:
        raise HTTPException(400, "Username already exists")
    existing_email = await k8s_db.get_user_by_email(req.email)
    if existing_email:
        raise HTTPException(400, "Email already registered")

    pw_hash = hash_password(req.password)
    user = await k8s_db.create_user(req.username, req.email, pw_hash)
    if not user:
        raise HTTPException(500, "Failed to create user — database may be unavailable")

    token = create_jwt_token(user)
    return {"success": True, "token": token, "user": {k: v for k, v in user.items() if k != "password_hash"}}


@app.post("/api/auth/login")
async def login(req: LoginRequest):
    """Authenticate and return JWT token."""
    user = await k8s_db.get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Invalid username or password")
    if not user.get("is_active", True):
        raise HTTPException(403, "Account disabled")

    await k8s_db.update_last_login(user["id"])
    token = create_jwt_token(user)
    return {"success": True, "token": token, "user": {k: v for k, v in user.items() if k != "password_hash"}}


@app.get("/api/auth/me")
async def get_me(user=Depends(get_current_user)):
    return {"user": user}


# ---------------------------------------------------------------------------
# Cluster status
# ---------------------------------------------------------------------------

@app.get("/api/k8s/status", dependencies=[Depends(verify_api_key)])
async def cluster_status():
    return {
        "connected": k8s_client.connected,
        "cluster_name": k8s_client.cluster_name,
        "namespaces": k8s_client.namespaces,
        "mode": os.getenv("K8S_MODE", "kubeconfig"),
    }


# ---------------------------------------------------------------------------
# Pod health
# ---------------------------------------------------------------------------

@app.get("/api/k8s/pods", dependencies=[Depends(verify_api_key)])
async def list_pods(namespace: Optional[str] = Query(None)):
    if not k8s_client.connected:
        raise HTTPException(503, "K8s cluster not connected")
    pods = await collector.collect_pod_health(namespace)
    return {"pods": [p.model_dump(mode="json") for p in pods]}


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@app.get("/api/k8s/events", dependencies=[Depends(verify_api_key)])
async def list_events(
    namespace: Optional[str] = Query(None),
    since_minutes: int = Query(10),
):
    if not k8s_client.connected:
        raise HTTPException(503, "K8s cluster not connected")
    events = await collector.collect_events(namespace, since_minutes)
    return {"events": [e.model_dump(mode="json") for e in events]}


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

@app.get("/api/k8s/metrics/pods", dependencies=[Depends(verify_api_key)])
async def pod_metrics(namespace: Optional[str] = Query(None)):
    if not k8s_client.connected:
        raise HTTPException(503, "K8s cluster not connected")
    metrics = await collector.collect_pod_metrics(namespace)
    return {"metrics": [m.model_dump(mode="json") for m in metrics]}


@app.get("/api/k8s/metrics/nodes", dependencies=[Depends(verify_api_key)])
async def node_metrics():
    if not k8s_client.connected:
        raise HTTPException(503, "K8s cluster not connected")
    metrics = await collector.collect_node_metrics()
    return {"metrics": [m.model_dump(mode="json") for m in metrics]}


# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------

@app.get("/api/k8s/logs/{namespace}/{pod_name}", dependencies=[Depends(verify_api_key)])
async def pod_logs(
    namespace: str,
    pod_name: str,
    container: Optional[str] = Query(None),
    since_seconds: int = Query(300),
    tail_lines: int = Query(100),
):
    if not k8s_client.connected:
        raise HTTPException(503, "K8s cluster not connected")
    logs = await collector.collect_logs(namespace, pod_name, container, since_seconds, tail_lines)
    return {"logs": [l.model_dump(mode="json") for l in logs]}


# ---------------------------------------------------------------------------
# K8s alerts (from DB)
# ---------------------------------------------------------------------------

@app.get("/api/k8s/alerts", dependencies=[Depends(verify_api_key)])
async def get_k8s_alerts():
    return {"alerts": await k8s_db.get_k8s_alerts()}


# ---------------------------------------------------------------------------
# Remediation
# ---------------------------------------------------------------------------

class RemediationRequestBody(BaseModel):
    incident_id: str
    action: str  # restart_pod, restart_deployment, scale_up, etc.
    namespace: str
    target_kind: str  # Pod, Deployment, StatefulSet
    target_name: str
    parameters: Dict[str, Any] = Field(default_factory=dict)
    evidence_summary: str = ""
    human_approved: bool = False


@app.post("/api/k8s/remediate", dependencies=[Depends(verify_api_key)])
async def execute_remediation(body: RemediationRequestBody):
    """Execute a K8s remediation action with validation and audit."""
    if not k8s_client.connected:
        raise HTTPException(503, "K8s cluster not connected")

    try:
        action = RemediationAction(body.action)
    except ValueError:
        raise HTTPException(400, f"Invalid action: {body.action}")

    request = RemediationRequest(
        incident_id=body.incident_id,
        action=action,
        cluster=k8s_client.cluster_name,
        namespace=body.namespace,
        target_kind=body.target_kind,
        target_name=body.target_name,
        parameters=body.parameters,
        evidence_summary=body.evidence_summary,
        requested_by="human_operator" if body.human_approved else "ai_triage",
    )

    # Pre-action audit
    evidence_hash = hashlib.sha256(body.evidence_summary.encode()).hexdigest()[:16]
    await k8s_db.save_audit_record({
        "incident_id": body.incident_id,
        "cluster": k8s_client.cluster_name,
        "namespace": body.namespace,
        "action": body.action,
        "target": f"{body.namespace}/{body.target_kind}/{body.target_name}",
        "actor": "human_operator" if body.human_approved else "ai_auto",
        "evidence_hash": evidence_hash,
        "result": "initiated",
        "detail": f"Remediation requested: {body.action}",
        "approved_by": "human" if body.human_approved else None,
    })

    # Execute
    result = await remediator.execute(request)

    # Post-action verification
    result = await remediator.verify_remediation(result, request, timeout_seconds=30)

    # Save result
    await k8s_db.save_remediation(result.model_dump(mode="json"))

    # Post-action audit
    await k8s_db.save_audit_record({
        "incident_id": body.incident_id,
        "cluster": k8s_client.cluster_name,
        "namespace": body.namespace,
        "action": body.action,
        "target": result.target,
        "actor": "system",
        "evidence_hash": evidence_hash,
        "result": "success" if result.success else "failed",
        "detail": result.message,
        "approved_by": "verified" if result.verified else "unverified",
    })

    return {
        "success": result.success,
        "result": result.model_dump(mode="json"),
    }


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

@app.get("/api/k8s/audit", dependencies=[Depends(verify_api_key)])
async def get_audit_log():
    return {"audit_log": await k8s_db.get_audit_log()}


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "uptime_seconds": round(time.time() - start_time, 1),
        "k8s_connected": k8s_client.connected,
        "k8s_cluster": k8s_client.cluster_name,
        "db_ready": k8s_db.is_ready,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Dockerfile and startup
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("K8S_BACKEND_PORT", "8001"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
