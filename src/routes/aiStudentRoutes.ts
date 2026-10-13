import { Router, Request, Response } from "express";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { answerConcept } from "../services/aiStudioService.js";

/** General concept questions for students. Answers are not stored and nothing about the student is sent. */
export const aiStudentRouter = Router();
aiStudentRouter.use(requireStudentAuth);

aiStudentRouter.post("/ask", rateLimit("ai-ask", 30, 60 * 60 * 1000), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { question } = req.body as { question?: string };
    res.json(await answerConcept(question || ""));
  } catch (err) {
    const message = (err as Error).message || "Could not get an answer.";
    const status = /limit|not configured|misconfigured/i.test(message) ? 409 : 400;
    res.status(status).json({ error: message });
  }
});
