import asyncio
from simulator.main import SimulatorManager

async def run():
    print("Starting default simulation locally for testing...")
    manager = SimulatorManager()
    manager.start_simulation(interval=3)
    
    try:
        # Run for 30 seconds
        await asyncio.sleep(30)
    finally:
        manager.stop_simulation()
        print("Simulation done")

if __name__ == "__main__":
    asyncio.run(run())
