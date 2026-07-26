// backend/src/modules/org/org.routes.ts
//
// Trimmed from LifeVerse's original org.routes.ts. The original wired up a
// full community-management suite (banners, committee, chat/comms, events,
// files, finance, meetings, membership plans, public landing pages,
// projects) — none of that is part of the education platform's "org" concept
// (an org here is just a school/branch, not a public-facing community).
//
// Kept: org CRUD, membership (join/approve/remove), org-scoped roles &
// permissions, org settings, org audit log — the actual multi-branch /
// multi-tenancy mechanics that Phase 0's design relies on.
//
// If you need any of the dropped community features later for a different
// deployment, the original controllers are still sitting in the LifeVerse
// repo unchanged — just re-wire them here.

import { Router } from "express";
import { authenticate, optionalAuth } from "../../middlewares/authenticate.js";
import { orgAuthorize, requireOrgMember } from "../../middlewares/orgAuthorize.js";
import { authorize } from "../../middlewares/authorize.js";
import {
  listOrgs, createOrg, getOrg, updateOrg,
  listMembers, getMember, applyToOrg, reviewApplication,
  updateMemberRole, removeMember,
  listOrgRoles, createOrgRole, updateOrgRole, deleteOrgRole,
  listOrgPermissions, upsertOrgPermission, deleteOrgPermission,
  assignOrgRole, revokeOrgRole,
} from "./org.controller.js";
import {
  getOrgSettings, upsertOrgSetting, getOrgAuditLogs,
} from "./org-system.controller.js";

const router = Router();

// ── Orgs (branches) ─────────────────────────────────────────────────────────
router.get   ("/",              optionalAuth, listOrgs);
router.post  ("/",              authenticate, authorize("org.create"), createOrg);
router.get   ("/:orgId",        optionalAuth, getOrg);
router.put   ("/:orgId",        authenticate, orgAuthorize("org.update"), updateOrg);

// ── Membership ───────────────────────────────────────────────────────────────
router.get   ("/:orgId/members",           authenticate, requireOrgMember(), listMembers);
router.get   ("/:orgId/members/:userId",   authenticate, requireOrgMember(), getMember);
router.post  ("/:orgId/apply",             authenticate, applyToOrg);
router.patch ("/:orgId/applications/:id",  authenticate, orgAuthorize("members.manage"), reviewApplication);
router.put   ("/:orgId/members/:userId/role", authenticate, orgAuthorize("members.manage"), updateMemberRole);
router.delete("/:orgId/members/:userId",   authenticate, orgAuthorize("members.manage"), removeMember);

// ── Org-scoped roles & permissions ──────────────────────────────────────────
router.get   ("/:orgId/roles",             authenticate, orgAuthorize("rbac.read"),   listOrgRoles);
router.post  ("/:orgId/roles",             authenticate, orgAuthorize("rbac.manage"), createOrgRole);
router.put   ("/:orgId/roles/:roleId",     authenticate, orgAuthorize("rbac.manage"), updateOrgRole);
router.delete("/:orgId/roles/:roleId",     authenticate, orgAuthorize("rbac.manage"), deleteOrgRole);
router.get   ("/:orgId/permissions",       authenticate, orgAuthorize("rbac.read"),   listOrgPermissions);
router.put   ("/:orgId/permissions/:code", authenticate, orgAuthorize("rbac.manage"), upsertOrgPermission);
router.delete("/:orgId/permissions/:code", authenticate, orgAuthorize("rbac.manage"), deleteOrgPermission);
router.post  ("/:orgId/members/:userId/roles/:roleId",   authenticate, orgAuthorize("rbac.assign"), assignOrgRole);
router.delete("/:orgId/members/:userId/roles/:roleId",   authenticate, orgAuthorize("rbac.assign"), revokeOrgRole);

// ── Org settings & audit log ────────────────────────────────────────────────
router.get   ("/:orgId/settings",       authenticate, orgAuthorize("config.read"),   getOrgSettings);
router.put   ("/:orgId/settings/:key",  authenticate, orgAuthorize("config.manage"), upsertOrgSetting);
router.get   ("/:orgId/audit-logs",     authenticate, orgAuthorize("audit.read"),    getOrgAuditLogs);

export default router;
