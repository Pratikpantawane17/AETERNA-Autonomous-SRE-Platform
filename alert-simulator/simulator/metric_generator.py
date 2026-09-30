import random
from typing import Dict, List, Any

class MetricGenerator:
    def __init__(self):
        pass
        
    def generate_metrics(self, alert_type: str, severity: str, definition: Dict[str, Any], pattern: str = "random") -> Dict[str, float]:
        """Generate realistic metrics based on the alert type, severity, and requested pattern."""
        metrics = {}
        metric_names = definition.get("metrics", [])
        thresholds = definition.get("thresholds", {})
        
        # Determine the base value based on severity
        # We want the main metric to exceed the threshold for this severity
        # but not the next severity if possible.
        severity_levels = ["low", "medium", "high", "critical"]
        
        target_threshold = thresholds.get(severity, 50)
        next_severity_idx = severity_levels.index(severity) + 1 if severity in severity_levels else len(severity_levels)
        
        max_val = 100
        if next_severity_idx < len(severity_levels):
            max_val = thresholds.get(severity_levels[next_severity_idx], target_threshold * 1.5)
        else:
            max_val = target_threshold * 1.2
            
        for i, metric_name in enumerate(metric_names):
            if i == 0:
                # Primary metric: ensure it matches the severity
                if pattern == "spike":
                    val = random.uniform(target_threshold, max_val)
                elif pattern == "gradual":
                    # simulate a value that just crossed the threshold
                    val = target_threshold + random.uniform(0.1, (max_val - target_threshold) * 0.2)
                else: 
                    # fluctuating / random
                    val = random.uniform(target_threshold, max_val)
            else:
                # Secondary metrics: randomize proportionally or based on domain knowledge
                # Here we just generate random plausible numbers to give context.
                if "percent" in metric_name or "rate" in metric_name:
                    val = random.uniform(10, 100)
                elif "count" in metric_name or "affected" in metric_name or "times" in metric_name:
                    val = random.randint(1, int(target_threshold * 10))
                else:
                    val = random.uniform(1, target_threshold)
            
            # Format nicely
            metrics[metric_name] = round(val, 2)
            
        return metrics
