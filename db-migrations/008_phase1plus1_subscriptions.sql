-- 008_phase1plus1_subscriptions.sql
--
-- Phase 1+1: the family journey (家长注册→试用→订阅→加孩子→孩子玩→家长看进度),
-- designed on paper in architecture doc section 2.5, built for real here.
--
-- edu.guardian_relationships already exists (001 migration). This adds the
-- two tables that were only ever designed, never migrated:
--   - edu.subscription_plans: the plan catalog (Early Bird RM35 etc.)
--   - edu.subscriptions: PER-CHILD subscription records. locked_monthly_fee
--     is independent of subscription_plans.monthly_fee so a future price
--     hike doesn't retroactively change what already-subscribed families
--     pay — see the architecture doc for the full reasoning.
--
-- Referral commissions (edu.referral_codes / edu.referral_commissions) are
-- explicitly NOT in this migration — that's a separate concern from the
-- core registration→trial→subscribe flow and is deferred to its own pass.

BEGIN;

CREATE TABLE IF NOT EXISTS edu.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  code varchar(30) UNIQUE NOT NULL,
  name_i18n jsonb NOT NULL,
  monthly_fee numeric(10,2) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'MYR',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

INSERT INTO edu.subscription_plans (code, name_i18n, monthly_fee, currency) VALUES
  ('early_bird', '{"zh":"早鸟价","en":"Early Bird"}', 35.00, 'MYR')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS edu.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_uuid_v7(),
  student_id uuid NOT NULL REFERENCES auth.users(id),
  parent_user_id uuid NOT NULL REFERENCES auth.users(id),
  plan_id uuid REFERENCES edu.subscription_plans(id),
  locked_monthly_fee numeric(10,2),
  currency varchar(3) NOT NULL DEFAULT 'MYR',
  status varchar(20) NOT NULL DEFAULT 'trial',  -- 'trial' | 'active' | 'past_due' | 'expired' | 'cancelled'
  trial_started_at timestamptz NOT NULL DEFAULT now(),
  trial_ends_at timestamptz NOT NULL,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_period_ends_at timestamptz,
  referred_by_user_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_student ON edu.subscriptions(student_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_parent  ON edu.subscriptions(parent_user_id);

COMMIT;
