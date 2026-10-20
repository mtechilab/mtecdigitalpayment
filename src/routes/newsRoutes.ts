import { Router, Request, Response } from "express";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import { createPost, listPostsForAdmin, deletePost, feedForStudent, markRead } from "../services/newsService.js";

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
}

export const studentNewsRouter = Router();
studentNewsRouter.use(requireStudentAuth);

studentNewsRouter.get("/feed", async (req: Request, res: Response) => {
  try { res.json(await feedForStudent((req as AuthenticatedRequest).studentRowId as string)); }
  catch (err) { fail(res, err, "Could not load the news."); }
});

studentNewsRouter.post("/feed/:id/read", async (req: Request, res: Response) => {
  try { res.json(await markRead((req as AuthenticatedRequest).studentRowId as string, req.params.id)); }
  catch (err) { fail(res, err, "Could not mark it as read."); }
});

export const adminNewsRouter = Router();
adminNewsRouter.use(requireAdminAuth);

adminNewsRouter.get("/posts", async (_req: AdminRequest, res: Response) => {
  try { res.json({ posts: await listPostsForAdmin() }); }
  catch (err) { fail(res, err, "Could not load the posts."); }
});

adminNewsRouter.post("/posts", async (req: AdminRequest, res: Response) => {
  try {
    const b = (req.body || {}) as Record<string, unknown>;
    res.json(await createPost(req.adminUsername || "admin", {
      kind: b.kind, title: b.title, body: b.body, audience: b.audience ?? "all", expiresAt: b.expiresAt ?? null,
      imageBase64: b.imageBase64, imageType: b.imageType,
    }));
  } catch (err) { fail(res, err, "Could not publish the post."); }
});

adminNewsRouter.post("/posts/:id/delete", async (req: AdminRequest, res: Response) => {
  try { res.json(await deletePost(req.adminUsername || "admin", req.params.id)); }
  catch (err) { fail(res, err, "Could not delete the post."); }
});
