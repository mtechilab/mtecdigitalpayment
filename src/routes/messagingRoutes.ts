import { Router, Request, Response } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { canTeach } from "../services/staffValidation.js";
import { callMode } from "../services/messagingPolicy.js";
import { deleteScope, validateReaction } from "../services/chatPolicy.js";
import { Viewer, studentViewer, listConversations, listMessages, sendMessage, markRead, createProgrammeGroup, createClassGroup, startDirectChat, listTeachableClasses, listStudentDirectory, startStudentChat, createCallLink, deleteMessage, reactToMessage, removeReaction, setTyping, listTyping, createCustomGroup, listGroupMembers, addGroupMember, removeGroupMember } from "../services/messagingService.js";

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
  const replyTo = typeof (b as { replyTo?: unknown }).replyTo === "string" ? (b as { replyTo: string }).replyTo : undefined;
  return { body: b.body, voice, file, replyTo };
}

type ViewerOf = (req: Request) => Promise<Viewer>;

/** Delete, reactions and typing, the same for students and staff. Each router passes in how to find the viewer. */
function registerEssentials(router: Router, viewerOf: ViewerOf) {
  router.delete("/messages/:messageId", async (req: Request, res: Response) => {
    try {
      const scope = deleteScope(req.query.scope);
      if (!scope) return res.status(400).json({ error: "The scope must be 'me' or 'everyone'." });
      res.json(await deleteMessage(await viewerOf(req), req.params.messageId, scope));
    } catch (err) { fail(res, err, "Could not delete the message."); }
  });

  router.post("/messages/:messageId/reaction", async (req: Request, res: Response) => {
    try {
      const key = (req.body || {}).key;
      if (!validateReaction(key)) return res.status(400).json({ error: "Choose one of the six reactions." });
      res.json(await reactToMessage(await viewerOf(req), req.params.messageId, key));
    } catch (err) { fail(res, err, "Could not react to the message."); }
  });

  router.delete("/messages/:messageId/reaction", async (req: Request, res: Response) => {
    try { res.json(await removeReaction(await viewerOf(req), req.params.messageId)); }
    catch (err) { fail(res, err, "Could not remove the reaction."); }
  });

  router.post("/conversations/:id/typing", async (req: Request, res: Response) => {
    try { res.json(await setTyping(await viewerOf(req), req.params.id)); }
    catch (err) { fail(res, err, "Could not send the typing signal."); }
  });

  router.get("/conversations/:id/typing", async (req: Request, res: Response) => {
    try { res.json(await listTyping(await viewerOf(req), req.params.id)); }
    catch (err) { fail(res, err, "Could not load typing."); }
  });
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
  try { res.json({ success: true, ...(await createCallLink(await viewerOf(req), req.params.id, callMode((req.body || {}).mode))) }); }
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
  try { res.json({ success: true, ...(await createCallLink(staffViewer(req), req.params.id, callMode((req.body || {}).mode))) }); }
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

registerEssentials(studentMessagingRouter, async (req) => viewerOf(req as AuthenticatedRequest));
registerEssentials(staffMessagingRouter, async (req) => staffViewer(req));

/** Group routes for students and staff alike: create, list members, add, and remove or leave. */
function registerGroupRoutes(router: Router, viewerOf: ViewerOf) {
  router.post("/groups/custom", async (req: Request, res: Response) => {
    try {
      const { name, members } = (req.body || {}) as { name?: string; members?: unknown };
      res.json(await createCustomGroup(await viewerOf(req), name || "", members));
    } catch (err) { fail(res, err, "Could not create the group."); }
  });

  router.get("/conversations/:id/members", async (req: Request, res: Response) => {
    try { res.json(await listGroupMembers(await viewerOf(req), req.params.id)); }
    catch (err) { fail(res, err, "Could not load the members."); }
  });

  router.post("/conversations/:id/members", async (req: Request, res: Response) => {
    try {
      const { kind, id } = (req.body || {}) as { kind?: string; id?: string };
      if ((kind !== "student" && kind !== "staff") || !id) return res.status(400).json({ error: "Choose a student or staff member." });
      res.json(await addGroupMember(await viewerOf(req), req.params.id, { kind, id }));
    } catch (err) { fail(res, err, "Could not add the person."); }
  });

  router.post("/conversations/:id/members/remove", async (req: Request, res: Response) => {
    try {
      const { kind, id } = (req.body || {}) as { kind?: string; id?: string };
      if ((kind !== "student" && kind !== "staff") || !id) return res.status(400).json({ error: "Choose a student or staff member." });
      res.json(await removeGroupMember(await viewerOf(req), req.params.id, { kind, id }));
    } catch (err) { fail(res, err, "Could not remove the person."); }
  });
}

registerGroupRoutes(studentMessagingRouter, async (req) => viewerOf(req as AuthenticatedRequest));
registerGroupRoutes(staffMessagingRouter, async (req) => staffViewer(req));
