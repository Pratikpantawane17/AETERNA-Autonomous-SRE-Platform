# Aeterna Alert Simulator

A complete Alert Simulator project for the Aeterna AIOps system, designed to generate realistic alerts with support for CLI and Web UI interfaces.

## Features
- **CLI Mode**: Generate, simulate, and batch alerts using the command line.
- **Web UI**: Interactive dashboard with real-time websocket streams, charting, and manual alert generation.
- **26+ Alert Types**: Covers various infrastructure and security scenarios.

## Setup
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## Running Web UI
```bash
uvicorn web.app:app --host 0.0.0.0 --port 8050 --reload
```

## Running CLI
```bash
python -m simulator.cli --help
python -m simulator.cli generate --type high_cpu --severity critical --service auth-service
```
