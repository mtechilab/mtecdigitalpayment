import { Router, Request, Response } from "express";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { uploadProfilePhoto, profilePhotoUrl } from "../services/profilePhotoService.js";

export const studentProfilePhotoRouter = Router();
studentProfilePhotoRouter.use(requireStudentAuth);

// GET — the student's current photo link, or null if none
studentProfilePhotoRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ url: await profilePhotoUrl(req.studentRowId as string) });
  } catch (err) {
    console.error("[/profile-photo GET] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load the photo." });
  }
});

// POST — { contentType, base64 }. Only the signed-in student's own photo is changed.
studentProfilePhotoRouter.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { contentType, base64 } = req.body as { contentType?: string; base64?: string };
    if (!contentType || !base64) return res.status(400).json({ error: "contentType and base64 are required." });
    res.json(await uploadProfilePhoto(req.studentRowId as string, contentType, base64));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message || "Could not save the photo." });
  }
});
