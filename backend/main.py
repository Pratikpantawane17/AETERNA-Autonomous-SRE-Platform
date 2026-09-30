import asyncio
import csv
import io
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

# ── FIX 1: load .env before anything else reads os.getenv ───────────────────
from dotenv import load_dotenv
load_dotenv()
# ────────────────────────────────────────────────────────────────────────────

from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ai_core import brain, generate_postmortem
from memory import memory_store
from models import Alert, Incident, OverrideRequest
from storage import store
from stream_processor import process_alert, BATCH_SEMAPHORE
from workflow_engine import engine as workflow_engine


# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

_automation_lock   = asyncio.Lock()
_automation_paused = False
start_time         = time.time()
APP_API_KEY        = os.getenv("AETERNA_API_KEY", "cummins-demo-key")

AETERNA_LOGO = r"""
    ___        __
   /   |  ___ / /_ ___  _____ ____  ____ _
  / /| | / _ \ __// _ \/ ___// __ \/ __ `/
 / ___ |/  __/ /_/  __/ /   / / / / /_/ /
/_/  |_|\___/\__/\___/_/   /_/ /_/\__,_/
"""


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        if "payload" in message and isinstance(message["payload"], dict) and "incident_id" in message["payload"]:
            message["payload"]["id"] = message["payload"]["incident_id"]
        stale = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self.disconnect(connection)


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def verify_api_key(x_api_key: str | None = Header(default=None)):
    if x_api_key != APP_API_KEY:
        raise HTTPException(status_code=401, detail="Missing or invalid API key")


# ---------------------------------------------------------------------------
# Hallucination recorder
# ---------------------------------------------------------------------------

async def record_hallucination_event(incident_dict: Dict[str, Any], triage_result: Dict[str, Any], batch_mode: bool = False):
    try:
        provider   = triage_result.get("llm_provider", "none")
        adjustment = triage_result.get("llm_confidence_adjustment", 0.0)
        await store.add_hallucination_event({
            "timestamp":          datetime.now(timezone.utc).isoformat(),
            "incident_id":        incident_dict.get("incident_id"),
            "alert_type":         incident_dict.get("alert_type"),
            "service":            incident_dict.get("service"),
            "status":             "checked" if provider != "none" else "skipped",
            "provider":           provider,
            "bounded_adjustment": adjustment,
            "notes":              f"Confidence adjusted by {adjustment:+.2f}" if adjustment != 0 else "",
        }, batch_mode=batch_mode)
    except Exception as exc:
        print(f"[Hallucination Event] Failed to record: {exc}")


# ---------------------------------------------------------------------------
# Core triage + dispatch
# ---------------------------------------------------------------------------

async def triage_and_dispatch(result: Dict[str, Any], batch_mode: bool = False) -> Dict[str, Any]:
    incident_dict = result.get("incident")
    if not incident_dict:
        return result

    try:
        alert_obj     = Alert(**result["alert"])
        triage_result = await brain.triage(alert_obj, Incident(**incident_dict), skip_llm=batch_mode)
        
        # Bug 15 fix: correct vocabulary mapping for workflow dispatch
        if alert_obj.alert_type == "high_error_rate" and triage_result["final_action"] in ["restart_service", "auto_restart_service"]:
            triage_result["final_action"] = "auto_rollback_deployment"
            
        incident_dict["triage_result"]  = triage_result
        incident_dict["confidence"]     = triage_result["confidence"]
        incident_dict["ai_reasoning"]   = triage_result["reasoning"]
        incident_dict["action_taken"]   = triage_result["final_action"]
        incident_dict["autonomy_mode"]  = triage_result.get("mode")
        incident_dict["llm_used"]       = triage_result.get("llm_provider", "none") != "none"
        await store.transition_incident(incident_dict["incident_id"], "triaged", "ai_core", "AI triage completed", batch_mode=batch_mode)
        if not batch_mode:
            await store.save()
        await record_hallucination_event(incident_dict, triage_result, batch_mode=batch_mode)
        if not batch_mode:
            await manager.broadcast({"type": "INCIDENT_CREATED", "payload": incident_dict})
    except Exception as exc:
        print(f"[Triage] Failed for {incident_dict.get('incident_id')}: {exc}")
        if not batch_mode:
            await manager.broadcast({
                "type":    "INCIDENT_ERROR",
                "payload": {"incident_id": incident_dict.get("incident_id"), "error": str(exc)},
            })
        return result

    async with _automation_lock:
        paused = _automation_paused

    try:
        if paused:
            incident_dict["action_taken"] = "manual_review"
            await store.transition_incident(
                incident_dict["incident_id"], "awaiting_review", "kill_switch", "Automation paused globally", batch_mode=batch_mode
            )
        elif triage_result["mode"] == "REVIEW":
            await store.transition_incident(
                incident_dict["incident_id"], "awaiting_review", "validator", "Awaiting human review", batch_mode=batch_mode
            )
        elif not batch_mode:
            asyncio.create_task(
                workflow_engine.execute(
                    incident_dict["incident_id"],
                    triage_result["final_action"],
                    incident_dict["service"],
                    manager.broadcast,
                )
            )

        if not batch_mode:
            await manager.broadcast({"type": "INCIDENT_UPDATED", "payload": incident_dict})
    except Exception as exc:
        print(f"[Dispatch] Failed for {incident_dict.get('incident_id')}: {exc}")

    result["triage_result"] = triage_result
    return result


# ---------------------------------------------------------------------------
# Background prediction loop
# ---------------------------------------------------------------------------

PREDICTION_POLL_INTERVAL = 30


async def _prediction_loop():
    await asyncio.sleep(10)
    print("[Predictor] Background prediction loop started.")

    while True:
        try:
            service_states = await store.list_service_state()

            for service, state in service_states.items():
                memory_store.update_metric_snapshot(service, state)

                prediction = memory_store.detect_patterns(service, state)
                if prediction:
                    predicted_type = f"predictive_{prediction['predicted_alert']}"
                    confidence     = prediction["confidence"]
                    print(
                        f"[Predictor] {service}: {predicted_type} detected "
                        f"(confidence={confidence:.0%}). "
                        f"Methods: {prediction.get('detection_methods', [])}"
                    )

                    await manager.broadcast({
                        "type":    "PREDICTIVE_ALERT",
                        "payload": prediction,
                    })

                    if confidence >= 0.80:
                        predictive_alert = Alert(
                            alert_type=predicted_type,
                            service=service,
                            severity="high",
                        )
                        result = await process_alert(predictive_alert)
                        if not result["deduplicated"]:
                            await manager.broadcast({
                                "type":    "ALERT_RECEIVED",
                                "payload": result["alert"],
                            })
                            await triage_and_dispatch(result)

        except Exception as exc:
            print(f"[Predictor] Loop error: {exc}")

        await asyncio.sleep(PREDICTION_POLL_INTERVAL)


# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Lifespan] Bootstrapping memory store...")
    try:
        history = await store.get_history()
        print(f"[Lifespan] Retrieved {len(history)} items from history.")
        memory_store.bootstrap(history)
        print("[Startup] Memory store bootstrapped.")
    except Exception as exc:
        print(f"[Startup] Warning: Failed to bootstrap memory store: {exc}")

    print("[Lifespan] Starting prediction loop...")
    prediction_task = asyncio.create_task(_prediction_loop())
    print("[Lifespan] Startup complete.")

    yield

    prediction_task.cancel()
    try:
        await prediction_task
    except asyncio.CancelledError:
        pass


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Aeterna — Sovereign SRE", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": exc.detail, "code": f"HTTP_{exc.status_code}_ERROR"})


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    return JSONResponse(status_code=500, content={"success": False, "error": str(exc), "code": "INTERNAL_SERVER_ERROR"})


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, api_key: str | None = Query(default=None)):
    if api_key != APP_API_KEY:
        await websocket.close(code=4401)
        return
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ---------------------------------------------------------------------------
# Alert endpoints
# ---------------------------------------------------------------------------

@app.post("/api/alerts", dependencies=[Depends(verify_api_key)])
async def create_alert(alert_in: Alert):
    print(f"[API] Received alert: {alert_in.alert_type} for service {alert_in.service} (severity: {alert_in.severity})")
    result = await process_alert(alert_in)
    await manager.broadcast({"type": "ALERT_RECEIVED", "payload": result["alert"]})
    if result["deduplicated"]:
        print(f"[API] Alert deduplicated. Original incident: {result['original_incident_id']}")
        return result
    print(f"[API] Alert processed. Created incident: {result['incident']['incident_id']}")
    return await triage_and_dispatch(result)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    print("VALIDATION ERROR:", exc.errors())  # 👈 ADD THIS
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": exc.body}
    )

@app.post("/api/alerts/upload-csv", dependencies=[Depends(verify_api_key)])
async def upload_alerts_csv(file: UploadFile = File(...)):
    contents = await file.read()
    decoded  = contents.decode("utf-8")
    reader   = list(csv.DictReader(io.StringIO(decoded)))
    total    = len(reader)

    # ── Header banner ────────────────────────────────────────────────────────
    print("\n" + "═" * 60)
    print(f"  📂  CSV UPLOAD  ─  {file.filename}")
    print(f"  📊  Total rows : {total}")
    print(f"  🕐  Started    : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("═" * 60)

    results_agg = {
        "processed":         0,
        "incidents_created": 0,
        "deduplicated":      0,
        "errors":            [],
    }

    idx = 0
    for row_num, row in enumerate(reader, start=2):
        idx += 1
        svc  = (row.get("service")    or "?").strip()
        atype= (row.get("alert_type") or "?").strip()
        sev  = (row.get("severity")   or "?").strip()

        try:
            if not row.get("alert_type") or not row.get("severity") or not row.get("service"):
                msg = f"Row {row_num}: Missing required fields (alert_type, severity, service)"
                results_agg["errors"].append(msg)
                print(f"  ⚠  [{idx:>3}/{total}] SKIP    row={row_num}  (missing fields: {dict(row)})")
                continue

            try:
                payload = {
                    "alert_type": atype,
                    "severity":   sev,
                    "service":    svc,
                }
                if row.get("timestamp"):
                    payload["timestamp"] = row["timestamp"].strip()

                alert_obj = Alert(**payload)
            except ValueError as ve:
                msg = f"Row {row_num}: Invalid alert format - {str(ve)}"
                results_agg["errors"].append(msg)
                print(f"  ✗  [{idx:>3}/{total}] ERROR   row={row_num}  {atype}/{svc}/{sev}  → {ve}")
                continue

            result = await process_alert(alert_obj, batch_mode=True)

            results_agg["processed"] += 1
            if result["deduplicated"]:
                results_agg["deduplicated"] += 1
                orig = result.get("original_incident_id", "?")
                print(f"  ⟳  [{idx:>3}/{total}] DEDUP   {atype:<22} service={svc:<18} sev={sev:<8} → dup of {orig}")
            else:
                results_agg["incidents_created"] += 1
                inc_id = result.get("incident", {}).get("incident_id", "?")
                print(f"  ✓  [{idx:>3}/{total}] NEW     {atype:<22} service={svc:<18} sev={sev:<8} → {inc_id}")
                await triage_and_dispatch(result, batch_mode=True)

        except Exception as exc:
            msg = f"Row {row_num}: {str(exc)}"
            results_agg["errors"].append(msg)
            print(f"  ✗  [{idx:>3}/{total}] EXCEPT  row={row_num}  {atype}/{svc}  → {exc}")

        # Progress bar every 10 rows
        if idx % 10 == 0 or idx == total:
            done = results_agg["incidents_created"]
            dup  = results_agg["deduplicated"]
            err  = len(results_agg["errors"])
            pct  = int(idx / total * 30)
            bar  = "█" * pct + "░" * (30 - pct)
            print(f"\n  ▶  [{bar}] {idx}/{total}  new={done}  dup={dup}  err={err}\n")

    # ── Persist (JSON save is fast; PG flush fires in background) ────────────
    print("─" * 60)
    print("  💾  Persisting to disk…")
    try:
        await store.save()
        print("  ✅  JSON store saved.")
    except Exception as exc:
        print(f"  ✗   Failed to persist storage: {exc}")

    # Fire-and-forget Postgres flush — does NOT block the HTTP response
    async def _bg_pg_flush():
        try:
            await store.flush_batch_to_postgres()
            print("  ✅  [Background] Postgres batch flush complete.")
        except Exception as exc:
            print(f"  ⚠   [Background] Postgres flush failed (non-fatal): {exc}")
    asyncio.create_task(_bg_pg_flush())

    # ── Final summary ─────────────────────────────────────────────────────────
    results_agg["success"] = len(results_agg["errors"]) == 0
    status_icon = "✅" if results_agg["success"] else "⚠ "
    print("═" * 60)
    print(f"  {status_icon}  CSV UPLOAD COMPLETE")
    print(f"  ├─ File          : {file.filename}")
    print(f"  ├─ Total rows    : {total}")
    print(f"  ├─ Processed     : {results_agg['processed']}")
    print(f"  ├─ Incidents new : {results_agg['incidents_created']}")
    print(f"  ├─ Deduplicated  : {results_agg['deduplicated']}")
    print(f"  ├─ Errors        : {len(results_agg['errors'])}")
    if results_agg["errors"]:
        for e in results_agg["errors"][:10]:
            print(f"  │    • {e}")
        if len(results_agg["errors"]) > 10:
            print(f"  │    … and {len(results_agg['errors']) - 10} more")
    print(f"  └─ Finished      : {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print("═" * 60 + "\n")

    await manager.broadcast({"type": "BATCH_UPLOAD_COMPLETE", "payload": results_agg})
    return results_agg


@app.get("/api/alerts", dependencies=[Depends(verify_api_key)])
async def get_alerts():
    return await store.get_alerts()


# ---------------------------------------------------------------------------
# Metric ingestion — universal adapter endpoint
# Accepts direct metric pushes or Prometheus-style payloads.
# Feeds the prediction loop without requiring CSV uploads or manual triggers.
# ---------------------------------------------------------------------------

class MetricIngestPayload(BaseModel):
    service:       str
    cpu_pct:       Optional[float] = None
    disk_pct:      Optional[float] = None
    error_rate:    Optional[float] = None
    health:        Optional[str]   = None
    traffic_level: Optional[str]   = None
    # Prometheus-compatible fields
    metric_name:   Optional[str]   = None
    value:         Optional[float] = None
    labels:        Optional[Dict[str, str]] = None


@app.post("/api/ingest/metrics", dependencies=[Depends(verify_api_key)])
async def ingest_metrics(payload: MetricIngestPayload):
    """
    Universal metric ingestion adapter.

    Accepts:
      - Direct metric fields: { service, cpu_pct, disk_pct, error_rate, health }
      - Prometheus-style:     { service, metric_name, value, labels }

    Updates service state immediately and pushes a snapshot into the
    prediction loop — enabling live external monitoring without CSV uploads.
    """
    patch: Dict[str, Any] = {}

    # Direct fields
    if payload.cpu_pct       is not None: patch["cpu_pct"]       = payload.cpu_pct
    if payload.disk_pct      is not None: patch["disk_pct"]      = payload.disk_pct
    if payload.error_rate    is not None: patch["error_rate"]     = payload.error_rate
    if payload.health        is not None: patch["health"]         = payload.health
    if payload.traffic_level is not None: patch["traffic_level"]  = payload.traffic_level

    # Prometheus-style: metric_name + value
    if payload.metric_name and payload.value is not None:
        _prometheus_map = {
            "cpu_usage":   "cpu_pct",
            "cpu_pct":     "cpu_pct",
            "disk_usage":  "disk_pct",
            "disk_pct":    "disk_pct",
            "error_rate":  "error_rate",
        }
        mapped = _prometheus_map.get(payload.metric_name)
        if mapped:
            patch[mapped] = payload.value

    if not patch:
        raise HTTPException(status_code=400, detail="No valid metric fields in payload")

    await store.update_service_state(payload.service, patch, reason="external_ingest")

    # Push snapshot into the memory store so the prediction loop sees it immediately
    updated_state = await store.get_service_state(payload.service)
    memory_store.update_metric_snapshot(payload.service, updated_state)

    # Broadcast state change to connected dashboards
    await manager.broadcast({
        "type":    "SERVICE_STATE_UPDATED",
        "payload": {"service": payload.service, "state": updated_state},
    })

    return {"success": True, "service": payload.service, "applied": patch}


# ---------------------------------------------------------------------------
# Incident endpoints
# ---------------------------------------------------------------------------

@app.get("/api/incidents", dependencies=[Depends(verify_api_key)])
async def get_incidents():
    return await store.get_incidents()


@app.get("/api/incidents/{incident_id}", dependencies=[Depends(verify_api_key)])
async def get_incident(incident_id: str):
    incident = await store.get_incident(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@app.post("/api/incidents/{incident_id}/override", dependencies=[Depends(verify_api_key)])
async def override_incident(incident_id: str, request: OverrideRequest):
    """
    Human override endpoint.

    Two learning signals are recorded:
      1. The AI's original recommendation is penalized as a failure
         (it was wrong enough that a human corrected it).
      2. The human-chosen action is executed and its outcome recorded
         normally by the workflow engine.

    This closes the learning loop for human corrections — the AI will
    down-weight its original recommendation for similar future incidents.
    """
    try:
        incident = await store.get_incident(incident_id)
        if not incident:
            raise HTTPException(status_code=404, detail="Incident not found")

        chosen_action = request.action or incident.get("triage_result", {}).get("strategist", {}).get("action") or "escalate"
        if request.decision == "reject":
            chosen_action = "escalate"

        # ── Penalize the AI's original recommendation ────────────────────
        # If the human chose a different action, the AI's pick was wrong.
        # Record it as a failure so the learning loop adjusts future scoring.
        ai_original_action = (
            incident.get("triage_result", {})
                    .get("strategist", {})
                    .get("action")
        )
        if ai_original_action and ai_original_action != chosen_action:
            await store.record_action_metric(
                incident.get("alert_type", ""),
                ai_original_action,
                False,
                incident_id=incident_id,
                service=incident.get("service", ""),
            )
            memory_store.store_resolved_incident({
                **incident,
                "action_taken":    ai_original_action,
                "status":          "failed",
                "override_reason": f"Human chose '{chosen_action}' instead",
            })
            print(
                f"[Override] AI recommendation '{ai_original_action}' penalized "
                f"for incident {incident_id} — human chose '{chosen_action}'"
            )

        override_event = {
            "timestamp":        datetime.now(timezone.utc).isoformat(),
            "incident_id":      incident_id,
            "decision":         request.decision,
            "action":           chosen_action,
            "note":             request.note,
            "actor":            request.actor,
            "ai_original":      ai_original_action,
        }
        await store.add_override(override_event)
        incident["action_taken"] = chosen_action
        incident.setdefault("triage_result", {}).setdefault("validator", {})["override"] = override_event
        await store.transition_incident(incident_id, "in_progress", request.actor, f"Human override → {chosen_action}")
        asyncio.create_task(
            workflow_engine.execute(incident_id, chosen_action, incident["service"], manager.broadcast)
        )
        await manager.broadcast({"type": "INCIDENT_UPDATED", "payload": incident})
        return {"success": True, "override": override_event}
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[Override] Failed for {incident_id}: {exc}")
        raise HTTPException(status_code=500, detail="Failed to process override")


@app.get("/api/incidents/{incident_id}/postmortem", dependencies=[Depends(verify_api_key)])
async def get_incident_postmortem(incident_id: str):
    incident = await store.get_incident(incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    if not incident.get("postmortem"):
        incident["postmortem"] = await generate_postmortem(incident)
        await store.save()
    return {"incident_id": incident_id, "postmortem": incident["postmortem"]}


# ---------------------------------------------------------------------------
# Workflow endpoints
# ---------------------------------------------------------------------------

@app.get("/api/workflows", dependencies=[Depends(verify_api_key)])
async def get_workflows():
    return await store.get_workflows()


class WorkflowAddRequest(BaseModel):
    alert_type:          str
    action:              str
    priority:            int   = 1
    estimated_time_mins: float = 2.0


@app.post("/api/workflows", dependencies=[Depends(verify_api_key)])
async def add_workflow(req: WorkflowAddRequest):
    wf = await store.add_workflow(req.model_dump())
    await store.append_audit_event({"type": "workflow_added", "workflow": wf})
    return {"success": True, "workflow": wf}


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

_stats_cache = {"data": None, "ts": 0.0}
STATS_CACHE_TTL = 10.0  # seconds

async def _compute_stats():
    incidents = await store.get_incidents()
    total     = len(incidents)
    resolved  = sum(1 for i in incidents if i.get("status") == "resolved")
    pending   = sum(1 for i in incidents if i.get("status") in
                    ["detected", "triaged", "awaiting_review", "in_progress", "verifying"])
    escalated = sum(1 for i in incidents if i.get("status") == "escalated")

    resolved_incs       = [i for i in incidents if i.get("duration_mins") is not None]
    avg_resolution_mins = (
        sum(i["duration_mins"] for i in resolved_incs) / len(resolved_incs)
        if resolved_incs else 0.0
    )

    alerts_by_sev = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for inc in incidents:
        if inc.get("severity") in alerts_by_sev:
            alerts_by_sev[inc["severity"]] += 1

    now          = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)
    last_hour    = sum(
        1 for inc in incidents
        if _parse_dt(inc.get("created_at")) and _parse_dt(inc.get("created_at")) >= one_hour_ago
    )

    services         = await store.list_service_state()
    chronic_services = sorted(
        services.items(), key=lambda kv: kv[1].get("error_rate", 0), reverse=True
    )[:3]

    type_counts: Dict[str, int] = {}
    for inc in incidents:
        t = inc.get("alert_type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1

    return {
        "total_incidents":     total,
        "resolved":            resolved,
        "pending":             pending,
        "escalated":           escalated,
        "avg_resolution_mins": round(avg_resolution_mins, 2),
        "mttr_formatted":      f"{int(avg_resolution_mins)}m {int((avg_resolution_mins % 1) * 60)}s",
        "alerts_by_severity":  alerts_by_sev,
        "alerts_by_type":      type_counts,
        "automation_rate_pct": round((resolved / total * 100) if total else 0.0, 1),
        "incidents_last_hour": last_hour,
        "pending_review":      sum(1 for i in incidents if i.get("status") == "awaiting_review"),
        "learning_updates":    await store.get_learning_updates(limit=5),
        "chronic_services":    [
            {"service": n, "error_rate": d.get("error_rate", 0)} for n, d in chronic_services
        ],
    }

@app.get("/api/dashboard/stats", dependencies=[Depends(verify_api_key)])
async def get_stats():
    now = time.time()
    if _stats_cache["data"] and (now - _stats_cache["ts"]) < STATS_CACHE_TTL:
        return _stats_cache["data"]
    result = await _compute_stats()
    _stats_cache["data"] = result
    _stats_cache["ts"] = now
    return result


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Reliability / audit / learning
# ---------------------------------------------------------------------------

@app.get("/api/reliability/hallucinations", dependencies=[Depends(verify_api_key)])
async def get_hallucination_events():
    return await store.get_hallucination_events()


@app.get("/api/audit", dependencies=[Depends(verify_api_key)])
async def get_audit_log():
    return await store.get_audit_log()


@app.get("/api/overrides", dependencies=[Depends(verify_api_key)])
async def get_override_log():
    return await store.get_overrides()


@app.get("/api/learning/updates", dependencies=[Depends(verify_api_key)])
async def get_learning_updates():
    return await store.get_learning_updates()


@app.get("/api/services/state", dependencies=[Depends(verify_api_key)])
async def get_service_state():
    return await store.list_service_state()


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@app.get("/api/reports/weekly-digest", dependencies=[Depends(verify_api_key)])
async def weekly_digest():
    incidents = await store.get_incidents()
    services  = await store.list_service_state()
    return {
        "generated_at":   datetime.now(timezone.utc).isoformat(),
        "top_incidents":  [
            {k: inc.get(k) for k in ("incident_id", "service", "alert_type", "status")}
            for inc in incidents[:5]
        ],
        "services_needing_attention": [
            name for name, state in services.items()
            if state.get("error_rate", 0) > 0.02 or state.get("health") != "healthy"
        ],
        "automation_success_metrics": list((await store.get_action_metrics()).values()),
    }


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")
    return {
        "status":         "ok",
        "uptime_seconds": round(time.time() - start_time, 1),
        "timestamp":      datetime.now(timezone.utc).isoformat(),
        "llm_primary":    "gemini",
        "llm_primary_status": "online" if gemini_key else "missing",
        "llm_fallback":   "groq" if groq_key else "not_configured",
        "llm_fallback_status": "ready" if groq_key else "error",
        "kill_switch":    _automation_paused,
        "postgres_ready": store._pg_ready,
        "mcp_tools":      workflow_engine.list_definitions().get("mcp_tools", []),
    }


# ---------------------------------------------------------------------------
# Predictive alert — manual trigger
# ---------------------------------------------------------------------------

class PredictRequest(BaseModel):
    service:        str
    metric_history: List[float] = Field(min_length=3, description="At least 3 metric readings")


@app.post("/api/predict", dependencies=[Depends(verify_api_key)])
async def predict_alert(req: PredictRequest):
    result = memory_store.generate_predictive_alert(req.service, req.metric_history)
    return result if result else {"prediction": None}


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------

@app.post("/api/kill-switch", dependencies=[Depends(verify_api_key)])
async def toggle_kill_switch():
    global _automation_paused
    async with _automation_lock:
        _automation_paused = not _automation_paused
        paused = _automation_paused

    status = "paused" if paused else "active"
    try:
        await manager.broadcast({"type": "KILL_SWITCH_TOGGLED", "payload": {"kill_switch_active": paused}})
        await store.append_audit_event({"type": "kill_switch_toggled", "status": status})
    except Exception as exc:
        print(f"[Kill Switch] Failed to broadcast/audit: {exc}")

    return {"kill_switch_active": paused, "automation_status": status, "paused": paused}


@app.get("/api/kill-switch", dependencies=[Depends(verify_api_key)])
async def get_kill_switch_status():
    async with _automation_lock:
        paused = _automation_paused
    return {"kill_switch_active": paused, "paused": paused}