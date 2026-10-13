# Muse order and payout integration

Open **Orders → Settings** as a company administrator. Generate an API key and
copy the instructions to Muse. Keys are tenant-scoped, stored as hashes and
limited to `/integrations/muse/` routes. Replacing a key invalidates the old key.

Local development base: `http://localhost:8000/integrations/muse`.
Muse running outside this computer needs a publicly reachable HTTPS deployment.
`https://hisbenew.com/integrations/muse` is only usable after the updated backend
is deployed and the web server routes that path to FastAPI. If the deployment
uses an `/api` prefix, include it in the base URL.

All requests require `Authorization: Bearer <API_KEY>`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/orders` | Queue order details and customer matching |
| POST | `/payouts` | Queue a final actual payout |
| GET | `/submissions` | Latest 100 submissions with Pending, Applied or Failed status |
| GET | `/pending-payouts` | Applied Muse orders awaiting final payment |

POST bodies and examples are available in Orders settings and the FastAPI
OpenAPI schema. Amounts are USD. Items refer to existing product article numbers;
quantity is units, and unit price is the gross price per unit.

The backend checks persisted submissions at startup and every 600 seconds while
running. A successful POST returns 202, meaning queued, not applied. The batch
processes up to 500 submissions per check. Failed submissions show an error in
settings and can be corrected and resubmitted, or retried from settings after
fixing the underlying customer/product data. Identical retries do not create
duplicate orders, reservations, or payout accounting entries.

Customer matching uses optional explicit `customer_id`, otherwise normalized
phone, then normalized name and company. Multiple matches fail for review.
No match creates a new customer. Existing customer details remain intact;
order-specific shipping/contact details are saved on the order.

Muse performs its own payment-source check daily at 08:00 Asia/Karachi
(03:00 UTC). The ERP does not query the sales platform for Muse. Send
`actual_paid_usd` as the final total, not an incremental payment; send `paid_at`
with the payment timestamp. The original estimate remains unchanged, the payout
is settled even if the actual value differs, and Accounting is updated. Muse
should stop tracking after the payout submission is Applied.

Tests (from backend, with a disposable database):

```powershell
$env:SKIP_DATABASE_INITIALIZATION='1'
$env:DATABASE_URL='sqlite://'
$env:APP_DATA_DIR='D:\DevCache\tmp\muse-tests'
$env:SECRET_KEY='muse-test-only'
.\venv\Scripts\python.exe -m unittest tests.test_muse_api -v
```

Tests use the HTTP test client (`httpx`) and isolated SQLite tables. They cover
tenant isolation, key rotation, validation, customer reuse, retries, inventory,
transaction rollback, and the accounting integration.
