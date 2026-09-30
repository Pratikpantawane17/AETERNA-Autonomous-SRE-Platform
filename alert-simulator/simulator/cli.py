import click
import asyncio
import json
import csv
import sys
from rich.console import Console
from rich.table import Table
from rich.progress import track

from simulator.alert_generator import AlertGenerator
from simulator.api_client import AeternaApiClient
from simulator.main import SimulatorManager
from simulator.config import settings

console = Console()

async def wait_for_backend(url=f"{settings.AETERNA_CORE_URL}/health", timeout=30):
    import httpx
    import time
    console.print(f"[bold yellow]Waiting for backend at {url}...[/bold yellow]")
    for i in range(timeout):
        try:
            async with httpx.AsyncClient() as client:
                r = await client.get(url, timeout=2.0)
                if r.status_code == 200:
                    console.print("[bold green]Backend ready.[/bold green]")
                    return True
        except Exception:
            pass
        await asyncio.sleep(1)
    
    console.print("[bold red]Backend never became ready. Continuing anyway...[/bold red]")
    return False

@click.group()
def cli():
    """Aeterna Alert Simulator CLI"""
    pass

@cli.command()
@click.option('--type', 'alert_type', help='Specific alert type to generate')
@click.option('--severity', help='Severity level (info, low, medium, high, critical)')
@click.option('--service', help='Service name to tag with the alert')
@click.option('--pattern', default='random', help='Metric generation pattern (random, spike, gradual)')
def generate(alert_type, severity, service, pattern):
    """Generate a single alert"""
    asyncio.run(wait_for_backend())
    generator = AlertGenerator()
    alert = generator.generate_single_alert(alert_type=alert_type, severity=severity, service=service, pattern=pattern)
    
    console.print("[bold green]Generated Alert:[/bold green]")
    console.print_json(data=alert)
    
    # Send to API
    client = AeternaApiClient()
    # async run
    success = asyncio.run(client.send_alert(alert))
    if success:
        console.print("[bold green]Successfully sent to Aeterna Core[/bold green]")
    else:
        console.print("[bold red]Failed to send alert. Is Aeterna Core running?[/bold red]")

@cli.command()
@click.option('--interval', default=settings.DEFAULT_SIMULATION_INTERVAL, help='Interval between alerts in seconds')
@click.option('--types', help='Comma-separated list of alert types to simulate')
def simulate(interval, types):
    """Start continuous simulation"""
    asyncio.run(wait_for_backend())
    types_list = types.split(',') if types else None
    manager = SimulatorManager()
    
    console.print(f"[bold cyan]Starting continuous simulation every {interval}s... Press Ctrl+C to stop.[/bold cyan]")
    try:
        manager.start_simulation(interval=interval)
        # Keep process alive
        loop = asyncio.get_event_loop()
        loop.run_forever()
    except KeyboardInterrupt:
        console.print("[bold yellow]Stopping simulation...[/bold yellow]")
        manager.stop_simulation()
        sys.exit(0)

@cli.command()
@click.option('--count', default=10, help='Number of alerts to generate')
@click.option('--output', help='Optional CSS/JSON file to export to')
def batch(count, output):
    """Batch generate alerts"""
    generator = AlertGenerator()
    alerts = generator.generate_batch(count)
    
    if output:
        if output.endswith('.json'):
            with open(output, 'w') as f:
                json.dump(alerts, f, indent=2)
            console.print(f"Exported {count} alerts to {output}")
        elif output.endswith('.csv'):
            if alerts:
                keys = list(alerts[0].keys())
                with open(output, 'w', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=keys)
                    writer.writeheader()
                    # Convert dicts like metrics to json strings for csv
                    for alert in alerts:
                        row = {**alert}
                        row['metrics'] = json.dumps(row['metrics'])
                        writer.writerow(row)
                console.print(f"Exported {count} alerts to {output}")
        return

    # Send batch
    client = AeternaApiClient()
    console.print(f"Sending {count} alerts to Aeterna Core...")
    
    async def send_all():
        success_count = 0
        for alert in track(alerts, description="Sending..."):
            res = await client.send_alert(alert)
            if res: success_count += 1
        return success_count
        
    successes = asyncio.run(send_all())
    console.print(f"[bold green]Batch complete. Sent {successes}/{count} successfully.[/bold green]")

@cli.command()
@click.option('--kill-switch/--no-kill-switch', default=False, help='Toggle kill switch mode')
def monitor(kill_switch):
    """Monitor mode with kill switch option"""
    client = AeternaApiClient()
    if kill_switch:
        client.toggle_kill_switch()
        console.print("[bold red]KILL SWITCH ACTIVATED. No alerts will be sent.[/bold red]")
    else:
        console.print("[bold green]Monitor mode active.[/bold green]")

if __name__ == '__main__':
    cli()
