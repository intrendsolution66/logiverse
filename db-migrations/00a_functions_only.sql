-- 00a_functions_only.sql
--
-- Standalone sanity check: just the extensions + 4 helper functions
-- (fn_soft_delete, fn_updated_at, gen_uuid_v7, uuid_v7_to_ts) that every
-- table in the main schema file depends on. Run this FIRST, on its own,
-- to confirm it succeeds cleanly before running the full
-- 00_core_schema_only.sql — this isolates whether DBeaver is mis-splitting
-- the $$...$$ PL/pgSQL function bodies (a known DBeaver gotcha) from any
-- other issue.
--
-- If this file alone throws an error, that confirms the function-body
-- splitting theory; try running just the CREATE FUNCTION gen_uuid_v7()
-- statement by itself (select it manually, including the full $$...$$
-- body, then "Execute SQL Statement" — not the whole script) to narrow
-- it down further.

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


