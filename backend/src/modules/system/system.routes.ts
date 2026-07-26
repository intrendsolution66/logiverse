import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import {
  getLookupOptions, getSettings, upsertSetting,
  listIdentityProviders, updateIdentityProvider,
  listTranslations, upsertTranslation,
  listGlobalRoles, createRole, updateRole, deleteRole,
  listPermissions, assignRoleToUser, removeRoleFromUser,
} from "./system.controller.js";

const router = Router();

// Lookups (public)
router.get("/lookup",       getLookupOptions);
router.get("/providers",    listIdentityProviders);

// Translations (public read)
router.get("/i18n",         listTranslations);
router.put("/i18n/:key",    authenticate, authorize("i18n.manage"), upsertTranslation);

// Settings
router.get("/settings",     authenticate, authorize("config.read"),   getSettings);
router.put("/settings/:key",authenticate, authorize("config.manage"), upsertSetting);

// Global RBAC
router.get   ("/roles",         authenticate, authorize("rbac.read"),   listGlobalRoles);
router.post  ("/roles",         authenticate, authorize("rbac.manage"), createRole);
router.put   ("/roles/:id",     authenticate, authorize("rbac.manage"), updateRole);
router.delete("/roles/:id",     authenticate, authorize("rbac.manage"), deleteRole);
router.get   ("/permissions",   authenticate, authorize("rbac.read"),   listPermissions);

// Assign/remove roles
router.post  ("/users/:userId/roles",           authenticate, authorize("rbac.assign"), assignRoleToUser);
router.delete("/users/:userId/roles/:roleId",   authenticate, authorize("rbac.assign"), removeRoleFromUser);

// Identity providers
router.put("/providers/:code", authenticate, authorize("config.manage"), updateIdentityProvider);

export default router;
