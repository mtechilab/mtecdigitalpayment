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

## MTeC Connect: messaging (migration 018)
Requires migration 012 (staff accounts) and the existing students and classes tables.
Rules:
- Administrators create programme groups: POST /api/messages/staff/groups/programme { programme }.
- Lecturers create class groups for classes they teach, and administrators for any class: POST /api/messages/staff/groups/class { classId }.
- Lecturers and administrators start a direct chat with a student: POST /api/messages/staff/direct { studentRowId }.
- Students cannot create groups or start chats.
- Group access follows the programme and class records, so no membership step is needed.
- Text messages up to 2000 characters. Voice notes up to 120 seconds and 2 MB, in private storage.
Staging checks:
1. An administrator creates a programme group; a student of that programme sees it; a student of another programme does not.
2. A class group is visible to the students enrolled in that class only.
3. A student sends a text; the lecturer sees it in the conversation, with an unread count of 1 before reading.
4. A voice note plays through its link, and the link expires after 5 minutes.
5. A student tries to create a group, and is refused.

## In-app calls (migration 022)
Set ICE_SERVERS_JSON in Render only when a TURN relay is available, for example:
[{"urls":"turn:relay.example:3478","username":"user","credential":"secret"}]
Without it, the server uses the public STUN server. Calls can then fail on networks that block direct connections.
Endpoints: /api/calls/student and /api/calls/staff: GET /ice, POST /start, GET /incoming, GET /:id, POST /:id/answer, POST /:id/reject, POST /:id/end, POST /:id/signal, GET /:id/signals.
Staging checks:
1. Two students in a direct chat: one starts a call, the other sees it in /incoming.
2. A second call in the same chat is refused while the first is ringing.
3. An unanswered call stops appearing after 60 seconds.
4. Signals reach only the other person; a third person gets not found.

## Student groups (migration 023)
Students create groups and add other students (up to 50 people, including the creator). Only the creator adds or removes people. Other members can leave.
Endpoints: POST /api/messages/student/groups/custom, GET/POST /api/messages/student/conversations/:id/members, DELETE /api/messages/student/conversations/:id/members/:studentRowId.
Staging checks:
1. A student creates a group with two others; all three see it.
2. A member who is not the creator cannot add someone (refused).
3. The creator adds a student; that student sees the group and its messages.
4. A non-member cannot read the group's messages.
5. The creator cannot leave; a member can leave and loses access.

## Groups with any registered member (migration 024)
Students and staff create groups and add active students or staff members (up to 50 people, including the creator). Only the creator adds or removes people. Other members can leave.
Endpoints (students: /api/messages/student, staff: /api/messages/staff): POST /groups/custom {name, members:[{kind,id}]}, GET /conversations/:id/members, POST /conversations/:id/members {kind,id}, POST /conversations/:id/members/remove {kind,id}.
Run migration 024 after 023.

## Online application payments (migration 027)
Fees by level: Certificate and Diploma, set by the admin (default 100 and 200). Applicants pay to +232 76 866 665 by Orange Money with the transaction reference, or by cash with a receipt photo.
Applicant portal (PIN and application number, sent in the body): POST /api/application-payments/portal/status and /portal/payment. Public fees: GET /api/application-payments/fees.
Admin: GET/POST /api/application-payments/admin/fees, GET /admin/payments/pending, GET /admin/payments/:id/receipt, POST /admin/payments/:id/review {decision: verify|reject, reason}.
The application form now requires programmeLevel and returns the application number and PIN.

## Applicant decisions and acceptance letter (phase 2)
Admin accepts an application once its fee is verified: POST /api/application-payments/admin/applications/:id/accept. Rejection uses the existing POST /api/admin/applications/:id/reject {reason}. Enrolling the applicant as a student is the existing approve, which stays separate.
Applicant portal: POST /api/application-payments/portal/letter {applicationNumber, pin} returns the acceptance letter as a PDF. The status response now includes rejectionReason and letterReady.

## Online application form (migration 028)
The web form is at /apply. It follows the paper form: applicant, education (up to five schools), enrollment category, fee, guardian, and declaration. After submitting, the applicant is shown the application number and PIN, and pays and checks status from the same page.
Run migration 028 after 027.

## Admin management (migration 029)
Admin only, under /api/admin/manage:
Students: POST /students/:id/update, POST /students/:id/status {status}, POST /students/:id/delete (refused if any invoice, plan, submission or transaction exists; deactivate instead).
Programmes: GET /programmes, POST /programmes, POST /programmes/:id/update, POST /programmes/:id/active {active}. Names are not changed, since students and fees link by name.
Fees: GET /fees, POST /fees {programme, registrationFee, tuitionPerSemester}. Applies to invoices created from now on.
Not yet: payment plan templates, and hiding deactivated programmes from the public list.

## Student PIN after acceptance (migration 030)
Accept first (applicant accepted, fee verified), then Generate PIN (approve). The student ID and PIN are created once; the letter shows them; the applicant registers with them. Run migration 030 after 029.

## Semester registration (migration 031)
Admin opens and closes registration per semester (window with opening date, closing date, optional late deadline, surcharge, open or closed).
Students register after paying: Orange Money reference or cash receipt. A late registration adds the surcharge (50% by default).
Admin verifies the payment, which confirms the registration, then assigns the courses. Students see their courses once confirmed.
Endpoints: /api/semester/student (GET /status, POST /pay), /api/semester/admin (POST /window, GET /pending, GET /registrations/:id/receipt, POST /registrations/:id/review, POST /students/:id/courses).

## Finance cash recording (migration 032)
Finance officers (staff role "finance") and administrators record cash taken at the office. Each payment carries a client reference, so an offline sync sent twice is recorded once. Cash is confirmed through the same step as an approved payment, so balances and the student's panel update together. The student must already have a payment plan.
Endpoints: /api/finance/staff and /api/finance/admin: GET /students/lookup?studentId=, POST /cash {studentId, amount, paymentType, clientReference}.
Known limit: receipts record cash as "bank" because the shared finalize step maps every non-Monime method to bank. Fix that in the finalize step before cash receipts are issued.

## Cash receipt photo (migration 033)
Every cash payment recorded by finance needs a receipt photo (JPG, PNG or WEBP, up to 5 MB). It is stored privately. Admins open it with GET /api/finance/admin/cash/:clientReference/receipt.

## Receipts everywhere
Every confirmed payment creates a receipt automatically (online, approved bank or mobile money, and finance cash).
Student: GET /api/student/receipts and GET /api/student/receipts/:receiptNumber/pdf.
Finance officers: GET /api/finance/staff/receipts and GET /api/finance/staff/receipts/:receiptNumber/pdf.
Administrators: GET /api/finance/admin/receipts and GET /api/finance/admin/receipts/:receiptNumber/pdf.
Known limit: cash receipts show method "bank", because the shared finalize step maps non-Monime payments to bank.

## News, notices, and programme thumbnails (migration 036)
Admins publish news and notices for everyone or for one programme, with an optional image and an expiry date. Students see the posts meant for them, with an unread count, and mark them read.
Student: GET /api/news/student/feed, POST /api/news/student/feed/:id/read.
Admin: GET /api/news/admin/posts, POST /api/news/admin/posts, POST /api/news/admin/posts/:id/delete, POST /api/admin/manage/programmes/:id/thumbnail {imageBase64, imageType}.
Images are stored privately and returned as links that last one hour.
