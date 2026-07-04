# Telegram Bot Reliability

## Goal

Make the Telegram ingestion bot reliable enough for real accounting use: differentiated outcomes, persistent pending proposals, duplicate handling, deterministic receipt parsing, Chile-safe dates, and idempotent button callbacks.

## Scope

- Telegram webhook and shared Telegram helpers.
- Database migrations for bot state and audit/fingerprint support.
- OCR/classification post-processing only where needed for dates and transaction IDs.
- Deterministic Telegram receipt parsing for amount/date/direction before any AI fallback.
- No SII emission from Telegram.
- No legacy `/escritorio` work.

## Requirements

- A received payment (`entrada`) shows a pending boleta with edit/approve buttons.
- A sent transfer (`salida`) explains that no sale boleta is generated and offers safe actions.
- A duplicate shows OCR text, duplicate warning, discard, and accept-with-double-confirmation.
- Telegram button taps are idempotent: double taps and retries must not duplicate movements/proposals.
- Pending Telegram messages can be recovered with `/pendientes` and the latest status with `/ultimo`.
- Pending edits can be cancelled with `/cancelar` and expire after a short window.
- Dates shown to users and fallback dates use `America/Santiago`.
- If the source does not provide a clear date, use the Telegram receipt date in Chile and show that it was assumed.
- OCR/AI may read the image, but amount, date, and direction must be decided by deterministic rules.
- Amount extraction must reject account/RUT/operation/code/bank/date lines as amount candidates.
- If a transfer-like receipt has no safe deterministic consensus, do not send it to DeepSeek to invent a movement; mark it for review instead.

## Constraints

- Keep approval in Telegram as “ready in Agregados”; do not emit to SII.
- Scope every service-client operation by `empresa_id` from the linked chat.
- Do not auto-learn identities without explicit user confirmation.
- Do not log images/base64 or unnecessary sensitive data.

## Verification

- `npx tsc --noEmit`
- `npm run test -- src/lib/telegram/deterministico.test.ts`
- `npm run build`
- Manual Telegram matrix: received payment, sent payment, duplicate, double tap, `/pendientes`, `/ultimo`, `/cancelar`.
