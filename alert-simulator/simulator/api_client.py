import httpx
import logging
from typing import Dict, Any, List
from simulator.config import settings
import asyncio

logger = logging.getLogger(__name__)

class AeternaApiClient:
    def __init__(self):
        self.base_url = settings.AETERNA_CORE_URL
        self.headers = {"Content-Type": "application/json"}
        if settings.AETERNA_API_KEY:
            print("API KEY:", settings.AETERNA_API_KEY)
            self.headers["x-api-key"] = settings.AETERNA_API_KEY
            
        self._kill_switch_enabled = False

    @property
    def kill_switch(self):
        return self._kill_switch_enabled
        
    def toggle_kill_switch(self):
        self._kill_switch_enabled = not self._kill_switch_enabled
        return self._kill_switch_enabled

    async def send_alert(self, alert: Dict[str, Any], max_retries=3) -> bool:
        if self._kill_switch_enabled:
            logger.info("Kill switch is active. Skipping alert transmission.")
            return False
            
        url = f"{self.base_url}/api/alerts" # Correct path for ingestion
        
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient() as client:
                    # response = await client.post(url, json=alert, headers=self.headers, timeout=5.0)
                    payload = {
                        "alert_type": alert.get("alert_type") or alert.get("type"),
                        "severity": alert.get("severity"),
                        "service": alert.get("service"),
                    }
                    if "metrics" in alert:
                        payload["enrichment"] = alert["metrics"]

                    print("SENDING PAYLOAD:", payload)  # DEBUG

                    print(f"Attempting to send alert to: {url} with headers {self.headers}")
                    response = await client.post(
                        url,
                        json=payload,
                        headers=self.headers,
                        timeout=30.0
                    )       
                    if response.status_code in (200, 201, 202):
                        logger.debug(f"Successfully sent alert {alert['id']}")
                        print(f"SUCCESS: Sent alert {alert['id']}")
                        return True
                    else:
                        logger.warning(f"Failed to send alert. Status: {response.status_code}")
                        print(f"FAILED: Status {response.status_code}, Response: {response.text}")
            except httpx.RequestError as e:
                logger.error(f"Request error sending alert: {e}. Attempt {attempt + 1}/{max_retries}")
                print(f"REQUEST ERROR: {e}")
                
            # Exponential backoff
            await asyncio.sleep(2 ** attempt)
            
        return False
        
    async def send_batch(self, alerts: List[Dict[str, Any]]) -> Dict[str, int]:
        success_count = 0
        fail_count = 0
        
        # We could use `asyncio.gather` for true concurrency or sequential for rate limiting
        # Let's do sequential for safer rate handling but you can optimize this.
        for alert in alerts:
            success = await self.send_alert(alert)
            if success:
                success_count += 1
            else:
                fail_count += 1
                
        return {"success": success_count, "failed": fail_count}
