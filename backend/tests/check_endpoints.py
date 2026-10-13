import sys
import os
import urllib.request
import json
import gzip

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.main import create_access_token, SessionLocal, User

db = SessionLocal()
admin = db.query(User).filter(User.role == 'admin').first()
token = create_access_token(subject=admin.id) if admin else ''
db.close()

headers = {'Authorization': f'Bearer {token}', 'Accept-Encoding': 'gzip'}

urls = [
    'http://127.0.0.1:8000/dashboard-stats',
    'http://127.0.0.1:8000/products',
    'http://127.0.0.1:8000/customers',
    'http://127.0.0.1:8000/workers',
    'http://127.0.0.1:8000/orders',
    'http://127.0.0.1:8000/shipping/pending',
    'http://127.0.0.1:8000/shipping',
    'http://127.0.0.1:8000/stock-movements',
]

print("Checking endpoints...")
for u in urls:
    try:
        req = urllib.request.Request(u, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as r:
            raw = r.read()
            if r.headers.get('content-encoding') == 'gzip':
                raw = gzip.decompress(raw)
            data = raw.decode('utf-8', errors='ignore')
            try:
                j = json.loads(data)
                count = len(j) if isinstance(j, list) else ('keys: ' + str(len(j.keys())) if isinstance(j, dict) else 'ok')
                print(f"  [OK] {u:<45} (items: {count})")
            except Exception:
                print(f"  [OK] {u:<45}")
    except Exception as e:
        print(f"  [FAIL] {u:<45} ERROR: {e}")
