import urllib.request
import json

urls = [
    'http://127.0.0.1:8000/dashboard-stats',
    'http://127.0.0.1:8000/products',
    'http://127.0.0.1:8000/customers',
    'http://127.0.0.1:8000/workers',
    'http://127.0.0.1:8000/orders',
]

for u in urls:
    try:
        with urllib.request.urlopen(u, timeout=5) as r:
            data = r.read().decode(errors='ignore')
            try:
                j = json.loads(data)
                print(u, 'OK', 'items=', len(j) if isinstance(j, list) else 'obj')
            except Exception:
                print(u, 'OK')
    except Exception as e:
        print(u, 'ERROR', e)
