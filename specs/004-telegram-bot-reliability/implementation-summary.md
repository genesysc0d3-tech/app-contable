# Implementation Summary

Implemented Telegram bot reliability improvements:

- Added server-only persistence tables for Telegram message links, duplicate actions, and audit events.
- Added FK indexes for the new Telegram tables and applied both migrations in Supabase.
- Persisted Telegram `message_id` for proposal, duplicate, and sent-transfer messages.
- Made `sendMessage` return Telegram message metadata and `editMessageText` return success/failure.
- Added differentiated Telegram summaries:
  - received payment with boleta buttons,
  - sent transfer with no-sale explanation and safe actions,
  - duplicate warning with discard/accept controls.
- Added duplicate double-confirmation and idempotent duplicate acceptance/discard state.
- Made approval idempotent: repeated taps report already-approved instead of mutating again.
- Added `/pendientes`, `/ultimo`, and `/cancelar` commands.
- Added pending edit expiry at 15 minutes.
- Added editable fecha field for Telegram proposals.
- Added Chile-safe fallback date normalization for Telegram comprobantes when OCR text does not mention the model date.
- Extracted visible transaction codes into `movimientos_raw.n_documento` for future dedupe.
- Clarified Telegram copy: approving from Telegram does not emit to SII.
- Removed the Telegram “guardar como gasto” path because massDTE does not manage expenses from the bot.
- Replaced raw OCR dump with a structured receipt summary: type, status, amount, visible date, destination, email, and transaction code when available.
- Renamed sent-transfer actions to “No es ingreso” and “Revisar como ingreso”.
- “No es ingreso” now removes the sent-transfer movement from the useful accounting flow and marks the Telegram document as ignored.
- Telegram now filters out `gasto_egreso`, `no_comercial`, and `ignorar` proposals so accidental non-sale classifications are not shown as boletas.
- Added a deterministic Telegram receipt parser after OCR: common bank transfer receipts now extract amount, date, transaction code, direction, and proposal without DeepSeek. DeepSeek remains only as fallback for unknown formats.
- Telegram callback queries are answered immediately so button taps stop showing the loading spinner while DB/message edits continue.
- Added a pure Telegram deterministic parser module with 3 amount voters: strong label, scored candidates, and receipt-template parser.
- Amount candidates from account/RUT/operation/code/saldo/date lines are discarded before consensus, preventing `Cuenta RUT N° 61725277` from being used as a boleta amount.
- Direction is now resolved by identity, role block, and verbal/template votes; company identity in destination wins over payer-side wording like “monto transferido”.
- Transfer-like receipts with no safe deterministic consensus are marked `requiere_revision` and do not fall through to DeepSeek.
- Added compact parser diagnostics in `progreso_ia`: `monto_elegido`, `linea_monto`, discarded candidates, amount consensus, direction decision, and date decision.
- Changed the initial Telegram copy to optimistic boleta preparation.
- Added focused Vitest coverage for the Telegram parser bug and direction/date safeguards.
- Unified `Comprobante leído` into one copyable formatted block with detected fields and clean read details, without OCR wording or bullet noise.
- Amount diagnostics now include the source line for parser votes, and a strong labeled amount can win over a single medium non-label conflict.
- `requiere_revision` responses now reuse the same formatted `Comprobante leído` message and are registered as Telegram state messages.
- Hardened amount extraction so 9+ digit continuous operation codes are never accepted as CLP amounts, including partial regex matches inside long codes.
- Simplified `Comprobante leído` further to only structured copyable fields (type, result, amount, date, origin/destination, code, message, email, reason), removing the raw full read dump.
- Added support for OCR amount variants with spaced thousands or `$` read as `S`, such as `$ 53 000` and `S 53 000`, while still rejecting long operation codes.
- Added CLP repair for OCR that drops the last thousands digit, e.g. `$ 53.00` and `S 53.00` are normalized to `$53.000`.

Verification:

- `rtk tsc --noEmit`: passed.
- `rtk npm run test -- src/lib/telegram/deterministico.test.ts`: passed, 9 tests.
- `rtk npm run build`: passed.
- Spec validation: not run locally because `validate.sh` is not present in this workspace.
