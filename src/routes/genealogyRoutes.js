import express from "express";
import { getDownlineTree, getTreeStats } from "../controllers/genealogyController.js";
import { protect } from "../middlewares/auth.js";

const router = express.Router();

router.use(protect);

router.get("/tree", getDownlineTree);
router.get("/stats", getTreeStats);

export default router;
