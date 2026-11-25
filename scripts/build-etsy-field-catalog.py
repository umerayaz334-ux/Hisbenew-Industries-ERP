"""Capture listing input schemas from Etsy's official OpenAPI document.

Usage: python scripts/build-etsy-field-catalog.py PATH_TO_DOWNLOADED_SPEC
No credentials or network calls are used by this generator.
"""
import json
import sys
from pathlib import Path

OPERATIONS = {
    "createDraftListing", "updateListing", "updateListingInventory",
    "updateListingProperty", "uploadListingImage", "uploadListingVideo",
    "uploadListingFile", "updateListingPersonalization", "updateListingTranslation",
    "updateVariationImages",
}
spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
catalog = {}
for path, methods in spec["paths"].items():
    for method, operation in methods.items():
        if not isinstance(operation, dict) or operation.get("operationId") not in OPERATIONS:
            continue
        schema = next(iter(operation["requestBody"]["content"].values()))["schema"]
        catalog[operation["operationId"]] = {"path": path, "method": method, "schema": schema}
assert set(catalog) == OPERATIONS
output = Path(__file__).resolve().parents[1] / "backend/app/etsy/fields.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({"checked_on": "2026-11-25", "source": "https://www.etsy.com/openapi/generated/oas/3.0.0.json", "operations": catalog}, indent=2) + "\n", encoding="utf-8")
print(f"Captured {len(catalog)} listing operations")
