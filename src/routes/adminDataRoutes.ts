import { Router, Request, Response } from "express";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import {
  listTables, listRows, getRow, createRow, updateRow, deactivateRow, deleteRow, changeLog,
} from "../services/adminDataService.js";

function fail(res: Response, err: unknown) {
  const message = (err as Error).message || "The request could not be completed.";
  res.status(/not found/i.test(message) ? 404 : /still used/i.test(message) ? 409 : 400).json({ error: message });
}

export const adminDataRouter = Router();
adminDataRouter.use(requireAdminAuth);
const actor = (req: AdminRequest) => req.adminUsername || "admin";
const body = (req: Request) => (req.body || {}) as { fields?: Record<string, unknown>; reason?: unknown };

adminDataRouter.get("/tables", (_req: AdminRequest, res: Response) => res.json({ tables: listTables() }));

adminDataRouter.get("/log", async (req: AdminRequest, res: Response) => {
  try {
    const table = typeof req.query.table === "string" ? req.query.table : undefined;
    const key = typeof req.query.key === "string" ? req.query.key : undefined;
    res.json({ entries: await changeLog(table, key, Number(req.query.limit) || 100) });
  } catch (err) { fail(res, err); }
});

adminDataRouter.get("/:table", async (req: AdminRequest, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json({ rows: await listRows(req.params.table, q, Number(req.query.limit) || 50) });
  } catch (err) { fail(res, err); }
});

adminDataRouter.get("/:table/:key", async (req: AdminRequest, res: Response) => {
  try { res.json({ row: await getRow(req.params.table, req.params.key) }); }
  catch (err) { fail(res, err); }
});

adminDataRouter.post("/:table", async (req: AdminRequest, res: Response) => {
  try {
    const b = body(req);
    res.json({ row: await createRow(actor(req), req.params.table, b.fields || {}, b.reason) });
  } catch (err) { fail(res, err); }
});

adminDataRouter.post("/:table/:key/update", async (req: AdminRequest, res: Response) => {
  try {
    const b = body(req);
    res.json({ row: await updateRow(actor(req), req.params.table, req.params.key, b.fields || {}, b.reason) });
  } catch (err) { fail(res, err); }
});

adminDataRouter.post("/:table/:key/deactivate", async (req: AdminRequest, res: Response) => {
  try { res.json({ row: await deactivateRow(actor(req), req.params.table, req.params.key, body(req).reason) }); }
  catch (err) { fail(res, err); }
});

adminDataRouter.post("/:table/:key/delete", async (req: AdminRequest, res: Response) => {
  try { res.json(await deleteRow(actor(req), req.params.table, req.params.key, body(req).reason)); }
  catch (err) { fail(res, err); }
});
