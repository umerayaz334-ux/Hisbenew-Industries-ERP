import urllib.request
import json

# Test the order endpoints
test_urls = [
    ('GET', 'http://127.0.0.1:8000/orders'),
]

for method, url in test_urls:
    try:
        if method == 'GET':
            with urllib.request.urlopen(url, timeout=5) as r:
                data = r.read().decode()
                j = json.loads(data)
                print(f"{method} {url}: OK ({len(j)} items)" if isinstance(j, list) else f"{method} {url}: OK")
    except Exception as e:
        print(f"{method} {url}: ERROR - {e}")

print("\nOrder endpoints ready for testing:")
print("- GET /orders (list)")
print("- POST /orders (create)")
print("- PUT /orders/{id} (edit)")
print("- DELETE /orders/{id} (delete)")
