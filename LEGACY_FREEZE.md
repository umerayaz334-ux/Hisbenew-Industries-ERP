# Legacy App Freeze

Date: 2026-08-20

The existing ERP app is now treated as the legacy reference system for the v2 rebuild.

## Freeze Rules

- Do not add new features to the legacy app.
- Do not refactor legacy code unless a production-blocking bug requires it.
- Do not mix v2 code into legacy folders.
- Keep the legacy app runnable so it can be used for behavior comparison.
- Use the legacy app for data migration reference, feature behavior checks, and emergency operation only.
- Put all rebuild work inside `v2/`.

## Allowed Legacy Changes

- Critical production bug fixes.
- Security fixes.
- Data recovery or backup work.
- Small compatibility changes needed to export/migrate data to v2.

## Not Allowed In Legacy

- New modules.
- Major UI redesigns.
- Database redesign.
- New integration architecture.
- Large cleanup/refactor work.

## Current Legacy Scope

The legacy app contains factory ERP, multi-tenancy, website/catalog, service taker portal, Amazon integration, shipping, fulfillment, accounting, communication, deployment tools, and school ERP.

School ERP is excluded from the current v2 rebuild scope.

