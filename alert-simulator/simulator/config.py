import os
from pathlib import Path
from typing import ClassVar, List, Dict
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

# Explicitly load .env from the root of the project
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

class Settings(BaseSettings):
    AETERNA_CORE_URL: str = os.getenv("AETERNA_CORE_URL", "http://localhost:8000")
    AETERNA_API_KEY: str = os.getenv("AETERNA_API_KEY", "")
    SIMULATOR_PORT: int = int(os.getenv("SIMULATOR_PORT", "8050"))
    SIMULATOR_HOST: str = os.getenv("SIMULATOR_HOST", "0.0.0.0")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
    DEFAULT_SIMULATION_INTERVAL: int = int(os.getenv("DEFAULT_SIMULATION_INTERVAL", "5"))
    DEFAULT_BATCH_SIZE: int = int(os.getenv("DEFAULT_BATCH_SIZE", "10"))
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")

    model_config = {
        "env_file": str(env_path),
        "env_file_encoding": "utf-8",
        "extra": "ignore"
    }
    
    SERVICES: ClassVar[List[str]] = [
        "auth-service", "user-service", "cart-service", 
        "inventory-service", "payment-service", "db-cluster",
        "redis-cache", "frontend-app", "search-service", "nlp-engine"
    ]
    
    SEVERITY_WEIGHTS: ClassVar[Dict[str, float]] = {
        "info": 0.4,
        "low": 0.3,
        "medium": 0.15,
        "high": 0.1,
        "critical": 0.05
    }

settings = Settings()