import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import {
  listUsers, getUser, updateProfile,
  updateMyProfile, listSessions, revokeSession,
  listVerifications, reviewVerification,
} from "./users.controller.js";

import {
  listMyEducation, listUserEducation, addEducation, updateEducation, deleteEducation,
  listMyAffiliations, listUserAffiliations, addAffiliation, updateAffiliation, deleteAffiliation,
  searchOrgsLite,
} from "../auth/profile-extras.controller.js";
 
const router = Router();

// Own profile
router.get ("/me/profile",          authenticate, updateMyProfile);   // GET returns profile
router.put ("/me/profile",          authenticate, updateMyProfile);
router.get ("/me/sessions",         authenticate, listSessions);
router.delete("/me/sessions/:id",   authenticate, revokeSession);

// Admin: user management
router.get ("/",                    authenticate, authorize("users.read"),   listUsers);
router.get ("/:id",                 authenticate, authorize("users.read"),   getUser);
router.put ("/:id/profile",         authenticate, authorize("users.update"), updateProfile);
router.get ("/verifications",       authenticate, authorize("verification.review"), listVerifications);
router.patch("/verifications/:id",  authenticate, authorize("verification.review"), reviewVerification);

// ── 学历 ──
router.get   ("/me/education",           authenticate, listMyEducation);
router.post  ("/me/education",           authenticate, addEducation);
router.put   ("/me/education/:id",       authenticate, updateEducation);
router.delete("/me/education/:id",       authenticate, deleteEducation);
router.get   ("/:userId/education",      authenticate, listUserEducation);   // 查看别人的资料页
export default router;
