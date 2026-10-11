import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    import psycopg
except ImportError:
    psycopg = None

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

# Default workflows for initialization if the table is empty
DEFAULT_WORKFLOWS = [
    {"alert_type": "high_cpu",         "action": "restart_service",    "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "high_cpu",         "action": "scale_service",       "priority": 2, "estimated_time_mins": 3.0},
    {"alert_type": "crash_loop",       "action": "restart_pod",        "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "oom_kill",         "action": "restart_pod",        "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "oom_kill",         "action": "scale_up",           "priority": 2, "estimated_time_mins": 3.5},
    {"alert_type": "service_down",     "action": "restart_deployment", "priority": 1, "estimated_time_mins": 3.0},
    {"alert_type": "high_memory",      "action": "restart_pod",        "priority": 1, "estimated_time_mins": 2.0},
    {"alert_type": "high_memory",      "action": "scale_up",           "priority": 2, "estimated_time_mins": 3.0},
    {"alert_type": "pod_eviction",     "action": "scale_up",           "priority": 1, "estimated_time_mins": 3.0},
    {"alert_type": "health_check_fail","action": "restart_pod",        "priority": 1, "estimated_time_mins": 3.0},
]

class Storage:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.database_url = os.getenv("DATABASE_URL", "postgresql://aeterna:aeterna@postgres:5432/aeterna")
        self._ensure_postgres()

    def _db_connection(self):
        if not psycopg:
            raise RuntimeError("psycopg not installed")
        return psycopg.connect(self.database_url, autocommit=True)

    def _ensure_postgres(self):
        if not psycopg:
            print("[Storage] Postgres missing")
            return
        try:
            with self._db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    # Ensure base tables exist
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
                        CREATE TABLE IF NOT EXISTS workflows (
                            id            SERIAL PRIMARY KEY,
                            alert_type    TEXT NOT NULL,
                            action        TEXT NOT NULL,
                            priority      INTEGER DEFAULT 1,
                            estimated_time_mins FLOAT DEFAULT 2.0,
                            auto_inferred BOOLEAN DEFAULT FALSE,
                            UNIQUE(alert_type, action)
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
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS audit_events (
                            id            SERIAL PRIMARY KEY,
                            event_type    TEXT,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS overrides (
                            id            SERIAL PRIMARY KEY,
                            incident_id   TEXT,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS hallucination_events (
                            id            SERIAL PRIMARY KEY,
                            incident_id   TEXT,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS learning_updates (
                            id            SERIAL PRIMARY KEY,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Seed workflows if empty
                    cur.execute("SELECT COUNT(*) FROM workflows")
                    if cur.fetchone()[0] == 0:
                        for wf in DEFAULT_WORKFLOWS:
                            cur.execute(
                                """INSERT INTO workflows (alert_type, action, priority, estimated_time_mins)
                                   VALUES (%s, %s, %s, %s)""",
                                (wf["alert_type"], wf["action"], wf["priority"], wf["estimated_time_mins"])
                            )

            print("[Storage] Postgres Ready")
        except Exception as exc:
            print(f"[Storage] Connection unavailable: {exc}")

    # ------------------------------------------------------------------
    # Query helpers
    # ------------------------------------------------------------------

    async def _query_jsonb_table(self, table: str, order_col: str, limit: int = 500) -> List[Dict]:
        try:
            def _query():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(f"SELECT data FROM {table} ORDER BY {order_col} DESC LIMIT %s", (limit,))
                        return [row[0] if isinstance(row[0], dict) else json.loads(row[0]) for row in cur.fetchall()]
            return await asyncio.to_thread(_query)
        except Exception as exc:
            print(f"[Storage] Query failed for {table}: {exc}")
            return []

    # ------------------------------------------------------------------
    # Alerts
    # ------------------------------------------------------------------

    async def add_alert(self, alert: Dict, batch_mode: bool = False):
        try:
            alert_id = alert.get("alert_id") or alert.get("id") or alert.get("timestamp", "")
            def _insert():
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
            await asyncio.to_thread(_insert)
        except Exception as exc:
            print(f"[Storage] add_alert failed: {exc}")

    async def get_alerts(self) -> List[Dict]:
        return await self._query_jsonb_table("alerts", "created_at", 100)

    # ------------------------------------------------------------------
    # Incidents & History
    # ------------------------------------------------------------------

    async def add_incident(self, incident: Dict, batch_mode: bool = False):
        try:
            def _upsert():
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
            await asyncio.to_thread(_upsert)
        except Exception as exc:
            print(f"[Storage] add_incident failed: {exc}")

    async def get_incidents(self) -> List[Dict]:
        return await self._query_jsonb_table("incidents", "updated_at", 500)

    async def get_incident(self, incident_id: str) -> Optional[Dict]:
        try:
            def _query():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT data FROM incidents WHERE incident_id = %s", (incident_id,))
                        row = cur.fetchone()
                        return (row[0] if isinstance(row[0], dict) else json.loads(row[0])) if row else None
            return await asyncio.to_thread(_query)
        except Exception:
            return None

    async def transition_incident(self, incident_id: str, status: str, actor: str, note: str, batch_mode: bool = False) -> Optional[Dict]:
        async with self.lock:
            incident = await self.get_incident(incident_id)
            if not incident:
                return None
            incident["status"] = status
            incident.setdefault("state_history", []).append({
                "timestamp": _now(),
                "to_status": status,
                "actor":     actor,
                "note":      note,
            })
            if status == "resolved":
                incident["resolved_at"] = _now()
                created = incident.get("created_at")
                if isinstance(created, str):
                    try:
                        created_dt  = datetime.fromisoformat(created.replace("Z", "+00:00"))
                        resolved_dt = datetime.fromisoformat(incident["resolved_at"].replace("Z", "+00:00"))
                        incident["duration_mins"] = round((resolved_dt - created_dt).total_seconds() / 60, 2)
                    except Exception:
                        pass
            await self.add_incident(incident)
            return incident

    async def get_history(self) -> List[Dict]:
        # History is essentially all resolved incidents + historical ones
        incidents = await self.get_incidents()
        return [inc for inc in incidents if inc.get("status") == "resolved"]

    # ------------------------------------------------------------------
    # Workflows
    # ------------------------------------------------------------------

    async def get_workflows(self) -> List[Dict]:
        try:
            def _query():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT alert_type, action, priority, estimated_time_mins, auto_inferred FROM workflows")
                        return [
                            {"alert_type": r[0], "action": r[1], "priority": r[2], "estimated_time_mins": r[3], "auto_inferred": r[4]}
                            for r in cur.fetchall()
                        ]
            return await asyncio.to_thread(_query)
        except Exception:
            return []

    async def add_workflow(self, workflow: Dict) -> Dict:
        try:
            def _insert():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO workflows (alert_type, action, priority, estimated_time_mins)
                               VALUES (%s, %s, %s, %s)
                               ON CONFLICT (alert_type, action) DO UPDATE SET
                               priority = EXCLUDED.priority,
                               estimated_time_mins = EXCLUDED.estimated_time_mins""",
                            (workflow["alert_type"], workflow["action"], workflow.get("priority", 1), workflow.get("estimated_time_mins", 2.0))
                        )
            await asyncio.to_thread(_insert)
        except Exception as e:
            print(e)
        return workflow

    async def get_actions_for_alert(self, alert_type: str) -> List[str]:
        wfs = await self.get_workflows()
        return [w["action"] for w in wfs if w["alert_type"] == alert_type]

    # ------------------------------------------------------------------
    # Service state
    # ------------------------------------------------------------------

    async def get_service_state(self, service: str) -> Dict:
        try:
            def _query():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT data FROM service_state WHERE service = %s", (service,))
                        row = cur.fetchone()
                        return (row[0] if isinstance(row[0], dict) else json.loads(row[0])) if row else {
                            "cpu_pct": 0, "disk_pct": 0, "error_rate": 0, "health": "unknown", "traffic_level": "normal"
                        }
            return await asyncio.to_thread(_query)
        except Exception:
            return {}

    async def list_service_state(self) -> Dict[str, Dict]:
        try:
            def _query():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT service, data FROM service_state")
                        return {r[0]: (r[1] if isinstance(r[1], dict) else json.loads(r[1])) for r in cur.fetchall()}
            return await asyncio.to_thread(_query)
        except Exception:
            return {}

    async def update_service_state(self, service: str, patch: Dict[str, Any], reason: str = ""):
        state = await self.get_service_state(service)
        state.update(patch)
        if reason:
            state["last_update_reason"] = reason
        try:
            def _upsert():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO service_state (service, data, updated_at)
                               VALUES (%s, %s::jsonb, NOW())
                               ON CONFLICT (service) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                            (service, json.dumps(state))
                        )
            await asyncio.to_thread(_upsert)
        except Exception as exc:
            pass

    # ------------------------------------------------------------------
    # Overrides / Audit / Hallucination
    # ------------------------------------------------------------------

    async def add_override(self, event: Dict):
        event.setdefault("timestamp", _now())
        try:
            def _insert():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("INSERT INTO overrides (incident_id, data) VALUES (%s, %s::jsonb)", (event.get("incident_id"), json.dumps(event)))
                        cur.execute("INSERT INTO audit_events (event_type, data) VALUES (%s, %s::jsonb)", ("override", json.dumps(event)))
            await asyncio.to_thread(_insert)
        except Exception:
            pass

    async def append_audit_event(self, event: Dict):
        event.setdefault("timestamp", _now())
        try:
            def _insert():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("INSERT INTO audit_events (event_type, data) VALUES (%s, %s::jsonb)", (event.get("type", "general"), json.dumps(event)))
            await asyncio.to_thread(_insert)
        except Exception:
            pass

    async def add_hallucination_event(self, event: Dict, batch_mode: bool = False):
        event.setdefault("timestamp", _now())
        try:
            def _insert():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("INSERT INTO hallucination_events (incident_id, data) VALUES (%s, %s::jsonb)", (event.get("incident_id"), json.dumps(event)))
                        cur.execute("INSERT INTO audit_events (event_type, data) VALUES (%s, %s::jsonb)", ("hallucination", json.dumps(event)))
            await asyncio.to_thread(_insert)
        except Exception:
            pass

    async def get_audit_log(self) -> List[Dict]:
        return await self._query_jsonb_table("audit_events", "created_at", 200)

    async def get_overrides(self) -> List[Dict]:
        return await self._query_jsonb_table("overrides", "created_at", 100)

    async def get_hallucination_events(self) -> List[Dict]:
        return await self._query_jsonb_table("hallucination_events", "created_at", 100)

    # ------------------------------------------------------------------
    # Learning / metrics
    # ------------------------------------------------------------------

    async def get_learning_updates(self, limit: int = 25) -> List[Dict]:
        return await self._query_jsonb_table("learning_updates", "created_at", limit)

    async def get_action_metrics(self) -> Dict:
        try:
            def _query():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT metric_key, data FROM action_metrics")
                        return {r[0]: (r[1] if isinstance(r[1], dict) else json.loads(r[1])) for r in cur.fetchall()}
            return await asyncio.to_thread(_query)
        except Exception:
            return {}

    async def record_action_metric(
        self,
        alert_type: str,
        action: str,
        success: bool,
        incident_id: str = "",
        service: str = "",
    ) -> Dict:
        key = f"{alert_type}::{action}::{service}"
        metrics = await self.get_action_metrics()
        metric = metrics.get(key, {
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
        metric["success_rate"] = round(metric["success_count"] / metric["total_runs"], 4)

        try:
            def _upsert():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO action_metrics (metric_key, data, updated_at)
                               VALUES (%s, %s::jsonb, NOW())
                               ON CONFLICT (metric_key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                            (key, json.dumps(metric))
                        )
                        update = {
                            "timestamp":    _now(),
                            "alert_type":   alert_type,
                            "action":       action,
                            "service":      service,
                            "success_rate": metric["success_rate"],
                            "outcome":      "resolved" if success else "failed",
                        }
                        cur.execute("INSERT INTO learning_updates (data) VALUES (%s::jsonb)", (json.dumps(update),))
            await asyncio.to_thread(_upsert)
        except Exception:
            pass

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

        return metric

    async def flush_batch_to_postgres(self):
        # Deprecated since everything is direct to PG now
        pass

    async def save(self):
        # Deprecated
        pass

    def get_mttr(self) -> float:
        try:
            def _query():
                with self._db_connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT data->>'duration_mins' FROM incidents WHERE data->>'duration_mins' IS NOT NULL")
                        vals = [float(r[0]) for r in cur.fetchall() if r[0]]
                        if not vals:
                            return 0.0
                        return round(sum(vals) / len(vals), 2)
            # Cannot use await in sync method, so execute directly (blocking)
            # This is fine since it's an internal helper
            import psycopg
            with psycopg.connect(self.database_url, autocommit=True) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT data->>'duration_mins' FROM incidents WHERE data->>'duration_mins' IS NOT NULL")
                    vals = [float(r[0]) for r in cur.fetchall() if r[0]]
                    if not vals:
                        return 0.0
                    return round(sum(vals) / len(vals), 2)
        except Exception:
            return 0.0

store = Storage()