#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Ensure dependencies installed
pip install -r requirements.txt -q

# Ensure port-forward is alive
if ! curl -s --max-time 2 http://127.0.0.1:9090/health >/dev/null 2>&1; then
    echo "Starting resilient port-forward to aeterna-sample-app on port 9090..."
    (while true; do kubectl port-forward -n aeterna-sample svc/aeterna-sample-app 9090:80 >/dev/null 2>&1 || true; sleep 1; done) &
    sleep 2
fi

echo "Connected! Service is healthy on http://127.0.0.1:9090"
echo "Starting Locust web UI on http://localhost:8089..."
locust -f locustfile.py --host=http://127.0.0.1:9090
