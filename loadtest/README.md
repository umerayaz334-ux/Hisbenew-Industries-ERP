# ERP load test

Run this only against a staging copy of the ERP, not the live factory database.

```powershell
python -m venv .venv
.\.venv\Scripts\pip.exe install -r requirements.txt
$env:ERP_LOADTEST_USERNAME="adminmain"
$env:ERP_LOADTEST_PIN="1234"
.\.venv\Scripts\locust.exe -f locustfile.py --host https://staging-erp.example.com
```

Start at 50 users and check errors and p95 latency. Then test 200, 500, and 1,000 users. A headless 1,000-user run is:

```powershell
.\.venv\Scripts\locust.exe -f locustfile.py --headless -u 1000 -r 20 -t 15m --host https://staging-erp.example.com
```

Targets before production release:

- error rate below 1%;
- p95 API latency below 500 ms for ordinary ERP reads;
- no PostgreSQL pool timeouts;
- stable CPU below 75% during the sustained portion of the run.
