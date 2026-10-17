import { DuplicateRequestError } from "../services/errors.js";
import { Router, Request, Response } from "express";
import { submitApplication } from "../services/applicationSubmissionService.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { getSupabase } from "../db/supabaseClient.js";
import { validateLevel } from "../services/applicationPaymentPolicy.js";

const router = Router();

// POST /applications/submit — public, no auth (this IS the sign-up form).
// Returns the application number and the PIN. The applicant uses both to sign in to the portal and app.
router.post("/submit", rateLimit("application-submit", 20, 60*60*1000), async (req: Request, res: Response) => {
  try {
    const { fullName, phone, email, programme, academicYear, intake, studyMode, programmeLevel } = req.body as {
      fullName?: string; phone?: string; email?: string; programme?: string;
      academicYear?: string; intake?: string; studyMode?: string; programmeLevel?: unknown;
    };
    if (!fullName || !phone || !programme || !academicYear || !intake || !studyMode) {
      return res.status(400).json({ error: "fullName, phone, programme, academicYear, intake, and studyMode are all required." });
    }
    if (!validateLevel(programmeLevel)) {
      return res.status(400).json({ error: "Choose Certificate or Diploma." });
    }
    const application = await submitApplication({ fullName, phone, email, programme, academicYear, intake, studyMode });
    const applicationNumber = application.application_number;
    if (!applicationNumber) throw new Error("The application number was not created.");
    const supabase = getSupabase();
    await supabase.from("applications").update({ programme_level: programmeLevel }).eq("application_number", applicationNumber);
    const { data: row } = await supabase.from("applications").select("pin_id").eq("application_number", applicationNumber).maybeSingle();
    const pinId = (row as unknown as { pin_id: string } | null)?.pin_id;
    const { data: pinRow } = pinId
      ? await supabase.from("application_pins").select("pin").eq("id", pinId).maybeSingle()
      : { data: null };
    res.json({
      success: true,
      applicationNumber,
      pin: (pinRow as unknown as { pin: string } | null)?.pin || null,
    });
  } catch (err) {
    console.error("[/applications/submit] error:", (err as Error).message);
    if (err instanceof DuplicateRequestError) return res.status(409).json({ error: (err as Error).message });
    res.status(500).json({ error: "Could not submit application." });
  }
});

export default router;
