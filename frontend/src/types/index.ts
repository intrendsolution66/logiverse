// frontend/src/types/index.ts
//
// Trimmed from LifeVerse's original types/index.ts. Dropped all the
// LifeVerse-app-specific types (Post, Diary, Goal, Schedule, FamilyMember,
// Contact, Community, Notification, OrgEvent, OrgProject, Task, Transaction)
// — none of those concepts exist in the education platform. Kept User
// (trimmed to match the backend's trimmed getMe()/v_users, which dropped the
// lifeverse.user_ext social-stats columns) and Organization (still needed —
// it's the "school/branch" concept, see 9.2 in the architecture doc).
//
// Add education-specific types here as Phase 1+ modules are built, e.g.:
//   export interface Course { id: string; title_i18n: Record<string,string>; ... }
//   export interface CourseLevel { id: string; module_type: string; ... }

export interface User {
  id: string;
  username: string; // IC number for students/parents (see backend/src/utils/ic.ts)
  email?: string;
  mobile?: string;
  status: string;
  is_verified: boolean;
  last_login_at?: string;
  created_at: string;
  // Profile
  full_name_en?: string;
  full_name_zh?: string;
  preferred_name?: string;
  avatar_url?: string;
  cover_url?: string;
  bio?: string;
  gender_code?: string;
  date_of_birth?: string;
  nationality_code?: string;
  religion_code?: string;
  ethnicity_code?: string;
  ancestry_code?: string;
  language_code?: string;
  timezone?: string;
  roles?: { code: string; name: string }[];
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
  name_zh?: string;
  tagline?: string;
  logo_url?: string;
  cover_url?: string;
  org_type?: string;
  category_code?: string;
  tags?: string[];
  members_count: number;
  is_verified_org: boolean;
  join_mode: string;
  require_verification: boolean;
  visibility: string;
  landing_enabled: boolean;
  created_at: string;
}

// Generic shape for the in-app notification center (see 3.6 in the
// architecture doc — level_completed / assignment_new / low_progress /
// invoice_due etc). Not backed by a real endpoint yet in this starter;
// kept here because stores/index.ts's useNotifStore expects the shape.
export interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string;
  is_read: boolean;
  created_at: string;
}
