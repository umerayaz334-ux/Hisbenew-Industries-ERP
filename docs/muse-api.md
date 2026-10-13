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
| GET | `/products` | List company products with id, article_no, name, unit_price_usd and image_url |
| POST | `/products` | Immediately create a missing product or return the existing SKU |
| POST | `/orders` | Queue order details and customer matching |
| POST | `/payouts` | Queue a final actual payout |
| GET | `/submissions` | Latest 100 submissions with Pending, Applied or Failed status |
| GET | `/pending-payouts` | Applied Muse orders awaiting final payment |

POST bodies and examples are available in Orders settings and the FastAPI
OpenAPI schema. Amounts are USD. Items refer to existing product article numbers;
quantity is units, and unit price is the gross price per unit.

The backend starts processing when an order, payout, or retry is submitted.
It also checks persisted submissions at startup and every 5 seconds as a fallback
while running. Processing time depends on server load; HTTP 202 is not a promise
that processing has finished. Poll `/submissions` every 2 seconds until Applied
or Failed. A successful POST returns 202, meaning queued, not applied. The batch
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

Product setup uses the same base URL and bearer key. Example `POST /products`:

```json
{"article_no": "SKU-NEW", "name": "Product name", "unit_price_usd": 25.50, "image_url": "https://example.com/catalog/product.jpg"}
```

Both product endpoints return HTTP 200. GET returns an array; POST returns one
object with `id`, `article_no`, `name`, `unit_price_usd`, and `image_url`. Prices map to the ERP
selling price in USD. New products start with zero stock. Article numbers and
names are trimmed and cannot be blank; prices must be finite and nonnegative.
Matching uses exact, case-sensitive article numbers. Repeating POST for an
existing article returns it without overwriting its name, price, or image. A conflicting
article unavailable to this company returns 409 without exposing other company data.

Before sending an order, list products, create each missing SKU using its catalog
wholesale price, verify it exists, then POST the order. After adding products for
a Failed submission, resend that order and poll `/submissions` until Applied.
Product creation is immediate and does not wait for the order queue. Existing
Muse API keys work without rotation.

Orders default to unfulfilled (`shipping_status` Pending) so they appear in the
Shipping queue. To create an already-fulfilled shipment, include:

```json
"fulfilled": true,
"courier": "FedEx",
"tracking_number": "794612345678",
"shipped_at": "2026-10-13T15:30:00+05:00"
```

`courier` must be `FedEx` or `DHL` (case-insensitive). `tracking_number` is
required when `fulfilled` is true. `shipped_at` is optional (defaults to process
time). Fulfilled Muse orders deduct stock like the Shipping “mark shipped” flow
and create a shipping record with the courier and tracking number. Resubmitting
the same Muse order number with fulfillment details updates tracking on that
Muse order only.

`image_url` is optional and accepts an absolute HTTP/HTTPS URL (HTTPS recommended).
Omit it or send null for products without an image. Use a publicly accessible
direct image URL, not a product page. The ERP stores the URL without downloading
or verifying the image; the source must remain available for display. GET and
POST product responses include the stored URL, or null when absent. Existing
products are unchanged by repeated POST requests, including their images.
