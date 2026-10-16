import { Router, Request, Response } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { canTeach } from "../services/staffValidation.js";
import { Viewer, studentViewer, listConversations, listMessages, sendMessage, markRead, createProgrammeGroup, createClassGroup, startDirectChat, listTeachableClasses, listStudentDirectory, startStudentChat, createCallLink } from "../services/messagingService.js";

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  const status = /not found/i.test(message) ? 404 : 400;
  res.status(status).json({ error: message });
}

function bodyOf(req: Request) {
  const b = req.body as { body?: string; voice?: { base64?: string; contentType?: string; seconds?: number }; file?: { base64?: string; contentType?: string; fileName?: string } };
  const voice = b.voice && b.voice.base64 && b.voice.contentType
    ? { base64: b.voice.base64, contentType: b.voice.contentType, seconds: Number(b.voice.seconds) }
    : undefined;
  const file = b.file && b.file.base64 && b.file.contentType && b.file.fileName
    ? { base64: b.file.base64, contentType: b.file.contentType, fileName: b.file.fileName }
    : undefined;
  return { body: b.body, voice, file };
}

export const studentMessagingRouter = Router();
studentMessagingRouter.use(requireStudentAuth);

async function viewerOf(req: AuthenticatedRequest): Promise<Viewer> {
  return studentViewer(req.studentRowId as string);
}

studentMessagingRouter.get("/conversations", async (req: AuthenticatedRequest, res: Response) => {
  try { res.json({ conversations: await listConversations(await viewerOf(req)) }); }
  catch (err) { fail(res, err, "Could not load conversations."); }
});

studentMessagingRouter.get("/conversations/:id/messages", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const after = typeof req.query.after === "string" ? req.query.after : undefined;
    res.json({ messages: await listMessages(await viewerOf(req), req.params.id, after) });
  } catch (err) { fail(res, err, "Could not load messages."); }
});

studentMessagingRouter.post("/conversations/:id/messages", rateLimit("msg-post", 120, 60 * 60 * 1000), async (req: AuthenticatedRequest, res: Response) => {
  try { res.json({ success: true, ...(await sendMessage(await viewerOf(req), req.params.id, bodyOf(req))) }); }
  catch (err) { fail(res, err, "Could not send the message."); }
});

studentMessagingRouter.get("/students", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json({ students: await listStudentDirectory(await viewerOf(req), q) });
  } catch (err) { fail(res, err, "Could not search students."); }
});

studentMessagingRouter.post("/direct", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { studentRowId } = req.body as { studentRowId?: string };
    if (!studentRowId) return res.status(400).json({ error: "studentRowId is required." });
    res.json(await startStudentChat(await viewerOf(req), studentRowId));
  } catch (err) { fail(res, err, "Could not start the chat."); }
});

studentMessagingRouter.post("/conversations/:id/call-link", async (req: AuthenticatedRequest, res: Response) => {
  try { res.json({ success: true, ...(await createCallLink(await viewerOf(req), req.params.id)) }); }
  catch (err) { fail(res, err, "Could not start the call."); }
});

studentMessagingRouter.post("/conversations/:id/read", async (req: AuthenticatedRequest, res: Response) => {
  try { res.json(await markRead(await viewerOf(req), req.params.id)); }
  catch (err) { fail(res, err, "Could not mark as read."); }
});

export const staffMessagingRouter = Router();
staffMessagingRouter.use(requireStaffAuth);

function staffViewer(req: Request): Viewer {
  const staff = (req as StaffRequest).staff;
  if (!staff) throw new Error("Sign in with your own staff account.");
  return { kind: "staff", id: staff.id, name: staff.fullName, role: staff.role };
}

staffMessagingRouter.get("/conversations", async (req: Request, res: Response) => {
  try { res.json({ conversations: await listConversations(staffViewer(req)) }); }
  catch (err) { fail(res, err, "Could not load conversations."); }
});

staffMessagingRouter.get("/conversations/:id/messages", async (req: Request, res: Response) => {
  try {
    const after = typeof req.query.after === "string" ? req.query.after : undefined;
    res.json({ messages: await listMessages(staffViewer(req), req.params.id, after) });
  } catch (err) { fail(res, err, "Could not load messages."); }
});

staffMessagingRouter.post("/conversations/:id/messages", rateLimit("msg-post", 120, 60 * 60 * 1000), async (req: Request, res: Response) => {
  try { res.json({ success: true, ...(await sendMessage(staffViewer(req), req.params.id, bodyOf(req))) }); }
  catch (err) { fail(res, err, "Could not send the message."); }
});

staffMessagingRouter.post("/conversations/:id/call-link", async (req: Request, res: Response) => {
  try { res.json({ success: true, ...(await createCallLink(staffViewer(req), req.params.id)) }); }
  catch (err) { fail(res, err, "Could not start the call."); }
});

staffMessagingRouter.post("/conversations/:id/read", async (req: Request, res: Response) => {
  try { res.json(await markRead(staffViewer(req), req.params.id)); }
  catch (err) { fail(res, err, "Could not mark as read."); }
});

// The classes this staff member can open a group for, and whether each already has one.
staffMessagingRouter.get("/classes", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff!;
    res.json({ classes: await listTeachableClasses({ id: staff.id, name: staff.fullName, role: staff.role }) });
  } catch (err) { fail(res, err, "Could not load your classes."); }
});

staffMessagingRouter.post("/groups/programme", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff!;
    const { programme } = req.body as { programme?: string };
    res.json(await createProgrammeGroup({ name: staff.fullName, role: staff.role }, programme || ""));
  } catch (err) { fail(res, err, "Could not create the group."); }
});

staffMessagingRouter.post("/groups/class", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff!;
    const { classId } = req.body as { classId?: string };
    if (!classId) return res.status(400).json({ error: "classId is required." });
    res.json(await createClassGroup({ id: staff.id, name: staff.fullName, role: staff.role }, classId));
  } catch (err) { fail(res, err, "Could not create the group."); }
});

staffMessagingRouter.post("/direct", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff!;
    const { studentRowId } = req.body as { studentRowId?: string };
    if (!studentRowId) return res.status(400).json({ error: "studentRowId is required." });
    res.json(await startDirectChat({ id: staff.id, name: staff.fullName, role: staff.role }, studentRowId));
  } catch (err) { fail(res, err, "Could not start the chat."); }
});
