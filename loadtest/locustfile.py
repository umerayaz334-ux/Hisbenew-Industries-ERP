import os
import random

from locust import HttpUser, between, task


class ErpUser(HttpUser):
    wait_time = between(1.5, 5.0)

    def on_start(self):
        username = os.getenv("ERP_LOADTEST_USERNAME", "adminmain")
        pin = os.getenv("ERP_LOADTEST_PIN", "1234")
        with self.client.post(
            "/login",
            json={"username": username, "pin": pin},
            name="POST /login",
            catch_response=True,
        ) as response:
            if response.status_code != 200:
                response.failure(f"Login failed: {response.status_code}")
                return
            payload = response.json()
            token = payload.get("access_token")
            self.user_id = payload.get("id")
            if not token:
                response.failure("Login response did not include an access token")
                return
            self.client.headers.update({"Authorization": f"Bearer {token}"})

    @task(5)
    def dashboard(self):
        self.client.get("/dashboard-stats", name="GET /dashboard-stats")

    @task(4)
    def message_counts(self):
        self.client.get(
            "/internal-messages/unread-count",
            name="GET /internal-messages/unread-count",
        )

    @task(2)
    def message_users(self):
        self.client.get("/internal-message-users", name="GET /internal-message-users")

    @task(2)
    def products(self):
        self.client.get("/products", name="GET /products")

    @task(1)
    def current_user(self):
        if getattr(self, "user_id", None):
            self.client.get(f"/users/{self.user_id}", name="GET /users/:id")

    @task(1)
    def active_call_check(self):
        # Slow fallback endpoint; real clients receive calls over WebSocket.
        if random.random() < 0.25:
            self.client.get("/internal-calls/active", name="GET /internal-calls/active")
