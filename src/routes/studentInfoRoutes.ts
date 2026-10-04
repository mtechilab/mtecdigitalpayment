import { Router, Response } from "express";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import {
  getReceipts,
  getProfile,
  getTimetable,
  getAttendance,
  getResults,
  getGpaSummary,
  getLetters,
} from "../services/studentInfoService.js";
import { getChatThread, sendStudentChatMessage } from "../services/adminOpsService.js";
import { streamResultSlip } from "../services/resultSlipService.js";
import { getSupabase } from "../db/supabaseClient.js";
import bcrypt from "bcryptjs";

const router = Router();
router.use(requireStudentAuth);

function handle(fn: (studentRowId: string) => Promise<unknown>, label: string) {
  return async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await fn(req.studentRowId as string);
      res.json(result);
    } catch (err) {
      console.error(`[/student/${label}] error:`, (err as Error).message);
      res.status(500).json({ error: `Could not load ${label}.` });
    }
  };
}

router.get("/receipts", handle(getReceipts, "receipts"));
router.get("/profile", handle(getProfile, "profile"));
router.get("/timetable", handle(getTimetable, "timetable"));
router.get("/attendance", handle(getAttendance, "attendance"));
router.get("/results", handle(getResults, "results"));
router.get("/gpa", handle(getGpaSummary, "gpa"));

// PDF stream, not JSON — can't go through handle()'s res.json() wrapper.
router.get("/result-slip", async (req: AuthenticatedRequest, res: Response) => {
  try {
    await streamResultSlip(req.studentRowId as string, res);
  } catch (err) {
    console.error("[/student/result-slip] error:", (err as Error).message);
    res.status(500).json({ error: (err as Error).message || "Could not generate result slip." });
  }
});
router.get("/letters", handle(getLetters, "letters"));

// GET /student/chat — the student's own thread with staff
router.get("/chat", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const messages = await getChatThread(req.studentRowId as string);
    res.json({ messages });
  } catch (err) {
    console.error("[/student/chat GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load chat thread." });
  }
});

// POST /student/chat — { message }
router.post("/chat", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { message } = req.body as { message?: string };
    if (!message) return res.status(400).json({ error: "message is required." });
    const supabase = getSupabase();
    const { data: student } = await supabase
      .from("students").select("full_name").eq("id", req.studentRowId as string).maybeSingle();
    await sendStudentChatMessage(req.studentRowId as string, message, student?.full_name || "Student");
    res.json({ success: true });
  } catch (err) {
    console.error("[/student/chat POST] error:", (err as Error).message);
    res.status(500).json({ error: "Could not send message." });
  }
});

// POST /student/change-password — { currentPassword, newPassword }
router.post("/change-password", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are both required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters." });
    }
    const supabase = getSupabase();
    const { data: student, error } = await supabase
      .from("students").select("password_hash").eq("id", req.studentRowId as string).maybeSingle();
    if (error || !student) return res.status(404).json({ error: "Account not found." });

    const matches = student.password_hash && (await bcrypt.compare(currentPassword, student.password_hash as string));
    if (!matches) return res.status(400).json({ error: "Current password is incorrect." });

    const newHash = await bcrypt.hash(newPassword, 10);
    await supabase.from("students").update({ password_hash: newHash }).eq("id", req.studentRowId as string);
    res.json({ success: true });
  } catch (err) {
    console.error("[/student/change-password] error:", (err as Error).message);
    res.status(500).json({ error: "Could not change password." });
  }
});

export default router;
