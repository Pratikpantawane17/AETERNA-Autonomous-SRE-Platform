import asyncio

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Tuple

try:
    from redis.asyncio import Redis
except Exception:
    Redis = None

from models import Alert, Incident
from storage import store


# ---------------------------------------------------------------------------
# Semaphore for concurrent batch processing (used by CSV upload in main.py)
# Limits to 8 concurrent alert-processing coroutines to avoid overwhelming
# the storage lock and LLM rate limits.
# ---------------------------------------------------------------------------

BATCH_SEMAPHORE = asyncio.Semaphore(2)


_dedup_window: Dict[Tuple[str, str], Dict[str, Any]] = {}
_dedup_lock = asyncio.Lock()
_redis_client = None
_redis_url = __import__("os").getenv("REDIS_URL", "")
if _redis_url and Redis is not None:
    try:
        _redis_client = Redis.from_url(_redis_url, decode_responses=True)
    except Exception:
        _redis_client = None


def _utc_now():
    return datetime.now(timezone.utc)


async def _check_redis_dedup(key: str, incident_id: str) -> Dict[str, Any] | None:
    if _redis_client is None:
        return None
    try:
        existing = await _redis_client.get(key)
        if existing:
            data = __import__("json").loads(existing)
            data["count"] += 1
            await _redis_client.set(key, __import__("json").dumps(data), ex=60)
            return data
        await _redis_client.set(
            key,
            __import__("json").dumps({"incident_id": incident_id, "count": 1}),
            ex=60,
        )
    except Exception as exc:
        print(f"[Redis] dedup error: {exc}")
    return None


async def process_alert(alert_in: Alert, batch_mode: bool = False) -> Dict[str, Any]:
    now = _utc_now()
    if alert_in.timestamp.tzinfo is None:
        alert_in.timestamp = alert_in.timestamp.replace(tzinfo=timezone.utc)

    key       = (alert_in.alert_type, alert_in.service)
    redis_key = f"dedup:{alert_in.alert_type}:{alert_in.service}"

    # ── In-process deduplication (60-second sliding window) ─────────────────
    async with _dedup_lock:
        if key in _dedup_window:
            window_data = _dedup_window[key]
            if (now - window_data["timestamp"]).total_seconds() <= 60:
                window_data["count"]     += 1
                window_data["timestamp"]  = now
                return {
                    "alert":                 alert_in.model_dump(mode="json"),
                    "incident":              None,
                    "deduplicated":          True,
                    "original_incident_id":  window_data["incident_id"],
                }

    new_incident_id = f"inc-{uuid.uuid4().hex[:8]}"

    # ── Redis deduplication (distributed, optional) ──────────────────────────
    redis_duplicate = await _check_redis_dedup(redis_key, new_incident_id)
    if redis_duplicate is not None:
        return {
            "alert":                alert_in.model_dump(mode="json"),
            "incident":             None,
            "deduplicated":         True,
            "original_incident_id": redis_duplicate["incident_id"],
        }

    async with _dedup_lock:
        _dedup_window[key] = {"timestamp": now, "incident_id": new_incident_id, "count": 1}

    # ── Context enrichment ───────────────────────────────────────────────────
    service_state = await store.get_service_state(alert_in.service)
    history       = await store.get_history()
    alerts        = await store.get_alerts()

    past_incident_count    = 0
    recursive_failure_count = 0
    similar_actions: list   = []

    for past in history:
        if past.get("alert_type") == alert_in.alert_type and past.get("service") == alert_in.service:
            past_incident_count += 1
            if past.get("action_taken"):
                similar_actions.append(past["action_taken"])
            if past.get("status") in ("failed", "escalated"):
                recursive_failure_count += 1

    correlated_types: set = set()
    five_mins_ago = now - timedelta(minutes=5)
    for alert in alerts:
        ts = alert.get("timestamp")
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                continue
        if (
            ts and ts >= five_mins_ago
            and alert.get("service") == alert_in.service
            and alert.get("alert_type") != alert_in.alert_type
        ):
            correlated_types.add(alert["alert_type"])

    traffic_level = service_state.get("traffic_level", "normal")

    # Current metric value for this alert type
    metric_map = {
        "high_cpu":         service_state.get("cpu_pct", 0),
        "disk_full":        service_state.get("disk_pct", 0),
        "high_memory":      service_state.get("cpu_pct", 0),  # proxy
        "memory_leak":      service_state.get("cpu_pct", 0),
        "api_failure":      round(service_state.get("error_rate", 0) * 100, 2),
        "high_error_rate":  round(service_state.get("error_rate", 0) * 100, 2),
        "service_down":     0 if service_state.get("health") == "healthy" else 1,
        "health_check_fail":0 if service_state.get("health") == "healthy" else 1,
        "repeated_failure": recursive_failure_count,
        "high_latency":     round(service_state.get("error_rate", 0) * 1000, 0),
        "network_timeout":  round(service_state.get("error_rate", 0) * 1000, 0),
    }
    threshold_map = {
        "high_cpu": 90, "disk_full": 95, "api_failure": 5,
        "service_down": 1, "repeated_failure": 2,
        "high_memory": 85, "memory_leak": 80,
        "high_error_rate": 3, "high_latency": 500,
        "network_timeout": 1000, "health_check_fail": 1,
    }

    alert_in.enrichment = {
        "past_incident_count":    past_incident_count,
        "traffic_level":          traffic_level,
        "correlated_alerts":      list(correlated_types),
        "service_state":          service_state,
        "similar_actions":        similar_actions[:3],
        "current_metric":         metric_map.get(alert_in.alert_type, 0),
        "threshold":              threshold_map.get(alert_in.alert_type),
        "risk_context":           "peak_window" if traffic_level == "high" else "standard_window",
    }

    if recursive_failure_count >= 2:
        alert_in.enrichment["recursive_failure"] = True

    alert_dict = alert_in.model_dump(mode="json")
    await store.add_alert(alert_dict, batch_mode=batch_mode)

    incident = Incident(
        incident_id=new_incident_id,
        alert_id=alert_in.id,
        alert_type=alert_in.alert_type,
        service=alert_in.service,
        severity=alert_in.severity,
        status="detected",
    )
    incident_dict = incident.model_dump(mode="json")
    incident_dict["state_history"] = [{
        "timestamp": now.isoformat(),
        "to_status": "detected",
        "actor":     "system",
        "note":      "Alert converted into incident",
    }]
    await store.add_incident(incident_dict, batch_mode=batch_mode)

    return {"alert": alert_dict, "incident": incident_dict, "deduplicated": False}