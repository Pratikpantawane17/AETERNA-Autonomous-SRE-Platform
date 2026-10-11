"""
AETERNA Sample Application — A simple web app for Kubernetes deployment.

This app is designed to be deployed into a K8s cluster so AETERNA
can monitor it, detect issues, and remediate them automatically.

Features:
  - Login / Signup pages
  - Health endpoint (can be stressed)
  - CPU-intensive endpoint (for load testing)
  - Memory-consuming endpoint (for OOM testing)
  - Configurable failure modes
"""

import hashlib
import os
import random
import time
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

app = FastAPI(title="AETERNA Sample App")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory user store (simple, for demo purposes)
_users: Dict[str, Dict] = {}
_sessions: Dict[str, str] = {}
_memory_hog: List[bytes] = []
_request_count = 0
_error_rate = float(os.getenv("ERROR_RATE", "0.0"))
_slow_mode = os.getenv("SLOW_MODE", "false").lower() == "true"
start_time = time.time()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SignupRequest(BaseModel):
    username: str
    password: str
    email: str = ""


class LoginRequest(BaseModel):
    username: str
    password: str


# ---------------------------------------------------------------------------
# HTML pages
# ---------------------------------------------------------------------------

MAIN_PAGE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AETERNA Sample App</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
            color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        }
        .container {
            background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px; padding: 40px; max-width: 460px; width: 100%;
            backdrop-filter: blur(10px); box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        h1 { font-size: 1.8rem; margin-bottom: 8px; background: linear-gradient(90deg, #00d2ff, #7b2ff7);
             -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        p.sub { color: #999; margin-bottom: 24px; font-size: 0.9rem; }
        .tabs { display: flex; gap: 8px; margin-bottom: 24px; }
        .tab { flex:1; padding: 10px; text-align: center; border-radius: 8px; cursor: pointer;
               background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
               color: #999; transition: all 0.3s; }
        .tab.active { background: rgba(123,47,247,0.2); border-color: #7b2ff7; color: #fff; }
        input {
            width: 100%; padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15);
            background: rgba(255,255,255,0.05); color: #fff; margin-bottom: 12px; font-size: 0.95rem;
            outline: none; transition: border-color 0.3s;
        }
        input:focus { border-color: #7b2ff7; }
        button {
            width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 1rem;
            font-weight: 600; cursor: pointer; transition: all 0.3s;
            background: linear-gradient(135deg, #7b2ff7, #00d2ff); color: #fff;
        }
        button:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(123,47,247,0.4); }
        .msg { text-align: center; margin-top: 16px; font-size: 0.9rem; min-height: 24px; }
        .msg.ok { color: #4ade80; }
        .msg.err { color: #f87171; }
        .form-group { display: none; }
        .form-group.active { display: block; }
        .status { margin-top: 24px; padding: 16px; border-radius: 8px; background: rgba(0,0,0,0.3);
                  font-size: 0.8rem; }
        .status .label { color: #999; }
        .status .value { color: #4ade80; font-weight: 600; }
    </style>
</head>
<body>
    <div class="container">
        <h1>AETERNA Sample App</h1>
        <p class="sub">Kubernetes test workload for SRE monitoring</p>

        <div class="tabs">
            <div class="tab active" onclick="switchTab('login')">Login</div>
            <div class="tab" onclick="switchTab('signup')">Sign Up</div>
        </div>

        <div id="login-form" class="form-group active">
            <input type="text" id="login-user" placeholder="Username">
            <input type="password" id="login-pass" placeholder="Password">
            <button onclick="doLogin()">Login</button>
        </div>

        <div id="signup-form" class="form-group">
            <input type="text" id="signup-user" placeholder="Username">
            <input type="email" id="signup-email" placeholder="Email">
            <input type="password" id="signup-pass" placeholder="Password">
            <button onclick="doSignup()">Create Account</button>
        </div>

        <div class="msg" id="msg"></div>

        <div class="status">
            <div><span class="label">Pod: </span><span class="value" id="pod-name">loading...</span></div>
            <div><span class="label">Node: </span><span class="value" id="node-name">loading...</span></div>
            <div><span class="label">Uptime: </span><span class="value" id="uptime">loading...</span></div>
            <div><span class="label">Requests: </span><span class="value" id="req-count">0</span></div>
        </div>
    </div>

    <script>
        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.form-group').forEach(f => f.classList.remove('active'));
            if(tab === 'login') {
                document.querySelectorAll('.tab')[0].classList.add('active');
                document.getElementById('login-form').classList.add('active');
            } else {
                document.querySelectorAll('.tab')[1].classList.add('active');
                document.getElementById('signup-form').classList.add('active');
            }
            document.getElementById('msg').textContent = '';
        }

        async function doLogin() {
            const msg = document.getElementById('msg');
            try {
                const resp = await fetch('/api/login', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        username: document.getElementById('login-user').value,
                        password: document.getElementById('login-pass').value
                    })
                });
                const data = await resp.json();
                msg.className = resp.ok ? 'msg ok' : 'msg err';
                msg.textContent = resp.ok ? 'Login successful!' : (data.detail || 'Login failed');
            } catch(e) { msg.className = 'msg err'; msg.textContent = 'Network error'; }
        }

        async function doSignup() {
            const msg = document.getElementById('msg');
            try {
                const resp = await fetch('/api/signup', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        username: document.getElementById('signup-user').value,
                        email: document.getElementById('signup-email').value,
                        password: document.getElementById('signup-pass').value
                    })
                });
                const data = await resp.json();
                msg.className = resp.ok ? 'msg ok' : 'msg err';
                msg.textContent = resp.ok ? 'Account created!' : (data.detail || 'Signup failed');
            } catch(e) { msg.className = 'msg err'; msg.textContent = 'Network error'; }
        }

        async function updateStatus() {
            try {
                const resp = await fetch('/health');
                const data = await resp.json();
                document.getElementById('pod-name').textContent = data.pod_name || 'unknown';
                document.getElementById('node-name').textContent = data.node_name || 'unknown';
                document.getElementById('uptime').textContent = data.uptime + 's';
                document.getElementById('req-count').textContent = data.request_count;
            } catch(e) {}
        }
        setInterval(updateStatus, 5000);
        updateStatus();
    </script>
</body>
</html>
"""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def root():
    global _request_count
    _request_count += 1
    return MAIN_PAGE


@app.post("/api/signup")
async def signup(req: SignupRequest):
    global _request_count
    _request_count += 1
    if _should_fail():
        raise HTTPException(500, "Internal server error (simulated)")
    if req.username in _users:
        raise HTTPException(400, "Username already exists")
    _users[req.username] = {
        "username": req.username,
        "email": req.email,
        "password_hash": hashlib.sha256(req.password.encode()).hexdigest(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    return {"success": True, "message": "Account created"}


@app.post("/api/login")
async def login(req: LoginRequest):
    global _request_count
    _request_count += 1
    if _should_fail():
        raise HTTPException(500, "Internal server error (simulated)")
    if _slow_mode:
        time.sleep(random.uniform(1, 3))
    user = _users.get(req.username)
    if not user:
        raise HTTPException(401, "Invalid credentials")
    if user["password_hash"] != hashlib.sha256(req.password.encode()).hexdigest():
        raise HTTPException(401, "Invalid credentials")
    session_id = hashlib.sha256(f"{req.username}{time.time()}".encode()).hexdigest()[:16]
    _sessions[session_id] = req.username
    return {"success": True, "session_id": session_id}


@app.get("/health")
async def health():
    global _request_count
    _request_count += 1
    return {
        "status": "ok",
        "uptime": round(time.time() - start_time, 1),
        "request_count": _request_count,
        "pod_name": os.getenv("HOSTNAME", "unknown"),
        "node_name": os.getenv("NODE_NAME", "unknown"),
        "memory_hog_mb": len(_memory_hog) * 10,
    }


@app.get("/api/ready")
async def readiness():
    """Kubernetes readiness probe."""
    global _request_count
    _request_count += 1
    if _should_fail():
        raise HTTPException(503, "Not ready (simulated failure)")
    return {"ready": True}


@app.get("/api/live")
async def liveness():
    """Kubernetes liveness probe."""
    return {"alive": True}


# ---------------------------------------------------------------------------
# Stress endpoints (for load testing)
# ---------------------------------------------------------------------------

@app.get("/api/stress/cpu")
def stress_cpu(seconds: int = 5):
    """CPU-intensive computation for load testing."""
    global _request_count
    _request_count += 1
    end = time.time() + min(seconds, 30)  # cap at 30s
    result = 0
    while time.time() < end:
        result += sum(i * i for i in range(10000))
    return {"computed": result, "duration_seconds": seconds}


@app.get("/api/stress/memory")
async def stress_memory(mb: int = 10):
    """Allocate memory to simulate memory pressure."""
    global _request_count
    _request_count += 1
    mb = min(mb, 200)  # cap at 200MB
    _memory_hog.append(b"X" * (mb * 1024 * 1024))
    return {"allocated_mb": mb, "total_hog_mb": len(_memory_hog) * mb}


@app.post("/api/stress/clear-memory")
async def clear_memory():
    """Release hogged memory."""
    _memory_hog.clear()
    return {"cleared": True}


@app.get("/api/stress/error")
async def stress_error():
    """Always returns 500 — for error rate testing."""
    global _request_count
    _request_count += 1
    raise HTTPException(500, "Intentional error for testing")


@app.get("/api/stress/slow")
async def stress_slow(delay: float = 5.0):
    """Slow endpoint for latency testing."""
    global _request_count
    _request_count += 1
    import asyncio
    await asyncio.sleep(min(delay, 30))
    return {"delayed_seconds": delay}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _should_fail() -> bool:
    """Check if this request should fail based on configured error rate."""
    return random.random() < _error_rate


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8080"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)
