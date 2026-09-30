import json
import random
import uuid
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
import os

from simulator.config import settings
from simulator.metric_generator import MetricGenerator

class AlertGenerator:
    def __init__(self):
        self.metric_generator = MetricGenerator()
        self.definitions = self._load_definitions()
        
    def _load_definitions(self) -> Dict[str, Any]:
        defs_path = os.path.join(os.path.dirname(__file__), "data", "alert_definitions.json")
        try:
            with open(defs_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading alert definitions: {e}")
            return {}

    def get_alert_types(self) -> List[str]:
        return list(self.definitions.keys())

    def generate_single_alert(self, 
                              alert_type: Optional[str] = None, 
                              severity: Optional[str] = None, 
                              service: Optional[str] = None,
                              pattern: str = "random",
                              custom_metrics: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """Generates a single alert payload."""
        
        if not alert_type or alert_type not in self.definitions:
            alert_type = random.choice(list(self.definitions.keys()))
            
        if not severity:
            # Weighted random selection of severity
            severities = list(settings.SEVERITY_WEIGHTS.keys())
            weights = list(settings.SEVERITY_WEIGHTS.values())
            severity = random.choices(severities, weights=weights, k=1)[0]
            
        if not service:
            service = random.choice(settings.SERVICES)
            
        definition = self.definitions[alert_type]
        
        if custom_metrics:
            metrics = custom_metrics
        else:
            metrics = self.metric_generator.generate_metrics(alert_type, severity, definition, pattern)
            
        alert = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "alert_type": alert_type,
            "severity": severity,
            "service": service,
            "metrics": metrics,
            "status": "triggered",
            "message": f"{severity.upper()} alert: {alert_type.replace('_', ' ').title()} detected on {service}"
        }
        alert["type"] = alert_type
        
        return alert
        
    def generate_batch(self, count: int, alert_types: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        batch = []
        for _ in range(count):
            a_type = random.choice(alert_types) if alert_types else None
            batch.append(self.generate_single_alert(alert_type=a_type))
        return batch
