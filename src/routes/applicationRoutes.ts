import { Router, Request, Response } from "express";
import { submitApplication } from "../services/publicApplicationService.js";

const router = Router();

// POST /applications/submit — public, no auth
router.post("/submit", async (req: Request, res: Response) => {
  try {
    const { fullName, phone, email, programme, academicYear, intake, studyMode } = req.body as {
      fullName?: string; phone?: string; email?: string; programme?: string;
      academicYear?: string; intake?: string; studyMode?: string;
    };
    if (!fullName || !phone || !programme || !academicYear || !intake) {
      return res.status(400).json({ error: "fullName, phone, programme, academicYear, and intake are required." });
    }
    const result = await submitApplication({
      fullName, phone, email: email || "", programme, academicYear, intake,
      studyMode: studyMode || "Full-time",
    });
    res.json({ success: true, applicationNumber: result.applicationNumber });
  } catch (err) {
    console.error("[/applications/submit] error:", (err as Error).message);
    res.status(500).json({ error: "Could not submit application. Please try again." });
  }
});

export default router;
