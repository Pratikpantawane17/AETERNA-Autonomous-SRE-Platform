"""
db.py — PostgreSQL database layer for the K8s backend.

Manages all K8s-related tables:
  - k8s_alerts:       Structured alerts from K8s observations
  - k8s_events:       Raw K8s events
  - k8s_pod_health:   Pod health snapshots
  - k8s_remediations: Remediation actions and their outcomes
  - k8s_audit_log:    Every action with evidence hash
  - users:            Authentication users
"""

import asyncio
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    import psycopg
except ImportError:
    psycopg = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class K8sDatabase:
    """PostgreSQL persistence for K8s observations and remediations."""

    def __init__(self):
        self.database_url = os.getenv("DATABASE_URL", "")
        self._ready = False
        self._ensure_tables()

    def _connection(self):
        if not psycopg:
            raise RuntimeError("psycopg not installed")
        return psycopg.connect(self.database_url, autocommit=True)

    def _ensure_tables(self):
        if not self.database_url or not psycopg:
            print("[K8sDB] No DATABASE_URL or psycopg missing — running in memory-only mode")
            return

        try:
            with self._connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")

                    # Users table
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS users (
                            id            SERIAL PRIMARY KEY,
                            username      TEXT UNIQUE NOT NULL,
                            email         TEXT UNIQUE NOT NULL,
                            password_hash TEXT NOT NULL,
                            role          TEXT DEFAULT 'operator',
                            created_at    TIMESTAMPTZ DEFAULT NOW(),
                            last_login    TIMESTAMPTZ,
                            is_active     BOOLEAN DEFAULT TRUE
                        )
                    """)

                    # K8s alerts
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS k8s_alerts (
                            id            TEXT PRIMARY KEY,
                            alert_type    TEXT NOT NULL,
                            severity      TEXT NOT NULL,
                            service       TEXT NOT NULL,
                            cluster       TEXT NOT NULL,
                            namespace     TEXT NOT NULL,
                            pod           TEXT,
                            container     TEXT,
                            evidence      TEXT,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # K8s events
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS k8s_events (
                            uid           TEXT PRIMARY KEY,
                            namespace     TEXT NOT NULL,
                            object_kind   TEXT,
                            object_name   TEXT,
                            reason        TEXT,
                            message       TEXT,
                            event_type    TEXT,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Pod health snapshots
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS k8s_pod_health (
                            id            SERIAL PRIMARY KEY,
                            pod_name      TEXT NOT NULL,
                            namespace     TEXT NOT NULL,
                            phase         TEXT,
                            restart_total INTEGER DEFAULT 0,
                            data          JSONB NOT NULL,
                            collected_at  TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Remediations
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS k8s_remediations (
                            id            SERIAL PRIMARY KEY,
                            incident_id   TEXT NOT NULL,
                            action        TEXT NOT NULL,
                            target        TEXT NOT NULL,
                            success       BOOLEAN,
                            message       TEXT,
                            pre_state     JSONB,
                            post_state    JSONB,
                            verified      BOOLEAN DEFAULT FALSE,
                            verification_detail TEXT,
                            executed_at   TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Audit log
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS k8s_audit_log (
                            id            SERIAL PRIMARY KEY,
                            incident_id   TEXT NOT NULL,
                            cluster       TEXT,
                            namespace     TEXT,
                            action        TEXT NOT NULL,
                            target        TEXT,
                            actor         TEXT NOT NULL,
                            evidence_hash TEXT,
                            result        TEXT,
                            detail        TEXT,
                            approved_by   TEXT,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Incidents (ensure main table exists)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS incidents (
                            incident_id   TEXT PRIMARY KEY,
                            data          JSONB NOT NULL,
                            updated_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Alerts (ensure main table exists)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS alerts (
                            alert_id      TEXT PRIMARY KEY,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Workflows
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

                    # Action metrics
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS action_metrics (
                            metric_key    TEXT PRIMARY KEY,
                            data          JSONB NOT NULL,
                            updated_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Service state
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS service_state (
                            service       TEXT PRIMARY KEY,
                            data          JSONB NOT NULL,
                            updated_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Audit events (general)
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS audit_events (
                            id            SERIAL PRIMARY KEY,
                            event_type    TEXT,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Overrides
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS overrides (
                            id            SERIAL PRIMARY KEY,
                            incident_id   TEXT,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Hallucination events
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS hallucination_events (
                            id            SERIAL PRIMARY KEY,
                            incident_id   TEXT,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

                    # Learning updates
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS learning_updates (
                            id            SERIAL PRIMARY KEY,
                            data          JSONB NOT NULL,
                            created_at    TIMESTAMPTZ DEFAULT NOW()
                        )
                    """)

            self._ready = True
            print("[K8sDB] All tables verified/created.")
        except Exception as exc:
            print(f"[K8sDB] Connection failed: {exc}")
            self._ready = False

    @property
    def is_ready(self) -> bool:
        return self._ready

    # ------------------------------------------------------------------
    # User operations
    # ------------------------------------------------------------------

    async def create_user(self, username: str, email: str, password_hash: str, role: str = "operator") -> Optional[Dict]:
        if not self._ready:
            return None
        try:
            def _insert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO users (username, email, password_hash, role)
                               VALUES (%s, %s, %s, %s) RETURNING id, username, email, role, created_at""",
                            (username, email, password_hash, role),
                        )
                        row = cur.fetchone()
                        if row:
                            return {"id": row[0], "username": row[1], "email": row[2], "role": row[3], "created_at": str(row[4])}
                return None
            return await asyncio.to_thread(_insert)
        except Exception as exc:
            print(f"[K8sDB] create_user failed: {exc}")
            return None

    async def get_user_by_username(self, username: str) -> Optional[Dict]:
        if not self._ready:
            return None
        try:
            def _query():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT id, username, email, password_hash, role, is_active FROM users WHERE username = %s",
                            (username,),
                        )
                        row = cur.fetchone()
                        if row:
                            return {"id": row[0], "username": row[1], "email": row[2], "password_hash": row[3], "role": row[4], "is_active": row[5]}
                return None
            return await asyncio.to_thread(_query)
        except Exception as exc:
            print(f"[K8sDB] get_user failed: {exc}")
            return None

    async def get_user_by_email(self, email: str) -> Optional[Dict]:
        if not self._ready:
            return None
        try:
            def _query():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "SELECT id, username, email, password_hash, role, is_active FROM users WHERE email = %s",
                            (email,),
                        )
                        row = cur.fetchone()
                        if row:
                            return {"id": row[0], "username": row[1], "email": row[2], "password_hash": row[3], "role": row[4], "is_active": row[5]}
                return None
            return await asyncio.to_thread(_query)
        except Exception as exc:
            print(f"[K8sDB] get_user_by_email failed: {exc}")
            return None

    async def update_last_login(self, user_id: int):
        if not self._ready:
            return
        try:
            def _update():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("UPDATE users SET last_login = NOW() WHERE id = %s", (user_id,))
            await asyncio.to_thread(_update)
        except Exception as exc:
            print(f"[K8sDB] update_last_login failed: {exc}")

    # ------------------------------------------------------------------
    # K8s alert operations
    # ------------------------------------------------------------------

    async def save_k8s_alert(self, alert_data: Dict):
        if not self._ready:
            return
        try:
            def _insert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO k8s_alerts (id, alert_type, severity, service, cluster, namespace, pod, container, evidence, data)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                               ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data""",
                            (
                                alert_data.get("id"),
                                alert_data.get("alert_type"),
                                alert_data.get("severity"),
                                alert_data.get("service"),
                                alert_data.get("cluster"),
                                alert_data.get("namespace"),
                                alert_data.get("pod"),
                                alert_data.get("container"),
                                alert_data.get("evidence", "")[:2000],
                                json.dumps(alert_data),
                            ),
                        )
            await asyncio.to_thread(_insert)
        except Exception as exc:
            print(f"[K8sDB] save_k8s_alert failed: {exc}")

    async def get_k8s_alerts(self, limit: int = 100) -> List[Dict]:
        if not self._ready:
            return []
        try:
            def _query():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT data FROM k8s_alerts ORDER BY created_at DESC LIMIT %s", (limit,))
                        return [json.loads(row[0]) if isinstance(row[0], str) else row[0] for row in cur.fetchall()]
            return await asyncio.to_thread(_query)
        except Exception as exc:
            print(f"[K8sDB] get_k8s_alerts failed: {exc}")
            return []

    # ------------------------------------------------------------------
    # Remediation operations
    # ------------------------------------------------------------------

    async def save_remediation(self, result_data: Dict):
        if not self._ready:
            return
        try:
            def _insert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO k8s_remediations (incident_id, action, target, success, message, pre_state, post_state, verified, verification_detail)
                               VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s, %s)""",
                            (
                                result_data.get("incident_id"),
                                result_data.get("action"),
                                result_data.get("target"),
                                result_data.get("success"),
                                result_data.get("message"),
                                json.dumps(result_data.get("pre_state", {})),
                                json.dumps(result_data.get("post_state", {})),
                                result_data.get("verified", False),
                                result_data.get("verification_detail", ""),
                            ),
                        )
            await asyncio.to_thread(_insert)
        except Exception as exc:
            print(f"[K8sDB] save_remediation failed: {exc}")

    # ------------------------------------------------------------------
    # Audit log
    # ------------------------------------------------------------------

    async def save_audit_record(self, record: Dict):
        if not self._ready:
            return
        try:
            def _insert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO k8s_audit_log (incident_id, cluster, namespace, action, target, actor, evidence_hash, result, detail, approved_by)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                            (
                                record.get("incident_id"),
                                record.get("cluster"),
                                record.get("namespace"),
                                record.get("action"),
                                record.get("target"),
                                record.get("actor"),
                                record.get("evidence_hash"),
                                record.get("result"),
                                record.get("detail"),
                                record.get("approved_by"),
                            ),
                        )
            await asyncio.to_thread(_insert)
        except Exception as exc:
            print(f"[K8sDB] save_audit_record failed: {exc}")

    async def get_audit_log(self, limit: int = 200) -> List[Dict]:
        if not self._ready:
            return []
        try:
            def _query():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """SELECT incident_id, cluster, namespace, action, target, actor,
                                      evidence_hash, result, detail, approved_by, created_at
                               FROM k8s_audit_log ORDER BY created_at DESC LIMIT %s""",
                            (limit,),
                        )
                        return [
                            {
                                "incident_id": r[0], "cluster": r[1], "namespace": r[2],
                                "action": r[3], "target": r[4], "actor": r[5],
                                "evidence_hash": r[6], "result": r[7], "detail": r[8],
                                "approved_by": r[9], "timestamp": str(r[10]),
                            }
                            for r in cur.fetchall()
                        ]
            return await asyncio.to_thread(_query)
        except Exception as exc:
            print(f"[K8sDB] get_audit_log failed: {exc}")
            return []

    # ------------------------------------------------------------------
    # Generic CRUD helpers for main backend
    # ------------------------------------------------------------------

    async def upsert_incident(self, incident_id: str, data: Dict):
        if not self._ready:
            return
        try:
            def _upsert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO incidents (incident_id, data, updated_at)
                               VALUES (%s, %s::jsonb, NOW())
                               ON CONFLICT (incident_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                            (incident_id, json.dumps(data)),
                        )
            await asyncio.to_thread(_upsert)
        except Exception as exc:
            print(f"[K8sDB] upsert_incident failed: {exc}")

    async def get_all_incidents(self, limit: int = 500) -> List[Dict]:
        if not self._ready:
            return []
        try:
            def _query():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute("SELECT data FROM incidents ORDER BY updated_at DESC LIMIT %s", (limit,))
                        return [json.loads(row[0]) if isinstance(row[0], str) else row[0] for row in cur.fetchall()]
            return await asyncio.to_thread(_query)
        except Exception as exc:
            print(f"[K8sDB] get_all_incidents failed: {exc}")
            return []

    async def upsert_alert(self, alert_id: str, data: Dict):
        if not self._ready:
            return
        try:
            def _upsert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO alerts (alert_id, data, created_at)
                               VALUES (%s, %s::jsonb, NOW())
                               ON CONFLICT (alert_id) DO UPDATE SET data = EXCLUDED.data""",
                            (alert_id, json.dumps(data)),
                        )
            await asyncio.to_thread(_upsert)
        except Exception as exc:
            print(f"[K8sDB] upsert_alert failed: {exc}")

    async def save_audit_event(self, event: Dict):
        if not self._ready:
            return
        try:
            def _insert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "INSERT INTO audit_events (event_type, data) VALUES (%s, %s::jsonb)",
                            (event.get("type", "general"), json.dumps(event)),
                        )
            await asyncio.to_thread(_insert)
        except Exception as exc:
            print(f"[K8sDB] save_audit_event failed: {exc}")

    async def save_override(self, override: Dict):
        if not self._ready:
            return
        try:
            def _insert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "INSERT INTO overrides (incident_id, data) VALUES (%s, %s::jsonb)",
                            (override.get("incident_id"), json.dumps(override)),
                        )
            await asyncio.to_thread(_insert)
        except Exception as exc:
            print(f"[K8sDB] save_override failed: {exc}")

    async def save_hallucination_event(self, event: Dict):
        if not self._ready:
            return
        try:
            def _insert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "INSERT INTO hallucination_events (incident_id, data) VALUES (%s, %s::jsonb)",
                            (event.get("incident_id"), json.dumps(event)),
                        )
            await asyncio.to_thread(_insert)
        except Exception as exc:
            print(f"[K8sDB] save_hallucination_event failed: {exc}")

    async def save_learning_update(self, update: Dict):
        if not self._ready:
            return
        try:
            def _insert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            "INSERT INTO learning_updates (data) VALUES (%s::jsonb)",
                            (json.dumps(update),),
                        )
            await asyncio.to_thread(_insert)
        except Exception as exc:
            print(f"[K8sDB] save_learning_update failed: {exc}")

    async def upsert_service_state(self, service: str, data: Dict):
        if not self._ready:
            return
        try:
            def _upsert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO service_state (service, data, updated_at)
                               VALUES (%s, %s::jsonb, NOW())
                               ON CONFLICT (service) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                            (service, json.dumps(data)),
                        )
            await asyncio.to_thread(_upsert)
        except Exception as exc:
            print(f"[K8sDB] upsert_service_state failed: {exc}")

    async def upsert_action_metric(self, key: str, data: Dict):
        if not self._ready:
            return
        try:
            def _upsert():
                with self._connection() as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """INSERT INTO action_metrics (metric_key, data, updated_at)
                               VALUES (%s, %s::jsonb, NOW())
                               ON CONFLICT (metric_key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
                            (key, json.dumps(data)),
                        )
            await asyncio.to_thread(_upsert)
        except Exception as exc:
            print(f"[K8sDB] upsert_action_metric failed: {exc}")


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

k8s_db = K8sDatabase()
