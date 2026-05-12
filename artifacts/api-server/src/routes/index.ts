import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import dwalletRouter from "./dwallet.js";
import nativeRouter from "./native.js";
import privateIntentRouter from "./privateIntent.js";
import aiRouter from "./aiRoutes.js";
import vaultRouter from "./vault.js";
import darkpoolRouter from "./darkpool.js";
import ratesRouter from "./rates.js";
import stealthReceiveRouter from "./stealthReceive.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dwalletRouter);
router.use(nativeRouter);
router.use(privateIntentRouter);
router.use(aiRouter);
router.use(vaultRouter);
router.use(darkpoolRouter);
router.use(ratesRouter);
router.use(stealthReceiveRouter);

export default router;
