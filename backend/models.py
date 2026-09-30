from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
import uuid
from pydantic import BaseModel, Field

def utc_now():
    return datetime.now(timezone.utc)

class Alert(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=utc_now)

    # ── UPDATED: Explicitly includes our new Predictive Types ─────────────
    alert_type: str  # Kept flexible for LLM-inferred & Predictive types
    severity: Literal["critical", "high", "medium", "low", "info"]
    service: str
    status: Literal["new", "processing", "resolved", "escalated"] = "new"

    # enrichment layer (now includes the live metrics from our Prometheus ingestor)
    enrichment: Dict[str, Any] = Field(default_factory=dict)

class Incident(BaseModel):
    incident_id: str
    alert_id: str
    alert_type: str
    service: str
    severity: str

    # ── UPDATED: Aligns with MCP Tool Server ─────────────────────────────
    action_taken: str = ""
    mcp_tool_used: Optional[str] = None # Tracks which MCP tool actually fired
    mcp_output: Optional[str] = None    # Captures tool output: "[MCP] scale_service..."

    status: Literal[
        "detected",
        "triaged",
        "awaiting_review",
        "in_progress",
        "verifying",
        "resolved",
        "failed",
        "escalated",
    ] = "detected"

    created_at: datetime = Field(default_factory=utc_now)
    resolved_at: Optional[datetime] = None
    duration_mins: Optional[float] = None

    # ── UPDATED: Captures metrics at the exact moment the Brain decided ──
    metrics_snapshot: Dict[str, Any] = Field(default_factory=dict)

    # execution + audit trail
    execution_log: List[Dict[str, Any]] = Field(default_factory=list)
    state_history: List[Dict[str, Any]] = Field(default_factory=list)

    # ── UPDATED: Decision Intelligence ───────────────────────────────────
    ai_reasoning: str = ""
    confidence: float = 0.0
    triage_result: Dict[str, Any] = Field(default_factory=dict)
    
    # autonomy classification (AUTO, REVIEW, ESCALATE)
    autonomy_mode: Optional[str] = None 
    llm_used: bool = False

    # ── UPDATED: Closed-Loop Learning Signals ────────────────────────────
    # Stores the success_rate from Postgres at decision time
    learning_metadata: Dict[str, Any] = Field(default_factory=dict)
    is_predictive: bool = False  # True if fired by the _prediction_loop

    # reporting
    postmortem: Optional[str] = None

class WorkflowRule(BaseModel):
    alert_type: str
    action: str
    priority: int
    estimated_time_mins: float
    auto_inferred: bool = False # Tracks if the AI added this rule via learning loop

class OverrideRequest(BaseModel):
    decision: Literal["approve", "reject"]
    action: Optional[str] = None
    note: str = ""
    actor: str = "human_operator"