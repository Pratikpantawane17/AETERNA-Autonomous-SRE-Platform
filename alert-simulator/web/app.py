import asyncio
import json
from fastapi import FastAPI, BackgroundTasks, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any, List, Optional

from simulator.main import SimulatorManager
from simulator.alert_generator import AlertGenerator
from simulator.ai_generator import AIGenerator
from simulator.config import settings

app = FastAPI(title="Aeterna Alert Simulator")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static and Templates
app.mount("/static", StaticFiles(directory="web/static"), name="static")
templates = Jinja2Templates(directory="web/templates")

# Globals
simulator_manager = SimulatorManager()
generator = AlertGenerator()
ai_generator = AIGenerator()

# WebSocket connections tracking
connected_clients: List[WebSocket] = []
ai_sim_task: Optional[asyncio.Task] = None

async def broadcast_alert(alert: Dict[str, Any]):
    disconnected = []
    for client in connected_clients:
        try:
            await client.send_text(json.dumps({
                "type": "new_alert",
                "data": alert
            }))
        except WebSocketDisconnect:
            disconnected.append(client)
        except Exception as e:
            print(f"Error broadcasting to client: {e}")
            disconnected.append(client)
            
    for client in disconnected:
        if client in connected_clients:
            connected_clients.remove(client)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    try:
        while True:
            # Keep connection alive, listen for any incoming config changes if needed
            data = await websocket.receive_text()
            pass
    except WebSocketDisconnect:
        if websocket in connected_clients:
            connected_clients.remove(websocket)

@app.get("/")
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {
        "request": request,
        "services": settings.SERVICES,
        "alert_types": generator.get_alert_types(),
        "severities": list(settings.SEVERITY_WEIGHTS.keys())
    })

@app.post("/api/alerts")
async def create_alert(request: Request):
    data = await request.json()
    alert = generator.generate_single_alert(
        alert_type=data.get("type"),
        severity=data.get("severity"),
        service=data.get("service"),
        custom_metrics=data.get("metrics")
    )
    
    success = await simulator_manager.api_client.send_alert(alert)
    if success:
        await broadcast_alert(alert)
        
    return {"status": "success" if success else "failed", "alert": alert}

@app.post("/api/alerts/generate-ai")
async def generate_ai_alert(request: Request):
    data = await request.json()
    prompt = data.get("prompt")
    source = data.get("source", "direct")
    
    # Generate the nuanced alert
    alert = await ai_generator.generate_with_ai(prompt, source=source)
    
    # Send it through the normal pipe
    success = await simulator_manager.api_client.send_alert(alert)
    if success:
        await broadcast_alert(alert)
        
    return {"status": "success" if success else "failed", "alert": alert}

@app.get("/api/kill-switch")
async def get_kill_switch_status():
    return {"status": simulator_manager.api_client.kill_switch}

@app.post("/api/kill-switch")
async def toggle_kill_switch():
    new_status = simulator_manager.api_client.toggle_kill_switch()
    
    # Broadcast status change
    disconnected = []
    for client in connected_clients:
        try:
            await client.send_text(json.dumps({
                "type": "kill_switch_update",
                "data": {"status": new_status}
            }))
        except:
             disconnected.append(client)
             
    for client in disconnected:
        if client in connected_clients:
            connected_clients.remove(client)
            
    return {"status": new_status}

@app.post("/api/simulation/start")
async def start_sim(request: Request):
    data = await request.json()
    interval = data.get("interval", settings.DEFAULT_SIMULATION_INTERVAL)
    
    # ensure only one loop task exists
    if getattr(simulator_manager, "is_simulating", False) or getattr(simulator_manager, "task", None) is not None:
        return {"status": "already_started", "interval": interval}
        
    simulator_manager.interval = interval
    simulator_manager.is_simulating = True
    
    async def augmented_simulation_loop():
        while simulator_manager.is_simulating:
            if not simulator_manager.api_client.kill_switch:
                alert = simulator_manager.generator.generate_single_alert()
                success = await simulator_manager.api_client.send_alert(alert)
                if success:
                    await broadcast_alert(alert)
            await asyncio.sleep(simulator_manager.interval)
            
    simulator_manager.task = asyncio.create_task(augmented_simulation_loop())
    
    return {"status": "started", "interval": interval}

@app.post("/api/simulation/stop")
async def stop_sim():
    simulator_manager.stop_simulation()
    return {"status": "stopped"}

@app.post("/api/simulation/ai/start")
async def start_ai_sim(request: Request):
    global ai_sim_task
    data = await request.json()
    interval = data.get("interval", 60) # AI gen is slower, default higher to avoid quota 429s
    
    if ai_sim_task:
        ai_sim_task.cancel()
        
    async def ai_simulation_loop():
        import random
        while True:
            if not simulator_manager.api_client.kill_switch:
                # Use AI for generation
                alert = await ai_generator.generate_with_ai()
                success = await simulator_manager.api_client.send_alert(alert)
                if success:
                    await broadcast_alert(alert)
            # Random interval between 5 and 15 seconds
            sleep_time = random.uniform(5, 15)
            await asyncio.sleep(sleep_time)
            
    ai_sim_task = asyncio.create_task(ai_simulation_loop())
    return {"status": "started", "interval": interval}

@app.post("/api/simulation/ai/stop")
async def stop_ai_sim():
    global ai_sim_task
    if ai_sim_task:
        ai_sim_task.cancel()
        ai_sim_task = None
    return {"status": "stopped"}

@app.get("/api/status")
async def get_system_status():
    return {
        "simulating": simulator_manager.is_simulating,
        "ai_simulating": ai_sim_task is not None,
        "interval": simulator_manager.interval,
        "kill_switch": simulator_manager.api_client.kill_switch
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("web.app:app", host=settings.SIMULATOR_HOST, port=settings.SIMULATOR_PORT, reload=True)
