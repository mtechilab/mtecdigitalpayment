import { Router, Request, Response } from "express";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { Viewer, studentViewer } from "../services/messagingService.js";
import { parseIceServers } from "../services/callPolicy.js";
import { startCall, incomingCalls, callState, answerCall, rejectCall, endCall, sendSignal, fetchSignals } from "../services/callService.js";

type ViewerOf = (req: Request) => Promise<Viewer>;

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  const status = /not found/i.test(message) ? 404
    : /already in progress|no longer|timed out|has ended/i.test(message) ? 409
    : 400;
  res.status(status).json({ error: message });
}

/** The same call endpoints for students and staff. Each router passes in how to find the viewer. */
function registerCallRoutes(router: Router, viewerOf: ViewerOf) {
  // Connection settings for the phone. Read from ICE_SERVERS_JSON; STUN by default.
  router.get("/ice", (_req: Request, res: Response) => {
    res.json({ iceServers: parseIceServers(process.env.ICE_SERVERS_JSON) });
  });

  router.post("/start", async (req: Request, res: Response) => {
    try {
      const { conversationId, mode } = (req.body || {}) as { conversationId?: string; mode?: unknown };
      if (!conversationId) return res.status(400).json({ error: "conversationId is required." });
      res.json(await startCall(await viewerOf(req), conversationId, mode));
    } catch (err) { fail(res, err, "Could not start the call."); }
  });

  router.get("/incoming", async (req: Request, res: Response) => {
    try { res.json({ calls: await incomingCalls(await viewerOf(req)) }); }
    catch (err) { fail(res, err, "Could not check for calls."); }
  });

  router.get("/:callId", async (req: Request, res: Response) => {
    try { res.json(await callState(await viewerOf(req), req.params.callId)); }
    catch (err) { fail(res, err, "Could not load the call."); }
  });

  router.post("/:callId/answer", async (req: Request, res: Response) => {
    try { res.json(await answerCall(await viewerOf(req), req.params.callId)); }
    catch (err) { fail(res, err, "Could not answer the call."); }
  });

  router.post("/:callId/reject", async (req: Request, res: Response) => {
    try { res.json(await rejectCall(await viewerOf(req), req.params.callId)); }
    catch (err) { fail(res, err, "Could not decline the call."); }
  });

  router.post("/:callId/end", async (req: Request, res: Response) => {
    try { res.json(await endCall(await viewerOf(req), req.params.callId)); }
    catch (err) { fail(res, err, "Could not end the call."); }
  });

  router.post("/:callId/signal", async (req: Request, res: Response) => {
    try {
      const { kind, payload } = (req.body || {}) as { kind?: unknown; payload?: unknown };
      res.json(await sendSignal(await viewerOf(req), req.params.callId, kind, payload));
    } catch (err) { fail(res, err, "Could not send the signal."); }
  });

  router.get("/:callId/signals", async (req: Request, res: Response) => {
    try {
      const after = Number(req.query.after || 0);
      res.json({ signals: await fetchSignals(await viewerOf(req), req.params.callId, Number.isFinite(after) ? after : 0) });
    } catch (err) { fail(res, err, "Could not load the signals."); }
  });
}

export const studentCallRouter = Router();
studentCallRouter.use(requireStudentAuth);
registerCallRoutes(studentCallRouter, async (req) => studentViewer((req as AuthenticatedRequest).studentRowId as string));

export const staffCallRouter = Router();
staffCallRouter.use(requireStaffAuth);
registerCallRoutes(staffCallRouter, async (req) => {
  const staff = (req as StaffRequest).staff;
  if (!staff) throw new Error("Sign in with your own staff account.");
  return { kind: "staff", id: staff.id, name: staff.fullName, role: staff.role };
});
