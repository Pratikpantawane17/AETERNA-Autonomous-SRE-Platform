import json
import os
import re
import httpx
from typing import Any, Dict, List, Optional

from memory import memory_store
from models import Alert, Incident
from storage import store


# ---------------------------------------------------------------------------
# Action risk/cost profiles — extended to match new workflow table
# ---------------------------------------------------------------------------

ACTION_PROFILES = {
    "restart_service":    {"risk": 0.22, "cost": 0.18},
    "cleanup_logs":       {"risk": 0.12, "cost": 0.10},
    "switch_to_fallback": {"risk": 0.14, "cost": 0.16},
    "restart_and_notify": {"risk": 0.26, "cost": 0.22},
    "scale_service":      {"risk": 0.08, "cost": 0.35},
    "manual_review":      {"risk": 0.02, "cost": 0.30},
    "escalate":           {"risk": 0.03, "cost": 0.45},
}

BASE_CONFIDENCE = {
    "high_cpu":         0.83,
    "disk_full":        0.86,
    "api_failure":      0.80,
    "service_down":     0.84,
    "repeated_failure": 0.95,
    # extended types — sensible defaults
    "memory_leak":       0.80,
    "high_memory":       0.80,
    "high_latency":      0.78,
    "high_error_rate":   0.82,
    "network_timeout":   0.79,
    "db_connection":     0.77,
    "db_slow_query":     0.75,
    "queue_backlog":     0.76,
    "ssl_expiry":        0.90,
    "certificate_expiry":0.90,
    "auth_failure":      0.88,
    "oom_kill":          0.85,
    "crash_loop":        0.87,
    "pod_eviction":      0.80,
    "health_check_fail": 0.84,
    "rate_limit":        0.78,
    "dependency_down":   0.81,
    "predictive_high_cpu":   0.75,
    "predictive_disk_full":  0.72,
    "predictive_api_failure":0.70,
}

# Fallback mapping: for truly unknown alert types, infer the best generic action
_UNKNOWN_ACTION_HEURISTIC = {
    # keyword → action
    "cpu":      "restart_service",
    "memory":   "restart_service",
    "disk":     "cleanup_logs",
    "error":    "switch_to_fallback",
    "api":      "switch_to_fallback",
    "network":  "switch_to_fallback",
    "down":     "restart_and_notify",
    "fail":     "restart_service",
    "crash":    "restart_service",
    "queue":    "scale_service",
    "latency":  "scale_service",
    "load":     "scale_service",
    "auth":     "escalate",
    "cert":     "escalate",
    "ssl":      "escalate",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _call_groq(prompt: str, timeout: float = 12.0) -> Optional[str]:
    """Fallback handler for Groq AI using OpenAI-compatible API."""
    groq_key = os.getenv("GROQ_API_KEY")
    groq_url = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    if not groq_key: 
        return None
    try:
        model = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.post(
                f"{groq_url}/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}"},
                json={
                    "model": model, 
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1
                }
            )
            res.raise_for_status()
            return res.json()['choices'][0]['message']['content']
    except Exception as e:
        print(f"[LLM] Groq fallback failed: {e}")
        return None

def _extract_json(text: str) -> Dict[str, Any]:
    try:
        match = re.search(r"(\{.*\})", text, re.DOTALL)
        if match:
            return json.loads(match.group(1))
        return json.loads(text)
    except Exception:
        return {}


async def _gemini_post(payload: Dict[str, Any], timeout: float = 10.0) -> Optional[Dict[str, Any]]:
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    original_prompt = payload["contents"][0]["parts"][0]["text"]
    
    # 1. Immediate fallback if Gemini key is missing
    if not gemini_key:
        print("[LLM] Gemini key missing. Rerouting to Groq...")
        groq_res = await _call_groq(original_prompt)
        return {"candidates": [{"content": {"parts": [{"text": groq_res}]}}]} if groq_res else None

    model = os.getenv("GEMINI_API_MODEL", "gemini-2.0-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_key}"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5.0), follow_redirects=True) as client:
            res = await client.post(url, json=payload)
            res.raise_for_status()
            return res.json()
    except Exception as exc:
        # Fallback to Groq for ANY Gemini failure (Quota, Overloaded, Invalid Key, Network, etc.)
        print(f"[LLM] Gemini failure: {exc}. Rerouting to Groq...")
        groq_res = await _call_groq(original_prompt)
        if groq_res:
            return {
                "candidates": [{"content": {"parts": [{"text": groq_res}]}}],
                "provider": "groq"
            }
        
        print(f"[LLM] Groq fallback also failed.")
        return None


async def _ask_llm(alert_type: str, service: str, action: str, context: str) -> Optional[Dict[str, Any]]:
    """Call Gemini for a confidence adjustment on the chosen action."""
    prompt = f"""You are an AIOps decision assistant.

Alert: {alert_type}
Service: {service}
Proposed action: {action}
Context: {context}

Return ONLY valid JSON (no markdown, no extra text).
Format:
{{"confidence_adjustment": 0.0, "reasoning": "one short sentence"}}
"""
    payload = {"contents": [{"parts": [{"text": prompt}]}]}
    data = await _gemini_post(payload, timeout=6.0)
    if not data:
        return None

    try:
        raw = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = _extract_json(raw)
        if parsed:
            parsed["provider"] = data.get("provider", "gemini")
            return parsed
    except Exception as e:
        print("[LLM] _ask_llm parse error:", e)
    return None


async def _ask_llm_text(prompt: str) -> Optional[str]:
    """Call Gemini for a free-text response (postmortem, unknown-action inference)."""
    payload = {"contents": [{"parts": [{"text": prompt}]}]}
    data = await _gemini_post(payload, timeout=10.0)
    if not data:
        return None

    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        print("[LLM] _ask_llm_text parse error:", e)
    return None


async def _infer_actions_for_unknown_alert(alert_type: str, service: str, enrichment: Dict) -> List[str]:
    """
    For alert types not in the workflow table, infer candidate actions via:
      1. LLM  (if API key present)
      2. Keyword heuristic fallback
    Registers the inferred action back into the workflow table for future use.
    """
    # ── Try LLM first ────────────────────────────────────────────────────────
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    actions_from_llm: List[str] = []
    if gemini_key:
        valid_actions = list(ACTION_PROFILES.keys())
        prompt = f"""You are an AIOps action recommender.

Alert type: {alert_type}
Service: {service}
Enrichment context: {json.dumps(enrichment)}
Valid actions: {valid_actions}

Choose 1-2 of the valid actions that best resolve this alert type.
Return ONLY valid JSON (no markdown):
{{"actions": ["<action1>", "<action2>"], "reasoning": "<one sentence>"}}"""

        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                res = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={gemini_key}",
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                )
                data = res.json()
                raw = data["candidates"][0]["content"]["parts"][0]["text"]
                payload = _extract_json(raw)
                if payload and "actions" in payload:
                    actions_from_llm = [
                        a for a in payload["actions"] if a in ACTION_PROFILES
                    ]
                    print(f"[AI] LLM inferred actions for '{alert_type}': {actions_from_llm}")
        except Exception as e:
            print("[LLM] _infer_actions error:", e)

    if actions_from_llm:
        inferred = actions_from_llm
    else:
        # ── Keyword heuristic fallback ────────────────────────────────────────
        alert_lower = alert_type.lower()
        inferred = []
        for keyword, action in _UNKNOWN_ACTION_HEURISTIC.items():
            if keyword in alert_lower and action not in inferred:
                inferred.append(action)
        if not inferred:
            inferred = ["escalate"]

    # Register new alert_type → action mappings so future calls find them
    for action in inferred:
        await store.add_workflow({
            "alert_type": alert_type,
            "action": action,
            "priority": 1,
            "estimated_time_mins": 2.0,
            "auto_inferred": True,
        })

    return inferred


# ---------------------------------------------------------------------------
# Agent classes
# ---------------------------------------------------------------------------

class Sentinel:
    async def run(self, alert: Alert) -> Dict[str, Any]:
        enrichment = alert.enrichment

        if enrichment.get("recursive_failure"):
            return {
                "recommended_action": "escalate",
                "confidence": 1.0,
                "reasoning": "Recursive failure detected — auto-escalating",
                "similar_count": 0,
                "top_past_resolutions": [],
            }

        similar = await memory_store.query_similar(alert.alert_type, alert.service, limit=3)
        return {
            "top_past_resolutions": similar,
            "similar_count": len(similar),
        }


class Strategist:

    def _similarity_score(self, action: str, similar: List[Dict[str, Any]]) -> float:
        if not similar:
            return 0.5
        success = sum(
            1 for inc in similar
            if inc.get("action_taken") == action and inc.get("status") == "resolved"
        )
        return round(0.5 + (success / len(similar)) * 0.5, 3)

    async def run(self, alert: Alert, sentinel_output: Dict[str, Any], skip_llm: bool = False) -> Dict[str, Any]:
        enrichment = alert.enrichment
        similar    = sentinel_output.get("top_past_resolutions", [])
        chain: List[str] = []

        # ── 1. Resolve candidate actions ─────────────────────────────────────
        workflows = await store.get_workflows()
        candidate_actions = list({
            wf["action"]
            for wf in workflows
            if wf["alert_type"] == alert.alert_type
        })

        if not candidate_actions:
            # Unknown alert type — infer dynamically
            chain.append(
                f"Alert type '{alert.alert_type}' not in workflow table. "
                "Inferring actions via LLM / heuristic."
            )
            candidate_actions = await _infer_actions_for_unknown_alert(
                alert.alert_type, alert.service, enrichment
            )
            chain.append(f"Inferred candidate actions: {candidate_actions}")
        else:
            chain.append(f"Candidate actions for '{alert.alert_type}': {', '.join(candidate_actions)}")

        # ── 2. Score all candidates ──────────────────────────────────────────
        ranked: List[Dict[str, Any]] = []

        for action in candidate_actions:
            base       = BASE_CONFIDENCE.get(alert.alert_type, 0.65)
            history    = memory_store.get_success_rate(alert.alert_type, action) or 0.5
            similarity = self._similarity_score(action, similar)
            risk       = ACTION_PROFILES.get(action, {}).get("risk", 0.15)
            cost       = ACTION_PROFILES.get(action, {}).get("cost", 0.20)

            score = (
                base       * 0.40 +
                history    * 0.25 +
                similarity * 0.15 -
                risk       * 0.08 -
                cost       * 0.05
            )

            # Context boosts
            if enrichment.get("traffic_level") == "high" and action == "scale_service":
                score += 0.07
                chain.append("Scale service boosted: traffic_level=high.")

            if enrichment.get("past_incident_count", 0) >= 3 and action == "escalate":
                score += 0.05
                chain.append("Escalate boosted: past_incident_count >= 3.")

            if memory_store.is_deprioritized(alert.alert_type, action):
                score = min(score, 0.25)
                chain.append(
                    f"'{action}' deprioritized for '{alert.alert_type}' (repeated failures)."
                )

            ranked.append({
                "action":     action,
                "score":      max(0.0, min(score, 1.0)),
                "base":       base,
                "history":    history,
                "similarity": similarity,
                "risk":       risk,
                "cost":       cost,
            })

        ranked.sort(key=lambda x: x["score"], reverse=True)
        best = ranked[0]
        action     = best["action"]
        confidence = best["score"]

        chain.append(
            f"Selected '{action}' — base={best['base']:.2f}, "
            f"history={best['history']:.2f}, similarity={best['similarity']:.2f}, "
            f"penalty={best['risk'] * 0.08 + best['cost'] * 0.05:.3f}."
        )

        # ── 3. LLM refinement ────────────────────────────────────────────────
        llm = None
        if not skip_llm:
            llm = await _ask_llm(
                alert.alert_type, alert.service, action, json.dumps(enrichment)
            )

        adj          = 0.0
        llm_reason   = "N/A (no API key or LLM call failed)"
        llm_provider = "none"

        if llm:
            llm_provider = llm.get("provider", "unknown")
            adj          = max(-0.2, min(0.2, float(llm.get("confidence_adjustment", 0))))
            confidence   = max(0.0, min(1.0, confidence + adj * 1.0))  # full weight, not dampened
            llm_reason   = llm.get("reasoning", "")
            chain.append(f"LLM({llm_provider}) adjusted confidence by {adj:+.2f}: {llm_reason}")
        else:
            chain.append("LLM unavailable — using hybrid score only.")

        # ── 4. Structured explanation ────────────────────────────────────────
        reasoning = (
            f"For '{alert.alert_type}' on '{alert.service}', "
            f"'{action}' selected. "
            f"Base={best['base']:.2f}, History(success_rate)={best['history']:.2f}, "
            f"Similarity={best['similarity']:.2f}, "
            f"Risk={best['risk']:.2f}, Cost={best['cost']:.2f}. "
            f"LLM({llm_provider}) delta={adj:+.2f}. {llm_reason}"
        )

        # Structured why-block (shown in Explainability Panel)
        why = {
            "alert_type":        alert.alert_type,
            "service":           alert.service,
            "base_confidence":   best["base"],
            "historical_success":best["history"],
            "similarity_score":  best["similarity"],
            "risk_penalty":      round(best["risk"] * 0.08, 3),
            "cost_penalty":      round(best["cost"] * 0.05, 3),
            "llm_adjustment":    adj,
            "llm_provider":      llm_provider,
            "final_confidence":  round(confidence, 3),
            "similar_incidents": len(similar),
            "alternatives":      [{"action": r["action"], "score": round(r["score"], 3)} for r in ranked[1:3]],
        }

        return {
            "action":                    action,
            "confidence":                round(confidence, 3),
            "reasoning":                 reasoning,
            "why":                       why,
            "alternatives":              ranked[1:3],
            "llm_provider":              llm_provider,
            "llm_confidence_adjustment": adj,
            "chain_of_thought":          chain,
        }


class Validator:

    async def run(self, alert: Alert, strategist_output: Dict[str, Any]) -> Dict[str, Any]:
        conf   = strategist_output["confidence"]
        action = strategist_output["action"]

        if conf >= 0.85:
            return {
                "mode":          "AUTO",
                "autonomy_mode": "AUTO",
                "final_action":  action,
                "status":        "AUTO_APPROVED",
                "reason":        f"High confidence ({conf:.0%}) — executing automatically.",
            }
        elif conf >= 0.60:
            return {
                "mode":          "REVIEW",
                "autonomy_mode": "REVIEW",
                "final_action":  "manual_review",
                "status":        "HUMAN_REVIEW",
                "reason":        f"Medium confidence ({conf:.0%}) — routing to Human Override Panel.",
            }
        else:
            return {
                "mode":          "ESCALATE",
                "autonomy_mode": "ESCALATE",
                "final_action":  "escalate",
                "status":        "ESCALATED",
                "reason":        f"Low confidence ({conf:.0%}) — auto-escalating.",
            }


class AeternaBrain:

    def __init__(self):
        self.sentinel   = Sentinel()
        self.strategist = Strategist()
        self.validator  = Validator()

    async def triage(self, alert: Alert, incident: Incident, skip_llm: bool = False) -> Dict[str, Any]:
        s  = await self.sentinel.run(alert)
        st = await self.strategist.run(alert, s, skip_llm=skip_llm)
        v  = await self.validator.run(alert, st)

        llm_provider = st.get("llm_provider", "none")
        confidence_adj = st.get("llm_confidence_adjustment", 0.0)

        return {
            "final_action":              v["final_action"],
            "confidence":                st["confidence"],
            "mode":                      v["mode"],
            "reasoning":                 st["reasoning"],
            "why":                       st.get("why", {}),
            "alternatives":              st["alternatives"],
            "llm_provider":              llm_provider,
            "llm_confidence_adjustment": confidence_adj,
            "chain_of_thought":          st.get("chain_of_thought", []),
            "sentinel":                  s,
            "strategist": {
                "action":                    st["action"],
                "confidence":                st["confidence"],
                "reasoning":                 st["reasoning"],
                "why":                       st.get("why", {}),
                "alternatives":              st["alternatives"],
                "llm_provider":              llm_provider,
                "llm_confidence_adjustment": confidence_adj,
                "chain_of_thought":          st.get("chain_of_thought", []),
            },
            "validator": v,
        }


brain = AeternaBrain()


# ---------------------------------------------------------------------------
# Postmortem generator
# ---------------------------------------------------------------------------

async def generate_postmortem(incident: Dict[str, Any]) -> str:
    try:
        alert_type    = incident.get("alert_type", "unknown")
        service       = incident.get("service", "unknown")
        action_taken  = incident.get("action_taken", "unknown")
        status        = incident.get("status", "unknown")
        duration_mins = incident.get("duration_mins", 0)
        confidence    = incident.get("confidence", 0)
        reasoning     = incident.get("ai_reasoning", "")
        why           = incident.get("triage_result", {}).get("why", {})
        execution_log = incident.get("execution_log", [])

        base_summary = (
            f"## Incident Postmortem\n\n"
            f"**Alert Type:** {alert_type}\n"
            f"**Service:** {service}\n"
            f"**Status:** {status}\n"
            f"**Duration:** {duration_mins:.1f} minutes\n"
            f"**Action Taken:** {action_taken}\n"
            f"**AI Confidence:** {confidence:.1%}\n\n"
            f"### AI Reasoning\n{reasoning}\n\n"
        )

        if why:
            base_summary += (
                f"### Decision Factors\n"
                f"- Base confidence: {why.get('base_confidence', 0):.0%}\n"
                f"- Historical success rate: {why.get('historical_success', 0):.0%}\n"
                f"- Similarity score: {why.get('similarity_score', 0):.0%}\n"
                f"- LLM adjustment: {why.get('llm_adjustment', 0):+.2f} ({why.get('llm_provider', 'none')})\n"
                f"- Similar past incidents: {why.get('similar_incidents', 0)}\n\n"
            )

        if execution_log:
            base_summary += "### Execution Log\n"
            for entry in execution_log:
                base_summary += f"- {entry.get('step', '?')}: {entry.get('status', '?')}\n"
            base_summary += "\n"

        base_summary += (
            f"### Recommendations\n"
            f"- Review action '{action_taken}' effectiveness for '{alert_type}' alerts.\n"
            f"- Consider preventive measures for '{service}' service.\n"
        )

        llm_prompt = (
            "You are a cloud operations postmortem assistant. "
            "Generate a concise, human-readable markdown postmortem based on the incident details below. "
            "Focus on: root cause, resolution rationale, and 2-3 concrete next-step recommendations. "
            "Do NOT invent details beyond what is provided.\n\n"
            f"Incident Summary:\n{base_summary}\n"
            f"Triage Details:\n{json.dumps(incident.get('triage_result', {}), indent=2)}\n"
            "Return only valid markdown."
        )

        llm_text = await _ask_llm_text(llm_prompt)
        if llm_text:
            return llm_text.strip()

        return base_summary

    except Exception as exc:
        return f"Failed to generate postmortem: {str(exc)}"