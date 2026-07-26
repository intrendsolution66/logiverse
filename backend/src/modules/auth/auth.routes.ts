// backend/src/modules/auth/auth.routes.ts
//
// Changes from your original:
//   - `register` is no longer mounted as a public route. The education
//     platform doesn't allow self-serve sign-up — accounts are created by
//     an operator/teacher via the new `createManagedUser` endpoint below.
//     (Left the import/handler in auth.controller.ts untouched in case you
//     want to re-enable public registration for a different deployment —
//     just add the route back here if so.)
//   - Added POST /users, gated behind `authorize("users.create")`, for
//     operator/teacher-created student & parent accounts (IC as username).

import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import {
  login, refreshToken, logout, logoutAll,
  getMe, changePassword, forgotPassword,
  submitVerification, getMyVerification,
  createManagedUser,
} from "./auth.controller.js";

const router = Router();

// Public
router.post("/login",           login);
router.post("/refresh",         refreshToken);
router.post("/forgot-password", forgotPassword);

// Authenticated
router.get ("/me",              authenticate, getMe);
router.post("/logout",          authenticate, logout);
router.post("/logout-all",      authenticate, logoutAll);
router.put ("/change-password", authenticate, changePassword);

// Admin-managed account creation (operator/teacher only)
router.post("/users", authenticate, authorize("users.create"), createManagedUser);

// Real-name verification
router.post("/verification",    authenticate, submitVerification);
router.get ("/verification",    authenticate, getMyVerification);

export default router;
