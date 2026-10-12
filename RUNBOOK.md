# MTeC backend — staging runbook

Nothing here runs automatically. Work through it in order, on a staging copy first.

## 1. Environment variables (set in Render; never commit them)
- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
- JWT_SECRET (required for student, admin and staff sessions)
- STAFF_API_KEY (legacy shared key, kept only during the staff transition)
- Monime credentials, as already configured

## 2. Database migrations, in order
002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 → 011 → 012
Check which of these the live database already has before running any.
Migration 010 (atomic payment confirmation) must be tested on a copy first.

## 3. Automated tests (no database or network needed)
    npm test
Expected: 16 passing tests.

## 4. Staging checks, after deploying to staging
1. Staff login: POST /api/staff/login with a test account returns a token.
2. Disabled account: disable it via POST /api/admin/staff-accounts/:id/active; its token stops working on the next request.
3. Shared key still works, and logs a warning once.
4. Duplicate payment: a second payment for the same amount within 30 minutes returns 409.
5. Duplicate application: same phone, programme and year returns 409.
6. A confirmed payment appears once in the audit log and once in receipts.
7. Confirming the same payment twice changes nothing the second time.

## 5. Production
Only after every staging check passes, and with the decision recorded in the audit log.
