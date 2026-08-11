import json
from urllib.parse import urlparse

import websocket

from config import AGENT_NAME, ERP_API


def build_websocket_url(api_base: str) -> str:
    base = str(api_base or "").strip().rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme in {"ws", "wss"}:
        return f"{base}/ws/print-agent"
    if parsed.scheme == "http":
        return f"ws://{parsed.netloc}{parsed.path.rstrip('/')}/ws/print-agent"
    return f"wss://{parsed.netloc}{parsed.path.rstrip('/')}/ws/print-agent"


URL = build_websocket_url(ERP_API)

print("Connecting to Hisbenew ERP...")
print(URL)

try:
    ws = websocket.create_connection(URL, timeout=10)
    print("Connected successfully")
    ws.send(json.dumps({"type": "register", "agent": AGENT_NAME}))
    print("Agent registered")
    print(ws.recv())
    ws.close()
except Exception as e:
    print("Connection failed:")
    print(e)