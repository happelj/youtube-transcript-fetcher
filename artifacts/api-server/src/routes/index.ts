import { Router } from "express";
import healthRouter from "./health.js";
import transcriptRouter from "./transcript.js";

const router = Router();

router.use(healthRouter);
router.use(transcriptRouter);

export default router;
