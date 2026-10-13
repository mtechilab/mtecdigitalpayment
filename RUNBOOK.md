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

## Online library (migration 013)
Run migration 013 on staging after 012. It creates a private `library` bucket.
Staging checks:
1. A lecturer with an individual account uploads a PDF; it is listed as pending for them.
2. Students do not see it until an admin approves it.
3. After approval, a student gets a signed link that opens the PDF and expires after 5 minutes.
4. A lecturer cannot add a version to another lecturer's item (expect 403).
5. A new version does not replace the published one until it is approved.
6. Rejecting an item records the reason in the audit log.
7. A file over 5 MB, a video, and an invalid file name path are all refused.

## AI Learning Studio (migration 014)
Set these in Render, never in the app or in source control:
- AI_BASE_URL: the provider's base address (any service using the chat-completions format)
- AI_API_KEY: the provider key, server only
- AI_MODEL: the model name
- AI_MONTHLY_CALL_LIMIT: optional, default 200

Staging checks:
1. Without the three AI variables, generation returns the "not configured" message.
2. A lecturer generates a draft; it appears in their list as draft.
3. Another lecturer cannot read, edit or approve it (expect "not found").
4. Editing saves; approving locks it; a locked draft refuses edits.
5. Regenerating creates version 2 and keeps version 1.
6. Students cannot see drafts through any route.
7. The usage counter in ai_usage rises by one per generation.

## Staff roles (migration 015)
Roles: staff, lecturer, administrator.
- Lecturers and administrators can use the library and the AI studio.
- Administrators can also add versions to library items uploaded by others.
- Account management stays with the admin portal: create, list, update (name, role, password), enable or disable, and delete. Delete is refused for accounts that have authored material; disable those instead.
Staging: create one account of each role, sign in as each, and check the access listed above.

## AI model in use
AI_MODEL = gemini-3.5-flash-lite (confirmed working in the studio). Google retires models over time: if a draft returns a 404 that names a replacement model, update AI_MODEL to that name.

## Quizzes (migration 016)
Staging checks:
1. A lecturer creates a quiz with two questions and publishes it.
2. A student of the same programme sees it in the list, with no answers shown.
3. The student submits; the score and the correct answers come back.
4. A second submission is refused (409).
5. A student of another programme cannot open the quiz.
6. The lecturer sees the score on the results page, and no other lecturer can.

## Draft export and student questions
- Lecturers and administrators can download any draft they own as a PDF: GET /api/ai/staff/:id/export.
- Students can ask general concept questions: POST /api/ai/student/ask with { "question": "..." }. Answers are not stored.
- Word, PowerPoint, and image output are not included yet. They need new packages and an image model, which need separate approval.
- Student questions accept an optional photo (JPG, PNG or WEBP, up to 4 MB), sent as imageBase64 and imageContentType. The model must support images; gemini-3.5-flash-lite should, but confirm on the first test.

## Assignments (migration 017)
Staging checks:
1. A lecturer creates an assignment with a due date next week and publishes it.
2. A student of the same programme sees it as open.
3. The student submits; a second submission is refused (409).
4. The lecturer sees the submission and grades it (0 to 100, with feedback).
5. The student sees the score and feedback.
6. An assignment with a due date in the past cannot be submitted.
