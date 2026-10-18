"""Short-lived credentials for the company's TURN relay."""
import base64
import hashlib
import hmac
import time
from .config import APP_DATA_DIR, INTERNAL_CALL_ICE_SERVERS


def ice_servers(user_id: int) -> list[dict]:
    try:
        secret = (APP_DATA_DIR / '.turn-secret').read_text(encoding='utf-8').strip()
        host = (APP_DATA_DIR / '.turn-host').read_text(encoding='utf-8').strip()
    except OSError:
        return INTERNAL_CALL_ICE_SERVERS
    if len(secret) < 32 or not host or any(char not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-' for char in host):
        return INTERNAL_CALL_ICE_SERVERS
    username = f'{int(time.time()) + 86400}:{user_id}'
    password = base64.b64encode(hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()).decode()
    return [
        {'urls': f'stun:{host}:3478'},
        {'urls': [f'turn:{host}:3478?transport=udp', f'turn:{host}:3478?transport=tcp'], 'username': username, 'credential': password},
    ]
