import random
from locust import HttpUser, task, between

class AeternaLoadUser(HttpUser):
    wait_time = between(1, 3)

    def on_start(self):
        # Create a user to use for the session
        self.username = f"loaduser_{random.randint(1000, 9999)}"
        self.password = "password"
        self.client.post("/api/signup", json={
            "username": self.username,
            "email": f"{self.username}@example.com",
            "password": self.password
        })

    @task(5)
    def view_health(self):
        self.client.get("/health")

    @task(2)
    def login(self):
        self.client.post("/api/login", json={
            "username": self.username,
            "password": self.password
        })

    @task(1)
    def stress_cpu(self):
        """Simulate an expensive operation"""
        self.client.get("/api/stress/cpu?seconds=2")

    @task(1)
    def stress_memory(self):
        """Simulate memory leak / high memory usage"""
        self.client.get("/api/stress/memory?mb=5")

    @task(1)
    def simulate_errors(self):
        """Hit the error endpoint to trigger alert"""
        with self.client.get("/api/stress/error", catch_response=True) as response:
            if response.status_code == 500:
                response.success()  # We expect a 500 here

    @task(1)
    def simulate_latency(self):
        """Hit the slow endpoint"""
        self.client.get("/api/stress/slow?delay=2.0")
