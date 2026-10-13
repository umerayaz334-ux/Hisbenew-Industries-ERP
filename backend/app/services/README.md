# Backend Services

Put reusable backend business logic here.

Examples:

- `backup_service.py`: database backup lifecycle.
- `catalog/`: product catalog generation.
- `printing/`: label rendering and TSPL printer payloads.
- `shipping/`: shipping rate and shipping calculation services.
- `realtime.py`: websocket/realtime event hub.

Services may use models and database sessions, but they should not know about frontend layout.