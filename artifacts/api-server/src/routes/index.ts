import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import transcriptRouter from "./transcript.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(transcriptRouter);

export default router;
