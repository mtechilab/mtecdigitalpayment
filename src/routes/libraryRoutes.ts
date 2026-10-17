import { canTeach, isAdministratorRole } from "../services/staffValidation.js";
import { Router, Request, Response, NextFunction } from "express";
import { requireStaffAuth, StaffRequest } from "../middleware/staffAuth.js";
import { requireStudentAuth, AuthenticatedRequest } from "../middleware/auth.js";
import { requireAdminAuth, AdminRequest } from "../middleware/adminAuth.js";
import { createLibraryItem, addLibraryVersion, approveLibraryItem, rejectLibraryItem, listLibrary, getLibraryDownload, LibraryFilters, createLibraryItemByAdmin, updateLibraryItemDetails, setLibraryItemArchived, deleteLibraryItem } from "../services/libraryService.js";

function filtersFrom(query: Request["query"]): LibraryFilters {
  const pick = (k: string) => (typeof query[k] === "string" ? (query[k] as string).trim().slice(0, 120) : undefined);
  return {
    programme: pick("programme"), courseCode: pick("courseCode"), semester: pick("semester"),
    academicYear: pick("academicYear"), materialType: pick("materialType"), search: pick("q"),
  };
}

/** Administrators see and version all staff material; lecturers see their own. */
function viewerOf(staff: { id: string; role: string }) {
  return isAdministratorRole(staff.role) ? { role: "admin" as const } : { role: "lecturer" as const, staffId: staff.id };
}

function fail(res: Response, err: unknown, fallback: string) {
  const message = (err as Error).message || fallback;
  const status = /not found/i.test(message) ? 404 : /only|not available/i.test(message) ? 403 : 400;
  res.status(status).json({ error: message });
}

/** Lecturers only. Requires an individual staff session, since the shared key cannot say who acted. */
function requireLecturer(req: Request, res: Response, next: NextFunction) {
  const staff = (req as StaffRequest).staff;
  if (!staff) return res.status(401).json({ error: "Sign in with your own staff account." });
  if (!canTeach(staff.role)) return res.status(403).json({ error: "Only lecturers and administrators can use the library." });
  next();
}

export const staffLibraryRouter = Router();
staffLibraryRouter.use(requireStaffAuth, requireLecturer);

staffLibraryRouter.get("/", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff!;
    res.json({ items: await listLibrary(viewerOf(staff), filtersFrom(req.query)) });
  } catch (err) { fail(res, err, "Could not load the library."); }
});

staffLibraryRouter.post("/", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff!;
    const body = req.body as Record<string, string | undefined>;
    const result = await createLibraryItem({ id: staff.id, name: staff.fullName }, {
      title: body.title || "", description: body.description, programme: body.programme || "",
      courseCode: body.courseCode, semester: body.semester, academicYear: body.academicYear || "",
      topic: body.topic, fileName: body.fileName || "", contentType: body.contentType || "", fileBase64: body.fileBase64 || "",
    });
    res.json({ success: true, ...result });
  } catch (err) { fail(res, err, "Could not upload the material."); }
});

staffLibraryRouter.post("/:id/versions", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff!;
    const body = req.body as Record<string, string | undefined>;
    const result = await addLibraryVersion({ id: staff.id, name: staff.fullName, role: staff.role }, req.params.id, {
      fileName: body.fileName || "", contentType: body.contentType || "", fileBase64: body.fileBase64 || "",
    });
    res.json({ success: true, ...result });
  } catch (err) { fail(res, err, "Could not add the new version."); }
});

staffLibraryRouter.get("/:id/download", async (req: Request, res: Response) => {
  try {
    const staff = (req as StaffRequest).staff!;
    res.json(await getLibraryDownload(viewerOf(staff), req.params.id));
  } catch (err) { fail(res, err, "Could not create the download link."); }
});

export const studentLibraryRouter = Router();
studentLibraryRouter.use(requireStudentAuth);

studentLibraryRouter.get("/", async (req: Request, res: Response) => {
  try {
    res.json({ items: await listLibrary({ role: "student" }, filtersFrom(req.query)) });
  } catch (err) { fail(res, err, "Could not load the library."); }
});

studentLibraryRouter.get("/:id/download", async (req: AuthenticatedRequest, res: Response) => {
  try {
    res.json(await getLibraryDownload({ role: "student" }, req.params.id));
  } catch (err) { fail(res, err, "Could not create the download link."); }
});

export const adminLibraryRouter = Router();
adminLibraryRouter.use(requireAdminAuth);

adminLibraryRouter.get("/", async (req: Request, res: Response) => {
  try {
    res.json({ items: await listLibrary({ role: "admin" }, filtersFrom(req.query)) });
  } catch (err) { fail(res, err, "Could not load the library."); }
});

adminLibraryRouter.post("/:id/approve", async (req: AdminRequest, res: Response) => {
  try {
    res.json(await approveLibraryItem(req.adminUsername || "admin", req.params.id));
  } catch (err) { fail(res, err, "Could not approve the material."); }
});

adminLibraryRouter.post("/:id/reject", async (req: AdminRequest, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    res.json(await rejectLibraryItem(req.adminUsername || "admin", req.params.id, reason || ""));
  } catch (err) { fail(res, err, "Could not reject the material."); }
});

adminLibraryRouter.post("/", async (req: AdminRequest, res: Response) => {
  try {
    const b = req.body as Record<string, string | undefined>;
    res.json(await createLibraryItemByAdmin(req.adminUsername || "admin", {
      title: b.title || "", description: b.description, programme: b.programme || "", courseCode: b.courseCode,
      semester: b.semester, academicYear: b.academicYear || "", topic: b.topic,
      fileName: b.fileName || "", contentType: b.contentType || "", fileBase64: b.fileBase64 || "",
    }));
  } catch (err) { fail(res, err, "Could not add the material."); }
});

adminLibraryRouter.post("/:id/update", async (req: AdminRequest, res: Response) => {
  try {
    const b = req.body as Record<string, string | undefined>;
    res.json(await updateLibraryItemDetails(req.adminUsername || "admin", req.params.id, {
      title: b.title, description: b.description, programme: b.programme, courseCode: b.courseCode,
      semester: b.semester, academicYear: b.academicYear, topic: b.topic,
    }));
  } catch (err) { fail(res, err, "Could not update the material."); }
});

adminLibraryRouter.post("/:id/archive", async (req: AdminRequest, res: Response) => {
  try {
    const { archived } = req.body as { archived?: boolean };
    if (typeof archived !== "boolean") return res.status(400).json({ error: "archived must be true or false." });
    res.json(await setLibraryItemArchived(req.adminUsername || "admin", req.params.id, archived));
  } catch (err) { fail(res, err, "Could not change the material."); }
});

adminLibraryRouter.delete("/:id", async (req: AdminRequest, res: Response) => {
  try { res.json(await deleteLibraryItem(req.adminUsername || "admin", req.params.id)); }
  catch (err) { fail(res, err, "Could not delete the material."); }
});

adminLibraryRouter.get("/:id/download", async (req: Request, res: Response) => {
  try {
    const v = typeof req.query.version === "string" ? Number(req.query.version) : undefined;
    res.json(await getLibraryDownload({ role: "admin" }, req.params.id, v));
  } catch (err) { fail(res, err, "Could not create the download link."); }
});
