SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;

IF COL_LENGTH(N'dbo.members', N'membership_revision') IS NULL
  ALTER TABLE dbo.members ADD membership_revision bigint NOT NULL
    CONSTRAINT DF_members_membership_revision DEFAULT (0);

IF COL_LENGTH(N'dbo.members', N'membership_status') IS NULL
  ALTER TABLE dbo.members ADD membership_status nvarchar(max) NOT NULL
    CONSTRAINT DF_members_membership_status DEFAULT (N'active');

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.members')
    AND name = N'membership_status'
    AND max_length <> -1
)
BEGIN
  DECLARE @membership_status_default sysname;
  SELECT @membership_status_default = dc.name
  FROM sys.default_constraints dc
  INNER JOIN sys.columns c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.members')
    AND c.name = N'membership_status';

  IF @membership_status_default IS NOT NULL
  BEGIN
    DECLARE @drop_membership_status_default nvarchar(max) =
      N'ALTER TABLE dbo.members DROP CONSTRAINT ' + QUOTENAME(@membership_status_default) + N';';
    EXEC sys.sp_executesql @drop_membership_status_default;
  END;

  EXEC(N'ALTER TABLE dbo.members ALTER COLUMN membership_status nvarchar(max) NOT NULL;');
  ALTER TABLE dbo.members ADD CONSTRAINT DF_members_membership_status
    DEFAULT (N'active') FOR membership_status;
END;

IF COL_LENGTH(N'dbo.members', N'membership_member_id') IS NULL
  ALTER TABLE dbo.members ADD membership_member_id uniqueidentifier NULL;

-- Older releases could copy private membership profile fields to a till.
-- Offline lookup requires only the minimal directory; clear those local-only
-- copies without changing the central POS or membership databases.
UPDATE dbo.members
SET email = NULL, address = NULL, country_code = NULL, postal_code = NULL, date_of_birth = NULL
WHERE email IS NOT NULL OR address IS NOT NULL OR country_code IS NOT NULL
   OR postal_code IS NOT NULL OR date_of_birth IS NOT NULL;

-- Supabase Auth identity/password material is never part of the till roster.
-- Preserve any email already held by an earlier installation, but new
-- offline-directory rows get a blank local placeholder because the device
-- pull allowlist deliberately does not copy cloud email. Offline
-- authentication uses only username plus bcrypt pin_hash.
UPDATE dbo.app_users
SET auth_user_id = NULL, auth_secret = N''
WHERE auth_user_id IS NOT NULL OR auth_secret <> N'';

IF NOT EXISTS (
  SELECT 1
  FROM sys.default_constraints dc
  INNER JOIN sys.columns c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.app_users')
    AND c.name = N'email'
)
  ALTER TABLE dbo.app_users ADD CONSTRAINT DF_app_users_email
    DEFAULT (N'') FOR email;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.members') AND name = N'IX_members_membership_revision'
)
  EXEC(N'CREATE INDEX IX_members_membership_revision ON dbo.members(membership_revision);');

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.members') AND name = N'UX_members_membership_member_id'
)
  EXEC(N'CREATE UNIQUE INDEX UX_members_membership_member_id
    ON dbo.members(membership_member_id)
    WHERE membership_member_id IS NOT NULL;');

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
  CREATE TABLE dbo.pos_schema_migrations (
    version int NOT NULL PRIMARY KEY,
    name nvarchar(200) NOT NULL,
    applied_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 5)
  INSERT dbo.pos_schema_migrations(version, name)
  VALUES (5, N'staff_sql_and_member_directory');
