import os
import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
import google.generativeai as genai
from groq import Groq
from simulator.config import settings

logger = logging.getLogger(__name__)

class AIGenerator:
    def __init__(self):
        self.groq_key = os.getenv("GROQ_API_KEY")
        self.gemini_key = settings.GEMINI_API_KEY
        
        # Load alert definitions for better AI context
        self.definitions_path = Path(__file__).parent / "data" / "alert_definitions.json"
        try:
            with open(self.definitions_path, 'r') as f:
                self.alert_definitions = json.load(f)
            logger.info(f"Loaded {len(self.alert_definitions)} alert definitions for AI context")
        except Exception as e:
            logger.error(f"Failed to load alert definitions: {e}")
            self.alert_definitions = {}

        # Initialize Groq (Primary)
        if self.groq_key:
            try:
                self.groq_client = Groq(api_key=self.groq_key)
                logger.info("Groq AI Engine initialized (Llama3-8b)")
            except Exception as e:
                logger.error(f"Failed to init Groq: {e}")
                self.groq_client = None
        else:
            self.groq_client = None
            
        # Initialize Gemini (Secondary/Fallback)
        if self.gemini_key:
            try:
                genai.configure(api_key=self.gemini_key)
                self.gemini_model = genai.GenerativeModel('gemini-1.5-flash')
                logger.info("Gemini AI Engine initialized (Fallback)")
            except Exception as e:
                logger.error(f"Failed to init Gemini: {e}")
                self.gemini_model = None
        else:
            self.gemini_model = None

    async def generate_with_ai(self, prompt: str = None, source: str = "direct") -> Dict[str, Any]:
        alert_types = list(self.alert_definitions.keys()) if self.alert_definitions else ["high_cpu", "latency_spike", "disk_full", "auth_failure", "db_connection", "pod_crash"]
        
        system_instruction = f"""
        You are an advanced AIOps Incident Generator. 
        Create a realistic, technical IT incident in JSON format.
        
        Available alert types: {', '.join(alert_types)}
        Available services: {', '.join(settings.SERVICES)}
        
        Example JSON Output:
        {{
            "alert_type": "high_cpu",
            "severity": "critical",
            "service": "auth-service",
            "narrative": "Authentication service threads locked due to unexpected spike in JWT validation CPU usage.",
            "metrics": {{"percentage": 98.5, "cores_affected": 8, "duration_seconds": 120}}
        }}

        Schema rules:
        - "alert_type": MUST be one from the provided list string.
        - "severity": one of [low, medium, high, critical]
        - "service": MUST be a simple STRING from the provided list. Do not use objects.
        - "narrative": A technical one-sentence explanation of the root cause.
        - "metrics": A dictionary of technical metrics. Use realistic values matching the severity.
        
        ONLY output raw JSON.
        """
        
        full_prompt = prompt if prompt else "Generate a random realistic production incident. Vary the alert types and services."
        
        try:
            if self.groq_client:
                alert = await self._generate_with_groq(system_instruction, full_prompt)
            elif self.gemini_model:
                alert = await self._generate_with_gemini(system_instruction, full_prompt)
            else:
                alert = await self._mock_fallback(full_prompt)
            
            # Inject source
            if "metrics" not in alert:
                alert["metrics"] = {}
            alert["metrics"]["source"] = source
            return alert
        except Exception as e:
            logger.error(f"AI Generation failed: {e}")
            return await self._mock_fallback(full_prompt)

    async def _generate_with_groq(self, system: str, prompt: str) -> Dict[str, Any]:
        import asyncio
        def run_groq():
            return self.groq_client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
        response = await asyncio.to_thread(run_groq)
        data = json.loads(response.choices[0].message.content)
        return self._format_alert(data, "GROQ")

    async def _generate_with_gemini(self, system: str, prompt: str) -> Dict[str, Any]:
        import asyncio
        response = await asyncio.to_thread(self.gemini_model.generate_content, f"{system}\n\nScenario: {prompt}")
        text = response.text.replace("```json", "").replace("```", "").strip()
        data = json.loads(text)
        return self._format_alert(data, "GEMINI")

    def _format_alert(self, data: Dict[str, Any], engine: str) -> Dict[str, Any]:
        # Handle potential object-leak from LLM for service or alert_type
        service = data.get("service", "ai-service")
        if isinstance(service, dict):
            service = service.get("name") or service.get("id") or str(service)
            
        alert_type = data.get("alert_type", "ai_anomaly")
        if isinstance(alert_type, dict):
             alert_type = alert_type.get("name") or str(alert_type)

        alert = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "alert_type": alert_type,
            "severity": data.get("severity", "medium"),
            "service": service,
            "metrics": data.get("metrics", {}),
            "status": "triggered",
            "message": f"{engine} AI ANALYSIS: {data.get('narrative', 'Anomaly detected.')}"
        }
        logger.info(f"Generated alert via {engine}")
        return alert


    async def _mock_fallback(self, prompt: str) -> Dict[str, Any]:
        import random
        fallbacks = [
            {
                "alert_type": "high_cpu", 
                "service": "auth-service", 
                "severity": "critical",
                "narrative": "AI detected unusual CPU spike in authentication threads.",
                "metrics": {
                    "percentage": round(random.uniform(85, 99), 2),
                    "cores_affected": random.randint(4, 16)
                }
            },
            {
                "alert_type": "latency_spike", 
                "service": "payment-gateway", 
                "severity": "high",
                "narrative": "Latency threshold exceeded in regional payment processor.",
                "metrics": {
                    "latency_ms": round(random.uniform(500, 2000), 2),
                    "error_rate": round(random.uniform(5, 15), 2)
                }
            },
            {
                "alert_type": "disk_full", 
                "service": "db-cluster", 
                "severity": "high",
                "narrative": "Database cluster storage approaching capacity limits.",
                "metrics": {
                    "usage_percent": round(random.uniform(90, 98), 2),
                    "free_gb": round(random.uniform(1, 5), 2)
                }
            },
            {
                "alert_type": "info_message", 
                "service": "nlp-engine", 
                "severity": "info",
                "narrative": "Routine optimization sweep completed by Aeterna AI.",
                "metrics": {
                    "optimization_score": round(random.uniform(0.8, 1.0), 2),
                    "items_processed": random.randint(1000, 5000)
                }
            }
        ]
        
        scenario = random.choice(fallbacks)
        return {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "alert_type": scenario["alert_type"],
            "severity": scenario["severity"],
            "service": scenario["service"],
            "metrics": scenario["metrics"],
            "status": "triggered",
            "message": f"AI (SIMULATED): {scenario['narrative']}"
        }
    
    async def get_recommended_interval(self) -> int:
        return 10 if self.groq_client else 60
