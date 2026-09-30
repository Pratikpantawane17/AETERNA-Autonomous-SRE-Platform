import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
import asyncio

try:
    import chromadb
except Exception:
    chromadb = None


# ---------------------------------------------------------------------------
# Pure-stdlib math helpers (no numpy needed)
# ---------------------------------------------------------------------------

def _linear_slope(values: List[float]) -> float:
    """Least-squares slope per sample interval. Positive = rising trend."""
    n = len(values)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    numerator   = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    return numerator / denominator if denominator else 0.0


def _mean_std(values: List[float]) -> Tuple[float, float]:
    if not values:
        return 0.0, 0.0
    mean     = sum(values) / len(values)
    variance = sum((x - mean) ** 2 for x in values) / len(values)
    return mean, math.sqrt(variance)


def _zscore(value: float, history: List[float]) -> float:
    """Z-score of value relative to history. >2 = anomaly."""
    if len(history) < 3:
        return 0.0
    mean, std = _mean_std(history)
    return (value - mean) / std if std > 0 else 0.0


def _peak_hour_sensitivity() -> float:
    """
    Return a sensitivity multiplier based on UTC hour and weekday.
    Business hours (09-18 Mon-Fri) → lower threshold (more sensitive = 0.85).
    Off-hours → normal (1.0). Weekend off-hours → less sensitive (1.15).
    """
    now     = datetime.now(timezone.utc)
    hour    = now.hour
    weekday = now.weekday()   # 0=Mon … 6=Sun
    if weekday < 5 and 9 <= hour < 18:
        return 0.85
    if weekday >= 5:
        return 1.15
    return 1.0


# ---------------------------------------------------------------------------
# Metric snapshot — rolling window per service
# ---------------------------------------------------------------------------

MAX_SNAPSHOTS = 20   # keep last 20 readings (~10 min at 30 s polling)

# Sliding window for deprioritization — only last N incidents are considered.
# This allows an action to recover its priority if it starts working again.
DEPRIORITIZE_WINDOW = 10
DEPRIORITIZE_SCORE_THRESHOLD = 4


class AeternaMemory:
    def __init__(self):
        self._incidents: List[Dict[str, Any]] = []
        self._deprioritized: Set[Tuple[str, str]] = set()
        self._chroma_collection = None
        self._metric_snapshots: Dict[str, List[Dict[str, Any]]] = {}
        import threading
        threading.Thread(target=self._init_chroma, daemon=True).start()

    # ------------------------------------------------------------------
    # ChromaDB
    # ------------------------------------------------------------------

    def _init_chroma(self):
        if chromadb is None:
            return
        try:
            print("[Memory] Initializing ChromaDB persistent client at data/chroma...")
            client = chromadb.PersistentClient(path="data/chroma")
            print("[Memory] Client initialized. Getting/creating collection 'incident_memory'...")
            self._chroma_collection = client.get_or_create_collection("incident_memory")
            print("[Memory] ChromaDB collection ready.")
        except Exception as exc:
            print(f"[Memory] Chroma unavailable, fallback active: {exc}")
            self._chroma_collection = None

    def _incident_doc(self, inc: Dict[str, Any]) -> str:
        return (
            f"alert_type={inc.get('alert_type')} "
            f"service={inc.get('service')} "
            f"action={inc.get('action_taken')} "
            f"status={inc.get('status')} "
            f"reasoning={inc.get('ai_reasoning', '')}"
        )

    # ------------------------------------------------------------------
    # Incident store
    # ------------------------------------------------------------------

    async def store_resolved_incident(self, incident: Dict[str, Any]):
        inc_dict = dict(incident)
        self._incidents.insert(0, inc_dict)
        self._evaluate_deprioritization(inc_dict)

        if self._chroma_collection:
            if not inc_dict.get("incident_id"):
                inc_dict["incident_id"] = f"mem-{__import__('uuid').uuid4().hex[:8]}"
            try:
                doc = self._incident_doc(inc_dict)
                meta = {
                    "alert_type":   inc_dict.get("alert_type", ""),
                    "service":      inc_dict.get("service", ""),
                    "action_taken": inc_dict.get("action_taken", ""),
                    "status":       inc_dict.get("status", ""),
                }
                ids = [inc_dict["incident_id"]]
                await asyncio.to_thread(
                    self._chroma_collection.upsert,
                    ids=ids,
                    documents=[doc],
                    metadatas=[meta]
                )
            except Exception as exc:
                print(f"[Memory] Chroma upsert failed: {exc}")

    def bootstrap(self, incidents: List[Dict[str, Any]]):
        self._incidents = []
        self._deprioritized.clear()
        for incident in reversed(incidents):
            inc_dict = dict(incident)
            self._incidents.insert(0, inc_dict)
            # if self._chroma_collection and inc_dict.get("incident_id"):
            #     try:
            #         # print(f"[Memory] Upserting incident {inc_dict['incident_id']} to Chroma...")
            #         self._chroma_collection.upsert(
            #             ids=[inc_dict["incident_id"]],
            #             documents=[self._incident_doc(inc_dict)],
            #             metadatas=[{
            #                 "alert_type":   inc_dict.get("alert_type", ""),
            #                 "service":      inc_dict.get("service", ""),
            #                 "action_taken": inc_dict.get("action_taken", ""),
            #                 "status":       inc_dict.get("status", ""),
            #             }],
            #         )
            #     except Exception as e:
            #         print(f"[Memory] Chroma upsert failed for {inc_dict.get('incident_id')}: {e}")
        # evaluate deprioritization once after full history is loaded
        seen = set()
        for inc in self._incidents:
            key = (inc.get("alert_type"), inc.get("action_taken"))
            if key not in seen:
                seen.add(key)
                self._evaluate_deprioritization(inc)

    # ------------------------------------------------------------------
    # Deprioritization — sliding window with recovery
    #
    # Only the last DEPRIORITIZE_WINDOW incidents for each
    # (alert_type, action) pair are considered.  This means:
    # - If the action keeps failing → deprioritized (score ≥ threshold)
    # - If the action starts working again → automatically un-deprioritized
    #   because the old failures slide out of the window.
    # ------------------------------------------------------------------

    def _evaluate_deprioritization(self, latest: Dict[str, Any]):
        alert_type = latest.get("alert_type")
        action     = latest.get("action_taken")
        if not alert_type or not action:
            return

        # Look at only the most recent DEPRIORITIZE_WINDOW incidents
        # for this specific (alert_type, action) pair
        relevant = [
            inc for inc in self._incidents
            if inc.get("alert_type") == alert_type
            and inc.get("action_taken") == action
        ][:DEPRIORITIZE_WINDOW]

        score = 0
        for inc in relevant:
            if inc.get("status") == "failed":
                score += 1
            elif inc.get("status") == "escalated":
                score += 2

        if score >= DEPRIORITIZE_SCORE_THRESHOLD:
            self._deprioritized.add((alert_type, action))
        else:
            # Automatically recover — remove from deprioritized set if
            # the recent window no longer shows persistent failure
            self._deprioritized.discard((alert_type, action))

    # ------------------------------------------------------------------
    # Similarity search
    # ------------------------------------------------------------------

    async def query_similar(self, alert_type: str, service: str, limit: int = 3) -> List[Dict[str, Any]]:
        if self._chroma_collection:
            try:
                query  = (
                    f"alert_type={alert_type} service={service} "
                    f"failure patterns resolution action performance"
                )
                result = await asyncio.to_thread(
                    self._chroma_collection.query,
                    query_texts=[query],
                    n_results=limit
                )
                ids    = set(result.get("ids", [[]])[0])
                chroma_matches = [inc for inc in self._incidents if inc.get("incident_id") in ids]
                if len(chroma_matches) >= 1:
                    return chroma_matches[:limit]
            except Exception as exc:
                print(f"[Memory] Chroma query failed: {exc}")

        # fallback — exact match
        matches = []
        for inc in self._incidents:
            if inc.get("alert_type") == alert_type and inc.get("service") == service:
                matches.append(inc)
                if len(matches) >= limit:
                    break
        return matches

    # ------------------------------------------------------------------
    # Recency-weighted success rate
    # ------------------------------------------------------------------

    def get_success_rate(self, alert_type: str, action: str) -> float:
        weighted_success = 0.0
        weighted_total   = 0.0
        for i, inc in enumerate(self._incidents):
            if inc.get("alert_type") == alert_type and inc.get("action_taken") == action:
                w = 1.0 / (i + 1)
                weighted_total += w
                if inc.get("status") == "resolved":
                    weighted_success += w
        return round(weighted_success / weighted_total, 4) if weighted_total > 0 else 0.0

    def is_deprioritized(self, alert_type: str, action: str) -> bool:
        return (alert_type, action) in self._deprioritized

    # ------------------------------------------------------------------
    # Metric snapshot ingestion (called by background poller in main.py)
    # ------------------------------------------------------------------

    def update_metric_snapshot(self, service: str, state: Dict[str, Any]):
        """Push a new service-state reading into the rolling history."""
        snapshots = self._metric_snapshots.setdefault(service, [])
        snapshots.append({
            "ts":            datetime.now(timezone.utc).isoformat(),
            "cpu_pct":       float(state.get("cpu_pct", 0)),
            "disk_pct":      float(state.get("disk_pct", 0)),
            "error_rate":    float(state.get("error_rate", 0)),
            "health":        state.get("health", "healthy"),
            "traffic_level": state.get("traffic_level", "normal"),
        })
        if len(snapshots) > MAX_SNAPSHOTS:
            self._metric_snapshots[service] = snapshots[-MAX_SNAPSHOTS:]

    # ------------------------------------------------------------------
    # Comprehensive pattern detection
    # ------------------------------------------------------------------

    def detect_patterns(self, service: str, current_state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Real pattern detection using:
          1. Linear regression slope  — rate of change
          2. Z-score anomaly          — statistical outlier vs rolling mean
          3. Multi-metric correlation — CPU + error_rate both elevated
          4. Peak-hour sensitivity    — lower threshold during business hours
          5. Velocity spike           — sudden jump between last two readings
        """
        snapshots = self._metric_snapshots.get(service, [])
        if len(snapshots) < 3:
            return None

        sensitivity = _peak_hour_sensitivity()

        cpu_vals  = [s["cpu_pct"]    for s in snapshots]
        disk_vals = [s["disk_pct"]   for s in snapshots]
        err_vals  = [s["error_rate"] for s in snapshots]

        cur_cpu  = current_state.get("cpu_pct",    cpu_vals[-1])
        cur_disk = current_state.get("disk_pct",   disk_vals[-1])
        cur_err  = current_state.get("error_rate", err_vals[-1])

        findings: List[str]          = []
        predicted_alert: Optional[str] = None
        confidence = 0.0
        eta_minutes: Optional[int]   = None

        # ── 1. CPU trend ────────────────────────────────────────────────
        cpu_slope = _linear_slope(cpu_vals)
        cpu_z     = _zscore(cur_cpu, cpu_vals[:-1])

        if cpu_slope > 1.5 * sensitivity:
            if cur_cpu < 90:
                remaining    = 90 - cur_cpu
                intervals_left = remaining / cpu_slope if cpu_slope else 99
                eta_minutes  = max(1, int(intervals_left * 0.5))
            findings.append(
                f"CPU slope={cpu_slope:.2f}%/interval, current={cur_cpu:.1f}%, "
                f"eta_breach≈{eta_minutes}min"
            )
            predicted_alert = "high_cpu"
            confidence = min(0.95, 0.65 + cpu_slope * 0.04)

        if cpu_z > 2.0 * sensitivity and not predicted_alert:
            findings.append(f"CPU z-score={cpu_z:.2f} — statistical anomaly")
            predicted_alert = "high_cpu"
            confidence = max(confidence, 0.78)

        if len(cpu_vals) >= 2 and (cpu_vals[-1] - cpu_vals[-2]) > 15 * sensitivity:
            findings.append(
                f"CPU velocity spike: +{cpu_vals[-1] - cpu_vals[-2]:.1f}% in last interval"
            )
            predicted_alert = "high_cpu"
            confidence = max(confidence, 0.85)

        # ── 2. Disk trend ────────────────────────────────────────────────
        disk_slope = _linear_slope(disk_vals)
        disk_z     = _zscore(cur_disk, disk_vals[:-1])

        if disk_slope > 0.8 * sensitivity and cur_disk > 70:
            findings.append(
                f"Disk slope={disk_slope:.2f}%/interval, current={cur_disk:.1f}%"
            )
            if not predicted_alert or confidence < 0.75:
                predicted_alert = "disk_full"
                confidence = max(confidence, min(0.90, 0.60 + disk_slope * 0.06))

        if disk_z > 2.5 * sensitivity and not predicted_alert:
            findings.append(f"Disk z-score={disk_z:.2f} — anomaly")
            predicted_alert = "disk_full"
            confidence = max(confidence, 0.72)

        # ── 3. Error-rate trend ──────────────────────────────────────────
        err_slope = _linear_slope(err_vals)
        err_z     = _zscore(cur_err, err_vals[:-1])

        if err_slope > 0.003 * sensitivity and cur_err > 0.03:
            findings.append(
                f"Error rate slope={err_slope:.4f}/interval, current={cur_err:.3f}"
            )
            if not predicted_alert or confidence < 0.75:
                predicted_alert = "api_failure"
                confidence = max(confidence, 0.80)

        if err_z > 2.0 and cur_err > 0.05 and not predicted_alert:
            findings.append(f"Error rate z-score={err_z:.2f} — anomaly, rate={cur_err:.3f}")
            predicted_alert = "api_failure"
            confidence = max(confidence, 0.75)

        # ── 4. Multi-metric correlation (compounding signal) ─────────────
        multi_flags = 0
        if cur_cpu  > 75:
            multi_flags += 1
        if cur_err  > 0.03:
            multi_flags += 1
        if cur_disk > 80:
            multi_flags += 1
        if current_state.get("health") != "healthy":
            multi_flags += 1

        if multi_flags >= 2:
            findings.append(
                f"Multi-metric correlation: {multi_flags} metrics simultaneously degraded"
            )
            confidence = min(0.98, confidence + 0.08 * multi_flags)
            if multi_flags >= 3 and not predicted_alert:
                predicted_alert = "service_down"

        # ── 5. Health-flip detection ─────────────────────────────────────
        health_vals      = [s["health"] for s in snapshots]
        unhealthy_recent = sum(1 for h in health_vals[-5:] if h != "healthy")
        if unhealthy_recent >= 2 and current_state.get("health") != "healthy":
            findings.append(f"Health degraded in {unhealthy_recent}/last-5 readings")
            if not predicted_alert:
                predicted_alert = "service_down"
                confidence = max(confidence, 0.88)

        if not predicted_alert or confidence < 0.60:
            return None

        result: Dict[str, Any] = {
            "type":                 "predictive",
            "service":              service,
            "predicted_alert":      predicted_alert,
            "confidence":           round(confidence, 3),
            "findings":             findings,
            "detection_methods":    self._methods_used(cpu_slope, cpu_z, err_z, multi_flags),
            "sensitivity_multiplier": sensitivity,
            "current_metrics": {
                "cpu_pct":    cur_cpu,
                "disk_pct":   cur_disk,
                "error_rate": cur_err,
                "health":     current_state.get("health", "unknown"),
            },
        }
        if eta_minutes is not None:
            result["eta_minutes"] = eta_minutes
            result["message"] = (
                f"{predicted_alert.replace('_', ' ').title()} predicted for '{service}'. "
                f"Threshold breach in ~{eta_minutes} min. Confidence={confidence:.0%}."
            )
        else:
            result["message"] = (
                f"{predicted_alert.replace('_', ' ').title()} predicted for '{service}'. "
                f"Confidence={confidence:.0%}. Findings: {'; '.join(findings[:2])}."
            )
        return result

    @staticmethod
    def _methods_used(cpu_slope, cpu_z, err_z, multi_flags) -> List[str]:
        m = []
        if abs(cpu_slope) > 1.0:
            m.append("linear_regression")
        if cpu_z > 1.5 or err_z > 1.5:
            m.append("zscore_anomaly")
        if multi_flags >= 2:
            m.append("multi_metric_correlation")
        m.append("seasonality_sensitivity")
        return m

    # ------------------------------------------------------------------
    # Backward-compatible single-call API (still works for /api/predict)
    # ------------------------------------------------------------------

    def generate_predictive_alert(self, service: str, metric_history: List[float]) -> Optional[Dict[str, Any]]:
        """
        Backward-compatible: accepts a list of CPU values and runs pattern detection.
        Also used by the manual /api/predict endpoint.

        Uses try/finally to guarantee the original rolling metric history
        is always restored — even if detect_patterns raises an exception.
        """
        if len(metric_history) < 3:
            return None

        synth_snapshots = [
            {"cpu_pct": v, "disk_pct": 0, "error_rate": 0,
             "health": "healthy", "traffic_level": "normal", "ts": ""}
            for v in metric_history
        ]

        saved = self._metric_snapshots.get(service, [])
        self._metric_snapshots[service] = synth_snapshots
        try:
            result = self.detect_patterns(service, {
                "cpu_pct":    metric_history[-1],
                "disk_pct":   0,
                "error_rate": 0,
                "health":     "healthy",
            })
        finally:
            # Always restore the real rolling history — even on exception
            self._metric_snapshots[service] = saved

        return result


memory_store = AeternaMemory()