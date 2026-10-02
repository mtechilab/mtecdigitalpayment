import { Router, Request, Response } from "express";
import { loginAdmin, setupFirstAdmin } from "../services/adminAuthService.js";
import { getDashboardSummary, getRecentActivities } from "../services/adminDashboardService.js";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import { buildReport, REPORT_TYPES, ReportType } from "../services/reportsService.js";
import { streamResultSlip } from "../services/resultSlipService.js";
import {
  listApplications, getApplication, approveApplication, rejectApplication,
  registerStudentDirect,
  listStudents, getStudentDetail,
  createPaymentPlanForStudent, listFeeStructures,
  listTransactions, listPendingPayments, verifyPendingPayment, rejectPendingPayment,
  addCourse, listCourses, getCourse,
  addStaff, listStaff,
  createClass, listClasses, getClassDetail, addStudentToClass,
  listClassStudents, createAssessmentItem, listAssessmentItems, saveMarks, getMarks,
  changeAdminPassword,
  listThreadsNeedingReply, getChatThread, sendAdminChatMessage,
  listTimetableSlots, addTimetableSlot, deleteTimetableSlot,
  saveAttendance, getClassAttendance,
  getResultBatchStatus, submitResultsForReview, publishResults, returnResultsToLecturer,
} from "../services/adminOpsService.js";

const router = Router();

// POST /admin/setup — { username, password, fullName }
// Only works while admin_accounts is empty. This is how the very first
// admin account gets created; it refuses once one already exists.
router.post("/setup", async (req: Request, res: Response) => {
  const { username, password, fullName } = req.body as { username?: string; password?: string; fullName?: string };
  if (!username || !password || !fullName) {
    return res.status(400).json({ error: "username, password, and fullName are all required." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const result = await setupFirstAdmin(username, password, fullName);
  if (!result.success) return res.status(403).json({ error: result.reason });
  res.json({ success: true });
});

// POST /admin/login — { username, password }
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) return res.status(400).json({ error: "username and password are required." });

  const result = await loginAdmin(username, password);
  if (result.outcome === "no_admin_configured") {
    return res.status(409).json({ error: "no_admin_configured", message: "No admin account exists yet — use /admin/setup first." });
  }
  if (result.outcome === "invalid_credentials") {
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  res.json({ token: result.token, fullName: result.fullName, role: result.role });
});

// GET /admin/dashboard — protected
router.get("/dashboard", requireAdminAuth, async (_req: AdminRequest, res: Response) => {
  try {
    const summary = await getDashboardSummary();
    res.json(summary);
  } catch (err) {
    console.error("[/admin/dashboard] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load dashboard." });
  }
});

// ==========================================================================
// Applications — "Register Student" quick action
// Approving is what creates the student account (generates Student ID + PIN).
// ==========================================================================

// GET /admin/applications — everything past draft, most recent first
router.get("/applications", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const applications = await listApplications();
    res.json({ applications });
  } catch (err) {
    console.error("[/admin/applications GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load applications." });
  }
});

// GET /admin/applications/:id
router.get("/applications/:id", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const application = await getApplication(req.params.id);
    res.json(application);
  } catch (err) {
    console.error("[/admin/applications/:id GET] error:", (err as Error).message);
    res.status(404).json({ error: (err as Error).message || "Application not found." });
  }
});

// POST /admin/applications/:id/approve — creates the student, returns { studentId, pin }
router.post("/applications/:id/approve", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const result = await approveApplication(req.params.id);
    res.json(result);
  } catch (err) {
    console.error("[/admin/applications/:id/approve] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not approve application." });
  }
});

// POST /admin/applications/:id/reject — { reason }
router.post("/applications/:id/reject", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason) return res.status(400).json({ error: "reason is required." });
    await rejectApplication(req.params.id, reason);
    res.json({ success: true });
  } catch (err) {
    console.error("[/admin/applications/:id/reject] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not reject application." });
  }
});

// ==========================================================================
// Students
// ==========================================================================

// GET /admin/students?q=&limit=
router.get("/students", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const students = await listStudents(q, limit);
    res.json({ students });
  } catch (err) {
    console.error("[/admin/students GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load students." });
  }
});

// GET /admin/students/:id
router.get("/students/:id", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const student = await getStudentDetail(req.params.id);
    res.json(student);
  } catch (err) {
    console.error("[/admin/students/:id GET] error:", (err as Error).message);
    res.status(404).json({ error: (err as Error).message || "Student not found." });
  }
});

// GET /admin/students/:id/result-slip — streams a PDF, not JSON
router.get("/students/:id/result-slip", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await streamResultSlip(req.params.id, res);
  } catch (err) {
    console.error("[/admin/students/:id/result-slip] error:", (err as Error).message);
    // Headers may already be sent if streaming started before the failure —
    // guard against the "can't set headers after they're sent" crash.
    if (!res.headersSent) {
      res.status(400).json({ error: (err as Error).message || "Could not generate result slip." });
    } else {
      res.end();
    }
  }
});

// POST /admin/students — walk-in registration, coexists with the Applications review flow
router.post("/students", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try {
    const { fullName, phone, email, programme, academicYear } = req.body as {
      fullName?: string; phone?: string; email?: string; programme?: string; academicYear?: string;
    };
    if (!fullName || !phone || !programme || !academicYear) {
      return res.status(400).json({ error: "fullName, phone, programme, and academicYear are all required." });
    }
    const result = await registerStudentDirect({
      fullName, phone, email, programme, academicYear, registeredBy: req.adminUsername || "admin",
    });
    res.json(result);
  } catch (err) {
    console.error("[/admin/students POST] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not register student." });
  }
});

// POST /admin/students/:id/payment-plan — { label, frequency, totalAmount, periodCount, startDate }
router.post("/students/:id/payment-plan", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { label, frequency, totalAmount, periodCount, startDate } = req.body as {
      label?: string; frequency?: string; totalAmount?: number; periodCount?: number; startDate?: string;
    };
    if (!label || !frequency || !totalAmount || !periodCount || !startDate) {
      return res.status(400).json({ error: "label, frequency, totalAmount, periodCount, and startDate are all required." });
    }
    if (!["daily", "weekly", "monthly", "semester"].includes(frequency)) {
      return res.status(400).json({ error: "frequency must be one of: daily, weekly, monthly, semester." });
    }
    const result = await createPaymentPlanForStudent({
      studentRowId: req.params.id, label, frequency: frequency as any,
      totalAmount: Number(totalAmount), periodCount: Number(periodCount), startDate,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[/admin/students/:id/payment-plan] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not create payment plan." });
  }
});

// GET /admin/fee-structures
router.get("/fee-structures", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const feeStructures = await listFeeStructures();
    res.json({ feeStructures });
  } catch (err) {
    console.error("[/admin/fee-structures] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load fee structures." });
  }
});

// ==========================================================================
// Payments — Verification + Transactions tabs
// ==========================================================================

// GET /admin/transactions?limit= — full payment_submissions history, any status
router.get("/transactions", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const transactions = await listTransactions(limit);
    res.json({ transactions });
  } catch (err) {
    console.error("[/admin/transactions] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load transactions." });
  }
});

// GET /admin/payments/pending — cash deposits awaiting verification
router.get("/payments/pending", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const submissions = await listPendingPayments();
    res.json({ submissions });
  } catch (err) {
    console.error("[/admin/payments/pending] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load pending payments." });
  }
});

// POST /admin/payments/:id/verify
router.post("/payments/:id/verify", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try {
    const result = await verifyPendingPayment(req.params.id, req.adminUsername || "admin");
    res.json({ success: true, alreadyProcessed: (result as any)?.alreadyProcessed === true });
  } catch (err) {
    console.error("[/admin/payments/:id/verify] error:", (err as Error).message);
    res.status(500).json({ error: "Could not verify payment." });
  }
});

// POST /admin/payments/:id/reject — { reason }
router.post("/payments/:id/reject", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason) return res.status(400).json({ error: "reason is required." });
    await rejectPendingPayment(req.params.id, reason);
    res.json({ success: true });
  } catch (err) {
    console.error("[/admin/payments/:id/reject] error:", (err as Error).message);
    res.status(500).json({ error: "Could not reject payment." });
  }
});

// ==========================================================================
// Courses — "Add Course" quick action
// ==========================================================================

// GET /admin/courses?q=&limit=
router.get("/courses", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const limit = Math.min(Number(req.query.limit) || 100, 300);
    const courses = await listCourses(q, limit);
    res.json({ courses });
  } catch (err) {
    console.error("[/admin/courses GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load courses." });
  }
});

// GET /admin/courses/:id — course detail with class/student counts
router.get("/courses/:id", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const course = await getCourse(req.params.id);
    res.json(course);
  } catch (err) {
    console.error("[/admin/courses/:id GET] error:", (err as Error).message);
    res.status(404).json({ error: (err as Error).message || "Course not found." });
  }
});

// POST /admin/courses — { code, name, programme, level, semester, creditUnits }
router.post("/courses", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { code, name, programme, level, semester, creditUnits } = req.body as {
      code?: string; name?: string; programme?: string; level?: string; semester?: string; creditUnits?: number;
    };
    if (!code || !name || !programme || !level || !semester) {
      return res.status(400).json({ error: "code, name, programme, level, and semester are all required." });
    }
    const course = await addCourse({ code, name, programme, level, semester, creditUnits: Number(creditUnits) || 3 });
    res.json({ success: true, course });
  } catch (err) {
    console.error("[/admin/courses POST] error:", (err as Error).message);
    res.status(500).json({ error: "Could not add course." });
  }
});

// ==========================================================================
// Staff — "Manage Staff" quick action
// ==========================================================================

// GET /admin/staff
router.get("/staff", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const staff = await listStaff();
    res.json({ staff });
  } catch (err) {
    console.error("[/admin/staff GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load staff." });
  }
});

// POST /admin/staff — { username, password, fullName }
// Ongoing path for adding accounts once the very first one exists (see
// /admin/setup, which locks itself out after that). Every account created
// here gets full admin permissions — no role tiers yet.
router.post("/staff", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { username, password, fullName } = req.body as { username?: string; password?: string; fullName?: string };
    if (!username || !password || !fullName) {
      return res.status(400).json({ error: "username, password, and fullName are all required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    const cleanUsername = username.trim();
    if (cleanUsername.length < 3 || /\s/.test(cleanUsername)) {
      return res.status(400).json({ error: "Username must be at least 3 characters with no spaces." });
    }
    const staff = await addStaff({ username: cleanUsername, password, fullName: fullName.trim() });
    res.json({ success: true, staff });
  } catch (err) {
    console.error("[/admin/staff POST] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not add staff account." });
  }
});

// ==========================================================================
// Grades — "Enter Grades" quick action
// Chain: Class (course + enrolled students) -> Assessment Item -> Marks.
// ==========================================================================

// GET /admin/classes?courseId= — omit courseId for the global Classes list
router.get("/classes", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const courseId = typeof req.query.courseId === "string" ? req.query.courseId : undefined;
    const classes = await listClasses(courseId);
    res.json({ classes });
  } catch (err) {
    console.error("[/admin/classes GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load classes." });
  }
});

// POST /admin/classes — { courseCode, instructorName, academicYear, studentIds: string[] }
router.post("/classes", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { courseCode, instructorName, academicYear, studentIds } = req.body as {
      courseCode?: string; instructorName?: string; academicYear?: string; studentIds?: string[];
    };
    if (!courseCode || !instructorName || !academicYear) {
      return res.status(400).json({ error: "courseCode, instructorName, and academicYear are all required." });
    }
    const cls = await createClass({
      courseCode, instructorName, academicYear, studentIds: Array.isArray(studentIds) ? studentIds : [],
    });
    res.json({ success: true, class: cls });
  } catch (err) {
    console.error("[/admin/classes POST] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not create class." });
  }
});

// GET /admin/classes/:id — class detail (instructor, course, student count)
router.get("/classes/:id", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const cls = await getClassDetail(req.params.id);
    res.json(cls);
  } catch (err) {
    console.error("[/admin/classes/:id GET] error:", (err as Error).message);
    res.status(404).json({ error: (err as Error).message || "Class not found." });
  }
});

// GET /admin/classes/:id/students
router.get("/classes/:id/students", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const students = await listClassStudents(req.params.id);
    res.json({ students });
  } catch (err) {
    console.error("[/admin/classes/:id/students] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load class roster." });
  }
});

// POST /admin/classes/:id/students — { studentId } — enroll one more student
router.post("/classes/:id/students", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { studentId } = req.body as { studentId?: string };
    if (!studentId) return res.status(400).json({ error: "studentId is required." });
    const result = await addStudentToClass(req.params.id, studentId);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[/admin/classes/:id/students POST] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not add student to class." });
  }
});

// GET /admin/classes/:id/timetable
router.get("/classes/:id/timetable", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const slots = await listTimetableSlots(req.params.id);
    res.json({ slots });
  } catch (err) {
    console.error("[/admin/classes/:id/timetable GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load timetable." });
  }
});

// POST /admin/classes/:id/timetable — { dayOfWeek, startTime, endTime, room }
router.post("/classes/:id/timetable", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { dayOfWeek, startTime, endTime, room } = req.body as {
      dayOfWeek?: string; startTime?: string; endTime?: string; room?: string;
    };
    if (!dayOfWeek || !startTime || !endTime || !room) {
      return res.status(400).json({ error: "dayOfWeek, startTime, endTime, and room are all required." });
    }
    const slot = await addTimetableSlot({ classId: req.params.id, dayOfWeek, startTime, endTime, room });
    res.json({ success: true, slot });
  } catch (err) {
    console.error("[/admin/classes/:id/timetable POST] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not add timetable slot." });
  }
});

// DELETE /admin/timetable/:slotId
router.delete("/timetable/:slotId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    await deleteTimetableSlot(req.params.slotId);
    res.json({ success: true });
  } catch (err) {
    console.error("[/admin/timetable/:slotId DELETE] error:", (err as Error).message);
    res.status(500).json({ error: "Could not delete timetable slot." });
  }
});

// GET /admin/classes/:id/attendance?date=YYYY-MM-DD — existing marks for that date, to prefill
router.get("/classes/:id/attendance", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    if (!date) return res.status(400).json({ error: "date query param is required (YYYY-MM-DD)." });
    const records = await getClassAttendance(req.params.id, date);
    res.json({ records });
  } catch (err) {
    console.error("[/admin/classes/:id/attendance GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load attendance." });
  }
});

// POST /admin/classes/:id/attendance — { date, marks: [{ studentRowId, mark }] }
router.post("/classes/:id/attendance", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { date, marks } = req.body as { date?: string; marks?: { studentRowId: string; mark: string }[] };
    if (!date || !Array.isArray(marks) || marks.length === 0) {
      return res.status(400).json({ error: "date and a non-empty marks array are required." });
    }
    const result = await saveAttendance({ classId: req.params.id, date, marks });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[/admin/classes/:id/attendance POST] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not save attendance." });
  }
});

// ==========================================================================
// Results — publish gate on top of assessment_items/marks (see the
// adminOpsService comment for why this is a 3-state, single-tier workflow
// rather than the plan's full 5-stage HOD approval).
// ==========================================================================

// GET /admin/classes/:id/result-status
router.get("/classes/:id/result-status", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const status = await getResultBatchStatus(req.params.id);
    res.json(status);
  } catch (err) {
    console.error("[/admin/classes/:id/result-status] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load result status." });
  }
});

// POST /admin/classes/:id/results/submit — draft -> pending_review
router.post("/classes/:id/results/submit", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const result = await submitResultsForReview(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[/admin/classes/:id/results/submit] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not submit results." });
  }
});

// POST /admin/classes/:id/results/approve — pending_review -> published
router.post("/classes/:id/results/approve", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const result = await publishResults(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[/admin/classes/:id/results/approve] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not publish results." });
  }
});

// POST /admin/classes/:id/results/return — { reason } — pending_review -> draft
router.post("/classes/:id/results/return", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason) return res.status(400).json({ error: "reason is required." });
    const result = await returnResultsToLecturer(req.params.id, reason);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[/admin/classes/:id/results/return] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not return results." });
  }
});

// GET /admin/classes/:id/assessment-items
router.get("/classes/:id/assessment-items", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const items = await listAssessmentItems(req.params.id);
    res.json({ items });
  } catch (err) {
    console.error("[/admin/classes/:id/assessment-items GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load assessment items." });
  }
});

// POST /admin/classes/:id/assessment-items — { name, maxScore, weight }
router.post("/classes/:id/assessment-items", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { name, maxScore, weight } = req.body as { name?: string; maxScore?: number; weight?: number };
    if (!name || !maxScore || !weight) {
      return res.status(400).json({ error: "name, maxScore, and weight are all required." });
    }
    const item = await createAssessmentItem({ classId: req.params.id, name, maxScore: Number(maxScore), weight: Number(weight) });
    res.json({ success: true, item });
  } catch (err) {
    console.error("[/admin/classes/:id/assessment-items POST] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not create assessment item." });
  }
});

// GET /admin/marks?assessmentItemId=
router.get("/marks", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const assessmentItemId = req.query.assessmentItemId as string;
    if (!assessmentItemId) return res.status(400).json({ error: "assessmentItemId is required." });
    const marks = await getMarks(assessmentItemId);
    res.json({ marks });
  } catch (err) {
    console.error("[/admin/marks GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load marks." });
  }
});

// POST /admin/marks — { assessmentItemId, classId, scores: [{ studentRowId, score }] }
router.post("/marks", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { assessmentItemId, classId, scores } = req.body as {
      assessmentItemId?: string; classId?: string; scores?: { studentRowId: string; score: number }[];
    };
    if (!assessmentItemId || !classId || !Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({ error: "assessmentItemId, classId, and a non-empty scores array are required." });
    }
    const result = await saveMarks({ assessmentItemId, classId, scores });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[/admin/marks POST] error:", (err as Error).message);
    res.status(500).json({ error: "Could not save marks." });
  }
});

// GET /admin/notifications?limit= — fuller activity feed than the dashboard's 6-item summary
router.get("/notifications", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const activities = await getRecentActivities(limit);
    res.json({ activities });
  } catch (err) {
    console.error("[/admin/notifications] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load notifications." });
  }
});

// POST /admin/change-password — { currentPassword, newPassword }
router.post("/change-password", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are both required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    await changeAdminPassword(req.adminId as string, currentPassword, newPassword);
    res.json({ success: true });
  } catch (err) {
    console.error("[/admin/change-password] error:", (err as Error).message);
    res.status(400).json({ error: (err as Error).message || "Could not change password." });
  }
});

// ==========================================================================
// Chat — staff side of each student's thread
// ==========================================================================

// GET /admin/chat/needing-reply — threads where the student's latest message is unanswered
router.get("/chat/needing-reply", requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const threads = await listThreadsNeedingReply();
    res.json({ threads });
  } catch (err) {
    console.error("[/admin/chat/needing-reply] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load chat threads." });
  }
});

// GET /admin/chat/:studentRowId — full thread history
router.get("/chat/:studentRowId", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const messages = await getChatThread(req.params.studentRowId);
    res.json({ messages });
  } catch (err) {
    console.error("[/admin/chat/:studentRowId GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load chat thread." });
  }
});

// POST /admin/chat/:studentRowId — { message }
router.post("/chat/:studentRowId", requireAdminAuth, async (req: AdminRequest, res: Response) => {
  try {
    const { message } = req.body as { message?: string };
    if (!message) return res.status(400).json({ error: "message is required." });
    await sendAdminChatMessage(req.params.studentRowId, message, req.adminUsername || "Staff");
    res.json({ success: true });
  } catch (err) {
    console.error("[/admin/chat/:studentRowId POST] error:", (err as Error).message);
    res.status(500).json({ error: "Could not send message." });
  }
});

// GET /admin/reports/:type — one table-shaped report (see reportsService for the types)
router.get("/reports/:type", requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const type = req.params.type as ReportType;
    if (!REPORT_TYPES.includes(type)) {
      return res.status(404).json({ error: `Unknown report. Valid types: ${REPORT_TYPES.join(", ")}.` });
    }
    res.json(await buildReport(type));
  } catch (err) {
    console.error("[/admin/reports/:type] error:", (err as Error).message);
    res.status(500).json({ error: "Could not build report." });
  }
});

export default router;
