import time
import urllib.request

for i in range(20):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8000/dashboard-stats', timeout=2) as r:
            print('STATUS', r.status)
            data = r.read(800).decode(errors='ignore')
            print(data)
            break
    except Exception as e:
        time.sleep(0.5)
else:
    print('FAILED')
