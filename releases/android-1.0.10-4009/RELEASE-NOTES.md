# Android 1.0.10 (4009)

Workers can receive orders forwarded from another company's portal while keeping
their existing Hisbenew login.

- Open **My Tasks** from the dashboard or menu to see assigned order work.
- Forwarded tasks show the sending company, original order number, item photos,
  quantities, instructions and due date.
- Accept a task, then submit completed preparation or shipment details.
- The sending company's administrator verifies completion. The original order,
  shipment and stock remain in that company.

Administrators connect companies from **Workers → Forward orders across
companies** using a single-use forwarding code from the receiving company.
Connected workers are then available in each unfulfilled order's worker selector.
Either company can disconnect the worker and cancel unfinished forwarded work.

Update over the existing APK; keep the same login. Android package:
`com.hisbenew.factory.hisbenew_erp`, version code `4009`.

Verification: 24 Flutter tests passed, including a Cuterex task accepted and
submitted through one Hisbenew session. Six backend integration tests cover
tenant/worker isolation, source verification, codes, cancellation, revocation,
stock ownership, idempotency and shipment rollback. No physical phone was used.
