from fastapi import FastAPI, Request
import uvicorn
import json
from datetime import datetime

app = FastAPI(title="Aeterna Core Mock")

@app.post("/api/alerts")
async def receive_alert(request: Request):
    data = await request.json()
    print(f"[{datetime.now().isoformat()}] Received Alert: {data.get('id')} - {data.get('alert_type')} on service: {data.get('service')}")
    return {"status": "accepted", "id": data.get("id")}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
