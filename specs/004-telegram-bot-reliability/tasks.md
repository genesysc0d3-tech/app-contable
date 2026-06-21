# Tasks

- [x] Add database migration for Telegram proposal messages, duplicate actions, and audit events.
- [x] Generate stable duplicate fingerprints and persisted proposal-message links.
- [x] Add differentiated Telegram summaries for proposals, sent transfers, and duplicates.
- [x] Make approve/edit/duplicate callbacks idempotent and scoped by linked company.
- [x] Add `/pendientes`, `/ultimo`, and `/cancelar` commands.
- [x] Use Chile-safe fallback dates for Telegram comprobantes.
- [x] Add deterministic 3-parser amount consensus for Telegram receipts.
- [x] Reject account/RUT/operation/code/date lines as amount or date candidates.
- [x] Mark transfer-like receipts without safe consensus as requiring review instead of falling back to DeepSeek.
- [x] Add focused Vitest coverage for the Cuenta RUT vs real amount bug.
- [x] Verify with typecheck and build.
