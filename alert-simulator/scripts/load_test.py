import sys
import asyncio
from simulator.alert_generator import AlertGenerator
from simulator.api_client import AeternaApiClient
import time

async def trigger_load():
    try:
        count = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    except ValueError:
        count = 100

    print(f"Triggering load test: {count} alerts")
    generator = AlertGenerator()
    client = AeternaApiClient()
    
    alerts = generator.generate_batch(count)
    
    start = time.time()
    
    # Send simultaneously to test concurrency limits
    results = await asyncio.gather(*[client.send_alert(a, max_retries=1) for a in alerts])
    
    duration = time.time() - start
    successes = sum(1 for r in results if r)
    
    print(f"\n--- Load Test Results ---")
    print(f"Total Sent: {count}")
    print(f"Successes: {successes}")
    print(f"Failures: {count - successes}")
    print(f"Time Taken: {duration:.2f}s")
    print(f"Alerts/sec: {count/duration:.2f}")

if __name__ == "__main__":
    asyncio.run(trigger_load())
