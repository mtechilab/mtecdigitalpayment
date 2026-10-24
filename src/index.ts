import { adminDataRouter } from "./routes/adminDataRoutes.js";
import { publicCatalogueRouter } from "./routes/catalogueRoutes.js";
import { studentNewsRouter, adminNewsRouter } from "./routes/newsRoutes.js";
import { staffFinanceRouter, adminFinanceRouter } from "./routes/financeRoutes.js";
import { studentSemesterRouter, adminSemesterRouter } from "./routes/semesterRegistrationRoutes.js";
import { adminManagementRouter } from "./routes/adminManagementRoutes.js";
import { applicationPaymentRouter } from "./routes/applicationPaymentRoutes.js";
import { studentCallRouter, staffCallRouter } from "./routes/callRoutes.js";
import { studentProfilePhotoRouter } from "./routes/profilePhotoRoutes.js";
import { studentMessagingRouter, staffMessagingRouter } from "./routes/messagingRoutes.js";
import { staffAssignmentRouter, studentAssignmentRouter } from "./routes/assignmentRoutes.js";
import { aiStudentRouter } from "./routes/aiStudentRoutes.js";
import { staffQuizRouter, studentQuizRouter } from "./routes/quizRoutes.js";
import { aiStudioRouter } from "./routes/aiRoutes.js";
import { staffLibraryRouter, studentLibraryRouter, adminLibraryRouter } from "./routes/libraryRoutes.js";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import authRoutes from "./routes/authRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import staffRoutes from "./routes/staffRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import studentInfoRoutes from "./routes/studentInfoRoutes.js";
import applicationRoutes from "./routes/applicationRoutes.js";
import programmeRoutes from "./routes/programmeRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Webhook route needs raw body — registered before express.json() so it
// alone gets the unparsed buffer; every other route gets normal JSON.
app.use("/api/payments", webhookRoutes);

app.use(express.json({ limit: "16mb" })); // base64 JSON: payment screenshots, and chat documents up to 10 MB
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Staff-Token");
  res.header("Access-Control-Allow-Methods", "GET, POST");
  next();
});

app.use("/auth", authRoutes);
app.use("/applications", applicationRoutes);
app.use("/programmes", programmeRoutes);
app.use("/api/library/staff", staffLibraryRouter);
app.use("/api/library/student", studentLibraryRouter);
app.use("/api/library/admin", adminLibraryRouter);
app.use("/api/ai/staff", aiStudioRouter);
app.use("/api/quiz/staff", staffQuizRouter);
app.use("/api/quiz/student", studentQuizRouter);
app.use("/api/ai/student", aiStudentRouter);
app.use("/api/assignments/staff", staffAssignmentRouter);
app.use("/api/assignments/student", studentAssignmentRouter);
app.use("/api/messages/student", studentMessagingRouter);
app.use("/api/messages/staff", staffMessagingRouter);
app.use("/api/profile-photo/student", studentProfilePhotoRouter);
app.use("/api/calls/student", studentCallRouter);
app.use("/api/calls/staff", staffCallRouter);
app.use("/api/application-payments", applicationPaymentRouter);
app.use("/api/admin/manage", adminManagementRouter);
app.use("/api/semester/student", studentSemesterRouter);
app.use("/api/semester/admin", adminSemesterRouter);
app.use("/api/finance/staff", staffFinanceRouter);
app.use("/api/finance/admin", adminFinanceRouter);
app.use("/api/news/student", studentNewsRouter);
app.use("/api/news/admin", adminNewsRouter);
app.use("/api/programmes/catalogue", publicCatalogueRouter);
app.use("/api/admin/data", adminDataRouter);
app.use("/payments", paymentRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/student", studentInfoRoutes);

// Bare-minimum cash-approval page — visit https://<this-host>/staff on any
// phone/browser. No login of its own; it just asks for the staff key and
// sends it as X-Staff-Token on every request. Stopgap only — see the
// database-unification plan for where this belongs long-term.
app.get("/staff", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "staff.html"));
});

// Admin Dashboard — real login (admin_accounts + JWT), real data (students/
// courses/marks/receipts tables), no mock numbers. First run: POST to
// /api/admin/setup once (see migrations/002_admin_accounts.sql) to create
// the first account, since nobody can log in to create one otherwise.
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

// The public application form, in the same layout as the paper form.
app.get("/apply", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "apply.html"));
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`MTeC Payment Backend listening on port ${port}`);
  console.log(`Webhook endpoint: /api/payments/webhook`);
  console.log(`Staff cash-approval page: /staff`);
});
