import { Router, Request, Response } from "express";
import { publicCatalogue } from "../services/catalogueService.js";

/** Public: the programme catalogue with prices and thumbnails, for the student app and the web. */
export const publicCatalogueRouter = Router();

publicCatalogueRouter.get("/", async (_req: Request, res: Response) => {
  try { res.json({ programmes: await publicCatalogue() }); }
  catch (err) { res.status(500).json({ error: (err as Error).message || "Could not load the programmes." }); }
});
