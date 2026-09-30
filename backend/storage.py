import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import psycopg
except Exception:
    psycopg = None


DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_FILE = DATA_DIR / "runtime_store.json"


# ---------------------------------------------------------------------------
# Expanded workflow table — covers 15+ alert types, not just the PS examples.
# Each alert_type can have multiple candidate actions (Strategist picks best).
# ---------------------------------------------------------------------------

DEFAULT_WORKFLOWS = [
    # ── PS Scenarios ────────────────────────────────────────────────────────
    {"alert_type": "high_cpu",         "action": "restart_service",    "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "high_cpu",         "action": "scale_service",       "priority": 2, "estimated_time_mins": 3.0},
    {"alert_type": "disk_full",        "action": "cleanup_logs",        "priority": 1, "estimated_time_mins": 5.0},
    {"alert_type": "disk_full",        "action": "scale_service",       "priority": 2, "estimated_time_mins": 3.0},
    {"alert_type": "api_failure",      "action": "switch_to_fallback",  "priority": 1, "estimated_time_mins": 1.0},
    {"alert_type": "api_failure",      "action": "restart_service",     "priority": 2, "estimated_time_mins": 2.0},
    {"alert_type": "service_down",     "action": "restart_and_notify",  "priority": 1, "estimated_time_mins": 3.0},
    {"alert_type": "service_down",     "action": "switch_to_fallback",  "priority": 2, "estimated_time_mins": 1.5},
    {"alert_type": "repeated_failure", "action": "escalate",            "priority": 0, "estimated_time_mins": 0.5},
    {"alert_type": "repeated_failure", "action": "restart_service",     "priority": 1, "estimated_time_mins": 2.0},

    # ── Extended / Dynamic Scenarios ────────────────────────────────────────
    {"alert_type": "memory_leak",      "action": "restart_service",    "priority": 1, "estimated_time_mins": 2.5},
    {"alert_type": "memory_leak",      "action": "scale_service",       "priority": 2, "estimated_time_mins": 3.0},
    {"alert_type": "high_memory",      "action": "restart_service",    "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "high_memory",      "action": "scale_service",       "priority": 2, "estimated_time_mins": 3.0},
    {"alert_type": "high_latency",     "action": "scale_service",       "priority": 1, "estimated_time_mins": 3.0},
    {"alert_type": "high_latency",     "action": "switch_to_fallback",  "priority": 2, "estimated_time_mins": 1.5},
    {"alert_type": "high_error_rate",  "action": "switch_to_fallback",  "priority": 1, "estimated_time_mins": 1.0},
    {"alert_type": "high_error_rate",  "action": "restart_service",    "priority": 2, "estimated_time_mins": 2.0},
    {"alert_type": "network_timeout",  "action": "switch_to_fallback",  "priority": 1, "estimated_time_mins": 1.0},
    {"alert_type": "network_timeout",  "action": "restart_service",    "priority": 2, "estimated_time_mins": 2.0},
    {"alert_type": "db_connection",    "action": "restart_service",    "priority": 1, "estimated_time_mins": 3.0},
    {"alert_type": "db_connection",    "action": "scale_service",       "priority": 2, "estimated_time_mins": 4.0},
    {"alert_type": "db_slow_query",    "action": "restart_service",    "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "db_slow_query",    "action": "cleanup_logs",        "priority": 2, "estimated_time_mins": 3.0},
    {"alert_type": "queue_backlog",    "action": "scale_service",       "priority": 1, "estimated_time_mins": 3.5},
    {"alert_type": "queue_backlog",    "action": "restart_service",    "priority": 2, "estimated_time_mins": 2.0},
    {"alert_type": "ssl_expiry",       "action": "escalate",            "priority": 0, "estimated_time_mins": 0.5},
    {"alert_type": "certificate_expiry","action": "escalate",           "priority": 0, "estimated_time_mins": 0.5},
    {"alert_type": "auth_failure",     "action": "escalate",            "priority": 0, "estimated_time_mins": 0.5},
    {"alert_type": "auth_failure",     "action": "restart_service",    "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "oom_kill",         "action": "restart_service",    "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "oom_kill",         "action": "scale_service",       "priority": 2, "estimated_time_mins": 3.5},
    {"alert_type": "crash_loop",       "action": "restart_service",    "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "crash_loop",       "action": "escalate",            "priority": 2, "estimated_time_mins": 0.5},
    {"alert_type": "pod_eviction",     "action": "scale_service",       "priority": 1, "estimated_time_mins": 3.0},
    {"alert_type": "pod_eviction",     "action": "restart_service",    "priority": 2, "estimated_time_mins": 2.0},
    {"alert_type": "health_check_fail","action": "restart_and_notify",  "priority": 1, "estimated_time_mins": 3.0},
    {"alert_type": "health_check_fail","action": "switch_to_fallback",  "priority": 2, "estimated_time_mins": 1.5},
    {"alert_type": "rate_limit",       "action": "scale_service",       "priority": 1, "estimated_time_mins": 3.0},
    {"alert_type": "rate_limit",       "action": "switch_to_fallback",  "priority": 2, "estimated_time_mins": 1.0},
    {"alert_type": "dependency_down",  "action": "switch_to_fallback",  "priority": 1, "estimated_time_mins": 1.5},
    {"alert_type": "dependency_down",  "action": "restart_and_notify",  "priority": 2, "estimated_time_mins": 3.0},
    # predictive alerts map to pre-emptive scale/restart
    {"alert_type": "predictive_high_cpu",   "action": "scale_service",        "priority": 1, "estimated_time_mins": 3.0},
    {"alert_type": "predictive_disk_full",  "action": "cleanup_logs",          "priority": 1, "estimated_time_mins": 4.0},
    {"alert_type": "predictive_api_failure","action": "switch_to_fallback",    "priority": 1, "estimated_time_mins": 1.0},
]


DEFAULT_HISTORY = [
    {"incident_id": "hist-001", "alert_type": "high_cpu",    "action_taken": "restart_service",   "status": "resolved",  "service": "checkout"},
    {"incident_id": "hist-002", "alert_type": "high_cpu",    "action_taken": "restart_service",   "status": "resolved",  "service": "checkout"},
    {"incident_id": "hist-003", "alert_type": "disk_full",   "action_taken": "cleanup_logs",      "status": "resolved",  "service": "payment"},
    {"incident_id": "hist-004", "alert_type": "api_failure", "action_taken": "switch_to_fallback","status": "resolved",  "service": "auth"},
    {"incident_id": "hist-005", "alert_type": "high_latency","action_taken": "scale_service",     "status": "resolved",  "service": "checkout"},
    {"incident_id": "hist-006", "alert_type": "memory_leak", "action_taken": "restart_service",   "status": "resolved",  "service": "inventory"},
    {"incident_id": "hist-007", "alert_type": "service_down","action_taken": "restart_and_notify","status": "escalated", "service": "payment"},
]


DEFAULT_SERVICE_STATE = {
    "checkout":  {"cpu_pct": 42, "disk_pct": 56, "error_rate": 0.012, "health": "healthy", "traffic_level": "normal"},
    "payment":   {"cpu_pct": 35, "disk_pct": 61, "error_rate": 0.008, "health": "healthy", "traffic_level": "normal"},
    "auth":      {"cpu_pct": 28, "disk_pct": 44, "error_rate": 0.005, "health": "healthy", "traffic_level": "normal"},
    "inventory": {"cpu_pct": 55, "disk_pct": 72, "error_rate": 0.020, "health": "healthy", "traffic_level": "elevated"},
    "gateway":   {"cpu_pct": 38, "disk_pct": 40, "error_rate": 0.003, "health": "healthy", "traffic_level": "normal"},
}


class Storage:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.database_url = os.getenv("DATABASE_URL", "")
        self._pg_ready = False

        self.alerts: List[Dict] = []
        self.incidents: List[Dict] = []
        self.workflows: List[Dict] = list(DEFAULT_WORKFLOWS)
        self.history: List[Dict] = list(DEFAULT_HISTORY)
        self.action_metrics: Dict[str, Any] = {}
        self.learning_updates: List[Dict] = []
        self.audit_events: List[Dict] = []
        self.overrides: List[Dict] = []
        self.hallucination_events: List[Dict] = []
        self.service_state: Dict[str, Dict] = {k: dict(v) for k, v in DEFAULT_SERVICE_STATE.items()}

        self._load_state()
        self._ensure_postgres()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _metric_key(self, alert_type: str, action: str, service: str) -> str:
        return f"{alert_type}::{action}::{service}"

    def _db_connection(self):
        return psycopg.connect(self.database_url, autocommit=True)

    def _ensure_postgres(self):
        """
        Connect to Postgres and create tables if they don't exist.
        When _pg_ready=True, write operations dual-write to both
        Postgres (durable, ACID) and JSON (local fallback).
        """
        if not self.database_url or not psycopg:
            self._pg_ready = False
            return
        try:
            with self._db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    # Create tables — idempotent
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS incidents (
                            incident_id  TEXT PRIMARY KEY,
                            data         JSONB        NOT NULL,
                            updated_at   TIMESTAMPTZ  DEFAULT NOW()
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS alerts (
                            alert_id     TEXT PRIMARY KEY,
                            data         JSONB        NOT NULL,
                            created_at   TIMESTAMPTZ  DEFAULT NOW()
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS action_metrics (
                            metric_key   TEXT PRIMARY KEY,
                            data         JSONB        NOT NULL,
                            updated_at   TIMESTAMPTZ  DEFAULT NOW()
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS service_state (
                            service      TEXT PRIMARY KEY,
                            data         JSONB        NOT NULL,
                            updated_at   TIMESTAMPTZ  DEFAULT NOW()
                        )
                    """)
            self._pg_ready = True
            print("[Postgres] Connected and tables verified.")
        except Exception as exc:
            print(f"[Postgres] Connection unavailable: {exc}")
            self._pg_ready = False

    # ------------------------------------------------------------------
    # Postgres write helpers — each is fire-and-forget safe
    # (failures are logged but never crash the main path)
    # ------------------------------------------------------------------

    def _pg_upsert_incident(self, incident: Dict):
        if not self._pg_ready or not psycopg:
            return
        try:
            with self._db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO incidents (incident_id, data, updated_at)
                        VALUES (%s, %s::jsonb, NOW())
                        ON CONFLICT (incident_id) DO UPDATE
                            SET data = EXCLUDED.data, updated_at = NOW()
                        """,
                        (incident.get("incident_id"), json.dumps(incident)),
                    )
        except Exception as exc:
            print(f"[Postgres] upsert_incident failed: {exc}")

    def _pg_upsert_alert(self, alert: Dict):
        if not self._pg_ready or not psycopg:
            return
        try:
            alert_id = alert.get("alert_id") or alert.get("id") or alert.get("timestamp", "")
            with self._db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO alerts (alert_id, data, created_at)
                        VALUES (%s, %s::jsonb, NOW())
                        ON CONFLICT (alert_id) DO UPDATE
                            SET data = EXCLUDED.data
                        """,
                        (alert_id, json.dumps(alert)),
                    )
        except Exception as exc:
            print(f"[Postgres] upsert_alert failed: {exc}")

    def _pg_upsert_metric(self, key: str, metric: Dict):
        if not self._pg_ready or not psycopg:
            return
        try:
            with self._db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO action_metrics (metric_key, data, updated_at)
                        VALUES (%s, %s::jsonb, NOW())
                        ON CONFLICT (metric_key) DO UPDATE
                            SET data = EXCLUDED.data, updated_at = NOW()
                        """,
                        (key, json.dumps(metric)),
                    )
        except Exception as exc:
            print(f"[Postgres] upsert_metric failed: {exc}")

    def _pg_upsert_service_state(self, service: str, state: Dict):
        if not self._pg_ready or not psycopg:
            return
        try:
            with self._db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO service_state (service, data, updated_at)
                        VALUES (%s, %s::jsonb, NOW())
                        ON CONFLICT (service) DO UPDATE
                            SET data = EXCLUDED.data, updated_at = NOW()
                        """,
                        (service, json.dumps(state)),
                    )
        except Exception as exc:
            print(f"[Postgres] upsert_service_state failed: {exc}")

    def _load_state(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if DATA_FILE.exists():
            try:
                state = json.loads(DATA_FILE.read_text())
                self.alerts             = state.get("alerts", [])
                self.incidents          = state.get("incidents", [])
                saved_wf   = state.get("workflows", [])
                saved_keys = {(w["alert_type"], w["action"]) for w in saved_wf}
                merged     = list(saved_wf)
                for wf in DEFAULT_WORKFLOWS:
                    if (wf["alert_type"], wf["action"]) not in saved_keys:
                        merged.append(wf)
                self.workflows          = merged
                self.history            = state.get("history", list(DEFAULT_HISTORY))
                self.action_metrics     = state.get("action_metrics", {})
                self.learning_updates   = state.get("learning_updates", [])
                self.audit_events       = state.get("audit_events", [])
                self.overrides          = state.get("overrides", [])
                self.hallucination_events = state.get("hallucination_events", [])
                saved_ss = state.get("service_state", {})
                for svc, defaults in DEFAULT_SERVICE_STATE.items():
                    if svc not in saved_ss:
                        saved_ss[svc] = dict(defaults)
                self.service_state = saved_ss
            except Exception as exc:
                print(f"[Storage] Failed to load state: {exc}")

    # max items to persist per collection (prevents multi-GB JSON files)
    _MAX_ALERTS       = 500
    _MAX_INCIDENTS    = 500
    _MAX_HISTORY      = 1000
    _MAX_AUDIT        = 200
    _MAX_HALLUCINATE  = 200
    _MAX_OVERRIDES    = 100

    async def _save_async(self):
        """Asynchronous disk write that doesn't block the in-memory lock.
        Caps each list to a fixed max to keep the JSON file small and fast."""
        async with self.lock:
            snap = {
                "alerts":               self.alerts[:self._MAX_ALERTS],
                "incidents":            self.incidents[:self._MAX_INCIDENTS],
                "workflows":            list(self.workflows),
                "history":              self.history[:self._MAX_HISTORY],
                "action_metrics":       dict(self.action_metrics),
                "learning_updates":     self.learning_updates[:100],
                "audit_events":         self.audit_events[:self._MAX_AUDIT],
                "overrides":            self.overrides[:self._MAX_OVERRIDES],
                "hallucination_events": self.hallucination_events[:self._MAX_HALLUCINATE],
                "service_state":        dict(self.service_state),
            }
        def _write():
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            DATA_FILE.write_text(json.dumps(snap, indent=2))
        await asyncio.to_thread(_write)

    def _save_sync(self):
        """Synchronous file I/O - call via asyncio.to_thread() only"""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        DATA_FILE.write_text(json.dumps({
            "alerts":               self.alerts,
            "incidents":            self.incidents,
            "workflows":            self.workflows,
            "history":              self.history,
            "action_metrics":       self.action_metrics,
            "learning_updates":     self.learning_updates,
            "audit_events":         self.audit_events,
            "overrides":            self.overrides,
            "hallucination_events": self.hallucination_events,
            "service_state":        self.service_state,
        }, indent=2))

    def _save(self):
        """Backward compat for startup; use async save() in async contexts"""
        self._save_sync()

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------

    async def add_alert(self, alert: Dict, batch_mode: bool = False):
        async with self.lock:
            self.alerts.insert(0, alert)
        if not batch_mode:
            await self._save_async()
            await asyncio.to_thread(self._pg_upsert_alert, alert)

    async def get_alerts(self) -> List[Dict]:
        async with self.lock:
            return list(self.alerts)

    # ------------------------------------------------------------------
    # Incidents
    # ------------------------------------------------------------------

    async def add_incident(self, incident: Dict, batch_mode: bool = False):
        async with self.lock:
            self.incidents.insert(0, incident)
            self.history.insert(0, incident)
        if not batch_mode:
            await self._save_async()
            await asyncio.to_thread(self._pg_upsert_incident, incident)

    async def get_incidents(self) -> List[Dict]:
        async with self.lock:
            return list(self.incidents)

    async def get_incident(self, incident_id: str) -> Optional[Dict]:
        async with self.lock:
            return next((inc for inc in self.incidents if inc.get("incident_id") == incident_id), None)

    async def transition_incident(self, incident_id: str, status: str, actor: str, note: str, batch_mode: bool = False) -> Optional[Dict]:
        async with self.lock:
            incident = next((inc for inc in self.incidents if inc.get("incident_id") == incident_id), None)
            if not incident:
                return None
            incident["status"] = status
            incident.setdefault("state_history", []).append({
                "timestamp": self._now(),
                "to_status": status,
                "actor":     actor,
                "note":      note,
            })
            if status == "resolved":
                incident["resolved_at"] = self._now()
                created = incident.get("created_at")
                if isinstance(created, str):
                    try:
                        created_dt  = datetime.fromisoformat(created.replace("Z", "+00:00"))
                        resolved_dt = datetime.fromisoformat(incident["resolved_at"].replace("Z", "+00:00"))
                        incident["duration_mins"] = round((resolved_dt - created_dt).total_seconds() / 60, 2)
                    except Exception:
                        pass
            inc_copy = dict(incident)
        if not batch_mode:
            await self._save_async()
            await asyncio.to_thread(self._pg_upsert_incident, inc_copy)
        return inc_copy

    # ------------------------------------------------------------------
    # Workflows
    # ------------------------------------------------------------------

    async def get_workflows(self) -> List[Dict]:
        async with self.lock:
            return list(self.workflows)

    async def add_workflow(self, workflow: Dict) -> Dict:
        needs_save = False
        async with self.lock:
            exists = any(
                w["alert_type"] == workflow["alert_type"] and w["action"] == workflow["action"]
                for w in self.workflows
            )
            if not exists:
                workflow.setdefault("priority", 1)
                workflow.setdefault("estimated_time_mins", 2.0)
                self.workflows.append(workflow)
                needs_save = True
        if needs_save:
            await self._save_async()
        return workflow

    async def get_actions_for_alert(self, alert_type: str) -> List[str]:
        async with self.lock:
            return list({w["action"] for w in self.workflows if w["alert_type"] == alert_type})

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    async def get_history(self) -> List[Dict]:
        async with self.lock:
            return list(self.history)

    # ------------------------------------------------------------------
    # Service state
    # ------------------------------------------------------------------

    async def get_service_state(self, service: str) -> Dict:
        needs_save = False
        async with self.lock:
            if service not in self.service_state:
                self.service_state[service] = {
                    "cpu_pct": 0, "disk_pct": 0, "error_rate": 0,
                    "health": "unknown", "traffic_level": "normal",
                }
                needs_save = True
            state = dict(self.service_state[service])
        if needs_save:
            await self._save_async()
        return state

    async def list_service_state(self) -> Dict[str, Dict]:
        async with self.lock:
            return {k: dict(v) for k, v in self.service_state.items()}

    async def update_service_state(self, service: str, patch: Dict[str, Any], reason: str = ""):
        async with self.lock:
            state = self.service_state.setdefault(service, {})
            state.update(patch)
            if reason:
                state["last_update_reason"] = reason
            state_copy = dict(state)
        await self._save_async()
        await asyncio.to_thread(self._pg_upsert_service_state, service, state_copy)

    # ------------------------------------------------------------------
    # Overrides / Audit / Hallucination
    # ------------------------------------------------------------------

    async def add_override(self, event: Dict):
        async with self.lock:
            event.setdefault("timestamp", self._now())
            self.overrides.insert(0, event)
            self.audit_events.insert(0, event)
        await self._save_async()

    async def append_audit_event(self, event: Dict):
        async with self.lock:
            event.setdefault("timestamp", self._now())
            self.audit_events.insert(0, event)
        await self._save_async()

    async def add_hallucination_event(self, event: Dict, batch_mode: bool = False):
        async with self.lock:
            event.setdefault("timestamp", self._now())
            self.hallucination_events.insert(0, event)
            self.audit_events.insert(0, event)
        if not batch_mode:
            await self._save_async()

    async def get_audit_log(self) -> List[Dict]:
        async with self.lock:
            return list(self.audit_events)

    async def get_overrides(self) -> List[Dict]:
        async with self.lock:
            return list(self.overrides)

    async def get_hallucination_events(self) -> List[Dict]:
        async with self.lock:
            return list(self.hallucination_events)

    # ------------------------------------------------------------------
    # Learning / metrics
    # ------------------------------------------------------------------

    async def get_learning_updates(self, limit: int = 25) -> List[Dict]:
        async with self.lock:
            return self.learning_updates[:limit]

    async def get_action_metrics(self) -> Dict:
        async with self.lock:
            return dict(self.action_metrics)

    def _weighted_success_rate(self, alert_type: str, action: str, service: str) -> float:
        relevant = [
            inc for inc in self.history
            if inc.get("alert_type") == alert_type
            and inc.get("action_taken") == action
            and inc.get("service") == service
        ]
        if not relevant:
            return 0.0
        total_w = success_w = 0.0
        for i, inc in enumerate(relevant[:20]):
            w = 1.0 / (i + 1)
            total_w   += w
            if inc.get("status") == "resolved":
                success_w += w
        return round(success_w / total_w, 4) if total_w else 0.0

    async def record_action_metric(
        self,
        alert_type: str,
        action: str,
        success: bool,
        incident_id: str = "",
        service: str = "",
    ) -> Dict:
        async with self.lock:
            key    = self._metric_key(alert_type, action, service)
            metric = self.action_metrics.setdefault(key, {
                "alert_type":    alert_type,
                "action":        action,
                "service":       service,
                "total_runs":    0,
                "success_count": 0,
                "success_rate":  0.0,
            })
            metric["total_runs"] += 1
            if success:
                metric["success_count"] += 1
            metric["success_rate"] = self._weighted_success_rate(alert_type, action, service)

            self.learning_updates.insert(0, {
                "timestamp":    self._now(),
                "alert_type":   alert_type,
                "action":       action,
                "service":      service,
                "success_rate": metric["success_rate"],
                "outcome":      "resolved" if success else "failed",
            })
            self.learning_updates = self.learning_updates[:100]

            try:
                from memory import memory_store
                await memory_store.store_resolved_incident({
                    "incident_id":  incident_id,
                    "alert_type":   alert_type,
                    "action_taken": action,
                    "status":       "resolved" if success else "failed",
                    "service":      service,
                    "ai_reasoning": "auto-learned",
                })
            except Exception as e:
                print("[Storage → Memory sync failed]", e)
            metric_copy = dict(metric)

        await self._save_async()
        await asyncio.to_thread(self._pg_upsert_metric, key, metric_copy)
        return metric_copy

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    async def save(self):
        await self._save_async()

    async def flush_batch_to_postgres(self):
        """After a batch upload, snapshot data then upsert to PG outside the lock."""
        if not self._pg_ready or not psycopg:
            return
        # Snapshot quickly inside lock, then release it before doing any I/O
        async with self.lock:
            alerts_snap    = list(self.alerts[:500])
            incidents_snap = list(self.incidents[:500])

        # All Postgres I/O happens outside the lock so readers aren't blocked
        for alert in alerts_snap:
            await asyncio.to_thread(self._pg_upsert_alert, alert)
        for incident in incidents_snap:
            await asyncio.to_thread(self._pg_upsert_incident, incident)

    # ------------------------------------------------------------------
    # MTTR helper
    # ------------------------------------------------------------------

    def get_mttr(self) -> float:
        resolved = [inc for inc in self.incidents if inc.get("duration_mins")]
        if not resolved:
            return 0.0
        return round(sum(inc["duration_mins"] for inc in resolved) / len(resolved), 2)


# Global instance
store = Storage()