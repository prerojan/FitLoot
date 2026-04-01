BEGIN;

CREATE SCHEMA IF NOT EXISTS compat;

CREATE OR REPLACE FUNCTION compat._base_sqlite_datetime(value text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, compat
AS $$
DECLARE
  trimmed text;
BEGIN
  IF value IS NULL THEN
    RETURN NULL;
  END IF;

  trimmed := btrim(value);
  IF lower(trimmed) = 'now' THEN
    RETURN timezone('utc', now());
  END IF;

  RETURN value::timestamptz;
END;
$$;

CREATE OR REPLACE FUNCTION compat._apply_sqlite_datetime_modifier(
  base_ts timestamptz,
  modifier text
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, compat
AS $$
BEGIN
  IF modifier IS NULL OR btrim(modifier) = '' THEN
    RETURN base_ts;
  END IF;

  RETURN base_ts + (btrim(modifier))::interval;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Unsupported sqlite datetime() modifier: %', modifier
      USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION compat.datetime(value text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, compat
AS $$
  SELECT compat._base_sqlite_datetime(value);
$$;

CREATE OR REPLACE FUNCTION compat.datetime(value text, modifier text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, compat
AS $$
  SELECT compat._apply_sqlite_datetime_modifier(
    compat._base_sqlite_datetime(value),
    modifier
  );
$$;

CREATE OR REPLACE FUNCTION compat.datetime(value timestamptz)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, compat
AS $$
  SELECT value;
$$;

CREATE OR REPLACE FUNCTION compat.datetime(value timestamptz, modifier text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, compat
AS $$
  SELECT compat._apply_sqlite_datetime_modifier(value, modifier);
$$;

CREATE OR REPLACE FUNCTION compat.datetime(value timestamp)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, compat
AS $$
  SELECT value AT TIME ZONE 'UTC';
$$;

CREATE OR REPLACE FUNCTION compat.datetime(value timestamp, modifier text)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public, compat
AS $$
  SELECT compat._apply_sqlite_datetime_modifier(
    value AT TIME ZONE 'UTC',
    modifier
  );
$$;

GRANT EXECUTE ON FUNCTION compat.datetime(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION compat.datetime(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION compat.datetime(timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION compat.datetime(timestamptz, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION compat.datetime(timestamp) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION compat.datetime(timestamp, text) TO anon, authenticated, service_role;

COMMIT;
