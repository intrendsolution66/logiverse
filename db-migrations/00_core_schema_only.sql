--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE SCHEMA audit;


--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: config; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA config;


--
-- Name: i18n; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA i18n;


--
-- Name: org; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA org;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: rbac; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA rbac;


--
-- Name: fn_soft_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.fn_soft_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_deleted = true  AND OLD.is_deleted = false THEN NEW.deleted_at := clock_timestamp(); END IF;
  IF NEW.is_deleted = false AND OLD.is_deleted = true  THEN NEW.deleted_at := NULL; END IF;
  RETURN NEW;
END;
$$;


--
-- Name: fn_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.fn_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;


--
-- Name: gen_uuid_v7(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.gen_uuid_v7() RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  _ms   bigint := (extract(EPOCH FROM clock_timestamp())*1000)::bigint;
  _rand bytea  := gen_random_bytes(10);
  _hex  text;
BEGIN
  _hex :=
    lpad(to_hex(_ms),12,'0')
    || '7'
    || lpad(to_hex(get_byte(_rand,0)::int|(get_byte(_rand,1)::int<<8)&4095),3,'0')
    || to_hex(8+(get_byte(_rand,2)&3))
    || lpad(to_hex(get_byte(_rand,3)::int|(get_byte(_rand,4)::int<<8)&4095),3,'0')
    || encode(substring(_rand from 5 for 8),'hex');
  RETURN _hex::uuid;
END;
$$;


--
-- Name: uuid_v7_to_ts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.uuid_v7_to_ts(p uuid) RETURNS timestamp with time zone
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT to_timestamp(
    ('x'||lpad(split_part(p::text,'-',1)||left(split_part(p::text,'-',2),4),16,'0'))::bit(64)::bigint/1000.0
  );
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: operation_logs; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.operation_logs (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    actor_user_id uuid,
    actor_username character varying(100),
    actor_ip inet,
    actor_user_agent text,
    action character varying(100) NOT NULL,
    resource_type character varying(100),
    resource_id uuid,
    resource_label character varying(255),
    status character varying(20) DEFAULT 'success'::character varying NOT NULL,
    error_message text,
    old_data jsonb,
    new_data jsonb,
    request_id character varying(100),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operation_logs_status_check CHECK (((status)::text = ANY (ARRAY[('success'::character varying)::text, ('failure'::character varying)::text, ('partial'::character varying)::text])))
);


--
-- Name: invitations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.invitations (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    token_hash character(64) NOT NULL,
    invited_by uuid NOT NULL,
    email character varying(255),
    auto_role_codes jsonb DEFAULT '[]'::jsonb NOT NULL,
    max_uses smallint DEFAULT 1 NOT NULL,
    used_count smallint DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    note text,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invitations_status_check CHECK (((status)::text = ANY (ARRAY[('ACTIVE'::character varying)::text, ('USED'::character varying)::text, ('EXPIRED'::character varying)::text, ('REVOKED'::character varying)::text])))
);


--
-- Name: login_audit_logs; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.login_audit_logs (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    user_id uuid,
    identity_used character varying(255),
    provider_code character varying(50),
    event_type character varying(50) NOT NULL,
    success boolean NOT NULL,
    ip_address inet,
    user_agent text,
    failure_reason character varying(100),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT login_audit_logs_event_type_check CHECK (((event_type)::text = ANY (ARRAY[('LOGIN_SUCCESS'::character varying)::text, ('LOGIN_FAILURE'::character varying)::text, ('LOGIN_LOCKED'::character varying)::text, ('LOGOUT'::character varying)::text, ('TOKEN_REFRESH'::character varying)::text, ('PASSWORD_CHANGE'::character varying)::text, ('ACCOUNT_LOCKED'::character varying)::text, ('ACCOUNT_UNLOCKED'::character varying)::text, ('VERIFY_SUCCESS'::character varying)::text, ('VERIFY_FAILURE'::character varying)::text])))
);


--
-- Name: user_identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.user_identities (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    user_id uuid NOT NULL,
    provider_code character varying(50) NOT NULL,
    identity_value character varying(255) NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    oauth_sub character varying(255),
    oauth_token_data jsonb,
    oauth_profile jsonb,
    verification_code character varying(10),
    verification_expires timestamp with time zone,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_profiles; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.user_profiles (
    user_id uuid NOT NULL,
    full_name_en character varying(200),
    full_name_zh character varying(200),
    preferred_name character varying(100),
    gender_code character varying(20),
    date_of_birth date,
    nationality_code character(2),
    religion_code character varying(50),
    ethnicity_code character varying(50),
    ancestry_code character varying(50),
    marital_status_code character varying(30),
    education_level_code character varying(50),
    occupation_code character varying(50),
    ic_no character varying(30),
    passport_no character varying(30),
    ic_expiry date,
    passport_expiry date,
    address_line1 character varying(255),
    address_line2 character varying(255),
    city character varying(100),
    state character varying(100),
    postcode character varying(20),
    country_code character(2),
    language_code character varying(10),
    timezone character varying(60),
    avatar_url text,
    cover_url text,
    bio text,
    extra_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.user_sessions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    user_id uuid NOT NULL,
    refresh_token_hash character(64) NOT NULL,
    user_agent text,
    ip_address inet,
    device_name character varying(200),
    expires_at timestamp with time zone NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_verifications; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.user_verifications (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    user_id uuid NOT NULL,
    method character varying(30) NOT NULL,
    full_name_en character varying(200),
    full_name_zh character varying(200),
    ic_no character varying(30),
    passport_no character varying(30),
    date_of_birth date,
    nationality_code character(2),
    id_document_type character varying(20),
    front_doc_url text,
    back_doc_url text,
    selfie_url text,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    verified_by uuid,
    verified_at timestamp with time zone,
    rejected_reason text,
    expires_at timestamp with time zone,
    api_response jsonb,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_verifications_id_document_type_check CHECK (((id_document_type)::text = ANY (ARRAY[('IC'::character varying)::text, ('PASSPORT'::character varying)::text, ('OTHER'::character varying)::text]))),
    CONSTRAINT user_verifications_method_check CHECK (((method)::text = ANY (ARRAY[('MANUAL'::character varying)::text, ('DOCUMENT'::character varying)::text, ('AUTO_API'::character varying)::text, ('ADMIN'::character varying)::text]))),
    CONSTRAINT user_verifications_status_check CHECK (((status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('VERIFIED'::character varying)::text, ('REJECTED'::character varying)::text, ('EXPIRED'::character varying)::text])))
);


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255),
    mobile character varying(30),
    password_hash text,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    locked_until timestamp with time zone,
    failed_login_count smallint DEFAULT 0 NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    last_login_at timestamp with time zone,
    last_login_ip inet,
    registered_via character varying(50),
    invited_by uuid,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_status_check CHECK (((status)::text = ANY (ARRAY[('PENDING'::character varying)::text, ('ACTIVE'::character varying)::text, ('SUSPENDED'::character varying)::text, ('LOCKED'::character varying)::text, ('DELETED'::character varying)::text])))
);


--
-- Name: ancestries; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.ancestries (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(50) NOT NULL,
    label_en character varying(100) NOT NULL,
    label_zh character varying(100),
    label_ms character varying(100),
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: countries; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.countries (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code_alpha2 character(2) NOT NULL,
    code_alpha3 character(3),
    label_en character varying(100) NOT NULL,
    label_zh character varying(100),
    label_ms character varying(100),
    phone_code character varying(10),
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: education_levels; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.education_levels (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(50) NOT NULL,
    label_en character varying(150) NOT NULL,
    label_zh character varying(150),
    label_ms character varying(150),
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: ethnicities; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.ethnicities (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(50) NOT NULL,
    label_en character varying(100) NOT NULL,
    label_zh character varying(100),
    label_ms character varying(100),
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: genders; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.genders (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(20) NOT NULL,
    label_en character varying(100) NOT NULL,
    label_zh character varying(100),
    label_ms character varying(100),
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: identity_providers; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.identity_providers (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(50) NOT NULL,
    label_en character varying(100) NOT NULL,
    label_zh character varying(100),
    provider_type character varying(20) NOT NULL,
    is_enabled boolean DEFAULT false NOT NULL,
    allow_login boolean DEFAULT true NOT NULL,
    allow_register boolean DEFAULT false NOT NULL,
    require_verification boolean DEFAULT false NOT NULL,
    client_id text,
    client_secret text,
    authorization_url text,
    token_url text,
    userinfo_url text,
    scopes text,
    callback_url text,
    extra_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT identity_providers_provider_type_check CHECK (((provider_type)::text = ANY (ARRAY[('local'::character varying)::text, ('email'::character varying)::text, ('mobile'::character varying)::text, ('ic'::character varying)::text, ('oauth2'::character varying)::text, ('oidc'::character varying)::text, ('saml'::character varying)::text, ('custom'::character varying)::text])))
);


--
-- Name: languages; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.languages (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(10) NOT NULL,
    label_en character varying(100) NOT NULL,
    native_label character varying(100),
    is_active boolean DEFAULT true NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marital_statuses; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.marital_statuses (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(30) NOT NULL,
    label_en character varying(100) NOT NULL,
    label_zh character varying(100),
    label_ms character varying(100),
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: occupations; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.occupations (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(50) NOT NULL,
    label_en character varying(150) NOT NULL,
    label_zh character varying(150),
    label_ms character varying(150),
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: registration_policies; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.registration_policies (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    policy_key character varying(120) NOT NULL,
    is_enabled boolean DEFAULT false NOT NULL,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: religions; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.religions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(50) NOT NULL,
    label_en character varying(100) NOT NULL,
    label_zh character varying(100),
    label_ms character varying(100),
    sort_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: security_policies; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.security_policies (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    policy_key character varying(120) NOT NULL,
    value text NOT NULL,
    value_type character varying(20) DEFAULT 'integer'::character varying NOT NULL,
    description text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT security_policies_value_type_check CHECK (((value_type)::text = ANY (ARRAY[('string'::character varying)::text, ('integer'::character varying)::text, ('boolean'::character varying)::text, ('json'::character varying)::text])))
);


--
-- Name: settings; Type: TABLE; Schema: config; Owner: -
--

CREATE TABLE config.settings (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    key character varying(120) NOT NULL,
    value text,
    value_type character varying(20) DEFAULT 'string'::character varying NOT NULL,
    description text,
    is_public boolean DEFAULT false NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT settings_value_type_check CHECK (((value_type)::text = ANY (ARRAY[('string'::character varying)::text, ('integer'::character varying)::text, ('boolean'::character varying)::text, ('json'::character varying)::text])))
);


--
-- Name: translation_keys; Type: TABLE; Schema: i18n; Owner: -
--

CREATE TABLE i18n.translation_keys (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    key character varying(255) NOT NULL,
    default_value text,
    description text,
    group_code character varying(50),
    is_public boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: translations; Type: TABLE; Schema: i18n; Owner: -
--

CREATE TABLE i18n.translations (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    key_id uuid NOT NULL,
    language_code character varying(10) NOT NULL,
    value text NOT NULL,
    is_reviewed boolean DEFAULT false NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_flat; Type: VIEW; Schema: i18n; Owner: -
--

CREATE VIEW i18n.v_flat AS
 SELECT tk.key,
    t.language_code,
    t.value,
    tk.is_public
   FROM ((i18n.translation_keys tk
     JOIN i18n.translations t ON ((t.key_id = tk.id)))
     JOIN config.languages l ON (((l.code)::text = (t.language_code)::text)))
  WHERE (l.is_active = true);


--
-- Name: accounts; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.accounts (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(200) NOT NULL,
    account_type character varying(20) NOT NULL,
    parent_id uuid,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_account_type_check CHECK (((account_type)::text = ANY (ARRAY[('income'::character varying)::text, ('expense'::character varying)::text, ('asset'::character varying)::text, ('liability'::character varying)::text, ('equity'::character varying)::text])))
);


--
-- Name: announcements; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.announcements (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    author_id uuid NOT NULL,
    title character varying(300) NOT NULL,
    content text NOT NULL,
    visibility character varying(20) DEFAULT 'MEMBERS_ONLY'::character varying NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    pinned_until timestamp with time zone,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    views_count integer DEFAULT 0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT announcements_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('PUBLIC'::character varying)::text, ('MEMBERS_ONLY'::character varying)::text, ('PRIVATE'::character varying)::text])))
);


--
-- Name: budgets; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.budgets (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    fiscal_year smallint NOT NULL,
    fiscal_period character varying(20) DEFAULT 'annual'::character varying NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_budget numeric(14,2) DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    notes text,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT budgets_fiscal_period_check CHECK (((fiscal_period)::text = ANY (ARRAY[('annual'::character varying)::text, ('quarterly'::character varying)::text, ('monthly'::character varying)::text]))),
    CONSTRAINT budgets_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('approved'::character varying)::text, ('active'::character varying)::text, ('closed'::character varying)::text])))
);


--
-- Name: channel_members; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.channel_members (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    channel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    last_read_msg_id uuid,
    last_read_at timestamp with time zone,
    is_muted boolean DEFAULT false NOT NULL,
    muted_until timestamp with time zone,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: channels; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.channels (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    name character varying(100),
    channel_type character varying(20) DEFAULT 'group'::character varying NOT NULL,
    description text,
    icon_emoji character varying(10),
    is_readonly boolean DEFAULT false NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT channels_channel_type_check CHECK (((channel_type)::text = ANY (ARRAY[('general'::character varying)::text, ('group'::character varying)::text, ('direct'::character varying)::text])))
);


--
-- Name: event_check_ins; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.event_check_ins (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    event_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reg_id uuid,
    check_in_at timestamp with time zone DEFAULT now() NOT NULL,
    method character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    checked_by uuid,
    CONSTRAINT event_check_ins_method_check CHECK (((method)::text = ANY (ARRAY[('qr_scan'::character varying)::text, ('manual'::character varying)::text, ('self'::character varying)::text])))
);


--
-- Name: event_registrations; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.event_registrations (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    event_id uuid NOT NULL,
    ticket_id uuid,
    user_id uuid NOT NULL,
    status character varying(20) DEFAULT 'registered'::character varying NOT NULL,
    ticket_ref character varying(50),
    qr_code text,
    amount_paid numeric(10,2) DEFAULT 0 NOT NULL,
    payment_txn_id uuid,
    paid_at timestamp with time zone,
    special_requests text,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_registrations_status_check CHECK (((status)::text = ANY (ARRAY[('registered'::character varying)::text, ('confirmed'::character varying)::text, ('waitlisted'::character varying)::text, ('cancelled'::character varying)::text, ('attended'::character varying)::text, ('no_show'::character varying)::text])))
);


--
-- Name: event_tickets; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.event_tickets (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    event_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    price numeric(10,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'MYR'::character varying NOT NULL,
    quantity integer,
    quantity_sold integer DEFAULT 0 NOT NULL,
    member_only boolean DEFAULT false NOT NULL,
    required_role_id uuid,
    sale_start_at timestamp with time zone,
    sale_end_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: events; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.events (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    title character varying(300) NOT NULL,
    description text,
    cover_url text,
    event_type character varying(30) DEFAULT 'general'::character varying NOT NULL,
    start_at timestamp with time zone NOT NULL,
    end_at timestamp with time zone,
    registration_start_at timestamp with time zone,
    registration_end_at timestamp with time zone,
    is_online boolean DEFAULT false NOT NULL,
    location character varying(300),
    location_url text,
    online_link text,
    max_capacity integer,
    visibility character varying(20) DEFAULT 'PUBLIC'::character varying NOT NULL,
    requires_registration boolean DEFAULT true NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    registrations_count integer DEFAULT 0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT events_event_type_check CHECK (((event_type)::text = ANY (ARRAY[('general'::character varying)::text, ('workshop'::character varying)::text, ('seminar'::character varying)::text, ('agm'::character varying)::text, ('fundraising'::character varying)::text, ('social'::character varying)::text, ('competition'::character varying)::text, ('online'::character varying)::text]))),
    CONSTRAINT events_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('published'::character varying)::text, ('registration_open'::character varying)::text, ('registration_closed'::character varying)::text, ('ongoing'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text]))),
    CONSTRAINT events_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('PUBLIC'::character varying)::text, ('MEMBERS_ONLY'::character varying)::text, ('PRIVATE'::character varying)::text])))
);


--
-- Name: file_permissions; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.file_permissions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    target_type character varying(10) NOT NULL,
    target_id uuid NOT NULL,
    grantee_type character varying(10) NOT NULL,
    grantee_id uuid NOT NULL,
    can_view boolean DEFAULT true NOT NULL,
    can_download boolean DEFAULT true NOT NULL,
    can_upload boolean DEFAULT false NOT NULL,
    can_delete boolean DEFAULT false NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT file_permissions_grantee_type_check CHECK (((grantee_type)::text = ANY (ARRAY[('role'::character varying)::text, ('user'::character varying)::text]))),
    CONSTRAINT file_permissions_target_type_check CHECK (((target_type)::text = ANY (ARRAY[('file'::character varying)::text, ('folder'::character varying)::text])))
);


--
-- Name: files; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.files (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    folder_id uuid,
    name character varying(255) NOT NULL,
    original_name character varying(255) NOT NULL,
    file_type character varying(50),
    file_ext character varying(20),
    file_size_bytes bigint,
    url text NOT NULL,
    thumbnail_url text,
    version smallint DEFAULT 1 NOT NULL,
    previous_id uuid,
    visibility character varying(20) DEFAULT 'MEMBERS_ONLY'::character varying NOT NULL,
    download_count integer DEFAULT 0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT files_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('PUBLIC'::character varying)::text, ('MEMBERS_ONLY'::character varying)::text, ('PRIVATE'::character varying)::text])))
);


--
-- Name: financial_reports; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.financial_reports (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    report_type character varying(30) NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    report_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    generated_by uuid,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT financial_reports_report_type_check CHECK (((report_type)::text = ANY (ARRAY[('income_statement'::character varying)::text, ('balance_sheet'::character varying)::text, ('cash_flow'::character varying)::text, ('member_fees'::character varying)::text])))
);


--
-- Name: folders; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.folders (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    parent_id uuid,
    name character varying(255) NOT NULL,
    description text,
    visibility character varying(20) DEFAULT 'MEMBERS_ONLY'::character varying NOT NULL,
    inherit_permissions boolean DEFAULT true NOT NULL,
    created_by uuid,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT folders_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('PUBLIC'::character varying)::text, ('MEMBERS_ONLY'::character varying)::text, ('PRIVATE'::character varying)::text])))
);


--
-- Name: landing_sections; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.landing_sections (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    section_type character varying(30) NOT NULL,
    title character varying(200),
    title_en character varying(200),
    content text,
    media_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_visible boolean DEFAULT true NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    visibility character varying(20) DEFAULT 'PUBLIC'::character varying NOT NULL,
    CONSTRAINT landing_sections_section_type_check CHECK (((section_type)::text = ANY (ARRAY[('hero'::character varying)::text, ('about'::character varying)::text, ('stats'::character varying)::text, ('announcements'::character varying)::text, ('events'::character varying)::text, ('gallery'::character varying)::text, ('contact'::character varying)::text, ('committee'::character varying)::text, ('custom'::character varying)::text])))
);


--
-- Name: meeting_attendees; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.meeting_attendees (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    meeting_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status character varying(20) DEFAULT 'invited'::character varying NOT NULL,
    proxy_user_id uuid,
    rsvp_at timestamp with time zone,
    check_in_at timestamp with time zone,
    CONSTRAINT meeting_attendees_status_check CHECK (((status)::text = ANY (ARRAY[('invited'::character varying)::text, ('confirmed'::character varying)::text, ('attended'::character varying)::text, ('absent'::character varying)::text, ('apology'::character varying)::text])))
);


--
-- Name: meeting_minutes; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.meeting_minutes (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    meeting_id uuid NOT NULL,
    content text NOT NULL,
    content_format character varying(10) DEFAULT 'markdown'::character varying NOT NULL,
    resolutions jsonb DEFAULT '[]'::jsonb NOT NULL,
    action_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    visibility character varying(20) DEFAULT 'MEMBERS_ONLY'::character varying NOT NULL,
    authored_by uuid,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meeting_minutes_content_format_check CHECK (((content_format)::text = ANY (ARRAY[('markdown'::character varying)::text, ('html'::character varying)::text, ('plain'::character varying)::text]))),
    CONSTRAINT meeting_minutes_status_check CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('pending_approval'::character varying)::text, ('approved'::character varying)::text, ('published'::character varying)::text]))),
    CONSTRAINT meeting_minutes_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('PUBLIC'::character varying)::text, ('MEMBERS_ONLY'::character varying)::text, ('PRIVATE'::character varying)::text])))
);


--
-- Name: meetings; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.meetings (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    title character varying(300) NOT NULL,
    meeting_type character varying(30) DEFAULT 'general'::character varying NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    location character varying(300),
    online_link text,
    agenda jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
    chair_user_id uuid,
    secretary_user_id uuid,
    visibility character varying(20) DEFAULT 'MEMBERS_ONLY'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT meetings_meeting_type_check CHECK (((meeting_type)::text = ANY (ARRAY[('agm'::character varying)::text, ('egm'::character varying)::text, ('committee'::character varying)::text, ('general'::character varying)::text, ('working_group'::character varying)::text, ('online'::character varying)::text]))),
    CONSTRAINT meetings_status_check CHECK (((status)::text = ANY (ARRAY[('scheduled'::character varying)::text, ('in_progress'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text]))),
    CONSTRAINT meetings_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('PUBLIC'::character varying)::text, ('MEMBERS_ONLY'::character varying)::text, ('PRIVATE'::character varying)::text])))
);


--
-- Name: member_subscriptions; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.member_subscriptions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    member_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date,
    amount numeric(12,2) NOT NULL,
    currency character varying(3) DEFAULT 'MYR'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    auto_renew boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_subscriptions_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('expired'::character varying)::text, ('cancelled'::character varying)::text, ('refunded'::character varying)::text])))
);


--
-- Name: membership_plans; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.membership_plans (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'MYR'::character varying NOT NULL,
    billing_cycle character varying(20) DEFAULT 'yearly'::character varying NOT NULL,
    duration_days integer,
    benefits jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT membership_plans_billing_cycle_check CHECK (((billing_cycle)::text = ANY (ARRAY[('monthly'::character varying)::text, ('quarterly'::character varying)::text, ('yearly'::character varying)::text, ('lifetime'::character varying)::text, ('one_time'::character varying)::text])))
);


--
-- Name: message_reactions; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.message_reactions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reaction character varying(10) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: message_reads; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.message_reads (
    message_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.messages (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    channel_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    reply_to_id uuid,
    content text,
    msg_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_recalled boolean DEFAULT false NOT NULL,
    recalled_at timestamp with time zone,
    is_edited boolean DEFAULT false NOT NULL,
    edited_at timestamp with time zone,
    original_content text,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_msg_type_check CHECK (((msg_type)::text = ANY (ARRAY[('text'::character varying)::text, ('image'::character varying)::text, ('file'::character varying)::text, ('audio'::character varying)::text, ('system'::character varying)::text])))
);


--
-- Name: org_audit_logs; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.org_audit_logs (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    actor_user_id uuid,
    actor_username character varying(100),
    actor_ip inet,
    action character varying(100) NOT NULL,
    resource_type character varying(50),
    resource_id uuid,
    resource_label character varying(255),
    status character varying(20) DEFAULT 'success'::character varying NOT NULL,
    old_data jsonb,
    new_data jsonb,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_audit_logs_status_check CHECK (((status)::text = ANY (ARRAY[('success'::character varying)::text, ('failure'::character varying)::text])))
);


--
-- Name: org_banners; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.org_banners (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    title character varying(200),
    title_zh character varying(200),
    description text,
    description_zh text,
    media_url text,
    media_type character varying(10) DEFAULT 'image'::character varying NOT NULL,
    cta_label character varying(80),
    cta_label_zh character varying(80),
    cta_url text,
    visibility character varying(20) DEFAULT 'PUBLIC'::character varying NOT NULL,
    placement jsonb DEFAULT '["banner"]'::jsonb NOT NULL,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    created_by uuid,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_banners_media_type_check CHECK (((media_type)::text = ANY (ARRAY[('image'::character varying)::text, ('video'::character varying)::text]))),
    CONSTRAINT org_banners_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('PUBLIC'::character varying)::text, ('LOGGED_IN'::character varying)::text, ('MEMBERS_ONLY'::character varying)::text])))
);


--
-- Name: org_members; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.org_members (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid,
    member_no character varying(50),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    joined_via character varying(20) DEFAULT 'apply'::character varying NOT NULL,
    applied_at timestamp with time zone,
    apply_message text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    reject_reason text,
    membership_start date,
    membership_end date,
    is_verified boolean DEFAULT false NOT NULL,
    verification_id uuid,
    invited_by uuid,
    notes text,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    joined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_members_joined_via_check CHECK (((joined_via)::text = ANY (ARRAY[('apply'::character varying)::text, ('invite'::character varying)::text, ('direct'::character varying)::text, ('import'::character varying)::text]))),
    CONSTRAINT org_members_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('active'::character varying)::text, ('suspended'::character varying)::text, ('expired'::character varying)::text, ('left'::character varying)::text, ('removed'::character varying)::text, ('rejected'::character varying)::text])))
);


--
-- Name: org_permissions; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.org_permissions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    code character varying(120) NOT NULL,
    name character varying(200) NOT NULL,
    name_en character varying(200),
    description text,
    group_code character varying(50),
    group_name character varying(100),
    is_system boolean DEFAULT false NOT NULL,
    sort_order smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_role_permissions; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.org_role_permissions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_roles; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.org_roles (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(100) NOT NULL,
    name_en character varying(100),
    description text,
    level smallint DEFAULT 50 NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    color_hex character varying(10),
    icon_emoji character varying(10),
    is_active boolean DEFAULT true NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_settings; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.org_settings (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    key character varying(120) NOT NULL,
    value text,
    value_type character varying(20) DEFAULT 'string'::character varying NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT org_settings_value_type_check CHECK (((value_type)::text = ANY (ARRAY[('string'::character varying)::text, ('integer'::character varying)::text, ('boolean'::character varying)::text, ('json'::character varying)::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.organizations (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    created_by uuid NOT NULL,
    owner_user_id uuid NOT NULL,
    slug character varying(100) NOT NULL,
    name character varying(200) NOT NULL,
    name_en character varying(200),
    name_zh character varying(200),
    tagline character varying(300),
    description text,
    logo_url text,
    cover_url text,
    org_type character varying(20) DEFAULT 'community'::character varying NOT NULL,
    registration_no character varying(100),
    registration_body character varying(200),
    registration_date date,
    registration_doc_url text,
    is_verified_org boolean DEFAULT false NOT NULL,
    verified_at timestamp with time zone,
    verified_by uuid,
    category_code character varying(50),
    tags text[],
    email character varying(255),
    phone character varying(30),
    website_url text,
    address text,
    state_code character varying(20),
    country_code character(2) DEFAULT 'MY'::bpchar NOT NULL,
    visibility character varying(20) DEFAULT 'PUBLIC'::character varying NOT NULL,
    join_mode character varying(20) DEFAULT 'apply'::character varying NOT NULL,
    require_verification boolean DEFAULT false NOT NULL,
    landing_enabled boolean DEFAULT true NOT NULL,
    landing_theme character varying(20) DEFAULT 'default'::character varying NOT NULL,
    landing_custom_css text,
    members_count integer DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organizations_join_mode_check CHECK (((join_mode)::text = ANY (ARRAY[('open'::character varying)::text, ('apply'::character varying)::text, ('invite_only'::character varying)::text, ('closed'::character varying)::text]))),
    CONSTRAINT organizations_org_type_check CHECK (((org_type)::text = ANY (ARRAY[('registered_govt'::character varying)::text, ('registered_corp'::character varying)::text, ('community'::character varying)::text, ('ngo'::character varying)::text, ('education'::character varying)::text, ('religious'::character varying)::text, ('other'::character varying)::text]))),
    CONSTRAINT organizations_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('suspended'::character varying)::text, ('archived'::character varying)::text, ('deleted'::character varying)::text]))),
    CONSTRAINT organizations_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('PUBLIC'::character varying)::text, ('MEMBERS_ONLY'::character varying)::text, ('PRIVATE'::character varying)::text])))
);


--
-- Name: COLUMN organizations.org_type; Type: COMMENT; Schema: org; Owner: -
--

COMMENT ON COLUMN org.organizations.org_type IS 'registered_govt=政府注册社团/NGO, registered_corp=注册公司, community=未注册社区团体';


--
-- Name: COLUMN organizations.is_verified_org; Type: COMMENT; Schema: org; Owner: -
--

COMMENT ON COLUMN org.organizations.is_verified_org IS '平台核实标志：上传注册证明并经平台审核后为 true，显示认证徽章';


--
-- Name: organisations; Type: VIEW; Schema: org; Owner: -
--

CREATE VIEW org.organisations AS
 SELECT id,
    created_by,
    owner_user_id,
    slug,
    name,
    name_en,
    name_zh,
    tagline,
    description,
    logo_url,
    cover_url,
    org_type,
    registration_no,
    registration_body,
    registration_date,
    registration_doc_url,
    is_verified_org,
    verified_at,
    verified_by,
    category_code,
    tags,
    email,
    phone,
    website_url,
    address,
    state_code,
    country_code,
    visibility,
    join_mode,
    require_verification,
    landing_enabled,
    landing_theme,
    landing_custom_css,
    members_count,
    status,
    is_deleted,
    deleted_at,
    deleted_by,
    created_at,
    updated_at
   FROM org.organizations;


--
-- Name: project_members; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.project_members (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(50) DEFAULT 'member'::character varying NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.projects (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    name character varying(300) NOT NULL,
    description text,
    cover_url text,
    project_type character varying(30) DEFAULT 'general'::character varying NOT NULL,
    start_date date,
    target_date date,
    completed_at timestamp with time zone,
    progress_pct smallint DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'planning'::character varying NOT NULL,
    budget numeric(14,2),
    visibility character varying(20) DEFAULT 'MEMBERS_ONLY'::character varying NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projects_progress_pct_check CHECK (((progress_pct >= 0) AND (progress_pct <= 100))),
    CONSTRAINT projects_project_type_check CHECK (((project_type)::text = ANY (ARRAY[('general'::character varying)::text, ('event'::character varying)::text, ('campaign'::character varying)::text, ('construction'::character varying)::text, ('research'::character varying)::text, ('fundraising'::character varying)::text]))),
    CONSTRAINT projects_status_check CHECK (((status)::text = ANY (ARRAY[('planning'::character varying)::text, ('active'::character varying)::text, ('on_hold'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text]))),
    CONSTRAINT projects_visibility_check CHECK (((visibility)::text = ANY (ARRAY[('PUBLIC'::character varying)::text, ('MEMBERS_ONLY'::character varying)::text, ('PRIVATE'::character varying)::text])))
);


--
-- Name: task_comments; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.task_comments (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tasks; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.tasks (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    project_id uuid NOT NULL,
    parent_id uuid,
    title character varying(300) NOT NULL,
    description text,
    assignee_id uuid,
    created_by uuid,
    priority character varying(10) DEFAULT 'medium'::character varying NOT NULL,
    status character varying(20) DEFAULT 'todo'::character varying NOT NULL,
    due_date date,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    progress_pct smallint DEFAULT 0 NOT NULL,
    tags text[],
    sort_order integer DEFAULT 0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tasks_priority_check CHECK (((priority)::text = ANY (ARRAY[('critical'::character varying)::text, ('high'::character varying)::text, ('medium'::character varying)::text, ('low'::character varying)::text]))),
    CONSTRAINT tasks_progress_pct_check CHECK (((progress_pct >= 0) AND (progress_pct <= 100))),
    CONSTRAINT tasks_status_check CHECK (((status)::text = ANY (ARRAY[('backlog'::character varying)::text, ('todo'::character varying)::text, ('in_progress'::character varying)::text, ('in_review'::character varying)::text, ('done'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: transactions; Type: TABLE; Schema: org; Owner: -
--

CREATE TABLE org.transactions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    org_id uuid NOT NULL,
    txn_type character varying(20) NOT NULL,
    account_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency character varying(3) DEFAULT 'MYR'::character varying NOT NULL,
    txn_date date DEFAULT CURRENT_DATE NOT NULL,
    description text NOT NULL,
    reference_no character varying(100),
    ref_type character varying(30),
    ref_id uuid,
    reconciled boolean DEFAULT false NOT NULL,
    reconciled_at timestamp with time zone,
    reconciled_by uuid,
    attachment_url text,
    created_by uuid NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transactions_txn_type_check CHECK (((txn_type)::text = ANY (ARRAY[('income'::character varying)::text, ('expense'::character varying)::text, ('refund'::character varying)::text, ('transfer'::character varying)::text])))
);


--
-- Name: v_member_permissions; Type: VIEW; Schema: org; Owner: -
--

CREATE VIEW org.v_member_permissions AS
 SELECT DISTINCT m.org_id,
    m.user_id,
    p.code AS permission_code,
    p.id AS permission_id,
    r.code AS role_code,
    r.level AS role_level
   FROM (((org.org_members m
     JOIN org.org_roles r ON ((r.id = m.role_id)))
     JOIN org.org_role_permissions rp ON ((rp.role_id = r.id)))
     JOIN org.org_permissions p ON ((p.id = rp.permission_id)))
  WHERE (((m.status)::text = 'active'::text) AND (m.is_deleted = false) AND (r.is_active = true) AND (r.is_deleted = false));


--
-- Name: VIEW v_member_permissions; Type: COMMENT; Schema: org; Owner: -
--

COMMENT ON VIEW org.v_member_permissions IS '组织成员有效权限视图，按 org_id 隔离，供组织内权限检查：
     SELECT EXISTS (SELECT 1 FROM org.v_member_permissions
     WHERE org_id=$1 AND user_id=$2 AND permission_code=$3)';


--
-- Name: v_identity_providers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_identity_providers AS
 SELECT code,
    label_en,
    label_zh,
    provider_type,
    allow_login,
    allow_register,
    require_verification,
    sort_order
   FROM config.identity_providers
  WHERE (is_enabled = true)
  ORDER BY sort_order;


--
-- Name: v_lookup_options; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_lookup_options AS
 SELECT 'gender'::text AS category,
    genders.code,
    genders.label_en,
    genders.label_zh,
    NULL::character varying AS label_ms,
    genders.sort_order
   FROM config.genders
  WHERE (genders.is_active = true)
UNION ALL
 SELECT 'religion'::text AS category,
    religions.code,
    religions.label_en,
    religions.label_zh,
    religions.label_ms,
    religions.sort_order
   FROM config.religions
  WHERE (religions.is_active = true)
UNION ALL
 SELECT 'ethnicity'::text AS category,
    ethnicities.code,
    ethnicities.label_en,
    ethnicities.label_zh,
    ethnicities.label_ms,
    ethnicities.sort_order
   FROM config.ethnicities
  WHERE (ethnicities.is_active = true)
UNION ALL
 SELECT 'ancestry'::text AS category,
    ancestries.code,
    ancestries.label_en,
    ancestries.label_zh,
    ancestries.label_ms,
    ancestries.sort_order
   FROM config.ancestries
  WHERE (ancestries.is_active = true)
UNION ALL
 SELECT 'marital_status'::text AS category,
    marital_statuses.code,
    marital_statuses.label_en,
    marital_statuses.label_zh,
    marital_statuses.label_ms,
    marital_statuses.sort_order
   FROM config.marital_statuses
  WHERE (marital_statuses.is_active = true)
UNION ALL
 SELECT 'education_level'::text AS category,
    education_levels.code,
    education_levels.label_en,
    education_levels.label_zh,
    education_levels.label_ms,
    education_levels.sort_order
   FROM config.education_levels
  WHERE (education_levels.is_active = true)
UNION ALL
 SELECT 'occupation'::text AS category,
    occupations.code,
    occupations.label_en,
    occupations.label_zh,
    occupations.label_ms,
    occupations.sort_order
   FROM config.occupations
  WHERE (occupations.is_active = true)
  ORDER BY 1, 6;


--
-- Name: v_org_member_permissions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_org_member_permissions AS
 SELECT org_id,
    user_id,
    permission_code,
    permission_id,
    role_code,
    role_level
   FROM org.v_member_permissions;


--
-- Name: v_organizations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_organizations AS
 SELECT id,
    slug,
    name,
    name_en,
    name_zh,
    tagline,
    logo_url,
    cover_url,
    org_type,
    category_code,
    tags,
    email,
    phone,
    website_url,
    state_code,
    country_code,
    visibility,
    join_mode,
    require_verification,
    is_verified_org,
    verified_at,
    landing_enabled,
    landing_theme,
    members_count,
    status,
    created_at,
        CASE org_type
            WHEN 'registered_govt'::text THEN '政府注册'::text
            WHEN 'registered_corp'::text THEN '注册公司'::text
            WHEN 'community'::text THEN '社区团体'::text
            WHEN 'ngo'::text THEN 'NGO'::text
            WHEN 'education'::text THEN '教育机构'::text
            WHEN 'religious'::text THEN '宗教组织'::text
            ELSE '其他'::text
        END AS org_type_label_zh
   FROM org.organizations o
  WHERE (is_deleted = false);


--
-- Name: v_registration_policies; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_registration_policies AS
 SELECT policy_key,
    is_enabled,
    metadata
   FROM config.registration_policies
  ORDER BY policy_key;


--
-- Name: v_translations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_translations AS
 SELECT key,
    language_code,
    value,
    is_public
   FROM i18n.v_flat;


--
-- Name: permissions; Type: TABLE; Schema: rbac; Owner: -
--

CREATE TABLE rbac.permissions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(120) NOT NULL,
    name_en character varying(200) NOT NULL,
    name_zh character varying(200),
    description text,
    group_code character varying(50),
    group_name_en character varying(100),
    group_name_zh character varying(100),
    is_system boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: role_hierarchy; Type: TABLE; Schema: rbac; Owner: -
--

CREATE TABLE rbac.role_hierarchy (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    parent_role_id uuid NOT NULL,
    child_role_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rh_no_self CHECK ((parent_role_id <> child_role_id))
);


--
-- Name: role_permissions; Type: TABLE; Schema: rbac; Owner: -
--

CREATE TABLE rbac.role_permissions (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: rbac; Owner: -
--

CREATE TABLE rbac.roles (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    code character varying(50) NOT NULL,
    name_en character varying(100) NOT NULL,
    name_zh character varying(100),
    description text,
    role_type character varying(20) DEFAULT 'custom'::character varying NOT NULL,
    level smallint DEFAULT 99 NOT NULL,
    is_assignable_on_register boolean DEFAULT false NOT NULL,
    is_default_register_role boolean DEFAULT false NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roles_role_type_check CHECK (((role_type)::text = ANY (ARRAY[('system'::character varying)::text, ('admin'::character varying)::text, ('member'::character varying)::text, ('custom'::character varying)::text])))
);


--
-- Name: user_roles; Type: TABLE; Schema: rbac; Owner: -
--

CREATE TABLE rbac.user_roles (
    id uuid DEFAULT public.gen_uuid_v7() NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    expires_at timestamp with time zone,
    scope_type character varying(50),
    scope_id uuid,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_user_effective_permissions; Type: VIEW; Schema: rbac; Owner: -
--

CREATE VIEW rbac.v_user_effective_permissions AS
 WITH RECURSIVE role_tree AS (
         SELECT ur.user_id,
            ur.role_id,
            ur.scope_type,
            ur.scope_id
           FROM rbac.user_roles ur
          WHERE ((ur.is_active = true) AND ((ur.expires_at IS NULL) OR (ur.expires_at > now())))
        UNION
         SELECT rt_1.user_id,
            rh.child_role_id,
            rt_1.scope_type,
            rt_1.scope_id
           FROM (role_tree rt_1
             JOIN rbac.role_hierarchy rh ON ((rh.parent_role_id = rt_1.role_id)))
        )
 SELECT DISTINCT rt.user_id,
    p.code AS permission_code,
    p.id AS permission_id,
    r.code AS role_code,
    rt.scope_type,
    rt.scope_id
   FROM (((role_tree rt
     JOIN rbac.role_permissions rp ON ((rp.role_id = rt.role_id)))
     JOIN rbac.permissions p ON ((p.id = rp.permission_id)))
     JOIN rbac.roles r ON ((r.id = rt.role_id)))
  WHERE ((r.is_active = true) AND (r.is_deleted = false) AND (p.is_active = true));


--
-- Name: VIEW v_user_effective_permissions; Type: COMMENT; Schema: rbac; Owner: -
--

COMMENT ON VIEW rbac.v_user_effective_permissions IS '全局有效权限（含角色继承），供全局权限检查';


--
-- Name: v_user_permissions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_user_permissions AS
 SELECT user_id,
    permission_code,
    permission_id,
    role_code,
    scope_type,
    scope_id
   FROM rbac.v_user_effective_permissions;


--
-- Name: v_users; Type: VIEW; Schema: public; Owner: -
--

-- NOTE: original LifeVerse view also joined lifeverse.user_ext for social
-- stats (followers_count, posts_count, diary_count, etc). That table is
-- LifeVerse-app-specific (social feed feature) and isn't part of the core
-- schema set carried into this education platform, so those columns were
-- dropped from this view rather than pulling in the whole lifeverse schema.
CREATE VIEW public.v_users AS
 SELECT u.id,
    u.username,
    u.email,
    u.mobile,
    u.status,
    u.is_verified,
    u.last_login_at,
    u.registered_via,
    u.created_at,
    p.full_name_en,
    p.full_name_zh,
    p.preferred_name,
    p.gender_code,
    p.date_of_birth,
    p.nationality_code,
    p.religion_code,
    p.ethnicity_code,
    p.ancestry_code,
    p.ic_no,
    p.language_code,
    p.timezone,
    p.avatar_url,
    p.cover_url,
    p.bio
   FROM (auth.users u
     LEFT JOIN auth.user_profiles p ON ((p.user_id = u.id)))
  WHERE (u.is_deleted = false);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_uq; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.invitations
    ADD CONSTRAINT invitations_token_uq UNIQUE (token_hash);


--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);


--
-- Name: user_identities user_identities_uq; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_identities
    ADD CONSTRAINT user_identities_uq UNIQUE (provider_code, identity_value);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_token_uq; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_sessions
    ADD CONSTRAINT user_sessions_token_uq UNIQUE (refresh_token_hash);


--
-- Name: user_verifications user_verif_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_verifications
    ADD CONSTRAINT user_verif_pkey PRIMARY KEY (id);


--
-- Name: users users_email_uq; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_email_uq UNIQUE (email);


--
-- Name: users users_mobile_uq; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_mobile_uq UNIQUE (mobile);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_uq; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_username_uq UNIQUE (username);


--
-- Name: ancestries ancestries_code_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.ancestries
    ADD CONSTRAINT ancestries_code_uq UNIQUE (code);


--
-- Name: ancestries ancestries_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.ancestries
    ADD CONSTRAINT ancestries_pkey PRIMARY KEY (id);


--
-- Name: countries countries_alpha2_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.countries
    ADD CONSTRAINT countries_alpha2_uq UNIQUE (code_alpha2);


--
-- Name: countries countries_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (id);


--
-- Name: education_levels education_code_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.education_levels
    ADD CONSTRAINT education_code_uq UNIQUE (code);


--
-- Name: education_levels education_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.education_levels
    ADD CONSTRAINT education_pkey PRIMARY KEY (id);


--
-- Name: ethnicities ethnicities_code_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.ethnicities
    ADD CONSTRAINT ethnicities_code_uq UNIQUE (code);


--
-- Name: ethnicities ethnicities_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.ethnicities
    ADD CONSTRAINT ethnicities_pkey PRIMARY KEY (id);


--
-- Name: genders genders_code_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.genders
    ADD CONSTRAINT genders_code_uq UNIQUE (code);


--
-- Name: genders genders_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.genders
    ADD CONSTRAINT genders_pkey PRIMARY KEY (id);


--
-- Name: identity_providers idp_code_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.identity_providers
    ADD CONSTRAINT idp_code_uq UNIQUE (code);


--
-- Name: identity_providers idp_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.identity_providers
    ADD CONSTRAINT idp_pkey PRIMARY KEY (id);


--
-- Name: languages languages_code_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.languages
    ADD CONSTRAINT languages_code_uq UNIQUE (code);


--
-- Name: languages languages_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.languages
    ADD CONSTRAINT languages_pkey PRIMARY KEY (id);


--
-- Name: marital_statuses marital_code_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.marital_statuses
    ADD CONSTRAINT marital_code_uq UNIQUE (code);


--
-- Name: marital_statuses marital_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.marital_statuses
    ADD CONSTRAINT marital_pkey PRIMARY KEY (id);


--
-- Name: occupations occupations_code_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.occupations
    ADD CONSTRAINT occupations_code_uq UNIQUE (code);


--
-- Name: occupations occupations_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.occupations
    ADD CONSTRAINT occupations_pkey PRIMARY KEY (id);


--
-- Name: registration_policies reg_policies_key_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.registration_policies
    ADD CONSTRAINT reg_policies_key_uq UNIQUE (policy_key);


--
-- Name: registration_policies reg_policies_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.registration_policies
    ADD CONSTRAINT reg_policies_pkey PRIMARY KEY (id);


--
-- Name: religions religions_code_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.religions
    ADD CONSTRAINT religions_code_uq UNIQUE (code);


--
-- Name: religions religions_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.religions
    ADD CONSTRAINT religions_pkey PRIMARY KEY (id);


--
-- Name: security_policies sec_policies_key_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.security_policies
    ADD CONSTRAINT sec_policies_key_uq UNIQUE (policy_key);


--
-- Name: security_policies sec_policies_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.security_policies
    ADD CONSTRAINT sec_policies_pkey PRIMARY KEY (id);


--
-- Name: settings settings_key_uq; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.settings
    ADD CONSTRAINT settings_key_uq UNIQUE (key);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: config; Owner: -
--

ALTER TABLE ONLY config.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: translation_keys tk_key_uq; Type: CONSTRAINT; Schema: i18n; Owner: -
--

ALTER TABLE ONLY i18n.translation_keys
    ADD CONSTRAINT tk_key_uq UNIQUE (key);


--
-- Name: translation_keys tk_pkey; Type: CONSTRAINT; Schema: i18n; Owner: -
--

ALTER TABLE ONLY i18n.translation_keys
    ADD CONSTRAINT tk_pkey PRIMARY KEY (id);


--
-- Name: translations translations_pkey; Type: CONSTRAINT; Schema: i18n; Owner: -
--

ALTER TABLE ONLY i18n.translations
    ADD CONSTRAINT translations_pkey PRIMARY KEY (id);


--
-- Name: translations translations_uq; Type: CONSTRAINT; Schema: i18n; Owner: -
--

ALTER TABLE ONLY i18n.translations
    ADD CONSTRAINT translations_uq UNIQUE (key_id, language_code);


--
-- Name: landing_sections landing_sec_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.landing_sections
    ADD CONSTRAINT landing_sec_pkey PRIMARY KEY (id);


--
-- Name: accounts org_acct_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.accounts
    ADD CONSTRAINT org_acct_pkey PRIMARY KEY (id);


--
-- Name: accounts org_acct_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.accounts
    ADD CONSTRAINT org_acct_uq UNIQUE (org_id, code);


--
-- Name: announcements org_ann_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.announcements
    ADD CONSTRAINT org_ann_pkey PRIMARY KEY (id);


--
-- Name: meeting_attendees org_att_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.meeting_attendees
    ADD CONSTRAINT org_att_pkey PRIMARY KEY (id);


--
-- Name: meeting_attendees org_att_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.meeting_attendees
    ADD CONSTRAINT org_att_uq UNIQUE (meeting_id, user_id);


--
-- Name: org_audit_logs org_aud_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_audit_logs
    ADD CONSTRAINT org_aud_pkey PRIMARY KEY (id);


--
-- Name: org_banners org_banners_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_banners
    ADD CONSTRAINT org_banners_pkey PRIMARY KEY (id);


--
-- Name: budgets org_budget_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.budgets
    ADD CONSTRAINT org_budget_pkey PRIMARY KEY (id);


--
-- Name: channels org_chan_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.channels
    ADD CONSTRAINT org_chan_pkey PRIMARY KEY (id);


--
-- Name: channel_members org_chanmem_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.channel_members
    ADD CONSTRAINT org_chanmem_pkey PRIMARY KEY (id);


--
-- Name: channel_members org_chanmem_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.channel_members
    ADD CONSTRAINT org_chanmem_uq UNIQUE (channel_id, user_id);


--
-- Name: event_check_ins org_checkin_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_check_ins
    ADD CONSTRAINT org_checkin_pkey PRIMARY KEY (id);


--
-- Name: events org_evt_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.events
    ADD CONSTRAINT org_evt_pkey PRIMARY KEY (id);


--
-- Name: files org_file_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.files
    ADD CONSTRAINT org_file_pkey PRIMARY KEY (id);


--
-- Name: folders org_folder_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.folders
    ADD CONSTRAINT org_folder_pkey PRIMARY KEY (id);


--
-- Name: file_permissions org_fp_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.file_permissions
    ADD CONSTRAINT org_fp_pkey PRIMARY KEY (id);


--
-- Name: file_permissions org_fp_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.file_permissions
    ADD CONSTRAINT org_fp_uq UNIQUE (target_type, target_id, grantee_type, grantee_id);


--
-- Name: meetings org_meet_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.meetings
    ADD CONSTRAINT org_meet_pkey PRIMARY KEY (id);


--
-- Name: org_members org_mem_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_members
    ADD CONSTRAINT org_mem_pkey PRIMARY KEY (id);


--
-- Name: org_members org_mem_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_members
    ADD CONSTRAINT org_mem_uq UNIQUE (org_id, user_id);


--
-- Name: meeting_minutes org_min_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.meeting_minutes
    ADD CONSTRAINT org_min_pkey PRIMARY KEY (id);


--
-- Name: meeting_minutes org_min_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.meeting_minutes
    ADD CONSTRAINT org_min_uq UNIQUE (meeting_id);


--
-- Name: messages org_msg_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.messages
    ADD CONSTRAINT org_msg_pkey PRIMARY KEY (id);


--
-- Name: org_permissions org_perms_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_permissions
    ADD CONSTRAINT org_perms_pkey PRIMARY KEY (id);


--
-- Name: org_permissions org_perms_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_permissions
    ADD CONSTRAINT org_perms_uq UNIQUE (org_id, code);


--
-- Name: organizations org_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.organizations
    ADD CONSTRAINT org_pkey PRIMARY KEY (id);


--
-- Name: membership_plans org_plans_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.membership_plans
    ADD CONSTRAINT org_plans_pkey PRIMARY KEY (id);


--
-- Name: project_members org_pm_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.project_members
    ADD CONSTRAINT org_pm_pkey PRIMARY KEY (id);


--
-- Name: project_members org_pm_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.project_members
    ADD CONSTRAINT org_pm_uq UNIQUE (project_id, user_id);


--
-- Name: projects org_proj_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.projects
    ADD CONSTRAINT org_proj_pkey PRIMARY KEY (id);


--
-- Name: message_reactions org_react_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.message_reactions
    ADD CONSTRAINT org_react_pkey PRIMARY KEY (id);


--
-- Name: message_reactions org_react_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.message_reactions
    ADD CONSTRAINT org_react_uq UNIQUE (message_id, user_id, reaction);


--
-- Name: message_reads org_reads_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.message_reads
    ADD CONSTRAINT org_reads_pkey PRIMARY KEY (message_id, user_id);


--
-- Name: event_registrations org_reg_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_registrations
    ADD CONSTRAINT org_reg_pkey PRIMARY KEY (id);


--
-- Name: event_registrations org_reg_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_registrations
    ADD CONSTRAINT org_reg_uq UNIQUE (event_id, user_id);


--
-- Name: org_roles org_roles_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_roles
    ADD CONSTRAINT org_roles_pkey PRIMARY KEY (id);


--
-- Name: org_roles org_roles_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_roles
    ADD CONSTRAINT org_roles_uq UNIQUE (org_id, code);


--
-- Name: org_role_permissions org_rp_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_role_permissions
    ADD CONSTRAINT org_rp_pkey PRIMARY KEY (id);


--
-- Name: org_role_permissions org_rp_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_role_permissions
    ADD CONSTRAINT org_rp_uq UNIQUE (role_id, permission_id);


--
-- Name: financial_reports org_rpt_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.financial_reports
    ADD CONSTRAINT org_rpt_pkey PRIMARY KEY (id);


--
-- Name: org_settings org_set_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_settings
    ADD CONSTRAINT org_set_pkey PRIMARY KEY (id);


--
-- Name: org_settings org_set_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_settings
    ADD CONSTRAINT org_set_uq UNIQUE (org_id, key);


--
-- Name: organizations org_slug_uq; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.organizations
    ADD CONSTRAINT org_slug_uq UNIQUE (slug);


--
-- Name: member_subscriptions org_subs_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.member_subscriptions
    ADD CONSTRAINT org_subs_pkey PRIMARY KEY (id);


--
-- Name: tasks org_task_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.tasks
    ADD CONSTRAINT org_task_pkey PRIMARY KEY (id);


--
-- Name: task_comments org_tc_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.task_comments
    ADD CONSTRAINT org_tc_pkey PRIMARY KEY (id);


--
-- Name: event_tickets org_tkt_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_tickets
    ADD CONSTRAINT org_tkt_pkey PRIMARY KEY (id);


--
-- Name: transactions org_txn_pkey; Type: CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.transactions
    ADD CONSTRAINT org_txn_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_code_uq; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.permissions
    ADD CONSTRAINT permissions_code_uq UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: role_hierarchy rh_pkey; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.role_hierarchy
    ADD CONSTRAINT rh_pkey PRIMARY KEY (id);


--
-- Name: role_hierarchy rh_uq; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.role_hierarchy
    ADD CONSTRAINT rh_uq UNIQUE (parent_role_id, child_role_id);


--
-- Name: roles roles_code_uq; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.roles
    ADD CONSTRAINT roles_code_uq UNIQUE (code);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: role_permissions rp_pkey; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.role_permissions
    ADD CONSTRAINT rp_pkey PRIMARY KEY (id);


--
-- Name: role_permissions rp_uq; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.role_permissions
    ADD CONSTRAINT rp_uq UNIQUE (role_id, permission_id);


--
-- Name: user_roles ur_pkey; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.user_roles
    ADD CONSTRAINT ur_pkey PRIMARY KEY (id);


--
-- Name: user_roles ur_uq; Type: CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.user_roles
    ADD CONSTRAINT ur_uq UNIQUE (user_id, role_id, scope_type, scope_id);


--
-- Name: idx_audit_action; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_action ON audit.operation_logs USING btree (action);


--
-- Name: idx_audit_actor; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_actor ON audit.operation_logs USING btree (actor_user_id) WHERE (actor_user_id IS NOT NULL);


--
-- Name: idx_audit_created; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_created ON audit.operation_logs USING btree (created_at DESC);


--
-- Name: idx_audit_resource; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_resource ON audit.operation_logs USING btree (resource_type, resource_id);


--
-- Name: idx_auth_users_email; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_users_email ON auth.users USING btree (lower((email)::text)) WHERE ((email IS NOT NULL) AND (is_deleted = false));


--
-- Name: idx_auth_users_mobile; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_users_mobile ON auth.users USING btree (mobile) WHERE ((mobile IS NOT NULL) AND (is_deleted = false));


--
-- Name: idx_auth_users_status; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_users_status ON auth.users USING btree (status) WHERE (is_deleted = false);


--
-- Name: idx_invitations_token; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_invitations_token ON auth.invitations USING btree (token_hash);


--
-- Name: idx_login_audit_created; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_login_audit_created ON auth.login_audit_logs USING btree (created_at DESC);


--
-- Name: idx_login_audit_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_login_audit_user ON auth.login_audit_logs USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_sessions_active; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_sessions_active ON auth.user_sessions USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: idx_sessions_expires; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_sessions_expires ON auth.user_sessions USING btree (expires_at);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_sessions_user ON auth.user_sessions USING btree (user_id);


--
-- Name: idx_user_identities_lookup; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_identities_lookup ON auth.user_identities USING btree (provider_code, identity_value);


--
-- Name: idx_user_identities_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_identities_user ON auth.user_identities USING btree (user_id);


--
-- Name: idx_user_profiles_ic; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_profiles_ic ON auth.user_profiles USING btree (ic_no) WHERE (ic_no IS NOT NULL);


--
-- Name: idx_verif_ic; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_verif_ic ON auth.user_verifications USING btree (ic_no) WHERE (ic_no IS NOT NULL);


--
-- Name: idx_verif_status; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_verif_status ON auth.user_verifications USING btree (status);


--
-- Name: idx_verif_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_verif_user ON auth.user_verifications USING btree (user_id);


--
-- Name: idx_trans_lang; Type: INDEX; Schema: i18n; Owner: -
--

CREATE INDEX idx_trans_lang ON i18n.translations USING btree (language_code);


--
-- Name: idx_landing_sec_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_landing_sec_org ON org.landing_sections USING btree (org_id, sort_order) WHERE (is_visible = true);


--
-- Name: idx_org_ann_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_ann_org ON org.announcements USING btree (org_id, created_at DESC) WHERE (is_deleted = false);


--
-- Name: idx_org_ann_pinned; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_ann_pinned ON org.announcements USING btree (org_id, is_pinned) WHERE (is_pinned = true);


--
-- Name: idx_org_ann_public; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_ann_public ON org.announcements USING btree (org_id, visibility) WHERE (((visibility)::text = 'PUBLIC'::text) AND (is_deleted = false));


--
-- Name: idx_org_aud_action; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_aud_action ON org.org_audit_logs USING btree (action);


--
-- Name: idx_org_aud_actor; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_aud_actor ON org.org_audit_logs USING btree (actor_user_id) WHERE (actor_user_id IS NOT NULL);


--
-- Name: idx_org_aud_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_aud_org ON org.org_audit_logs USING btree (org_id, created_at DESC);


--
-- Name: idx_org_category; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_category ON org.organizations USING btree (category_code) WHERE (is_deleted = false);


--
-- Name: idx_org_chanmem_user; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_chanmem_user ON org.channel_members USING btree (user_id) WHERE (is_deleted = false);


--
-- Name: idx_org_checkin_event; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_checkin_event ON org.event_check_ins USING btree (event_id);


--
-- Name: idx_org_evt_date; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_evt_date ON org.events USING btree (start_at) WHERE (is_deleted = false);


--
-- Name: idx_org_evt_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_evt_org ON org.events USING btree (org_id, start_at DESC) WHERE (is_deleted = false);


--
-- Name: idx_org_evt_public; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_evt_public ON org.events USING btree (org_id, visibility) WHERE (((visibility)::text = 'PUBLIC'::text) AND (is_deleted = false));


--
-- Name: idx_org_file_folder; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_file_folder ON org.files USING btree (folder_id) WHERE (is_deleted = false);


--
-- Name: idx_org_file_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_file_org ON org.files USING btree (org_id) WHERE (is_deleted = false);


--
-- Name: idx_org_folder_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_folder_org ON org.folders USING btree (org_id) WHERE (is_deleted = false);


--
-- Name: idx_org_folder_parent; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_folder_parent ON org.folders USING btree (parent_id) WHERE (is_deleted = false);


--
-- Name: idx_org_fp_target; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_fp_target ON org.file_permissions USING btree (target_type, target_id);


--
-- Name: idx_org_meet_date; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_meet_date ON org.meetings USING btree (scheduled_at) WHERE (is_deleted = false);


--
-- Name: idx_org_meet_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_meet_org ON org.meetings USING btree (org_id, scheduled_at DESC) WHERE (is_deleted = false);


--
-- Name: idx_org_mem_expiry; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_mem_expiry ON org.org_members USING btree (membership_end) WHERE (membership_end IS NOT NULL);


--
-- Name: idx_org_mem_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_mem_org ON org.org_members USING btree (org_id, status) WHERE (is_deleted = false);


--
-- Name: idx_org_mem_user; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_mem_user ON org.org_members USING btree (user_id) WHERE (is_deleted = false);


--
-- Name: idx_org_msg_chan; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_msg_chan ON org.messages USING btree (channel_id, created_at DESC) WHERE (is_deleted = false);


--
-- Name: idx_org_msg_sender; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_msg_sender ON org.messages USING btree (sender_id) WHERE (is_deleted = false);


--
-- Name: idx_org_perms_group; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_perms_group ON org.org_permissions USING btree (org_id, group_code);


--
-- Name: idx_org_perms_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_perms_org ON org.org_permissions USING btree (org_id);


--
-- Name: idx_org_proj_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_proj_org ON org.projects USING btree (org_id, status) WHERE (is_deleted = false);


--
-- Name: idx_org_proj_status; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_proj_status ON org.projects USING btree (status) WHERE (is_deleted = false);


--
-- Name: idx_org_react_msg; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_react_msg ON org.message_reactions USING btree (message_id);


--
-- Name: idx_org_reads_user; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_reads_user ON org.message_reads USING btree (user_id);


--
-- Name: idx_org_reg_event; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_reg_event ON org.event_registrations USING btree (event_id, status) WHERE (is_deleted = false);


--
-- Name: idx_org_reg_user; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_reg_user ON org.event_registrations USING btree (user_id) WHERE (is_deleted = false);


--
-- Name: idx_org_roles_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_roles_org ON org.org_roles USING btree (org_id) WHERE (is_deleted = false);


--
-- Name: idx_org_rp_perm; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_rp_perm ON org.org_role_permissions USING btree (permission_id);


--
-- Name: idx_org_rp_role; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_rp_role ON org.org_role_permissions USING btree (role_id);


--
-- Name: idx_org_rpt; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_rpt ON org.financial_reports USING btree (org_id, report_type, period_start DESC);


--
-- Name: idx_org_slug; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_slug ON org.organizations USING btree (slug) WHERE (is_deleted = false);


--
-- Name: idx_org_subs_member; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_subs_member ON org.member_subscriptions USING btree (member_id);


--
-- Name: idx_org_subs_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_subs_org ON org.member_subscriptions USING btree (org_id, status);


--
-- Name: idx_org_tags; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_tags ON org.organizations USING gin (tags);


--
-- Name: idx_org_task_assignee; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_task_assignee ON org.tasks USING btree (assignee_id) WHERE ((is_deleted = false) AND (assignee_id IS NOT NULL));


--
-- Name: idx_org_task_due; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_task_due ON org.tasks USING btree (due_date) WHERE ((due_date IS NOT NULL) AND (is_deleted = false));


--
-- Name: idx_org_task_project; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_task_project ON org.tasks USING btree (project_id, status) WHERE (is_deleted = false);


--
-- Name: idx_org_task_tags; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_task_tags ON org.tasks USING gin (tags);


--
-- Name: idx_org_txn_account; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_txn_account ON org.transactions USING btree (account_id) WHERE (is_deleted = false);


--
-- Name: idx_org_txn_org; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_txn_org ON org.transactions USING btree (org_id, txn_date DESC) WHERE (is_deleted = false);


--
-- Name: idx_org_txn_recon; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_txn_recon ON org.transactions USING btree (org_id, reconciled) WHERE (reconciled = false);


--
-- Name: idx_org_type; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_type ON org.organizations USING btree (org_type) WHERE (is_deleted = false);


--
-- Name: idx_org_visibility; Type: INDEX; Schema: org; Owner: -
--

CREATE INDEX idx_org_visibility ON org.organizations USING btree (visibility) WHERE (is_deleted = false);


--
-- Name: idx_ur_role; Type: INDEX; Schema: rbac; Owner: -
--

CREATE INDEX idx_ur_role ON rbac.user_roles USING btree (role_id);


--
-- Name: idx_ur_scope; Type: INDEX; Schema: rbac; Owner: -
--

CREATE INDEX idx_ur_scope ON rbac.user_roles USING btree (scope_type, scope_id) WHERE (scope_type IS NOT NULL);


--
-- Name: idx_ur_user; Type: INDEX; Schema: rbac; Owner: -
--

CREATE INDEX idx_ur_user ON rbac.user_roles USING btree (user_id) WHERE (is_active = true);


--
-- Name: invitations trg_auth_invitations_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_auth_invitations_upd BEFORE UPDATE ON auth.invitations FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: user_identities trg_auth_user_identities_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_auth_user_identities_upd BEFORE UPDATE ON auth.user_identities FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: user_profiles trg_auth_user_profiles_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_auth_user_profiles_upd BEFORE UPDATE ON auth.user_profiles FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: user_verifications trg_auth_user_verifications_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_auth_user_verifications_upd BEFORE UPDATE ON auth.user_verifications FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: users trg_auth_users_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_auth_users_upd BEFORE UPDATE ON auth.users FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: invitations trg_invitations_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_invitations_upd BEFORE UPDATE ON auth.invitations FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: user_identities trg_user_identities_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_user_identities_upd BEFORE UPDATE ON auth.user_identities FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: user_profiles trg_user_profiles_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_user_profiles_upd BEFORE UPDATE ON auth.user_profiles FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: user_verifications trg_user_verif_sdel; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_user_verif_sdel BEFORE UPDATE ON auth.user_verifications FOR EACH ROW EXECUTE FUNCTION public.fn_soft_delete();


--
-- Name: user_verifications trg_user_verif_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_user_verif_upd BEFORE UPDATE ON auth.user_verifications FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: users trg_users_sdel; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_users_sdel BEFORE UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.fn_soft_delete();


--
-- Name: users trg_users_upd; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_users_upd BEFORE UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: identity_providers trg_config_identity_providers_upd; Type: TRIGGER; Schema: config; Owner: -
--

CREATE TRIGGER trg_config_identity_providers_upd BEFORE UPDATE ON config.identity_providers FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: registration_policies trg_config_registration_policies_upd; Type: TRIGGER; Schema: config; Owner: -
--

CREATE TRIGGER trg_config_registration_policies_upd BEFORE UPDATE ON config.registration_policies FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: security_policies trg_config_security_policies_upd; Type: TRIGGER; Schema: config; Owner: -
--

CREATE TRIGGER trg_config_security_policies_upd BEFORE UPDATE ON config.security_policies FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: settings trg_config_settings_upd; Type: TRIGGER; Schema: config; Owner: -
--

CREATE TRIGGER trg_config_settings_upd BEFORE UPDATE ON config.settings FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: identity_providers trg_idp_upd; Type: TRIGGER; Schema: config; Owner: -
--

CREATE TRIGGER trg_idp_upd BEFORE UPDATE ON config.identity_providers FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: registration_policies trg_reg_policies_upd; Type: TRIGGER; Schema: config; Owner: -
--

CREATE TRIGGER trg_reg_policies_upd BEFORE UPDATE ON config.registration_policies FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: security_policies trg_sec_policies_upd; Type: TRIGGER; Schema: config; Owner: -
--

CREATE TRIGGER trg_sec_policies_upd BEFORE UPDATE ON config.security_policies FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: settings trg_settings_upd; Type: TRIGGER; Schema: config; Owner: -
--

CREATE TRIGGER trg_settings_upd BEFORE UPDATE ON config.settings FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: translation_keys trg_i18n_translation_keys_upd; Type: TRIGGER; Schema: i18n; Owner: -
--

CREATE TRIGGER trg_i18n_translation_keys_upd BEFORE UPDATE ON i18n.translation_keys FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: translations trg_i18n_translations_upd; Type: TRIGGER; Schema: i18n; Owner: -
--

CREATE TRIGGER trg_i18n_translations_upd BEFORE UPDATE ON i18n.translations FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: translation_keys trg_tk_upd; Type: TRIGGER; Schema: i18n; Owner: -
--

CREATE TRIGGER trg_tk_upd BEFORE UPDATE ON i18n.translation_keys FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: translations trg_trans_upd; Type: TRIGGER; Schema: i18n; Owner: -
--

CREATE TRIGGER trg_trans_upd BEFORE UPDATE ON i18n.translations FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: accounts trg_org_accounts_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_accounts_upd BEFORE UPDATE ON org.accounts FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: announcements trg_org_announcements_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_announcements_upd BEFORE UPDATE ON org.announcements FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: budgets trg_org_budgets_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_budgets_upd BEFORE UPDATE ON org.budgets FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: channels trg_org_channels_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_channels_upd BEFORE UPDATE ON org.channels FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: event_registrations trg_org_event_registrations_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_event_registrations_upd BEFORE UPDATE ON org.event_registrations FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: events trg_org_events_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_events_upd BEFORE UPDATE ON org.events FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: files trg_org_files_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_files_upd BEFORE UPDATE ON org.files FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: folders trg_org_folders_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_folders_upd BEFORE UPDATE ON org.folders FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: landing_sections trg_org_landing_sections_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_landing_sections_upd BEFORE UPDATE ON org.landing_sections FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: meeting_minutes trg_org_meeting_minutes_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_meeting_minutes_upd BEFORE UPDATE ON org.meeting_minutes FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: meetings trg_org_meetings_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_meetings_upd BEFORE UPDATE ON org.meetings FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: member_subscriptions trg_org_member_subscriptions_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_member_subscriptions_upd BEFORE UPDATE ON org.member_subscriptions FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: membership_plans trg_org_membership_plans_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_membership_plans_upd BEFORE UPDATE ON org.membership_plans FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: org_members trg_org_org_members_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_org_members_upd BEFORE UPDATE ON org.org_members FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: org_roles trg_org_org_roles_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_org_roles_upd BEFORE UPDATE ON org.org_roles FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: org_settings trg_org_org_settings_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_org_settings_upd BEFORE UPDATE ON org.org_settings FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: organizations trg_org_organizations_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_organizations_upd BEFORE UPDATE ON org.organizations FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: projects trg_org_projects_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_projects_upd BEFORE UPDATE ON org.projects FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: task_comments trg_org_task_comments_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_task_comments_upd BEFORE UPDATE ON org.task_comments FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: tasks trg_org_tasks_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_tasks_upd BEFORE UPDATE ON org.tasks FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: transactions trg_org_transactions_upd; Type: TRIGGER; Schema: org; Owner: -
--

CREATE TRIGGER trg_org_transactions_upd BEFORE UPDATE ON org.transactions FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: permissions trg_perms_upd; Type: TRIGGER; Schema: rbac; Owner: -
--

CREATE TRIGGER trg_perms_upd BEFORE UPDATE ON rbac.permissions FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: permissions trg_rbac_permissions_upd; Type: TRIGGER; Schema: rbac; Owner: -
--

CREATE TRIGGER trg_rbac_permissions_upd BEFORE UPDATE ON rbac.permissions FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: roles trg_rbac_roles_upd; Type: TRIGGER; Schema: rbac; Owner: -
--

CREATE TRIGGER trg_rbac_roles_upd BEFORE UPDATE ON rbac.roles FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: user_roles trg_rbac_user_roles_upd; Type: TRIGGER; Schema: rbac; Owner: -
--

CREATE TRIGGER trg_rbac_user_roles_upd BEFORE UPDATE ON rbac.user_roles FOR EACH ROW WHEN ((NOT (old.updated_at IS DISTINCT FROM new.updated_at))) EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: roles trg_roles_sdel; Type: TRIGGER; Schema: rbac; Owner: -
--

CREATE TRIGGER trg_roles_sdel BEFORE UPDATE ON rbac.roles FOR EACH ROW EXECUTE FUNCTION public.fn_soft_delete();


--
-- Name: roles trg_roles_upd; Type: TRIGGER; Schema: rbac; Owner: -
--

CREATE TRIGGER trg_roles_upd BEFORE UPDATE ON rbac.roles FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: user_roles trg_ur_upd; Type: TRIGGER; Schema: rbac; Owner: -
--

CREATE TRIGGER trg_ur_upd BEFORE UPDATE ON rbac.user_roles FOR EACH ROW EXECUTE FUNCTION public.fn_updated_at();


--
-- Name: invitations invitations_by_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.invitations
    ADD CONSTRAINT invitations_by_fk FOREIGN KEY (invited_by) REFERENCES auth.users(id);


--
-- Name: user_identities user_identities_provider_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_identities
    ADD CONSTRAINT user_identities_provider_fk FOREIGN KEY (provider_code) REFERENCES config.identity_providers(code);


--
-- Name: user_identities user_identities_user_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_identities
    ADD CONSTRAINT user_identities_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_ancestry_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_ancestry_fk FOREIGN KEY (ancestry_code) REFERENCES config.ancestries(code);


--
-- Name: user_profiles user_profiles_education_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_education_fk FOREIGN KEY (education_level_code) REFERENCES config.education_levels(code);


--
-- Name: user_profiles user_profiles_ethnicity_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_ethnicity_fk FOREIGN KEY (ethnicity_code) REFERENCES config.ethnicities(code);


--
-- Name: user_profiles user_profiles_gender_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_gender_fk FOREIGN KEY (gender_code) REFERENCES config.genders(code);


--
-- Name: user_profiles user_profiles_language_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_language_fk FOREIGN KEY (language_code) REFERENCES config.languages(code);


--
-- Name: user_profiles user_profiles_marital_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_marital_fk FOREIGN KEY (marital_status_code) REFERENCES config.marital_statuses(code);


--
-- Name: user_profiles user_profiles_occupation_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_occupation_fk FOREIGN KEY (occupation_code) REFERENCES config.occupations(code);


--
-- Name: user_profiles user_profiles_religion_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_religion_fk FOREIGN KEY (religion_code) REFERENCES config.religions(code);


--
-- Name: user_profiles user_profiles_user_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_profiles
    ADD CONSTRAINT user_profiles_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_sessions
    ADD CONSTRAINT user_sessions_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_verifications user_verif_user_fk; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.user_verifications
    ADD CONSTRAINT user_verif_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: translations translations_key_fk; Type: FK CONSTRAINT; Schema: i18n; Owner: -
--

ALTER TABLE ONLY i18n.translations
    ADD CONSTRAINT translations_key_fk FOREIGN KEY (key_id) REFERENCES i18n.translation_keys(id) ON DELETE CASCADE;


--
-- Name: translations translations_lng_fk; Type: FK CONSTRAINT; Schema: i18n; Owner: -
--

ALTER TABLE ONLY i18n.translations
    ADD CONSTRAINT translations_lng_fk FOREIGN KEY (language_code) REFERENCES config.languages(code);


--
-- Name: landing_sections landing_sec_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.landing_sections
    ADD CONSTRAINT landing_sec_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: accounts org_acct_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.accounts
    ADD CONSTRAINT org_acct_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: accounts org_acct_parent_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.accounts
    ADD CONSTRAINT org_acct_parent_fk FOREIGN KEY (parent_id) REFERENCES org.accounts(id);


--
-- Name: announcements org_ann_author_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.announcements
    ADD CONSTRAINT org_ann_author_fk FOREIGN KEY (author_id) REFERENCES auth.users(id);


--
-- Name: announcements org_ann_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.announcements
    ADD CONSTRAINT org_ann_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: meeting_attendees org_att_meeting_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.meeting_attendees
    ADD CONSTRAINT org_att_meeting_fk FOREIGN KEY (meeting_id) REFERENCES org.meetings(id) ON DELETE CASCADE;


--
-- Name: meeting_attendees org_att_user_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.meeting_attendees
    ADD CONSTRAINT org_att_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: org_audit_logs org_aud_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_audit_logs
    ADD CONSTRAINT org_aud_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: org_banners org_banners_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_banners
    ADD CONSTRAINT org_banners_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: budgets org_budget_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.budgets
    ADD CONSTRAINT org_budget_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: channels org_chan_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.channels
    ADD CONSTRAINT org_chan_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: channel_members org_chanmem_chan_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.channel_members
    ADD CONSTRAINT org_chanmem_chan_fk FOREIGN KEY (channel_id) REFERENCES org.channels(id) ON DELETE CASCADE;


--
-- Name: channel_members org_chanmem_user_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.channel_members
    ADD CONSTRAINT org_chanmem_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: event_check_ins org_checkin_event_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_check_ins
    ADD CONSTRAINT org_checkin_event_fk FOREIGN KEY (event_id) REFERENCES org.events(id) ON DELETE CASCADE;


--
-- Name: event_check_ins org_checkin_user_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_check_ins
    ADD CONSTRAINT org_checkin_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: organizations org_creator_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.organizations
    ADD CONSTRAINT org_creator_fk FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: events org_evt_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.events
    ADD CONSTRAINT org_evt_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: files org_file_folder_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.files
    ADD CONSTRAINT org_file_folder_fk FOREIGN KEY (folder_id) REFERENCES org.folders(id);


--
-- Name: files org_file_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.files
    ADD CONSTRAINT org_file_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: folders org_folder_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.folders
    ADD CONSTRAINT org_folder_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: folders org_folder_parent_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.folders
    ADD CONSTRAINT org_folder_parent_fk FOREIGN KEY (parent_id) REFERENCES org.folders(id);


--
-- Name: file_permissions org_fp_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.file_permissions
    ADD CONSTRAINT org_fp_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: meetings org_meet_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.meetings
    ADD CONSTRAINT org_meet_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: org_members org_mem_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_members
    ADD CONSTRAINT org_mem_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: org_members org_mem_role_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_members
    ADD CONSTRAINT org_mem_role_fk FOREIGN KEY (role_id) REFERENCES org.org_roles(id) ON DELETE SET NULL;


--
-- Name: org_members org_mem_user_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_members
    ADD CONSTRAINT org_mem_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: meeting_minutes org_min_meeting_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.meeting_minutes
    ADD CONSTRAINT org_min_meeting_fk FOREIGN KEY (meeting_id) REFERENCES org.meetings(id) ON DELETE CASCADE;


--
-- Name: messages org_msg_chan_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.messages
    ADD CONSTRAINT org_msg_chan_fk FOREIGN KEY (channel_id) REFERENCES org.channels(id) ON DELETE CASCADE;


--
-- Name: messages org_msg_reply_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.messages
    ADD CONSTRAINT org_msg_reply_fk FOREIGN KEY (reply_to_id) REFERENCES org.messages(id);


--
-- Name: messages org_msg_sender_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.messages
    ADD CONSTRAINT org_msg_sender_fk FOREIGN KEY (sender_id) REFERENCES auth.users(id);


--
-- Name: organizations org_owner_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.organizations
    ADD CONSTRAINT org_owner_fk FOREIGN KEY (owner_user_id) REFERENCES auth.users(id);


--
-- Name: org_permissions org_perms_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_permissions
    ADD CONSTRAINT org_perms_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: membership_plans org_plans_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.membership_plans
    ADD CONSTRAINT org_plans_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: project_members org_pm_project_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.project_members
    ADD CONSTRAINT org_pm_project_fk FOREIGN KEY (project_id) REFERENCES org.projects(id) ON DELETE CASCADE;


--
-- Name: project_members org_pm_user_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.project_members
    ADD CONSTRAINT org_pm_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: projects org_proj_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.projects
    ADD CONSTRAINT org_proj_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: message_reactions org_react_msg_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.message_reactions
    ADD CONSTRAINT org_react_msg_fk FOREIGN KEY (message_id) REFERENCES org.messages(id) ON DELETE CASCADE;


--
-- Name: message_reactions org_react_user_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.message_reactions
    ADD CONSTRAINT org_react_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: message_reads org_reads_msg_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.message_reads
    ADD CONSTRAINT org_reads_msg_fk FOREIGN KEY (message_id) REFERENCES org.messages(id) ON DELETE CASCADE;


--
-- Name: message_reads org_reads_user_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.message_reads
    ADD CONSTRAINT org_reads_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: event_registrations org_reg_event_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_registrations
    ADD CONSTRAINT org_reg_event_fk FOREIGN KEY (event_id) REFERENCES org.events(id) ON DELETE CASCADE;


--
-- Name: event_registrations org_reg_ticket_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_registrations
    ADD CONSTRAINT org_reg_ticket_fk FOREIGN KEY (ticket_id) REFERENCES org.event_tickets(id);


--
-- Name: event_registrations org_reg_user_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_registrations
    ADD CONSTRAINT org_reg_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: org_roles org_roles_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_roles
    ADD CONSTRAINT org_roles_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: org_role_permissions org_rp_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_role_permissions
    ADD CONSTRAINT org_rp_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: org_role_permissions org_rp_perm_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_role_permissions
    ADD CONSTRAINT org_rp_perm_fk FOREIGN KEY (permission_id) REFERENCES org.org_permissions(id) ON DELETE CASCADE;


--
-- Name: org_role_permissions org_rp_role_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_role_permissions
    ADD CONSTRAINT org_rp_role_fk FOREIGN KEY (role_id) REFERENCES org.org_roles(id) ON DELETE CASCADE;


--
-- Name: financial_reports org_rpt_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.financial_reports
    ADD CONSTRAINT org_rpt_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: org_settings org_set_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.org_settings
    ADD CONSTRAINT org_set_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: member_subscriptions org_subs_member_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.member_subscriptions
    ADD CONSTRAINT org_subs_member_fk FOREIGN KEY (member_id) REFERENCES org.org_members(id) ON DELETE CASCADE;


--
-- Name: member_subscriptions org_subs_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.member_subscriptions
    ADD CONSTRAINT org_subs_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: member_subscriptions org_subs_plan_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.member_subscriptions
    ADD CONSTRAINT org_subs_plan_fk FOREIGN KEY (plan_id) REFERENCES org.membership_plans(id);


--
-- Name: tasks org_task_assign_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.tasks
    ADD CONSTRAINT org_task_assign_fk FOREIGN KEY (assignee_id) REFERENCES auth.users(id);


--
-- Name: tasks org_task_parent_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.tasks
    ADD CONSTRAINT org_task_parent_fk FOREIGN KEY (parent_id) REFERENCES org.tasks(id);


--
-- Name: tasks org_task_project_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.tasks
    ADD CONSTRAINT org_task_project_fk FOREIGN KEY (project_id) REFERENCES org.projects(id) ON DELETE CASCADE;


--
-- Name: task_comments org_tc_task_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.task_comments
    ADD CONSTRAINT org_tc_task_fk FOREIGN KEY (task_id) REFERENCES org.tasks(id) ON DELETE CASCADE;


--
-- Name: task_comments org_tc_user_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.task_comments
    ADD CONSTRAINT org_tc_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: event_tickets org_tkt_event_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.event_tickets
    ADD CONSTRAINT org_tkt_event_fk FOREIGN KEY (event_id) REFERENCES org.events(id) ON DELETE CASCADE;


--
-- Name: transactions org_txn_account_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.transactions
    ADD CONSTRAINT org_txn_account_fk FOREIGN KEY (account_id) REFERENCES org.accounts(id);


--
-- Name: transactions org_txn_creator_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.transactions
    ADD CONSTRAINT org_txn_creator_fk FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: transactions org_txn_org_fk; Type: FK CONSTRAINT; Schema: org; Owner: -
--

ALTER TABLE ONLY org.transactions
    ADD CONSTRAINT org_txn_org_fk FOREIGN KEY (org_id) REFERENCES org.organizations(id) ON DELETE CASCADE;


--
-- Name: role_hierarchy rh_child_fk; Type: FK CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.role_hierarchy
    ADD CONSTRAINT rh_child_fk FOREIGN KEY (child_role_id) REFERENCES rbac.roles(id) ON DELETE CASCADE;


--
-- Name: role_hierarchy rh_parent_fk; Type: FK CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.role_hierarchy
    ADD CONSTRAINT rh_parent_fk FOREIGN KEY (parent_role_id) REFERENCES rbac.roles(id) ON DELETE CASCADE;


--
-- Name: role_permissions rp_perm_fk; Type: FK CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.role_permissions
    ADD CONSTRAINT rp_perm_fk FOREIGN KEY (permission_id) REFERENCES rbac.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions rp_role_fk; Type: FK CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.role_permissions
    ADD CONSTRAINT rp_role_fk FOREIGN KEY (role_id) REFERENCES rbac.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles ur_role_fk; Type: FK CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.user_roles
    ADD CONSTRAINT ur_role_fk FOREIGN KEY (role_id) REFERENCES rbac.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles ur_user_fk; Type: FK CONSTRAINT; Schema: rbac; Owner: -
--

ALTER TABLE ONLY rbac.user_roles
    ADD CONSTRAINT ur_user_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


