import { Router, Request, Response } from "express";
import { getPublicProgrammes } from "../services/programmeCatalogService.js";

const router = Router();

// GET /programmes — public catalogue, no auth. Mounted at /programmes in index.ts.
router.get("/", async (_req: Request, res: Response) => {
  try {
    const programmes = await getPublicProgrammes();
    res.json({ programmes });
  } catch (err) {
    console.error("[/programmes] error:", (err as Error).message);
    res.status(500).json({ error: "Could not load programmes." });
  }
});

export default router;
