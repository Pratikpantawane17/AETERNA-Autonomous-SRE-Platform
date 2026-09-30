import asyncio
from simulator.alert_generator import AlertGenerator
from simulator.api_client import AeternaApiClient
import logging

class SimulatorManager:
    def __init__(self):
        self.generator = AlertGenerator()
        self.api_client = AeternaApiClient()
        self.is_simulating = False
        self.interval = 5
        self.task = None

    async def _simulation_loop(self):
        while self.is_simulating:
            if not self.api_client.kill_switch:
                alert = self.generator.generate_single_alert()
                success = await self.api_client.send_alert(alert)
                status = "sent" if success else "failed"
                alert_type = alert.get("alert_type") or alert.get("type") or "unknown"
                logging.info(f"Simulation generated alert {alert_type}: {status}")
            else:
                logging.info("Simulation paused due to kill switch.")
            await asyncio.sleep(self.interval)

    def start_simulation(self, interval: int = 5):
        if self.is_simulating:
            return False
            
        self.interval = interval
        self.is_simulating = True
        self.task = asyncio.create_task(self._simulation_loop())
        return True

    def stop_simulation(self):
        self.is_simulating = False
        if self.task:
            self.task.cancel()
            self.task = None
        return True
