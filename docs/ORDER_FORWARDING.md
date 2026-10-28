# Cross-company order forwarding

## Use

On **Orders**, click the share icon in an unfulfilled order's Actions column
(or its detail header). On **Shipping → Pending dispatch**, the share icon is
beside each order header, so expanding the dispatch card is unnecessary. The
popup lets you select a connected receiving company, its approved worker,
Preparation/Shipping, instructions and a due date.

Open **Settings → Order forwarding** to connect or disconnect workers and change
the default receiving worker. The default is preselected in share popups and on
Workers. It affects new assignments only; existing tasks retain their worker.
Disconnecting a connection clears it as the default and cancels unfinished tasks.
The earlier Workers assignment flow below also remains available.

1. In the receiving company (for example Hisbenew), open **Workers**.
2. Under **Forward orders across companies**, select a worker with an active,
   linked worker login and create a forwarding code. Copy it to the sending
   company administrator. Codes expire in seven days and can be used once.
3. In the sending company (for example Cuterex), open **Workers**, paste the code
   and click **Connect worker**. The connection remains available for future orders.
4. Under **Unfulfilled orders**, search for the order numbers. Multiple numbers
   can be separated with commas. Select Preparation or Shipping, choose
   **Forward to [worker] / [company]**, add instructions, due date and optional
   worker earning, and click **Assign** for each order.
5. Install Android 1.0.10 (build 4009) or newer. The worker keeps their existing
   receiving-company login and opens **My Tasks** from the dashboard or menu.
   Accept the task, perform the work and submit completion. Shipping requires
   courier, tracking number and positive package weight.
6. The sending company verifies completion on its Workers task board.

Either company's administrator can disconnect the worker. This stops future
forwarding and cancels all unfinished tasks on that connection. Only the sending
company can cancel an individual task or verify completion. To reconnect, the
receiving company must issue a new code.

## Ownership and access

The original order, customer, shipment and inventory remain in the sending
company. A task is created in the receiving company's existing task system so
its worker uses one login and verified earnings appear in that worker's account.
A bridge records the source company/order, destination company, task, author
and a restricted task snapshot. Prices, payment records and general order access
are not shared. Preparation hides customer contact and address; shipping shares
delivery details subject to the worker's existing privacy settings.

Task transitions update the source order, shipment and stock in the same database
transaction as task completion. Normal tenant filtering is unchanged. Bridge
lookups explicitly check the sending or receiving company; worker actions also
check the assigned worker. An active step cannot be assigned locally and
forwarded at the same time. Forwarded tasks preserve an assignment-time item
snapshot; cancel and reassign if the order contents change.

New tables are created through the existing startup `Base.metadata.create_all`
path; existing tables require no column changes. Bridge tables deliberately have
explicit source/destination authorization instead of the single-tenant loader.

## Verification

Run `tests.test_order_forwarding` from backend with
`SKIP_DATABASE_INITIALIZATION=1` and `DATABASE_URL=sqlite://`.
The suite covers tenant and worker isolation, code rotation/expiry/replay,
duplicate assignments, cancellation, revocation, source verification, stock
ownership, repeated completion and transaction rollback. Backend deployment
runs this suite before restarting production.

The mobile test suite includes accepting and submitting a Cuterex task through
one Hisbenew session. No physical phone acceptance test is included.
