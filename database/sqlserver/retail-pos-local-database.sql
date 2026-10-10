/*
  Retail POS local Microsoft SQL Server schema
  Generated from the migrations loaded by the POS application.

  Application version: 1.4.55
  Target database: POS_Local

  Run this file while connected to the local Microsoft SQL Server instance.
  It creates POS_Local when needed, selects it, and installs or updates the
  complete schema. The script is additive and re-runnable. It does not delete
  tables or business data.
*/

USE [master];
GO

IF DB_ID(N'POS_Local') IS NULL
  EXEC(N'CREATE DATABASE [POS_Local]');
GO

USE [POS_Local];
GO

-- SECTION 1: Domain tables, columns, indexes, store groups and local tracking

-- Generated from supabase/schema.sql. Re-runnable and additive.

SET ANSI_NULLS ON;

SET QUOTED_IDENTIFIER ON;

SET ANSI_PADDING ON;

SET ANSI_WARNINGS ON;

SET ARITHABORT ON;

SET CONCAT_NULL_YIELDS_NULL ON;

SET NUMERIC_ROUNDABORT OFF;

SET XACT_ABORT ON;

IF NOT EXISTS (SELECT 1 FROM sys.change_tracking_databases WHERE database_id=DB_ID()) ALTER DATABASE CURRENT SET CHANGE_TRACKING = ON (CHANGE_RETENTION = 7 DAYS, AUTO_CLEANUP = ON);

GO

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NULL BEGIN CREATE TABLE dbo.[coupon_campaigns] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_coupon_campaigns_id] DEFAULT (NEWID()),
  [name] nvarchar(max) NOT NULL,
  [slug] nvarchar(450) NOT NULL,
  [discount_type] nvarchar(max) NOT NULL CONSTRAINT [DF_coupon_campaigns_discount_type] DEFAULT ('PERCENTAGE'),
  [discount_value] decimal(38,12) NOT NULL CONSTRAINT [DF_coupon_campaigns_discount_value] DEFAULT (0),
  [scope] nvarchar(max) NOT NULL CONSTRAINT [DF_coupon_campaigns_scope] DEFAULT ('BILL'),
  [scope_value] nvarchar(max) NULL,
  [max_claims] int NULL,
  [max_per_member] int NULL CONSTRAINT [DF_coupon_campaigns_max_per_member] DEFAULT (1),
  [claims_count] int NOT NULL CONSTRAINT [DF_coupon_campaigns_claims_count] DEFAULT (0),
  [starts_at] datetimeoffset(7) NULL,
  [expires_at] datetimeoffset(7) NULL,
  [is_active] bit NOT NULL CONSTRAINT [DF_coupon_campaigns_is_active] DEFAULT (1),
  [is_welcome] bit NOT NULL CONSTRAINT [DF_coupon_campaigns_is_welcome] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_coupon_campaigns_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_coupon_campaigns_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_coupon_campaigns_row_version] DEFAULT (1),
  CONSTRAINT [PK_coupon_campaigns] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns')) ALTER TABLE dbo.[coupon_campaigns] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'id') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'id'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'name') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'slug') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [slug] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'slug' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [slug] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'discount_type') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [discount_type] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'discount_type') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'discount_type'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_discount_type] DEFAULT ('PERCENTAGE') FOR [discount_type];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'discount_type' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [discount_type]=''PERCENTAGE'' WHERE [discount_type] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [discount_type] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'discount_value') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [discount_value] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'discount_value') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'discount_value'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_discount_value] DEFAULT (0) FOR [discount_value];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'discount_value' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [discount_value]=0 WHERE [discount_value] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [discount_value] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'scope') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [scope] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'scope') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'scope'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_scope] DEFAULT ('BILL') FOR [scope];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'scope' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [scope]=''BILL'' WHERE [scope] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [scope] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'scope_value') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [scope_value] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'max_claims') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [max_claims] int NULL;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'max_per_member') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [max_per_member] int NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'max_per_member') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'max_per_member'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_max_per_member] DEFAULT (1) FOR [max_per_member];

IF COL_LENGTH(N'dbo.coupon_campaigns', N'claims_count') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [claims_count] int NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'claims_count') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'claims_count'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_claims_count] DEFAULT (0) FOR [claims_count];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'claims_count' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [claims_count]=0 WHERE [claims_count] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [claims_count] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'starts_at') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [starts_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'expires_at') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [expires_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'is_active') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'is_active'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'is_welcome') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [is_welcome] bit NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'is_welcome') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'is_welcome'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_is_welcome] DEFAULT (0) FOR [is_welcome];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'is_welcome' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [is_welcome]=0 WHERE [is_welcome] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [is_welcome] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'created_at') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'created_at'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'updated_at') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'updated_at'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.coupon_campaigns', N'row_version') IS NULL ALTER TABLE dbo.[coupon_campaigns] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.coupon_campaigns', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_campaigns', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND c.name=N'row_version'
) ALTER TABLE dbo.[coupon_campaigns] ADD CONSTRAINT [DF_coupon_campaigns_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_campaigns] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[coupon_campaigns] ALTER COLUMN [row_version] int NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'UX_coupon_campaigns_slug') CREATE UNIQUE INDEX [UX_coupon_campaigns_slug] ON dbo.[coupon_campaigns]([slug]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.coupon_campaigns') AND name=N'IX_coupon_campaigns_updated_at') CREATE INDEX [IX_coupon_campaigns_updated_at] ON dbo.[coupon_campaigns]([updated_at]);

IF OBJECT_ID(N'dbo.shifts', N'U') IS NULL BEGIN CREATE TABLE dbo.[shifts] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_shifts_id] DEFAULT (NEWID()),
  [store_id] nvarchar(450) NOT NULL,
  [terminal_id] nvarchar(max) NULL,
  [terminal_name] nvarchar(max) NULL,
  [opened_by_name] nvarchar(max) NOT NULL CONSTRAINT [DF_shifts_opened_by_name] DEFAULT ('Cashier'),
  [opened_by_staff_id] nvarchar(max) NULL,
  [opened_by_role] nvarchar(max) NULL,
  [closed_by_name] nvarchar(max) NULL,
  [closed_by_staff_id] nvarchar(max) NULL,
  [closed_by_role] nvarchar(max) NULL,
  [opened_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shifts_opened_at] DEFAULT (SYSDATETIMEOFFSET()),
  [closed_at] datetimeoffset(7) NULL,
  [opening_float] decimal(38,12) NOT NULL CONSTRAINT [DF_shifts_opening_float] DEFAULT (0),
  [counted_cash] decimal(38,12) NULL,
  [expected_cash] decimal(38,12) NULL,
  [note] nvarchar(max) NOT NULL CONSTRAINT [DF_shifts_note] DEFAULT (''),
  [overdue] bit NOT NULL CONSTRAINT [DF_shifts_overdue] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shifts_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shifts_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_shifts_status] DEFAULT ('OPEN'),
  [closing_float] decimal(38,12) NULL,
  [user_id] uniqueidentifier NULL,
  [row_version] int NOT NULL CONSTRAINT [DF_shifts_row_version] DEFAULT (1),
  [counted_card] decimal(38,12) NULL,
  [counted_digital] decimal(38,12) NULL,
  [expected_card] decimal(38,12) NULL,
  [expected_digital] decimal(38,12) NULL,
  [variance_cash] decimal(38,12) NULL,
  [variance_card] decimal(38,12) NULL,
  [variance_digital] decimal(38,12) NULL,
  [variance_total] decimal(38,12) NULL,
  [state] nvarchar(max) NOT NULL CONSTRAINT [DF_shifts_state] DEFAULT ('ACTIVE'),
  [close_reason] nvarchar(max) NULL,
  [closing_started_at] datetimeoffset(7) NULL,
  [closing_started_by] nvarchar(max) NULL,
  [final_counted_cash] decimal(38,12) NULL,
  [variance_status] nvarchar(max) NULL,
  CONSTRAINT [PK_shifts] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.shifts')) ALTER TABLE dbo.[shifts] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.shifts', N'id') IS NULL ALTER TABLE dbo.[shifts] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'id'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shifts] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shifts', N'store_id') IS NULL ALTER TABLE dbo.[shifts] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shifts] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.shifts', N'terminal_id') IS NULL ALTER TABLE dbo.[shifts] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shifts', N'terminal_name') IS NULL ALTER TABLE dbo.[shifts] ADD [terminal_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shifts', N'opened_by_name') IS NULL ALTER TABLE dbo.[shifts] ADD [opened_by_name] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'opened_by_name') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'opened_by_name'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_opened_by_name] DEFAULT ('Cashier') FOR [opened_by_name];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'opened_by_name' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [opened_by_name]=''Cashier'' WHERE [opened_by_name] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [opened_by_name] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shifts', N'opened_by_staff_id') IS NULL ALTER TABLE dbo.[shifts] ADD [opened_by_staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shifts', N'opened_by_role') IS NULL ALTER TABLE dbo.[shifts] ADD [opened_by_role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shifts', N'closed_by_name') IS NULL ALTER TABLE dbo.[shifts] ADD [closed_by_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shifts', N'closed_by_staff_id') IS NULL ALTER TABLE dbo.[shifts] ADD [closed_by_staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shifts', N'closed_by_role') IS NULL ALTER TABLE dbo.[shifts] ADD [closed_by_role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shifts', N'opened_at') IS NULL ALTER TABLE dbo.[shifts] ADD [opened_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'opened_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'opened_at'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_opened_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [opened_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'opened_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [opened_at]=SYSDATETIMEOFFSET() WHERE [opened_at] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [opened_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shifts', N'closed_at') IS NULL ALTER TABLE dbo.[shifts] ADD [closed_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.shifts', N'opening_float') IS NULL ALTER TABLE dbo.[shifts] ADD [opening_float] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'opening_float') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'opening_float'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_opening_float] DEFAULT (0) FOR [opening_float];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'opening_float' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [opening_float]=0 WHERE [opening_float] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [opening_float] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shifts', N'counted_cash') IS NULL ALTER TABLE dbo.[shifts] ADD [counted_cash] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'expected_cash') IS NULL ALTER TABLE dbo.[shifts] ADD [expected_cash] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'note') IS NULL ALTER TABLE dbo.[shifts] ADD [note] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'note') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'note'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_note] DEFAULT ('') FOR [note];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'note' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [note]='''' WHERE [note] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [note] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shifts', N'overdue') IS NULL ALTER TABLE dbo.[shifts] ADD [overdue] bit NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'overdue') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'overdue'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_overdue] DEFAULT (0) FOR [overdue];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'overdue' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [overdue]=0 WHERE [overdue] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [overdue] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.shifts', N'created_at') IS NULL ALTER TABLE dbo.[shifts] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'created_at'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shifts', N'updated_at') IS NULL ALTER TABLE dbo.[shifts] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'updated_at'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shifts] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.shifts', N'status') IS NULL ALTER TABLE dbo.[shifts] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'status'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_status] DEFAULT ('OPEN') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [status]=''OPEN'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shifts', N'closing_float') IS NULL ALTER TABLE dbo.[shifts] ADD [closing_float] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'user_id') IS NULL ALTER TABLE dbo.[shifts] ADD [user_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.shifts', N'row_version') IS NULL ALTER TABLE dbo.[shifts] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'row_version'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.shifts', N'counted_card') IS NULL ALTER TABLE dbo.[shifts] ADD [counted_card] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'counted_digital') IS NULL ALTER TABLE dbo.[shifts] ADD [counted_digital] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'expected_card') IS NULL ALTER TABLE dbo.[shifts] ADD [expected_card] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'expected_digital') IS NULL ALTER TABLE dbo.[shifts] ADD [expected_digital] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'variance_cash') IS NULL ALTER TABLE dbo.[shifts] ADD [variance_cash] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'variance_card') IS NULL ALTER TABLE dbo.[shifts] ADD [variance_card] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'variance_digital') IS NULL ALTER TABLE dbo.[shifts] ADD [variance_digital] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'variance_total') IS NULL ALTER TABLE dbo.[shifts] ADD [variance_total] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'state') IS NULL ALTER TABLE dbo.[shifts] ADD [state] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shifts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shifts', N'state') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shifts') AND c.name=N'state'
) ALTER TABLE dbo.[shifts] ADD CONSTRAINT [DF_shifts_state] DEFAULT ('ACTIVE') FOR [state];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'state' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shifts] SET [state]=''ACTIVE'' WHERE [state] IS NULL;';
  ALTER TABLE dbo.[shifts] ALTER COLUMN [state] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shifts', N'close_reason') IS NULL ALTER TABLE dbo.[shifts] ADD [close_reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shifts', N'closing_started_at') IS NULL ALTER TABLE dbo.[shifts] ADD [closing_started_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.shifts', N'closing_started_by') IS NULL ALTER TABLE dbo.[shifts] ADD [closing_started_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shifts', N'final_counted_cash') IS NULL ALTER TABLE dbo.[shifts] ADD [final_counted_cash] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shifts', N'variance_status') IS NULL ALTER TABLE dbo.[shifts] ADD [variance_status] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'IX_shifts_store_id') CREATE INDEX [IX_shifts_store_id] ON dbo.[shifts]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shifts') AND name=N'IX_shifts_updated_at') CREATE INDEX [IX_shifts_updated_at] ON dbo.[shifts]([updated_at]);

IF OBJECT_ID(N'dbo.issued_vouchers', N'U') IS NULL BEGIN CREATE TABLE dbo.[issued_vouchers] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_issued_vouchers_id] DEFAULT (NEWID()),
  [token_slug] nvarchar(450) NOT NULL,
  [campaign_id] uniqueidentifier NOT NULL,
  [member_id] uniqueidentifier NULL,
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_issued_vouchers_status] DEFAULT ('ISSUED'),
  [issued_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_issued_vouchers_issued_at] DEFAULT (SYSDATETIMEOFFSET()),
  [expires_at] datetimeoffset(7) NULL,
  [issued_by] nvarchar(max) NULL,
  [issued_source] nvarchar(max) NOT NULL CONSTRAINT [DF_issued_vouchers_issued_source] DEFAULT ('PUBLIC'),
  [redeemed_at] datetimeoffset(7) NULL,
  [redeemed_by] nvarchar(max) NULL,
  [redeemed_sale_id] nvarchar(max) NULL,
  [disabled_at] datetimeoffset(7) NULL,
  [disabled_by] nvarchar(max) NULL,
  [disable_reason] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [row_version] int NOT NULL CONSTRAINT [DF_issued_vouchers_row_version] DEFAULT (1),
  CONSTRAINT [PK_issued_vouchers] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.issued_vouchers', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.issued_vouchers')) ALTER TABLE dbo.[issued_vouchers] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.issued_vouchers', N'id') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.issued_vouchers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.issued_vouchers', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'id'
) ALTER TABLE dbo.[issued_vouchers] ADD CONSTRAINT [DF_issued_vouchers_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.issued_vouchers') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[issued_vouchers] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'token_slug') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [token_slug] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'token_slug' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [token_slug] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'campaign_id') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [campaign_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'campaign_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [campaign_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'member_id') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [member_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'member_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [member_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'status') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.issued_vouchers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.issued_vouchers', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'status'
) ALTER TABLE dbo.[issued_vouchers] ADD CONSTRAINT [DF_issued_vouchers_status] DEFAULT ('ISSUED') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.issued_vouchers') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[issued_vouchers] SET [status]=''ISSUED'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.issued_vouchers', N'issued_at') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [issued_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.issued_vouchers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.issued_vouchers', N'issued_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'issued_at'
) ALTER TABLE dbo.[issued_vouchers] ADD CONSTRAINT [DF_issued_vouchers_issued_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [issued_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.issued_vouchers') AND name=N'issued_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[issued_vouchers] SET [issued_at]=SYSDATETIMEOFFSET() WHERE [issued_at] IS NULL;';
  ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [issued_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.issued_vouchers', N'expires_at') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [expires_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'issued_by') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [issued_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'issued_source') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [issued_source] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.issued_vouchers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.issued_vouchers', N'issued_source') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'issued_source'
) ALTER TABLE dbo.[issued_vouchers] ADD CONSTRAINT [DF_issued_vouchers_issued_source] DEFAULT ('PUBLIC') FOR [issued_source];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.issued_vouchers') AND name=N'issued_source' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[issued_vouchers] SET [issued_source]=''PUBLIC'' WHERE [issued_source] IS NULL;';
  ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [issued_source] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.issued_vouchers', N'redeemed_at') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [redeemed_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'redeemed_by') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [redeemed_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'redeemed_sale_id') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [redeemed_sale_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'disabled_at') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [disabled_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'disabled_by') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [disabled_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'disable_reason') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [disable_reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'store_id') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.issued_vouchers', N'row_version') IS NULL ALTER TABLE dbo.[issued_vouchers] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.issued_vouchers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.issued_vouchers', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.issued_vouchers') AND c.name=N'row_version'
) ALTER TABLE dbo.[issued_vouchers] ADD CONSTRAINT [DF_issued_vouchers_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.issued_vouchers') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[issued_vouchers] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[issued_vouchers] ALTER COLUMN [row_version] int NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.issued_vouchers') AND name=N'UX_issued_vouchers_token_slug') CREATE UNIQUE INDEX [UX_issued_vouchers_token_slug] ON dbo.[issued_vouchers]([token_slug]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.issued_vouchers') AND name=N'IX_issued_vouchers_store_id') CREATE INDEX [IX_issued_vouchers_store_id] ON dbo.[issued_vouchers]([store_id]);

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NULL BEGIN CREATE TABLE dbo.[activity_events] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_activity_events_id] DEFAULT (NEWID()),
  [event_type] nvarchar(max) NOT NULL,
  [severity] nvarchar(max) NOT NULL CONSTRAINT [DF_activity_events_severity] DEFAULT ('info'),
  [title] nvarchar(max) NOT NULL,
  [message] nvarchar(max) NOT NULL CONSTRAINT [DF_activity_events_message] DEFAULT (''),
  [actor_id] nvarchar(max) NULL,
  [actor_name] nvarchar(max) NULL,
  [actor_role] nvarchar(max) NULL,
  [terminal_id] nvarchar(max) NULL,
  [terminal_name] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [entity_type] nvarchar(max) NULL,
  [entity_id] nvarchar(max) NULL,
  [amount] decimal(38,12) NULL,
  [meta] nvarchar(max) NOT NULL CONSTRAINT [DF_activity_events_meta] DEFAULT (N'{}'),
  [whatsapp_status] nvarchar(max) NOT NULL CONSTRAINT [DF_activity_events_whatsapp_status] DEFAULT ('skipped'),
  [whatsapp_error] nvarchar(max) NULL,
  [client_event_id] nvarchar(450) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_activity_events_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [previous_state] nvarchar(max) NULL,
  [new_state] nvarchar(max) NULL,
  [cleared_by] nvarchar(max) NOT NULL CONSTRAINT [DF_activity_events_cleared_by] DEFAULT (N'[]'),
  [branch_id] nvarchar(450) NULL,
  CONSTRAINT [PK_activity_events] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.activity_events')) ALTER TABLE dbo.[activity_events] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.activity_events', N'id') IS NULL ALTER TABLE dbo.[activity_events] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.activity_events', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'id'
) ALTER TABLE dbo.[activity_events] ADD CONSTRAINT [DF_activity_events_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[activity_events] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[activity_events] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[activity_events] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.activity_events', N'event_type') IS NULL ALTER TABLE dbo.[activity_events] ADD [event_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'severity') IS NULL ALTER TABLE dbo.[activity_events] ADD [severity] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.activity_events', N'severity') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'severity'
) ALTER TABLE dbo.[activity_events] ADD CONSTRAINT [DF_activity_events_severity] DEFAULT ('info') FOR [severity];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'severity' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[activity_events] SET [severity]=''info'' WHERE [severity] IS NULL;';
  ALTER TABLE dbo.[activity_events] ALTER COLUMN [severity] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.activity_events', N'title') IS NULL ALTER TABLE dbo.[activity_events] ADD [title] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'message') IS NULL ALTER TABLE dbo.[activity_events] ADD [message] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.activity_events', N'message') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'message'
) ALTER TABLE dbo.[activity_events] ADD CONSTRAINT [DF_activity_events_message] DEFAULT ('') FOR [message];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'message' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[activity_events] SET [message]='''' WHERE [message] IS NULL;';
  ALTER TABLE dbo.[activity_events] ALTER COLUMN [message] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.activity_events', N'actor_id') IS NULL ALTER TABLE dbo.[activity_events] ADD [actor_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'actor_name') IS NULL ALTER TABLE dbo.[activity_events] ADD [actor_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'actor_role') IS NULL ALTER TABLE dbo.[activity_events] ADD [actor_role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'terminal_id') IS NULL ALTER TABLE dbo.[activity_events] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'terminal_name') IS NULL ALTER TABLE dbo.[activity_events] ADD [terminal_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'store_id') IS NULL ALTER TABLE dbo.[activity_events] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[activity_events] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'entity_type') IS NULL ALTER TABLE dbo.[activity_events] ADD [entity_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'entity_id') IS NULL ALTER TABLE dbo.[activity_events] ADD [entity_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'amount') IS NULL ALTER TABLE dbo.[activity_events] ADD [amount] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'meta') IS NULL ALTER TABLE dbo.[activity_events] ADD [meta] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.activity_events', N'meta') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'meta'
) ALTER TABLE dbo.[activity_events] ADD CONSTRAINT [DF_activity_events_meta] DEFAULT (N'{}') FOR [meta];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'meta' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[activity_events] SET [meta]=N''{}'' WHERE [meta] IS NULL;';
  ALTER TABLE dbo.[activity_events] ALTER COLUMN [meta] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.activity_events', N'whatsapp_status') IS NULL ALTER TABLE dbo.[activity_events] ADD [whatsapp_status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.activity_events', N'whatsapp_status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'whatsapp_status'
) ALTER TABLE dbo.[activity_events] ADD CONSTRAINT [DF_activity_events_whatsapp_status] DEFAULT ('skipped') FOR [whatsapp_status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'whatsapp_status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[activity_events] SET [whatsapp_status]=''skipped'' WHERE [whatsapp_status] IS NULL;';
  ALTER TABLE dbo.[activity_events] ALTER COLUMN [whatsapp_status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.activity_events', N'whatsapp_error') IS NULL ALTER TABLE dbo.[activity_events] ADD [whatsapp_error] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'client_event_id') IS NULL ALTER TABLE dbo.[activity_events] ADD [client_event_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'client_event_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[activity_events] ALTER COLUMN [client_event_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'created_at') IS NULL ALTER TABLE dbo.[activity_events] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.activity_events', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'created_at'
) ALTER TABLE dbo.[activity_events] ADD CONSTRAINT [DF_activity_events_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[activity_events] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[activity_events] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.activity_events', N'previous_state') IS NULL ALTER TABLE dbo.[activity_events] ADD [previous_state] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'new_state') IS NULL ALTER TABLE dbo.[activity_events] ADD [new_state] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.activity_events', N'cleared_by') IS NULL ALTER TABLE dbo.[activity_events] ADD [cleared_by] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.activity_events', N'cleared_by') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'cleared_by'
) ALTER TABLE dbo.[activity_events] ADD CONSTRAINT [DF_activity_events_cleared_by] DEFAULT (N'[]') FOR [cleared_by];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'cleared_by' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[activity_events] SET [cleared_by]=N''[]'' WHERE [cleared_by] IS NULL;';
  ALTER TABLE dbo.[activity_events] ALTER COLUMN [cleared_by] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.activity_events', N'branch_id') IS NULL ALTER TABLE dbo.[activity_events] ADD [branch_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.activity_events') AND c.name=N'branch_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[activity_events] ALTER COLUMN [branch_id] nvarchar(450) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'UX_activity_events_client_event_id') CREATE UNIQUE INDEX [UX_activity_events_client_event_id] ON dbo.[activity_events]([client_event_id]) WHERE [client_event_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'IX_activity_events_store_id') CREATE INDEX [IX_activity_events_store_id] ON dbo.[activity_events]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.activity_events') AND name=N'IX_activity_events_branch_id') CREATE INDEX [IX_activity_events_branch_id] ON dbo.[activity_events]([branch_id]);

IF OBJECT_ID(N'dbo.app_users', N'U') IS NULL BEGIN CREATE TABLE dbo.[app_users] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_app_users_id] DEFAULT (NEWID()),
  [user_id] nvarchar(64) NOT NULL,
  [full_name] nvarchar(160) NOT NULL,
  [email] nvarchar(255) NOT NULL,
  [role] nvarchar(max) NOT NULL,
  [store_id] nvarchar(64) NULL,
  [is_active] bit NOT NULL CONSTRAINT [DF_app_users_is_active] DEFAULT (1),
  [permissions] nvarchar(max) NOT NULL,
  [pin_hash] nvarchar(max) NOT NULL CONSTRAINT [DF_app_users_pin_hash] DEFAULT (''),
  [auth_user_id] uniqueidentifier NULL,
  [last_login_at] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_app_users_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_app_users_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [role_slug] nvarchar(max) NULL,
  [pin_length] smallint NOT NULL CONSTRAINT [DF_app_users_pin_length] DEFAULT (6),
  [row_version] int NOT NULL CONSTRAINT [DF_app_users_row_version] DEFAULT (1),
  [pin_set_at] datetimeoffset(7) NULL,
  [pin_updated_by] nvarchar(max) NULL,
  [auth_secret] nvarchar(max) NOT NULL CONSTRAINT [DF_app_users_auth_secret] DEFAULT (''),
  [idle_timeout_minutes] int NULL,
  CONSTRAINT [PK_app_users] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.app_users', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.app_users')) ALTER TABLE dbo.[app_users] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.app_users', N'id') IS NULL ALTER TABLE dbo.[app_users] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.app_users', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.app_users', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'id'
) ALTER TABLE dbo.[app_users] ADD CONSTRAINT [DF_app_users_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[app_users] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[app_users] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[app_users] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.app_users', N'user_id') IS NULL ALTER TABLE dbo.[app_users] ADD [user_id] nvarchar(64) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'user_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[app_users] ALTER COLUMN [user_id] nvarchar(64) NOT NULL;

IF COL_LENGTH(N'dbo.app_users', N'full_name') IS NULL ALTER TABLE dbo.[app_users] ADD [full_name] nvarchar(160) NULL;

IF COL_LENGTH(N'dbo.app_users', N'email') IS NULL ALTER TABLE dbo.[app_users] ADD [email] nvarchar(255) NULL;

IF COL_LENGTH(N'dbo.app_users', N'role') IS NULL ALTER TABLE dbo.[app_users] ADD [role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.app_users', N'store_id') IS NULL ALTER TABLE dbo.[app_users] ADD [store_id] nvarchar(64) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[app_users] ALTER COLUMN [store_id] nvarchar(64) NULL;

IF COL_LENGTH(N'dbo.app_users', N'is_active') IS NULL ALTER TABLE dbo.[app_users] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.app_users', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.app_users', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'is_active'
) ALTER TABLE dbo.[app_users] ADD CONSTRAINT [DF_app_users_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[app_users] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[app_users] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.app_users', N'permissions') IS NULL ALTER TABLE dbo.[app_users] ADD [permissions] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.app_users', N'pin_hash') IS NULL ALTER TABLE dbo.[app_users] ADD [pin_hash] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.app_users', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.app_users', N'pin_hash') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'pin_hash'
) ALTER TABLE dbo.[app_users] ADD CONSTRAINT [DF_app_users_pin_hash] DEFAULT ('') FOR [pin_hash];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'pin_hash' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[app_users] SET [pin_hash]='''' WHERE [pin_hash] IS NULL;';
  ALTER TABLE dbo.[app_users] ALTER COLUMN [pin_hash] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.app_users', N'auth_user_id') IS NULL ALTER TABLE dbo.[app_users] ADD [auth_user_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'auth_user_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[app_users] ALTER COLUMN [auth_user_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.app_users', N'last_login_at') IS NULL ALTER TABLE dbo.[app_users] ADD [last_login_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.app_users', N'created_at') IS NULL ALTER TABLE dbo.[app_users] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.app_users', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.app_users', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'created_at'
) ALTER TABLE dbo.[app_users] ADD CONSTRAINT [DF_app_users_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[app_users] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[app_users] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.app_users', N'updated_at') IS NULL ALTER TABLE dbo.[app_users] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.app_users', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.app_users', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'updated_at'
) ALTER TABLE dbo.[app_users] ADD CONSTRAINT [DF_app_users_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[app_users] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[app_users] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[app_users] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.app_users', N'role_slug') IS NULL ALTER TABLE dbo.[app_users] ADD [role_slug] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.app_users', N'pin_length') IS NULL ALTER TABLE dbo.[app_users] ADD [pin_length] smallint NULL;

IF OBJECT_ID(N'dbo.app_users', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.app_users', N'pin_length') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'pin_length'
) ALTER TABLE dbo.[app_users] ADD CONSTRAINT [DF_app_users_pin_length] DEFAULT (6) FOR [pin_length];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'pin_length' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[app_users] SET [pin_length]=6 WHERE [pin_length] IS NULL;';
  ALTER TABLE dbo.[app_users] ALTER COLUMN [pin_length] smallint NOT NULL;
END;

IF COL_LENGTH(N'dbo.app_users', N'row_version') IS NULL ALTER TABLE dbo.[app_users] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.app_users', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.app_users', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'row_version'
) ALTER TABLE dbo.[app_users] ADD CONSTRAINT [DF_app_users_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[app_users] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[app_users] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.app_users', N'pin_set_at') IS NULL ALTER TABLE dbo.[app_users] ADD [pin_set_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.app_users', N'pin_updated_by') IS NULL ALTER TABLE dbo.[app_users] ADD [pin_updated_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.app_users', N'auth_secret') IS NULL ALTER TABLE dbo.[app_users] ADD [auth_secret] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.app_users', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.app_users', N'auth_secret') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.app_users') AND c.name=N'auth_secret'
) ALTER TABLE dbo.[app_users] ADD CONSTRAINT [DF_app_users_auth_secret] DEFAULT ('') FOR [auth_secret];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'auth_secret' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[app_users] SET [auth_secret]='''' WHERE [auth_secret] IS NULL;';
  ALTER TABLE dbo.[app_users] ALTER COLUMN [auth_secret] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.app_users', N'idle_timeout_minutes') IS NULL ALTER TABLE dbo.[app_users] ADD [idle_timeout_minutes] int NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'UX_app_users_user_id') CREATE UNIQUE INDEX [UX_app_users_user_id] ON dbo.[app_users]([user_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'UX_app_users_auth_user_id') CREATE UNIQUE INDEX [UX_app_users_auth_user_id] ON dbo.[app_users]([auth_user_id]) WHERE [auth_user_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'IX_app_users_store_id') CREATE INDEX [IX_app_users_store_id] ON dbo.[app_users]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.app_users') AND name=N'IX_app_users_updated_at') CREATE INDEX [IX_app_users_updated_at] ON dbo.[app_users]([updated_at]);

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL BEGIN CREATE TABLE dbo.[audit_logs] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_audit_logs_id] DEFAULT (NEWID()),
  [user_name] nvarchar(max) NULL,
  [action_category] nvarchar(max) NOT NULL,
  [action_name] nvarchar(max) NOT NULL,
  [target_module] nvarchar(max) NULL,
  [details] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_audit_logs_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [user_id] nvarchar(max) NULL,
  [action] nvarchar(max) NULL,
  [entity] nvarchar(max) NULL,
  [before_state] nvarchar(max) NULL,
  [after_state] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  CONSTRAINT [PK_audit_logs] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.audit_logs')) ALTER TABLE dbo.[audit_logs] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.audit_logs', N'id') IS NULL ALTER TABLE dbo.[audit_logs] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.audit_logs', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.audit_logs') AND c.name=N'id'
) ALTER TABLE dbo.[audit_logs] ADD CONSTRAINT [DF_audit_logs_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.audit_logs') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[audit_logs] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[audit_logs] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.audit_logs') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[audit_logs] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'user_name') IS NULL ALTER TABLE dbo.[audit_logs] ADD [user_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'action_category') IS NULL ALTER TABLE dbo.[audit_logs] ADD [action_category] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'action_name') IS NULL ALTER TABLE dbo.[audit_logs] ADD [action_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'target_module') IS NULL ALTER TABLE dbo.[audit_logs] ADD [target_module] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'details') IS NULL ALTER TABLE dbo.[audit_logs] ADD [details] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'created_at') IS NULL ALTER TABLE dbo.[audit_logs] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.audit_logs', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.audit_logs') AND c.name=N'created_at'
) ALTER TABLE dbo.[audit_logs] ADD CONSTRAINT [DF_audit_logs_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.audit_logs') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[audit_logs] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[audit_logs] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.audit_logs', N'user_id') IS NULL ALTER TABLE dbo.[audit_logs] ADD [user_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'action') IS NULL ALTER TABLE dbo.[audit_logs] ADD [action] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'entity') IS NULL ALTER TABLE dbo.[audit_logs] ADD [entity] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'before_state') IS NULL ALTER TABLE dbo.[audit_logs] ADD [before_state] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'after_state') IS NULL ALTER TABLE dbo.[audit_logs] ADD [after_state] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.audit_logs', N'store_id') IS NULL ALTER TABLE dbo.[audit_logs] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.audit_logs') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[audit_logs] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.audit_logs') AND name=N'IX_audit_logs_store_id') CREATE INDEX [IX_audit_logs_store_id] ON dbo.[audit_logs]([store_id]);

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NULL BEGIN CREATE TABLE dbo.[booking_payments] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_booking_payments_id] DEFAULT (NEWID()),
  [booking_id] uniqueidentifier NOT NULL,
  [amount] decimal(38,12) NOT NULL CONSTRAINT [DF_booking_payments_amount] DEFAULT (0),
  [method] nvarchar(max) NOT NULL CONSTRAINT [DF_booking_payments_method] DEFAULT ('cash'),
  [cashier] nvarchar(max) NULL,
  [paid_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_booking_payments_paid_at] DEFAULT (SYSDATETIMEOFFSET()),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_booking_payments_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_booking_payments_row_version] DEFAULT (1),
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_booking_payments_status] DEFAULT ('settled'),
  [client_payment_id] nvarchar(128) NULL,
  [reference] nvarchar(max) NULL,
  [reversed_at] datetimeoffset(7) NULL,
  [reversed_by] nvarchar(max) NULL,
  [kind] nvarchar(max) NOT NULL CONSTRAINT [DF_booking_payments_kind] DEFAULT ('payment'),
  [refund_reason] nvarchar(max) NULL,
  [refunds_payment_id] uniqueidentifier NULL,
  [change_given] decimal(38,12) NOT NULL CONSTRAINT [DF_booking_payments_change_given] DEFAULT (0),
  CONSTRAINT [PK_booking_payments] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.booking_payments')) ALTER TABLE dbo.[booking_payments] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.booking_payments', N'id') IS NULL ALTER TABLE dbo.[booking_payments] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.booking_payments', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'id'
) ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [DF_booking_payments_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[booking_payments] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[booking_payments] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.booking_payments', N'booking_id') IS NULL ALTER TABLE dbo.[booking_payments] ADD [booking_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'booking_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[booking_payments] ALTER COLUMN [booking_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.booking_payments', N'amount') IS NULL ALTER TABLE dbo.[booking_payments] ADD [amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.booking_payments', N'amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'amount'
) ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [DF_booking_payments_amount] DEFAULT (0) FOR [amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [amount]=0 WHERE [amount] IS NULL;';
  ALTER TABLE dbo.[booking_payments] ALTER COLUMN [amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.booking_payments', N'method') IS NULL ALTER TABLE dbo.[booking_payments] ADD [method] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.booking_payments', N'method') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'method'
) ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [DF_booking_payments_method] DEFAULT ('cash') FOR [method];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'method' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [method]=''cash'' WHERE [method] IS NULL;';
  ALTER TABLE dbo.[booking_payments] ALTER COLUMN [method] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.booking_payments', N'cashier') IS NULL ALTER TABLE dbo.[booking_payments] ADD [cashier] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.booking_payments', N'paid_at') IS NULL ALTER TABLE dbo.[booking_payments] ADD [paid_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.booking_payments', N'paid_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'paid_at'
) ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [DF_booking_payments_paid_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [paid_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'paid_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [paid_at]=SYSDATETIMEOFFSET() WHERE [paid_at] IS NULL;';
  ALTER TABLE dbo.[booking_payments] ALTER COLUMN [paid_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.booking_payments', N'created_at') IS NULL ALTER TABLE dbo.[booking_payments] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.booking_payments', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'created_at'
) ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [DF_booking_payments_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[booking_payments] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.booking_payments', N'row_version') IS NULL ALTER TABLE dbo.[booking_payments] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.booking_payments', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'row_version'
) ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [DF_booking_payments_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[booking_payments] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.booking_payments', N'status') IS NULL ALTER TABLE dbo.[booking_payments] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.booking_payments', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'status'
) ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [DF_booking_payments_status] DEFAULT ('settled') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [status]=''settled'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[booking_payments] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.booking_payments', N'client_payment_id') IS NULL ALTER TABLE dbo.[booking_payments] ADD [client_payment_id] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'client_payment_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[booking_payments] ALTER COLUMN [client_payment_id] nvarchar(128) NULL;

IF COL_LENGTH(N'dbo.booking_payments', N'reference') IS NULL ALTER TABLE dbo.[booking_payments] ADD [reference] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.booking_payments', N'reversed_at') IS NULL ALTER TABLE dbo.[booking_payments] ADD [reversed_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.booking_payments', N'reversed_by') IS NULL ALTER TABLE dbo.[booking_payments] ADD [reversed_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.booking_payments', N'kind') IS NULL ALTER TABLE dbo.[booking_payments] ADD [kind] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.booking_payments', N'kind') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'kind'
) ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [DF_booking_payments_kind] DEFAULT ('payment') FOR [kind];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'kind' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [kind]=''payment'' WHERE [kind] IS NULL;';
  ALTER TABLE dbo.[booking_payments] ALTER COLUMN [kind] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.booking_payments', N'refund_reason') IS NULL ALTER TABLE dbo.[booking_payments] ADD [refund_reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.booking_payments', N'refunds_payment_id') IS NULL ALTER TABLE dbo.[booking_payments] ADD [refunds_payment_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.booking_payments', N'change_given') IS NULL ALTER TABLE dbo.[booking_payments] ADD [change_given] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.booking_payments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.booking_payments', N'change_given') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND c.name=N'change_given'
) ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [DF_booking_payments_change_given] DEFAULT (0) FOR [change_given];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'change_given' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [change_given]=0 WHERE [change_given] IS NULL;';
  ALTER TABLE dbo.[booking_payments] ALTER COLUMN [change_given] decimal(38,12) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'UQ_booking_payments_0') CREATE UNIQUE INDEX [UQ_booking_payments_0] ON dbo.[booking_payments]([booking_id],[client_payment_id]) WHERE [client_payment_id] IS NOT NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NULL BEGIN CREATE TABLE dbo.[bookings] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_bookings_id] DEFAULT (NEWID()),
  [ref] nvarchar(450) NOT NULL,
  [store_id] nvarchar(450) NULL,
  [shift_id] nvarchar(max) NULL,
  [customer_name] nvarchar(max) NOT NULL CONSTRAINT [DF_bookings_customer_name] DEFAULT (''),
  [customer_phone] nvarchar(max) NOT NULL CONSTRAINT [DF_bookings_customer_phone] DEFAULT (''),
  [member_id] uniqueidentifier NULL,
  [service_type_id] nvarchar(max) NULL,
  [service_name] nvarchar(max) NULL,
  [service_fee] decimal(38,12) NOT NULL CONSTRAINT [DF_bookings_service_fee] DEFAULT (0),
  [payment_timing] nvarchar(max) NULL,
  [lines] nvarchar(max) NOT NULL CONSTRAINT [DF_bookings_lines] DEFAULT (N'[]'),
  [subtotal] decimal(38,12) NOT NULL CONSTRAINT [DF_bookings_subtotal] DEFAULT (0),
  [discount] decimal(38,12) NOT NULL CONSTRAINT [DF_bookings_discount] DEFAULT (0),
  [tax] decimal(38,12) NOT NULL CONSTRAINT [DF_bookings_tax] DEFAULT (0),
  [total] decimal(38,12) NOT NULL CONSTRAINT [DF_bookings_total] DEFAULT (0),
  [paid] decimal(38,12) NOT NULL CONSTRAINT [DF_bookings_paid] DEFAULT (0),
  [due_date] date NULL,
  [note] nvarchar(max) NOT NULL CONSTRAINT [DF_bookings_note] DEFAULT (''),
  [cashier] nvarchar(max) NULL,
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_bookings_status] DEFAULT ('active'),
  [booking_kind] nvarchar(max) NOT NULL CONSTRAINT [DF_bookings_booking_kind] DEFAULT ('standard'),
  [sale_receipt_no] nvarchar(max) NULL,
  [closed_at] datetimeoffset(7) NULL,
  [racket_model] nvarchar(max) NULL,
  [string_type] nvarchar(max) NULL,
  [tension_main] decimal(38,12) NULL,
  [tension_cross] decimal(38,12) NULL,
  [tension_unit] nvarchar(max) NOT NULL CONSTRAINT [DF_bookings_tension_unit] DEFAULT ('lb'),
  [grommet_notes] nvarchar(max) NULL,
  [job_notes] nvarchar(max) NULL,
  [dropped_off_at] datetimeoffset(7) NULL,
  [promised_at] datetimeoffset(7) NULL,
  [job_status] nvarchar(max) NOT NULL CONSTRAINT [DF_bookings_job_status] DEFAULT ('received'),
  [job_status_by] nvarchar(max) NULL,
  [job_status_at] datetimeoffset(7) NULL,
  [notify_whatsapp] bit NOT NULL CONSTRAINT [DF_bookings_notify_whatsapp] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_bookings_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_bookings_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [tag_id] nvarchar(max) NULL,
  [intake_note] nvarchar(max) NULL,
  [string_origin] nvarchar(max) NULL,
  [string_source_product_id] uniqueidentifier NULL,
  [grip_product_id] uniqueidentifier NULL,
  [charges] nvarchar(max) NOT NULL CONSTRAINT [DF_bookings_charges] DEFAULT (N'{}'),
  [technician] nvarchar(max) NULL,
  [liability_accepted] bit NOT NULL CONSTRAINT [DF_bookings_liability_accepted] DEFAULT (0),
  [incident_note] nvarchar(max) NULL,
  [row_version] int NOT NULL CONSTRAINT [DF_bookings_row_version] DEFAULT (1),
  [cancel_reason] nvarchar(max) NULL,
  [cancelled_by] nvarchar(max) NULL,
  [cancelled_at] datetimeoffset(7) NULL,
  [cancelled_terminal] nvarchar(max) NULL,
  [cancel_money_action] nvarchar(max) NULL,
  [booking_ref] nvarchar(max) NULL,
  CONSTRAINT [PK_bookings] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.bookings')) ALTER TABLE dbo.[bookings] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.bookings', N'id') IS NULL ALTER TABLE dbo.[bookings] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'id'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[bookings] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.bookings', N'ref') IS NULL ALTER TABLE dbo.[bookings] ADD [ref] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'ref' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[bookings] ALTER COLUMN [ref] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.bookings', N'store_id') IS NULL ALTER TABLE dbo.[bookings] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[bookings] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.bookings', N'shift_id') IS NULL ALTER TABLE dbo.[bookings] ADD [shift_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'customer_name') IS NULL ALTER TABLE dbo.[bookings] ADD [customer_name] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'customer_name') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'customer_name'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_customer_name] DEFAULT ('') FOR [customer_name];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'customer_name' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [customer_name]='''' WHERE [customer_name] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [customer_name] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'customer_phone') IS NULL ALTER TABLE dbo.[bookings] ADD [customer_phone] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'customer_phone') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'customer_phone'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_customer_phone] DEFAULT ('') FOR [customer_phone];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'customer_phone' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [customer_phone]='''' WHERE [customer_phone] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [customer_phone] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'member_id') IS NULL ALTER TABLE dbo.[bookings] ADD [member_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'member_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[bookings] ALTER COLUMN [member_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.bookings', N'service_type_id') IS NULL ALTER TABLE dbo.[bookings] ADD [service_type_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'service_name') IS NULL ALTER TABLE dbo.[bookings] ADD [service_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'service_fee') IS NULL ALTER TABLE dbo.[bookings] ADD [service_fee] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'service_fee') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'service_fee'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_service_fee] DEFAULT (0) FOR [service_fee];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'service_fee' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [service_fee]=0 WHERE [service_fee] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [service_fee] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'payment_timing') IS NULL ALTER TABLE dbo.[bookings] ADD [payment_timing] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'lines') IS NULL ALTER TABLE dbo.[bookings] ADD [lines] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'lines') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'lines'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_lines] DEFAULT (N'[]') FOR [lines];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'lines' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [lines]=N''[]'' WHERE [lines] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [lines] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'subtotal') IS NULL ALTER TABLE dbo.[bookings] ADD [subtotal] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'subtotal') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'subtotal'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_subtotal] DEFAULT (0) FOR [subtotal];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'subtotal' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [subtotal]=0 WHERE [subtotal] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [subtotal] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'discount') IS NULL ALTER TABLE dbo.[bookings] ADD [discount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'discount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'discount'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_discount] DEFAULT (0) FOR [discount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'discount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [discount]=0 WHERE [discount] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [discount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'tax') IS NULL ALTER TABLE dbo.[bookings] ADD [tax] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'tax') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'tax'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_tax] DEFAULT (0) FOR [tax];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'tax' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [tax]=0 WHERE [tax] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [tax] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'total') IS NULL ALTER TABLE dbo.[bookings] ADD [total] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'total') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'total'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_total] DEFAULT (0) FOR [total];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'total' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [total]=0 WHERE [total] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [total] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'paid') IS NULL ALTER TABLE dbo.[bookings] ADD [paid] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'paid') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'paid'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_paid] DEFAULT (0) FOR [paid];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'paid' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [paid]=0 WHERE [paid] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [paid] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'due_date') IS NULL ALTER TABLE dbo.[bookings] ADD [due_date] date NULL;

IF COL_LENGTH(N'dbo.bookings', N'note') IS NULL ALTER TABLE dbo.[bookings] ADD [note] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'note') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'note'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_note] DEFAULT ('') FOR [note];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'note' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [note]='''' WHERE [note] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [note] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'cashier') IS NULL ALTER TABLE dbo.[bookings] ADD [cashier] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'status') IS NULL ALTER TABLE dbo.[bookings] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'status'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_status] DEFAULT ('active') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [status]=''active'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'booking_kind') IS NULL ALTER TABLE dbo.[bookings] ADD [booking_kind] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'booking_kind') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'booking_kind'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_booking_kind] DEFAULT ('standard') FOR [booking_kind];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'booking_kind' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [booking_kind]=''standard'' WHERE [booking_kind] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [booking_kind] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'sale_receipt_no') IS NULL ALTER TABLE dbo.[bookings] ADD [sale_receipt_no] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'closed_at') IS NULL ALTER TABLE dbo.[bookings] ADD [closed_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.bookings', N'racket_model') IS NULL ALTER TABLE dbo.[bookings] ADD [racket_model] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'string_type') IS NULL ALTER TABLE dbo.[bookings] ADD [string_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'tension_main') IS NULL ALTER TABLE dbo.[bookings] ADD [tension_main] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.bookings', N'tension_cross') IS NULL ALTER TABLE dbo.[bookings] ADD [tension_cross] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.bookings', N'tension_unit') IS NULL ALTER TABLE dbo.[bookings] ADD [tension_unit] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'tension_unit') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'tension_unit'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_tension_unit] DEFAULT ('lb') FOR [tension_unit];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'tension_unit' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [tension_unit]=''lb'' WHERE [tension_unit] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [tension_unit] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'grommet_notes') IS NULL ALTER TABLE dbo.[bookings] ADD [grommet_notes] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'job_notes') IS NULL ALTER TABLE dbo.[bookings] ADD [job_notes] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'dropped_off_at') IS NULL ALTER TABLE dbo.[bookings] ADD [dropped_off_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.bookings', N'promised_at') IS NULL ALTER TABLE dbo.[bookings] ADD [promised_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.bookings', N'job_status') IS NULL ALTER TABLE dbo.[bookings] ADD [job_status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'job_status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'job_status'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_job_status] DEFAULT ('received') FOR [job_status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'job_status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [job_status]=''received'' WHERE [job_status] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [job_status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'job_status_by') IS NULL ALTER TABLE dbo.[bookings] ADD [job_status_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'job_status_at') IS NULL ALTER TABLE dbo.[bookings] ADD [job_status_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.bookings', N'notify_whatsapp') IS NULL ALTER TABLE dbo.[bookings] ADD [notify_whatsapp] bit NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'notify_whatsapp') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'notify_whatsapp'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_notify_whatsapp] DEFAULT (0) FOR [notify_whatsapp];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'notify_whatsapp' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [notify_whatsapp]=0 WHERE [notify_whatsapp] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [notify_whatsapp] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'created_at') IS NULL ALTER TABLE dbo.[bookings] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'created_at'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'updated_at') IS NULL ALTER TABLE dbo.[bookings] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'updated_at'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[bookings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.bookings', N'tag_id') IS NULL ALTER TABLE dbo.[bookings] ADD [tag_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'intake_note') IS NULL ALTER TABLE dbo.[bookings] ADD [intake_note] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'string_origin') IS NULL ALTER TABLE dbo.[bookings] ADD [string_origin] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'string_source_product_id') IS NULL ALTER TABLE dbo.[bookings] ADD [string_source_product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.bookings', N'grip_product_id') IS NULL ALTER TABLE dbo.[bookings] ADD [grip_product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.bookings', N'charges') IS NULL ALTER TABLE dbo.[bookings] ADD [charges] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'charges') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'charges'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_charges] DEFAULT (N'{}') FOR [charges];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'charges' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [charges]=N''{}'' WHERE [charges] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [charges] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'technician') IS NULL ALTER TABLE dbo.[bookings] ADD [technician] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'liability_accepted') IS NULL ALTER TABLE dbo.[bookings] ADD [liability_accepted] bit NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'liability_accepted') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'liability_accepted'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_liability_accepted] DEFAULT (0) FOR [liability_accepted];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'liability_accepted' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [liability_accepted]=0 WHERE [liability_accepted] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [liability_accepted] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'incident_note') IS NULL ALTER TABLE dbo.[bookings] ADD [incident_note] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'row_version') IS NULL ALTER TABLE dbo.[bookings] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings') AND c.name=N'row_version'
) ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[bookings] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[bookings] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.bookings', N'cancel_reason') IS NULL ALTER TABLE dbo.[bookings] ADD [cancel_reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'cancelled_by') IS NULL ALTER TABLE dbo.[bookings] ADD [cancelled_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'cancelled_at') IS NULL ALTER TABLE dbo.[bookings] ADD [cancelled_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.bookings', N'cancelled_terminal') IS NULL ALTER TABLE dbo.[bookings] ADD [cancelled_terminal] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'cancel_money_action') IS NULL ALTER TABLE dbo.[bookings] ADD [cancel_money_action] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.bookings', N'booking_ref') IS NULL ALTER TABLE dbo.[bookings] ADD [booking_ref] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'UX_bookings_ref') CREATE UNIQUE INDEX [UX_bookings_ref] ON dbo.[bookings]([ref]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'IX_bookings_store_id') CREATE INDEX [IX_bookings_store_id] ON dbo.[bookings]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.bookings') AND name=N'IX_bookings_updated_at') CREATE INDEX [IX_bookings_updated_at] ON dbo.[bookings]([updated_at]);

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NULL BEGIN CREATE TABLE dbo.[branch_telemetry] (

  [terminal_id] nvarchar(450) NOT NULL,
  [store_id] nvarchar(450) NULL,
  [terminal_name] nvarchar(max) NULL,
  [staff_name] nvarchar(max) NULL,
  [staff_role] nvarchar(max) NULL,
  [db_mode] nvarchar(max) NOT NULL CONSTRAINT [DF_branch_telemetry_db_mode] DEFAULT ('online'),
  [connection_status] nvarchar(max) NOT NULL CONSTRAINT [DF_branch_telemetry_connection_status] DEFAULT ('online'),
  [storage_engine] nvarchar(max) NOT NULL CONSTRAINT [DF_branch_telemetry_storage_engine] DEFAULT ('cloud'),
  [pending_count] int NOT NULL CONSTRAINT [DF_branch_telemetry_pending_count] DEFAULT (0),
  [conflict_count] int NOT NULL CONSTRAINT [DF_branch_telemetry_conflict_count] DEFAULT (0),
  [last_synced_at] datetimeoffset(7) NULL,
  [app_version] nvarchar(max) NULL,
  [platform] nvarchar(max) NULL,
  [last_seen_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_branch_telemetry_last_seen_at] DEFAULT (SYSDATETIMEOFFSET()),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_branch_telemetry_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_branch_telemetry_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [branch_id] nvarchar(450) NULL,
  [pending_queue_count] int NULL,
  [last_ping] datetimeoffset(7) NULL,
  [status] nvarchar(max) NULL,
  [branch_code] nvarchar(max) NULL,
  [session_status] nvarchar(max) NULL,
  [sql_server_state] nvarchar(max) NULL,
  [database_name] nvarchar(max) NULL,
  [schema_version] int NULL,
  [failed_count] int NOT NULL CONSTRAINT [DF_branch_telemetry_failed_count] DEFAULT (0),
  [sync_phase] nvarchar(max) NULL,
  [current_table] nvarchar(max) NULL,
  [last_push_at] datetimeoffset(7) NULL,
  [last_pull_at] datetimeoffset(7) NULL,
  [device_name] nvarchar(max) NULL,
  [device_type] nvarchar(max) NULL,
  [location_name] nvarchar(max) NULL,
  [last_heartbeat_at] datetimeoffset(7) NULL,
  CONSTRAINT [PK_branch_telemetry] PRIMARY KEY ([terminal_id])

); END;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry')) ALTER TABLE dbo.[branch_telemetry] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.branch_telemetry', N'terminal_id') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [terminal_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'terminal_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [terminal_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'store_id') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'terminal_name') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [terminal_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'staff_name') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [staff_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'staff_role') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [staff_role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'db_mode') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [db_mode] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.branch_telemetry', N'db_mode') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'db_mode'
) ALTER TABLE dbo.[branch_telemetry] ADD CONSTRAINT [DF_branch_telemetry_db_mode] DEFAULT ('online') FOR [db_mode];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'db_mode' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[branch_telemetry] SET [db_mode]=''online'' WHERE [db_mode] IS NULL;';
  ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [db_mode] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.branch_telemetry', N'connection_status') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [connection_status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.branch_telemetry', N'connection_status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'connection_status'
) ALTER TABLE dbo.[branch_telemetry] ADD CONSTRAINT [DF_branch_telemetry_connection_status] DEFAULT ('online') FOR [connection_status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'connection_status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[branch_telemetry] SET [connection_status]=''online'' WHERE [connection_status] IS NULL;';
  ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [connection_status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.branch_telemetry', N'storage_engine') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [storage_engine] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.branch_telemetry', N'storage_engine') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'storage_engine'
) ALTER TABLE dbo.[branch_telemetry] ADD CONSTRAINT [DF_branch_telemetry_storage_engine] DEFAULT ('cloud') FOR [storage_engine];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'storage_engine' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[branch_telemetry] SET [storage_engine]=''cloud'' WHERE [storage_engine] IS NULL;';
  ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [storage_engine] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.branch_telemetry', N'pending_count') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [pending_count] int NULL;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.branch_telemetry', N'pending_count') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'pending_count'
) ALTER TABLE dbo.[branch_telemetry] ADD CONSTRAINT [DF_branch_telemetry_pending_count] DEFAULT (0) FOR [pending_count];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'pending_count' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[branch_telemetry] SET [pending_count]=0 WHERE [pending_count] IS NULL;';
  ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [pending_count] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.branch_telemetry', N'conflict_count') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [conflict_count] int NULL;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.branch_telemetry', N'conflict_count') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'conflict_count'
) ALTER TABLE dbo.[branch_telemetry] ADD CONSTRAINT [DF_branch_telemetry_conflict_count] DEFAULT (0) FOR [conflict_count];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'conflict_count' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[branch_telemetry] SET [conflict_count]=0 WHERE [conflict_count] IS NULL;';
  ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [conflict_count] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.branch_telemetry', N'last_synced_at') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [last_synced_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'app_version') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [app_version] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'platform') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [platform] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'last_seen_at') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [last_seen_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.branch_telemetry', N'last_seen_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'last_seen_at'
) ALTER TABLE dbo.[branch_telemetry] ADD CONSTRAINT [DF_branch_telemetry_last_seen_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [last_seen_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'last_seen_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[branch_telemetry] SET [last_seen_at]=SYSDATETIMEOFFSET() WHERE [last_seen_at] IS NULL;';
  ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [last_seen_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.branch_telemetry', N'created_at') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.branch_telemetry', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'created_at'
) ALTER TABLE dbo.[branch_telemetry] ADD CONSTRAINT [DF_branch_telemetry_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[branch_telemetry] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.branch_telemetry', N'updated_at') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.branch_telemetry', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'updated_at'
) ALTER TABLE dbo.[branch_telemetry] ADD CONSTRAINT [DF_branch_telemetry_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[branch_telemetry] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'branch_id') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [branch_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'branch_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [branch_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'pending_queue_count') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [pending_queue_count] int NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'last_ping') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [last_ping] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'status') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [status] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'branch_code') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [branch_code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'session_status') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [session_status] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'sql_server_state') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [sql_server_state] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'database_name') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [database_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'schema_version') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [schema_version] int NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'failed_count') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [failed_count] int NULL;

IF OBJECT_ID(N'dbo.branch_telemetry', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.branch_telemetry', N'failed_count') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.branch_telemetry') AND c.name=N'failed_count'
) ALTER TABLE dbo.[branch_telemetry] ADD CONSTRAINT [DF_branch_telemetry_failed_count] DEFAULT (0) FOR [failed_count];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'failed_count' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[branch_telemetry] SET [failed_count]=0 WHERE [failed_count] IS NULL;';
  ALTER TABLE dbo.[branch_telemetry] ALTER COLUMN [failed_count] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.branch_telemetry', N'sync_phase') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [sync_phase] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'current_table') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [current_table] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'last_push_at') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [last_push_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'last_pull_at') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [last_pull_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'device_name') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [device_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'device_type') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [device_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'location_name') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [location_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.branch_telemetry', N'last_heartbeat_at') IS NULL ALTER TABLE dbo.[branch_telemetry] ADD [last_heartbeat_at] datetimeoffset(7) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'IX_branch_telemetry_store_id') CREATE INDEX [IX_branch_telemetry_store_id] ON dbo.[branch_telemetry]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'IX_branch_telemetry_updated_at') CREATE INDEX [IX_branch_telemetry_updated_at] ON dbo.[branch_telemetry]([updated_at]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.branch_telemetry') AND name=N'IX_branch_telemetry_branch_id') CREATE INDEX [IX_branch_telemetry_branch_id] ON dbo.[branch_telemetry]([branch_id]);

IF OBJECT_ID(N'dbo.cashiers', N'U') IS NULL BEGIN CREATE TABLE dbo.[cashiers] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_cashiers_id] DEFAULT (NEWID()),
  [username] nvarchar(max) NOT NULL,
  [full_name] nvarchar(max) NOT NULL CONSTRAINT [DF_cashiers_full_name] DEFAULT (''),
  [pin_hash] nvarchar(max) NOT NULL,
  [store_id] nvarchar(450) NULL,
  [permissions] nvarchar(max) NOT NULL CONSTRAINT [DF_cashiers_permissions] DEFAULT (N'{}'),
  [is_active] bit NOT NULL CONSTRAINT [DF_cashiers_is_active] DEFAULT (1),
  [last_login_at] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_cashiers_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_cashiers_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [role_slug] nvarchar(max) NULL,
  [idle_timeout_minutes] int NULL,
  CONSTRAINT [PK_cashiers] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.cashiers', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.cashiers')) ALTER TABLE dbo.[cashiers] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.cashiers', N'id') IS NULL ALTER TABLE dbo.[cashiers] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.cashiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.cashiers', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.cashiers') AND c.name=N'id'
) ALTER TABLE dbo.[cashiers] ADD CONSTRAINT [DF_cashiers_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.cashiers') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[cashiers] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[cashiers] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.cashiers') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[cashiers] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.cashiers', N'username') IS NULL ALTER TABLE dbo.[cashiers] ADD [username] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.cashiers', N'full_name') IS NULL ALTER TABLE dbo.[cashiers] ADD [full_name] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.cashiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.cashiers', N'full_name') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.cashiers') AND c.name=N'full_name'
) ALTER TABLE dbo.[cashiers] ADD CONSTRAINT [DF_cashiers_full_name] DEFAULT ('') FOR [full_name];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.cashiers') AND name=N'full_name' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[cashiers] SET [full_name]='''' WHERE [full_name] IS NULL;';
  ALTER TABLE dbo.[cashiers] ALTER COLUMN [full_name] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.cashiers', N'pin_hash') IS NULL ALTER TABLE dbo.[cashiers] ADD [pin_hash] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.cashiers', N'store_id') IS NULL ALTER TABLE dbo.[cashiers] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.cashiers') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[cashiers] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.cashiers', N'permissions') IS NULL ALTER TABLE dbo.[cashiers] ADD [permissions] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.cashiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.cashiers', N'permissions') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.cashiers') AND c.name=N'permissions'
) ALTER TABLE dbo.[cashiers] ADD CONSTRAINT [DF_cashiers_permissions] DEFAULT (N'{}') FOR [permissions];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.cashiers') AND name=N'permissions' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[cashiers] SET [permissions]=N''{}'' WHERE [permissions] IS NULL;';
  ALTER TABLE dbo.[cashiers] ALTER COLUMN [permissions] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.cashiers', N'is_active') IS NULL ALTER TABLE dbo.[cashiers] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.cashiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.cashiers', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.cashiers') AND c.name=N'is_active'
) ALTER TABLE dbo.[cashiers] ADD CONSTRAINT [DF_cashiers_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.cashiers') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[cashiers] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[cashiers] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.cashiers', N'last_login_at') IS NULL ALTER TABLE dbo.[cashiers] ADD [last_login_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.cashiers', N'created_at') IS NULL ALTER TABLE dbo.[cashiers] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.cashiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.cashiers', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.cashiers') AND c.name=N'created_at'
) ALTER TABLE dbo.[cashiers] ADD CONSTRAINT [DF_cashiers_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.cashiers') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[cashiers] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[cashiers] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.cashiers', N'updated_at') IS NULL ALTER TABLE dbo.[cashiers] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.cashiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.cashiers', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.cashiers') AND c.name=N'updated_at'
) ALTER TABLE dbo.[cashiers] ADD CONSTRAINT [DF_cashiers_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.cashiers') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[cashiers] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[cashiers] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.cashiers') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[cashiers] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.cashiers', N'role_slug') IS NULL ALTER TABLE dbo.[cashiers] ADD [role_slug] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.cashiers', N'idle_timeout_minutes') IS NULL ALTER TABLE dbo.[cashiers] ADD [idle_timeout_minutes] int NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.cashiers') AND name=N'IX_cashiers_store_id') CREATE INDEX [IX_cashiers_store_id] ON dbo.[cashiers]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.cashiers') AND name=N'IX_cashiers_updated_at') CREATE INDEX [IX_cashiers_updated_at] ON dbo.[cashiers]([updated_at]);

IF OBJECT_ID(N'dbo.coupon_events', N'U') IS NULL BEGIN CREATE TABLE dbo.[coupon_events] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_coupon_events_id] DEFAULT (NEWID()),
  [event_type] nvarchar(max) NOT NULL,
  [campaign_id] uniqueidentifier NULL,
  [campaign_name] nvarchar(max) NULL,
  [voucher_token] nvarchar(max) NULL,
  [member_id] uniqueidentifier NULL,
  [member_phone] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [terminal_id] nvarchar(max) NULL,
  [staff_name] nvarchar(max) NULL,
  [staff_role] nvarchar(max) NULL,
  [sale_id] nvarchar(max) NULL,
  [note] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_coupon_events_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_coupon_events] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.coupon_events', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.coupon_events')) ALTER TABLE dbo.[coupon_events] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.coupon_events', N'id') IS NULL ALTER TABLE dbo.[coupon_events] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.coupon_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_events', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_events') AND c.name=N'id'
) ALTER TABLE dbo.[coupon_events] ADD CONSTRAINT [DF_coupon_events_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_events') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_events] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[coupon_events] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.coupon_events') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[coupon_events] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'event_type') IS NULL ALTER TABLE dbo.[coupon_events] ADD [event_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'campaign_id') IS NULL ALTER TABLE dbo.[coupon_events] ADD [campaign_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.coupon_events') AND c.name=N'campaign_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[coupon_events] ALTER COLUMN [campaign_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'campaign_name') IS NULL ALTER TABLE dbo.[coupon_events] ADD [campaign_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'voucher_token') IS NULL ALTER TABLE dbo.[coupon_events] ADD [voucher_token] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'member_id') IS NULL ALTER TABLE dbo.[coupon_events] ADD [member_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.coupon_events') AND c.name=N'member_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[coupon_events] ALTER COLUMN [member_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'member_phone') IS NULL ALTER TABLE dbo.[coupon_events] ADD [member_phone] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'store_id') IS NULL ALTER TABLE dbo.[coupon_events] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.coupon_events') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[coupon_events] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'terminal_id') IS NULL ALTER TABLE dbo.[coupon_events] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'staff_name') IS NULL ALTER TABLE dbo.[coupon_events] ADD [staff_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'staff_role') IS NULL ALTER TABLE dbo.[coupon_events] ADD [staff_role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'sale_id') IS NULL ALTER TABLE dbo.[coupon_events] ADD [sale_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'note') IS NULL ALTER TABLE dbo.[coupon_events] ADD [note] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.coupon_events', N'created_at') IS NULL ALTER TABLE dbo.[coupon_events] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.coupon_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.coupon_events', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.coupon_events') AND c.name=N'created_at'
) ALTER TABLE dbo.[coupon_events] ADD CONSTRAINT [DF_coupon_events_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.coupon_events') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[coupon_events] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[coupon_events] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.coupon_events') AND name=N'IX_coupon_events_store_id') CREATE INDEX [IX_coupon_events_store_id] ON dbo.[coupon_events]([store_id]);

IF OBJECT_ID(N'dbo.drawer_events', N'U') IS NULL BEGIN CREATE TABLE dbo.[drawer_events] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_drawer_events_id] DEFAULT (NEWID()),
  [store_id] nvarchar(450) NULL,
  [terminal_id] nvarchar(max) NULL,
  [shift_id] nvarchar(max) NULL,
  [staff_id] nvarchar(max) NULL,
  [staff_name] nvarchar(max) NULL,
  [role] nvarchar(max) NULL,
  [reason] nvarchar(max) NOT NULL,
  [note] nvarchar(max) NULL,
  [approved_by] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_drawer_events_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_drawer_events] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.drawer_events', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.drawer_events')) ALTER TABLE dbo.[drawer_events] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.drawer_events', N'id') IS NULL ALTER TABLE dbo.[drawer_events] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.drawer_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.drawer_events', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.drawer_events') AND c.name=N'id'
) ALTER TABLE dbo.[drawer_events] ADD CONSTRAINT [DF_drawer_events_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.drawer_events') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[drawer_events] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[drawer_events] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.drawer_events') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[drawer_events] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'store_id') IS NULL ALTER TABLE dbo.[drawer_events] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.drawer_events') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[drawer_events] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'terminal_id') IS NULL ALTER TABLE dbo.[drawer_events] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'shift_id') IS NULL ALTER TABLE dbo.[drawer_events] ADD [shift_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'staff_id') IS NULL ALTER TABLE dbo.[drawer_events] ADD [staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'staff_name') IS NULL ALTER TABLE dbo.[drawer_events] ADD [staff_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'role') IS NULL ALTER TABLE dbo.[drawer_events] ADD [role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'reason') IS NULL ALTER TABLE dbo.[drawer_events] ADD [reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'note') IS NULL ALTER TABLE dbo.[drawer_events] ADD [note] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'approved_by') IS NULL ALTER TABLE dbo.[drawer_events] ADD [approved_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.drawer_events', N'created_at') IS NULL ALTER TABLE dbo.[drawer_events] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.drawer_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.drawer_events', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.drawer_events') AND c.name=N'created_at'
) ALTER TABLE dbo.[drawer_events] ADD CONSTRAINT [DF_drawer_events_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.drawer_events') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[drawer_events] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[drawer_events] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.drawer_events') AND name=N'IX_drawer_events_store_id') CREATE INDEX [IX_drawer_events_store_id] ON dbo.[drawer_events]([store_id]);

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NULL BEGIN CREATE TABLE dbo.[held_orders] (

  [id] nvarchar(450) NOT NULL CONSTRAINT [DF_held_orders_id] DEFAULT (NEWID()),
  [label] nvarchar(max) NOT NULL CONSTRAINT [DF_held_orders_label] DEFAULT (''),
  [store_id] nvarchar(450) NULL,
  [shift_id] nvarchar(max) NULL,
  [held_by] nvarchar(max) NULL,
  [total] decimal(38,12) NOT NULL CONSTRAINT [DF_held_orders_total] DEFAULT (0),
  [lines] nvarchar(max) NOT NULL CONSTRAINT [DF_held_orders_lines] DEFAULT (N'[]'),
  [cart_discount] decimal(38,12) NOT NULL CONSTRAINT [DF_held_orders_cart_discount] DEFAULT (0),
  [cart_discount_type] nvarchar(max) NOT NULL CONSTRAINT [DF_held_orders_cart_discount_type] DEFAULT ('amount'),
  [exchange_ref] nvarchar(max) NULL,
  [member_id] nvarchar(max) NULL,
  [member_name] nvarchar(max) NULL,
  [coupon] nvarchar(max) NULL,
  [note] nvarchar(max) NOT NULL CONSTRAINT [DF_held_orders_note] DEFAULT (''),
  [cancelled_from] nvarchar(max) NULL,
  [held_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_held_orders_held_at] DEFAULT (SYSDATETIMEOFFSET()),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_held_orders_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_held_orders_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_held_orders_row_version] DEFAULT (1),
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_held_orders_status] DEFAULT ('held'),
  [pending_request_id] uniqueidentifier NULL,
  [approval_snapshot_hash] nvarchar(max) NULL,
  [bill_no] nvarchar(max) NULL,
  CONSTRAINT [PK_held_orders] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.held_orders')) ALTER TABLE dbo.[held_orders] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.held_orders', N'id') IS NULL ALTER TABLE dbo.[held_orders] ADD [id] nvarchar(450) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'id'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [id] nvarchar(450) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[held_orders] ALTER COLUMN [id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.held_orders', N'label') IS NULL ALTER TABLE dbo.[held_orders] ADD [label] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'label') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'label'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_label] DEFAULT ('') FOR [label];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'label' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [label]='''' WHERE [label] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [label] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'store_id') IS NULL ALTER TABLE dbo.[held_orders] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[held_orders] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.held_orders', N'shift_id') IS NULL ALTER TABLE dbo.[held_orders] ADD [shift_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.held_orders', N'held_by') IS NULL ALTER TABLE dbo.[held_orders] ADD [held_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.held_orders', N'total') IS NULL ALTER TABLE dbo.[held_orders] ADD [total] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'total') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'total'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_total] DEFAULT (0) FOR [total];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'total' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [total]=0 WHERE [total] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [total] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'lines') IS NULL ALTER TABLE dbo.[held_orders] ADD [lines] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'lines') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'lines'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_lines] DEFAULT (N'[]') FOR [lines];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'lines' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [lines]=N''[]'' WHERE [lines] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [lines] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'cart_discount') IS NULL ALTER TABLE dbo.[held_orders] ADD [cart_discount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'cart_discount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'cart_discount'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_cart_discount] DEFAULT (0) FOR [cart_discount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'cart_discount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [cart_discount]=0 WHERE [cart_discount] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [cart_discount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'cart_discount_type') IS NULL ALTER TABLE dbo.[held_orders] ADD [cart_discount_type] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'cart_discount_type') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'cart_discount_type'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_cart_discount_type] DEFAULT ('amount') FOR [cart_discount_type];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'cart_discount_type' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [cart_discount_type]=''amount'' WHERE [cart_discount_type] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [cart_discount_type] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'exchange_ref') IS NULL ALTER TABLE dbo.[held_orders] ADD [exchange_ref] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.held_orders', N'member_id') IS NULL ALTER TABLE dbo.[held_orders] ADD [member_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.held_orders', N'member_name') IS NULL ALTER TABLE dbo.[held_orders] ADD [member_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.held_orders', N'coupon') IS NULL ALTER TABLE dbo.[held_orders] ADD [coupon] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.held_orders', N'note') IS NULL ALTER TABLE dbo.[held_orders] ADD [note] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'note') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'note'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_note] DEFAULT ('') FOR [note];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'note' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [note]='''' WHERE [note] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [note] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'cancelled_from') IS NULL ALTER TABLE dbo.[held_orders] ADD [cancelled_from] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.held_orders', N'held_at') IS NULL ALTER TABLE dbo.[held_orders] ADD [held_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'held_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'held_at'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_held_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [held_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'held_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [held_at]=SYSDATETIMEOFFSET() WHERE [held_at] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [held_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'created_at') IS NULL ALTER TABLE dbo.[held_orders] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'created_at'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'updated_at') IS NULL ALTER TABLE dbo.[held_orders] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'updated_at'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[held_orders] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.held_orders', N'row_version') IS NULL ALTER TABLE dbo.[held_orders] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'row_version'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'status') IS NULL ALTER TABLE dbo.[held_orders] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.held_orders', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.held_orders') AND c.name=N'status'
) ALTER TABLE dbo.[held_orders] ADD CONSTRAINT [DF_held_orders_status] DEFAULT ('held') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[held_orders] SET [status]=''held'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[held_orders] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.held_orders', N'pending_request_id') IS NULL ALTER TABLE dbo.[held_orders] ADD [pending_request_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.held_orders', N'approval_snapshot_hash') IS NULL ALTER TABLE dbo.[held_orders] ADD [approval_snapshot_hash] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.held_orders', N'bill_no') IS NULL ALTER TABLE dbo.[held_orders] ADD [bill_no] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'IX_held_orders_store_id') CREATE INDEX [IX_held_orders_store_id] ON dbo.[held_orders]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.held_orders') AND name=N'IX_held_orders_updated_at') CREATE INDEX [IX_held_orders_updated_at] ON dbo.[held_orders]([updated_at]);

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NULL BEGIN CREATE TABLE dbo.[integration_settings] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_integration_settings_id] DEFAULT (NEWID()),
  [provider_name] nvarchar(450) NOT NULL,
  [api_keys_encrypted] nvarchar(max) NOT NULL CONSTRAINT [DF_integration_settings_api_keys_encrypted] DEFAULT (N'{}'),
  [verification_channel] nvarchar(max) NOT NULL CONSTRAINT [DF_integration_settings_verification_channel] DEFAULT ('whatsapp'),
  [strict_verification] bit NOT NULL CONSTRAINT [DF_integration_settings_strict_verification] DEFAULT (0),
  [is_active] bit NOT NULL CONSTRAINT [DF_integration_settings_is_active] DEFAULT (1),
  [updated_by] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_integration_settings_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_integration_settings_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_integration_settings] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.integration_settings')) ALTER TABLE dbo.[integration_settings] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.integration_settings', N'id') IS NULL ALTER TABLE dbo.[integration_settings] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.integration_settings', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'id'
) ALTER TABLE dbo.[integration_settings] ADD CONSTRAINT [DF_integration_settings_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.integration_settings') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[integration_settings] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[integration_settings] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[integration_settings] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.integration_settings', N'provider_name') IS NULL ALTER TABLE dbo.[integration_settings] ADD [provider_name] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'provider_name' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[integration_settings] ALTER COLUMN [provider_name] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.integration_settings', N'api_keys_encrypted') IS NULL ALTER TABLE dbo.[integration_settings] ADD [api_keys_encrypted] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.integration_settings', N'api_keys_encrypted') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'api_keys_encrypted'
) ALTER TABLE dbo.[integration_settings] ADD CONSTRAINT [DF_integration_settings_api_keys_encrypted] DEFAULT (N'{}') FOR [api_keys_encrypted];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.integration_settings') AND name=N'api_keys_encrypted' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[integration_settings] SET [api_keys_encrypted]=N''{}'' WHERE [api_keys_encrypted] IS NULL;';
  ALTER TABLE dbo.[integration_settings] ALTER COLUMN [api_keys_encrypted] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.integration_settings', N'verification_channel') IS NULL ALTER TABLE dbo.[integration_settings] ADD [verification_channel] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.integration_settings', N'verification_channel') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'verification_channel'
) ALTER TABLE dbo.[integration_settings] ADD CONSTRAINT [DF_integration_settings_verification_channel] DEFAULT ('whatsapp') FOR [verification_channel];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.integration_settings') AND name=N'verification_channel' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[integration_settings] SET [verification_channel]=''whatsapp'' WHERE [verification_channel] IS NULL;';
  ALTER TABLE dbo.[integration_settings] ALTER COLUMN [verification_channel] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.integration_settings', N'strict_verification') IS NULL ALTER TABLE dbo.[integration_settings] ADD [strict_verification] bit NULL;

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.integration_settings', N'strict_verification') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'strict_verification'
) ALTER TABLE dbo.[integration_settings] ADD CONSTRAINT [DF_integration_settings_strict_verification] DEFAULT (0) FOR [strict_verification];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.integration_settings') AND name=N'strict_verification' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[integration_settings] SET [strict_verification]=0 WHERE [strict_verification] IS NULL;';
  ALTER TABLE dbo.[integration_settings] ALTER COLUMN [strict_verification] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.integration_settings', N'is_active') IS NULL ALTER TABLE dbo.[integration_settings] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.integration_settings', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'is_active'
) ALTER TABLE dbo.[integration_settings] ADD CONSTRAINT [DF_integration_settings_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.integration_settings') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[integration_settings] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[integration_settings] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.integration_settings', N'updated_by') IS NULL ALTER TABLE dbo.[integration_settings] ADD [updated_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.integration_settings', N'created_at') IS NULL ALTER TABLE dbo.[integration_settings] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.integration_settings', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'created_at'
) ALTER TABLE dbo.[integration_settings] ADD CONSTRAINT [DF_integration_settings_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.integration_settings') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[integration_settings] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[integration_settings] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.integration_settings', N'updated_at') IS NULL ALTER TABLE dbo.[integration_settings] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.integration_settings', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'updated_at'
) ALTER TABLE dbo.[integration_settings] ADD CONSTRAINT [DF_integration_settings_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.integration_settings') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[integration_settings] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[integration_settings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.integration_settings') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[integration_settings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.integration_settings') AND name=N'UX_integration_settings_provider_name') CREATE UNIQUE INDEX [UX_integration_settings_provider_name] ON dbo.[integration_settings]([provider_name]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.integration_settings') AND name=N'IX_integration_settings_updated_at') CREATE INDEX [IX_integration_settings_updated_at] ON dbo.[integration_settings]([updated_at]);

IF OBJECT_ID(N'dbo.item_activity_logs', N'U') IS NULL BEGIN CREATE TABLE dbo.[item_activity_logs] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_item_activity_logs_id] DEFAULT (NEWID()),
  [product_id] uniqueidentifier NULL,
  [product_name] nvarchar(max) NULL,
  [sku] nvarchar(max) NULL,
  [barcode] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [terminal_id] nvarchar(max) NULL,
  [activity_type] nvarchar(max) NOT NULL,
  [reference] nvarchar(max) NULL,
  [quantity_delta] int NOT NULL CONSTRAINT [DF_item_activity_logs_quantity_delta] DEFAULT (0),
  [stock_before] int NULL,
  [stock_after] int NULL,
  [unit_cost] decimal(38,12) NOT NULL CONSTRAINT [DF_item_activity_logs_unit_cost] DEFAULT (0),
  [staff_id] nvarchar(max) NULL,
  [staff_name] nvarchar(max) NULL,
  [role] nvarchar(max) NULL,
  [note] nvarchar(max) NOT NULL CONSTRAINT [DF_item_activity_logs_note] DEFAULT (''),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_item_activity_logs_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_item_activity_logs_row_version] DEFAULT (1),
  [item_id] uniqueidentifier NULL,
  [sale_id] uniqueidentifier NULL,
  [transfer_id] uniqueidentifier NULL,
  [quantity] int NULL,
  [created_by] nvarchar(max) NULL,
  [notes] nvarchar(max) NULL,
  CONSTRAINT [PK_item_activity_logs] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.item_activity_logs', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.item_activity_logs')) ALTER TABLE dbo.[item_activity_logs] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.item_activity_logs', N'id') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.item_activity_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.item_activity_logs', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.item_activity_logs') AND c.name=N'id'
) ALTER TABLE dbo.[item_activity_logs] ADD CONSTRAINT [DF_item_activity_logs_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.item_activity_logs') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[item_activity_logs] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[item_activity_logs] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.item_activity_logs') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[item_activity_logs] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'product_id') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [product_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.item_activity_logs') AND c.name=N'product_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[item_activity_logs] ALTER COLUMN [product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'product_name') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [product_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'sku') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [sku] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'barcode') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [barcode] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'store_id') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.item_activity_logs') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[item_activity_logs] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'terminal_id') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'activity_type') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [activity_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'reference') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [reference] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'quantity_delta') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [quantity_delta] int NULL;

IF OBJECT_ID(N'dbo.item_activity_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.item_activity_logs', N'quantity_delta') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.item_activity_logs') AND c.name=N'quantity_delta'
) ALTER TABLE dbo.[item_activity_logs] ADD CONSTRAINT [DF_item_activity_logs_quantity_delta] DEFAULT (0) FOR [quantity_delta];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.item_activity_logs') AND name=N'quantity_delta' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[item_activity_logs] SET [quantity_delta]=0 WHERE [quantity_delta] IS NULL;';
  ALTER TABLE dbo.[item_activity_logs] ALTER COLUMN [quantity_delta] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.item_activity_logs', N'stock_before') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [stock_before] int NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'stock_after') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [stock_after] int NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'unit_cost') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [unit_cost] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.item_activity_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.item_activity_logs', N'unit_cost') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.item_activity_logs') AND c.name=N'unit_cost'
) ALTER TABLE dbo.[item_activity_logs] ADD CONSTRAINT [DF_item_activity_logs_unit_cost] DEFAULT (0) FOR [unit_cost];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.item_activity_logs') AND name=N'unit_cost' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[item_activity_logs] SET [unit_cost]=0 WHERE [unit_cost] IS NULL;';
  ALTER TABLE dbo.[item_activity_logs] ALTER COLUMN [unit_cost] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.item_activity_logs', N'staff_id') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'staff_name') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [staff_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'role') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'note') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [note] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.item_activity_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.item_activity_logs', N'note') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.item_activity_logs') AND c.name=N'note'
) ALTER TABLE dbo.[item_activity_logs] ADD CONSTRAINT [DF_item_activity_logs_note] DEFAULT ('') FOR [note];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.item_activity_logs') AND name=N'note' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[item_activity_logs] SET [note]='''' WHERE [note] IS NULL;';
  ALTER TABLE dbo.[item_activity_logs] ALTER COLUMN [note] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.item_activity_logs', N'created_at') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.item_activity_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.item_activity_logs', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.item_activity_logs') AND c.name=N'created_at'
) ALTER TABLE dbo.[item_activity_logs] ADD CONSTRAINT [DF_item_activity_logs_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.item_activity_logs') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[item_activity_logs] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[item_activity_logs] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.item_activity_logs', N'row_version') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.item_activity_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.item_activity_logs', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.item_activity_logs') AND c.name=N'row_version'
) ALTER TABLE dbo.[item_activity_logs] ADD CONSTRAINT [DF_item_activity_logs_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.item_activity_logs') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[item_activity_logs] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[item_activity_logs] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.item_activity_logs', N'item_id') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [item_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'sale_id') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [sale_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'transfer_id') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [transfer_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'quantity') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [quantity] int NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'created_by') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [created_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.item_activity_logs', N'notes') IS NULL ALTER TABLE dbo.[item_activity_logs] ADD [notes] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.item_activity_logs') AND name=N'IX_item_activity_logs_store_id') CREATE INDEX [IX_item_activity_logs_store_id] ON dbo.[item_activity_logs]([store_id]);

IF OBJECT_ID(N'dbo.member_verifications', N'U') IS NULL BEGIN CREATE TABLE dbo.[member_verifications] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_member_verifications_id] DEFAULT (NEWID()),
  [member_id] uniqueidentifier NULL,
  [phone] nvarchar(max) NULL,
  [email] nvarchar(max) NULL,
  [channel] nvarchar(max) NOT NULL CONSTRAINT [DF_member_verifications_channel] DEFAULT ('whatsapp'),
  [otp_code] nvarchar(max) NULL,
  [attempts] int NOT NULL CONSTRAINT [DF_member_verifications_attempts] DEFAULT (0),
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_member_verifications_status] DEFAULT ('pending'),
  [sent_by] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [expires_at] datetimeoffset(7) NOT NULL,
  [verified_at] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_member_verifications_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_member_verifications] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.member_verifications', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.member_verifications')) ALTER TABLE dbo.[member_verifications] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.member_verifications', N'id') IS NULL ALTER TABLE dbo.[member_verifications] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.member_verifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.member_verifications', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.member_verifications') AND c.name=N'id'
) ALTER TABLE dbo.[member_verifications] ADD CONSTRAINT [DF_member_verifications_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.member_verifications') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[member_verifications] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[member_verifications] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.member_verifications') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[member_verifications] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.member_verifications', N'member_id') IS NULL ALTER TABLE dbo.[member_verifications] ADD [member_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.member_verifications') AND c.name=N'member_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[member_verifications] ALTER COLUMN [member_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.member_verifications', N'phone') IS NULL ALTER TABLE dbo.[member_verifications] ADD [phone] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.member_verifications', N'email') IS NULL ALTER TABLE dbo.[member_verifications] ADD [email] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.member_verifications', N'channel') IS NULL ALTER TABLE dbo.[member_verifications] ADD [channel] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.member_verifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.member_verifications', N'channel') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.member_verifications') AND c.name=N'channel'
) ALTER TABLE dbo.[member_verifications] ADD CONSTRAINT [DF_member_verifications_channel] DEFAULT ('whatsapp') FOR [channel];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.member_verifications') AND name=N'channel' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[member_verifications] SET [channel]=''whatsapp'' WHERE [channel] IS NULL;';
  ALTER TABLE dbo.[member_verifications] ALTER COLUMN [channel] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.member_verifications', N'otp_code') IS NULL ALTER TABLE dbo.[member_verifications] ADD [otp_code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.member_verifications', N'attempts') IS NULL ALTER TABLE dbo.[member_verifications] ADD [attempts] int NULL;

IF OBJECT_ID(N'dbo.member_verifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.member_verifications', N'attempts') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.member_verifications') AND c.name=N'attempts'
) ALTER TABLE dbo.[member_verifications] ADD CONSTRAINT [DF_member_verifications_attempts] DEFAULT (0) FOR [attempts];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.member_verifications') AND name=N'attempts' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[member_verifications] SET [attempts]=0 WHERE [attempts] IS NULL;';
  ALTER TABLE dbo.[member_verifications] ALTER COLUMN [attempts] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.member_verifications', N'status') IS NULL ALTER TABLE dbo.[member_verifications] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.member_verifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.member_verifications', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.member_verifications') AND c.name=N'status'
) ALTER TABLE dbo.[member_verifications] ADD CONSTRAINT [DF_member_verifications_status] DEFAULT ('pending') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.member_verifications') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[member_verifications] SET [status]=''pending'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[member_verifications] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.member_verifications', N'sent_by') IS NULL ALTER TABLE dbo.[member_verifications] ADD [sent_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.member_verifications', N'store_id') IS NULL ALTER TABLE dbo.[member_verifications] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.member_verifications') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[member_verifications] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.member_verifications', N'expires_at') IS NULL ALTER TABLE dbo.[member_verifications] ADD [expires_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.member_verifications', N'verified_at') IS NULL ALTER TABLE dbo.[member_verifications] ADD [verified_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.member_verifications', N'created_at') IS NULL ALTER TABLE dbo.[member_verifications] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.member_verifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.member_verifications', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.member_verifications') AND c.name=N'created_at'
) ALTER TABLE dbo.[member_verifications] ADD CONSTRAINT [DF_member_verifications_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.member_verifications') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[member_verifications] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[member_verifications] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.member_verifications') AND name=N'IX_member_verifications_store_id') CREATE INDEX [IX_member_verifications_store_id] ON dbo.[member_verifications]([store_id]);

IF OBJECT_ID(N'dbo.members', N'U') IS NULL BEGIN CREATE TABLE dbo.[members] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_members_id] DEFAULT (NEWID()),
  [member_code] nvarchar(450) NOT NULL,
  [full_name] nvarchar(max) NOT NULL,
  [phone] nvarchar(450) NOT NULL,
  [email] nvarchar(max) NULL,
  [address] nvarchar(max) NULL,
  [country_code] nvarchar(max) NULL,
  [postal_code] nvarchar(max) NULL,
  [date_of_birth] date NULL,
  [tier_id] uniqueidentifier NULL,
  [loyalty_points] decimal(38,12) NOT NULL CONSTRAINT [DF_members_loyalty_points] DEFAULT (0),
  [total_spent] decimal(38,12) NOT NULL CONSTRAINT [DF_members_total_spent] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_members_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_members_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_members_row_version] DEFAULT (1),
  [deleted_at] nvarchar(max) NULL,
  CONSTRAINT [PK_members] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.members', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.members')) ALTER TABLE dbo.[members] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.members', N'id') IS NULL ALTER TABLE dbo.[members] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.members', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.members', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.members') AND c.name=N'id'
) ALTER TABLE dbo.[members] ADD CONSTRAINT [DF_members_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.members') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[members] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[members] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.members') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[members] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.members', N'member_code') IS NULL ALTER TABLE dbo.[members] ADD [member_code] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.members') AND c.name=N'member_code' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[members] ALTER COLUMN [member_code] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.members', N'full_name') IS NULL ALTER TABLE dbo.[members] ADD [full_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.members', N'phone') IS NULL ALTER TABLE dbo.[members] ADD [phone] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.members') AND c.name=N'phone' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[members] ALTER COLUMN [phone] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.members', N'email') IS NULL ALTER TABLE dbo.[members] ADD [email] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.members', N'address') IS NULL ALTER TABLE dbo.[members] ADD [address] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.members', N'country_code') IS NULL ALTER TABLE dbo.[members] ADD [country_code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.members', N'postal_code') IS NULL ALTER TABLE dbo.[members] ADD [postal_code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.members', N'date_of_birth') IS NULL ALTER TABLE dbo.[members] ADD [date_of_birth] date NULL;

IF COL_LENGTH(N'dbo.members', N'tier_id') IS NULL ALTER TABLE dbo.[members] ADD [tier_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.members') AND c.name=N'tier_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[members] ALTER COLUMN [tier_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.members', N'loyalty_points') IS NULL ALTER TABLE dbo.[members] ADD [loyalty_points] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.members', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.members', N'loyalty_points') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.members') AND c.name=N'loyalty_points'
) ALTER TABLE dbo.[members] ADD CONSTRAINT [DF_members_loyalty_points] DEFAULT (0) FOR [loyalty_points];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.members') AND name=N'loyalty_points' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[members] SET [loyalty_points]=0 WHERE [loyalty_points] IS NULL;';
  ALTER TABLE dbo.[members] ALTER COLUMN [loyalty_points] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.members', N'total_spent') IS NULL ALTER TABLE dbo.[members] ADD [total_spent] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.members', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.members', N'total_spent') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.members') AND c.name=N'total_spent'
) ALTER TABLE dbo.[members] ADD CONSTRAINT [DF_members_total_spent] DEFAULT (0) FOR [total_spent];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.members') AND name=N'total_spent' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[members] SET [total_spent]=0 WHERE [total_spent] IS NULL;';
  ALTER TABLE dbo.[members] ALTER COLUMN [total_spent] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.members', N'created_at') IS NULL ALTER TABLE dbo.[members] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.members', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.members', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.members') AND c.name=N'created_at'
) ALTER TABLE dbo.[members] ADD CONSTRAINT [DF_members_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.members') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[members] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[members] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.members', N'updated_at') IS NULL ALTER TABLE dbo.[members] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.members', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.members', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.members') AND c.name=N'updated_at'
) ALTER TABLE dbo.[members] ADD CONSTRAINT [DF_members_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.members') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[members] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[members] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.members') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[members] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.members', N'row_version') IS NULL ALTER TABLE dbo.[members] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.members', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.members', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.members') AND c.name=N'row_version'
) ALTER TABLE dbo.[members] ADD CONSTRAINT [DF_members_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.members') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[members] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[members] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.members', N'deleted_at') IS NULL ALTER TABLE dbo.[members] ADD [deleted_at] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.members') AND name=N'UX_members_member_code') CREATE UNIQUE INDEX [UX_members_member_code] ON dbo.[members]([member_code]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.members') AND name=N'UX_members_phone') CREATE UNIQUE INDEX [UX_members_phone] ON dbo.[members]([phone]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.members') AND name=N'IX_members_updated_at') CREATE INDEX [IX_members_updated_at] ON dbo.[members]([updated_at]);

IF OBJECT_ID(N'dbo.membership_tiers', N'U') IS NULL BEGIN CREATE TABLE dbo.[membership_tiers] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_membership_tiers_id] DEFAULT (NEWID()),
  [name] nvarchar(450) NOT NULL,
  [discount_percentage] decimal(38,12) NOT NULL CONSTRAINT [DF_membership_tiers_discount_percentage] DEFAULT (0),
  [points_multiplier] decimal(38,12) NOT NULL CONSTRAINT [DF_membership_tiers_points_multiplier] DEFAULT (1.0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_membership_tiers_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_membership_tiers_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_membership_tiers_row_version] DEFAULT (1),
  [deleted_at] nvarchar(max) NULL,
  CONSTRAINT [PK_membership_tiers] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.membership_tiers', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.membership_tiers')) ALTER TABLE dbo.[membership_tiers] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.membership_tiers', N'id') IS NULL ALTER TABLE dbo.[membership_tiers] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.membership_tiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.membership_tiers', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.membership_tiers') AND c.name=N'id'
) ALTER TABLE dbo.[membership_tiers] ADD CONSTRAINT [DF_membership_tiers_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.membership_tiers') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[membership_tiers] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[membership_tiers] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.membership_tiers') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[membership_tiers] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.membership_tiers', N'name') IS NULL ALTER TABLE dbo.[membership_tiers] ADD [name] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.membership_tiers') AND c.name=N'name' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[membership_tiers] ALTER COLUMN [name] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.membership_tiers', N'discount_percentage') IS NULL ALTER TABLE dbo.[membership_tiers] ADD [discount_percentage] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.membership_tiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.membership_tiers', N'discount_percentage') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.membership_tiers') AND c.name=N'discount_percentage'
) ALTER TABLE dbo.[membership_tiers] ADD CONSTRAINT [DF_membership_tiers_discount_percentage] DEFAULT (0) FOR [discount_percentage];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.membership_tiers') AND name=N'discount_percentage' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[membership_tiers] SET [discount_percentage]=0 WHERE [discount_percentage] IS NULL;';
  ALTER TABLE dbo.[membership_tiers] ALTER COLUMN [discount_percentage] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.membership_tiers', N'points_multiplier') IS NULL ALTER TABLE dbo.[membership_tiers] ADD [points_multiplier] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.membership_tiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.membership_tiers', N'points_multiplier') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.membership_tiers') AND c.name=N'points_multiplier'
) ALTER TABLE dbo.[membership_tiers] ADD CONSTRAINT [DF_membership_tiers_points_multiplier] DEFAULT (1.0) FOR [points_multiplier];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.membership_tiers') AND name=N'points_multiplier' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[membership_tiers] SET [points_multiplier]=1.0 WHERE [points_multiplier] IS NULL;';
  ALTER TABLE dbo.[membership_tiers] ALTER COLUMN [points_multiplier] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.membership_tiers', N'created_at') IS NULL ALTER TABLE dbo.[membership_tiers] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.membership_tiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.membership_tiers', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.membership_tiers') AND c.name=N'created_at'
) ALTER TABLE dbo.[membership_tiers] ADD CONSTRAINT [DF_membership_tiers_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.membership_tiers') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[membership_tiers] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[membership_tiers] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.membership_tiers', N'updated_at') IS NULL ALTER TABLE dbo.[membership_tiers] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.membership_tiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.membership_tiers', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.membership_tiers') AND c.name=N'updated_at'
) ALTER TABLE dbo.[membership_tiers] ADD CONSTRAINT [DF_membership_tiers_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.membership_tiers') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[membership_tiers] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[membership_tiers] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.membership_tiers') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[membership_tiers] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.membership_tiers', N'row_version') IS NULL ALTER TABLE dbo.[membership_tiers] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.membership_tiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.membership_tiers', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.membership_tiers') AND c.name=N'row_version'
) ALTER TABLE dbo.[membership_tiers] ADD CONSTRAINT [DF_membership_tiers_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.membership_tiers') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[membership_tiers] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[membership_tiers] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.membership_tiers', N'deleted_at') IS NULL ALTER TABLE dbo.[membership_tiers] ADD [deleted_at] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.membership_tiers') AND name=N'UX_membership_tiers_name') CREATE UNIQUE INDEX [UX_membership_tiers_name] ON dbo.[membership_tiers]([name]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.membership_tiers') AND name=N'IX_membership_tiers_updated_at') CREATE INDEX [IX_membership_tiers_updated_at] ON dbo.[membership_tiers]([updated_at]);

IF OBJECT_ID(N'dbo.offline_sync_audit_log', N'U') IS NULL BEGIN CREATE TABLE dbo.[offline_sync_audit_log] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_offline_sync_audit_log_id] DEFAULT (NEWID()),
  [terminal_id] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [direction] nvarchar(max) NOT NULL,
  [table_name] nvarchar(max) NOT NULL,
  [record_id] nvarchar(max) NULL,
  [records] int NOT NULL CONSTRAINT [DF_offline_sync_audit_log_records] DEFAULT (0),
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_offline_sync_audit_log_status] DEFAULT ('ok'),
  [error_message] nvarchar(max) NULL,
  [started_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_offline_sync_audit_log_started_at] DEFAULT (SYSDATETIMEOFFSET()),
  [finished_at] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_offline_sync_audit_log_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_offline_sync_audit_log] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.offline_sync_audit_log', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.offline_sync_audit_log')) ALTER TABLE dbo.[offline_sync_audit_log] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'id') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.offline_sync_audit_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.offline_sync_audit_log', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND c.name=N'id'
) ALTER TABLE dbo.[offline_sync_audit_log] ADD CONSTRAINT [DF_offline_sync_audit_log_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[offline_sync_audit_log] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[offline_sync_audit_log] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[offline_sync_audit_log] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'terminal_id') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'store_id') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[offline_sync_audit_log] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'direction') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [direction] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'table_name') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [table_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'record_id') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [record_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'records') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [records] int NULL;

IF OBJECT_ID(N'dbo.offline_sync_audit_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.offline_sync_audit_log', N'records') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND c.name=N'records'
) ALTER TABLE dbo.[offline_sync_audit_log] ADD CONSTRAINT [DF_offline_sync_audit_log_records] DEFAULT (0) FOR [records];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND name=N'records' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[offline_sync_audit_log] SET [records]=0 WHERE [records] IS NULL;';
  ALTER TABLE dbo.[offline_sync_audit_log] ALTER COLUMN [records] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'status') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.offline_sync_audit_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.offline_sync_audit_log', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND c.name=N'status'
) ALTER TABLE dbo.[offline_sync_audit_log] ADD CONSTRAINT [DF_offline_sync_audit_log_status] DEFAULT ('ok') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[offline_sync_audit_log] SET [status]=''ok'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[offline_sync_audit_log] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'error_message') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [error_message] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'started_at') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [started_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.offline_sync_audit_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.offline_sync_audit_log', N'started_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND c.name=N'started_at'
) ALTER TABLE dbo.[offline_sync_audit_log] ADD CONSTRAINT [DF_offline_sync_audit_log_started_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [started_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND name=N'started_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[offline_sync_audit_log] SET [started_at]=SYSDATETIMEOFFSET() WHERE [started_at] IS NULL;';
  ALTER TABLE dbo.[offline_sync_audit_log] ALTER COLUMN [started_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'finished_at') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [finished_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.offline_sync_audit_log', N'created_at') IS NULL ALTER TABLE dbo.[offline_sync_audit_log] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.offline_sync_audit_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.offline_sync_audit_log', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND c.name=N'created_at'
) ALTER TABLE dbo.[offline_sync_audit_log] ADD CONSTRAINT [DF_offline_sync_audit_log_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[offline_sync_audit_log] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[offline_sync_audit_log] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.offline_sync_audit_log') AND name=N'IX_offline_sync_audit_log_store_id') CREATE INDEX [IX_offline_sync_audit_log_store_id] ON dbo.[offline_sync_audit_log]([store_id]);

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NULL BEGIN CREATE TABLE dbo.[payment_transactions] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_payment_transactions_id] DEFAULT (NEWID()),
  [source_type] nvarchar(max) NOT NULL,
  [sale_id] uniqueidentifier NULL,
  [booking_id] uniqueidentifier NULL,
  [member_id] uniqueidentifier NULL,
  [store_id] nvarchar(450) NULL,
  [shift_id] nvarchar(max) NULL,
  [terminal_id] nvarchar(max) NULL,
  [amount] decimal(38,12) NOT NULL CONSTRAINT [DF_payment_transactions_amount] DEFAULT (0),
  [method] nvarchar(max) NOT NULL CONSTRAINT [DF_payment_transactions_method] DEFAULT ('cash'),
  [kind] nvarchar(max) NOT NULL CONSTRAINT [DF_payment_transactions_kind] DEFAULT ('payment'),
  [reference] nvarchar(max) NULL,
  [cashier_id] nvarchar(max) NULL,
  [cashier_name] nvarchar(max) NULL,
  [note] nvarchar(max) NOT NULL CONSTRAINT [DF_payment_transactions_note] DEFAULT (''),
  [paid_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_payment_transactions_paid_at] DEFAULT (SYSDATETIMEOFFSET()),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_payment_transactions_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_payment_transactions_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_payment_transactions_row_version] DEFAULT (1),
  [status] nvarchar(max) NULL CONSTRAINT [DF_payment_transactions_status] DEFAULT ('completed'),
  [metadata] nvarchar(max) NULL CONSTRAINT [DF_payment_transactions_metadata] DEFAULT (N'{}'),
  [client_transaction_id] nvarchar(450) NULL,
  [order_id] uniqueidentifier NULL,
  [payment_method] nvarchar(max) NULL,
  [transaction_reference] nvarchar(max) NULL,
  CONSTRAINT [PK_payment_transactions] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.payment_transactions')) ALTER TABLE dbo.[payment_transactions] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.payment_transactions', N'id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'id'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_transactions] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'source_type') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [source_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'sale_id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [sale_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'sale_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [sale_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'booking_id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [booking_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'booking_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [booking_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'member_id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [member_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'member_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [member_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'store_id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'shift_id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [shift_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'terminal_id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'amount') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'amount'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_amount] DEFAULT (0) FOR [amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_transactions] SET [amount]=0 WHERE [amount] IS NULL;';
  ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_transactions', N'method') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [method] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'method') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'method'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_method] DEFAULT ('cash') FOR [method];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'method' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_transactions] SET [method]=''cash'' WHERE [method] IS NULL;';
  ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [method] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_transactions', N'kind') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [kind] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'kind') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'kind'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_kind] DEFAULT ('payment') FOR [kind];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'kind' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_transactions] SET [kind]=''payment'' WHERE [kind] IS NULL;';
  ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [kind] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_transactions', N'reference') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [reference] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'cashier_id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [cashier_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'cashier_name') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [cashier_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'note') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [note] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'note') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'note'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_note] DEFAULT ('') FOR [note];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'note' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_transactions] SET [note]='''' WHERE [note] IS NULL;';
  ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [note] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_transactions', N'paid_at') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [paid_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'paid_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'paid_at'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_paid_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [paid_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'paid_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_transactions] SET [paid_at]=SYSDATETIMEOFFSET() WHERE [paid_at] IS NULL;';
  ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [paid_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_transactions', N'created_at') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'created_at'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_transactions] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_transactions', N'updated_at') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'updated_at'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_transactions] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'row_version') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'row_version'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_transactions] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_transactions', N'status') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'status'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_status] DEFAULT ('completed') FOR [status];

IF COL_LENGTH(N'dbo.payment_transactions', N'metadata') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [metadata] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'metadata') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'metadata'
) ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_metadata] DEFAULT (N'{}') FOR [metadata];

IF COL_LENGTH(N'dbo.payment_transactions', N'client_transaction_id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [client_transaction_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_transactions') AND c.name=N'client_transaction_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_transactions] ALTER COLUMN [client_transaction_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'order_id') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [order_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'payment_method') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [payment_method] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.payment_transactions', N'transaction_reference') IS NULL ALTER TABLE dbo.[payment_transactions] ADD [transaction_reference] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'UX_payment_transactions_client_transaction_id') CREATE UNIQUE INDEX [UX_payment_transactions_client_transaction_id] ON dbo.[payment_transactions]([client_transaction_id]) WHERE [client_transaction_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'IX_payment_transactions_store_id') CREATE INDEX [IX_payment_transactions_store_id] ON dbo.[payment_transactions]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'IX_payment_transactions_updated_at') CREATE INDEX [IX_payment_transactions_updated_at] ON dbo.[payment_transactions]([updated_at]);

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NULL BEGIN CREATE TABLE dbo.[payment_types] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_payment_types_id] DEFAULT (NEWID()),
  [name] nvarchar(max) NOT NULL,
  [type_code] nvarchar(450) NOT NULL,
  [requires_reference] bit NOT NULL CONSTRAINT [DF_payment_types_requires_reference] DEFAULT (0),
  [is_active] bit NOT NULL CONSTRAINT [DF_payment_types_is_active] DEFAULT (1),
  [icon] nvarchar(max) NOT NULL CONSTRAINT [DF_payment_types_icon] DEFAULT ('Wallet'),
  [sort_order] int NOT NULL CONSTRAINT [DF_payment_types_sort_order] DEFAULT (0),
  [is_system] bit NOT NULL CONSTRAINT [DF_payment_types_is_system] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_payment_types_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_payment_types_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_payment_types_row_version] DEFAULT (1),
  CONSTRAINT [PK_payment_types] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.payment_types')) ALTER TABLE dbo.[payment_types] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.payment_types', N'id') IS NULL ALTER TABLE dbo.[payment_types] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_types', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'id'
) ALTER TABLE dbo.[payment_types] ADD CONSTRAINT [DF_payment_types_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_types] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[payment_types] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_types] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.payment_types', N'name') IS NULL ALTER TABLE dbo.[payment_types] ADD [name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.payment_types', N'type_code') IS NULL ALTER TABLE dbo.[payment_types] ADD [type_code] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'type_code' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_types] ALTER COLUMN [type_code] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.payment_types', N'requires_reference') IS NULL ALTER TABLE dbo.[payment_types] ADD [requires_reference] bit NULL;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_types', N'requires_reference') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'requires_reference'
) ALTER TABLE dbo.[payment_types] ADD CONSTRAINT [DF_payment_types_requires_reference] DEFAULT (0) FOR [requires_reference];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'requires_reference' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_types] SET [requires_reference]=0 WHERE [requires_reference] IS NULL;';
  ALTER TABLE dbo.[payment_types] ALTER COLUMN [requires_reference] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_types', N'is_active') IS NULL ALTER TABLE dbo.[payment_types] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_types', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'is_active'
) ALTER TABLE dbo.[payment_types] ADD CONSTRAINT [DF_payment_types_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_types] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[payment_types] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_types', N'icon') IS NULL ALTER TABLE dbo.[payment_types] ADD [icon] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_types', N'icon') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'icon'
) ALTER TABLE dbo.[payment_types] ADD CONSTRAINT [DF_payment_types_icon] DEFAULT ('Wallet') FOR [icon];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'icon' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_types] SET [icon]=''Wallet'' WHERE [icon] IS NULL;';
  ALTER TABLE dbo.[payment_types] ALTER COLUMN [icon] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_types', N'sort_order') IS NULL ALTER TABLE dbo.[payment_types] ADD [sort_order] int NULL;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_types', N'sort_order') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'sort_order'
) ALTER TABLE dbo.[payment_types] ADD CONSTRAINT [DF_payment_types_sort_order] DEFAULT (0) FOR [sort_order];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'sort_order' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_types] SET [sort_order]=0 WHERE [sort_order] IS NULL;';
  ALTER TABLE dbo.[payment_types] ALTER COLUMN [sort_order] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_types', N'is_system') IS NULL ALTER TABLE dbo.[payment_types] ADD [is_system] bit NULL;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_types', N'is_system') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'is_system'
) ALTER TABLE dbo.[payment_types] ADD CONSTRAINT [DF_payment_types_is_system] DEFAULT (0) FOR [is_system];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'is_system' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_types] SET [is_system]=0 WHERE [is_system] IS NULL;';
  ALTER TABLE dbo.[payment_types] ALTER COLUMN [is_system] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_types', N'created_at') IS NULL ALTER TABLE dbo.[payment_types] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_types', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'created_at'
) ALTER TABLE dbo.[payment_types] ADD CONSTRAINT [DF_payment_types_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_types] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[payment_types] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.payment_types', N'updated_at') IS NULL ALTER TABLE dbo.[payment_types] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_types', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'updated_at'
) ALTER TABLE dbo.[payment_types] ADD CONSTRAINT [DF_payment_types_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_types] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[payment_types] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[payment_types] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.payment_types', N'row_version') IS NULL ALTER TABLE dbo.[payment_types] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.payment_types', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_types', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_types') AND c.name=N'row_version'
) ALTER TABLE dbo.[payment_types] ADD CONSTRAINT [DF_payment_types_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[payment_types] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[payment_types] ALTER COLUMN [row_version] int NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'UX_payment_types_type_code') CREATE UNIQUE INDEX [UX_payment_types_type_code] ON dbo.[payment_types]([type_code]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.payment_types') AND name=N'IX_payment_types_updated_at') CREATE INDEX [IX_payment_types_updated_at] ON dbo.[payment_types]([updated_at]);

IF OBJECT_ID(N'dbo.pin_attempts', N'U') IS NULL BEGIN CREATE TABLE dbo.[pin_attempts] (

  [key] nvarchar(450) NOT NULL,
  [attempts] int NOT NULL CONSTRAINT [DF_pin_attempts_attempts] DEFAULT (0),
  [window_started_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_pin_attempts_window_started_at] DEFAULT (SYSDATETIMEOFFSET()),
  [locked_until] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_pin_attempts_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_pin_attempts_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_pin_attempts] PRIMARY KEY ([key])

); END;

IF OBJECT_ID(N'dbo.pin_attempts', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.pin_attempts')) ALTER TABLE dbo.[pin_attempts] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.pin_attempts', N'key') IS NULL ALTER TABLE dbo.[pin_attempts] ADD [key] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.pin_attempts') AND c.name=N'key' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[pin_attempts] ALTER COLUMN [key] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.pin_attempts', N'attempts') IS NULL ALTER TABLE dbo.[pin_attempts] ADD [attempts] int NULL;

IF OBJECT_ID(N'dbo.pin_attempts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pin_attempts', N'attempts') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pin_attempts') AND c.name=N'attempts'
) ALTER TABLE dbo.[pin_attempts] ADD CONSTRAINT [DF_pin_attempts_attempts] DEFAULT (0) FOR [attempts];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pin_attempts') AND name=N'attempts' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pin_attempts] SET [attempts]=0 WHERE [attempts] IS NULL;';
  ALTER TABLE dbo.[pin_attempts] ALTER COLUMN [attempts] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.pin_attempts', N'window_started_at') IS NULL ALTER TABLE dbo.[pin_attempts] ADD [window_started_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.pin_attempts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pin_attempts', N'window_started_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pin_attempts') AND c.name=N'window_started_at'
) ALTER TABLE dbo.[pin_attempts] ADD CONSTRAINT [DF_pin_attempts_window_started_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [window_started_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pin_attempts') AND name=N'window_started_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pin_attempts] SET [window_started_at]=SYSDATETIMEOFFSET() WHERE [window_started_at] IS NULL;';
  ALTER TABLE dbo.[pin_attempts] ALTER COLUMN [window_started_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pin_attempts', N'locked_until') IS NULL ALTER TABLE dbo.[pin_attempts] ADD [locked_until] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.pin_attempts', N'created_at') IS NULL ALTER TABLE dbo.[pin_attempts] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.pin_attempts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pin_attempts', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pin_attempts') AND c.name=N'created_at'
) ALTER TABLE dbo.[pin_attempts] ADD CONSTRAINT [DF_pin_attempts_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pin_attempts') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pin_attempts] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[pin_attempts] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pin_attempts', N'updated_at') IS NULL ALTER TABLE dbo.[pin_attempts] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.pin_attempts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pin_attempts', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pin_attempts') AND c.name=N'updated_at'
) ALTER TABLE dbo.[pin_attempts] ADD CONSTRAINT [DF_pin_attempts_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pin_attempts') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pin_attempts] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[pin_attempts] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.pin_attempts') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[pin_attempts] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pin_attempts') AND name=N'IX_pin_attempts_updated_at') CREATE INDEX [IX_pin_attempts_updated_at] ON dbo.[pin_attempts]([updated_at]);

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NULL BEGIN CREATE TABLE dbo.[pos_settings] (

  [id] int NOT NULL CONSTRAINT [DF_pos_settings_id] DEFAULT (1),
  [tax_percentage] decimal(38,12) NOT NULL CONSTRAINT [DF_pos_settings_tax_percentage] DEFAULT (0),
  [enable_tax] bit NOT NULL CONSTRAINT [DF_pos_settings_enable_tax] DEFAULT (1),
  [tax_mode] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_tax_mode] DEFAULT ('exclusive'),
  [paper_size] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_paper_size] DEFAULT ('80mm'),
  [header_text] nvarchar(max) NULL,
  [footer_text] nvarchar(max) NULL,
  [show_logo] bit NOT NULL CONSTRAINT [DF_pos_settings_show_logo] DEFAULT (1),
  [show_points] bit NOT NULL CONSTRAINT [DF_pos_settings_show_points] DEFAULT (1),
  [show_barcode] bit NOT NULL CONSTRAINT [DF_pos_settings_show_barcode] DEFAULT (1),
  [show_tax_details] bit NOT NULL CONSTRAINT [DF_pos_settings_show_tax_details] DEFAULT (1),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_pos_settings_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [company_name] nvarchar(max) NULL,
  [tax_number] nvarchar(max) NULL,
  [reg_number] nvarchar(max) NULL,
  [phone] nvarchar(max) NULL,
  [website] nvarchar(max) NULL,
  [fonts] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_fonts] DEFAULT (N'{}'),
  [custom_lines] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_custom_lines] DEFAULT (N'[]'),
  [qr] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_qr] DEFAULT (N'{}'),
  [ui_visibility] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_ui_visibility] DEFAULT (N'{"hidden": {}}'),
  [integration_settings] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_integration_settings] DEFAULT (N'{}'),
  [region_country] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_region_country] DEFAULT (''),
  [time_zone] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_time_zone] DEFAULT (''),
  [date_format] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_date_format] DEFAULT ('dd/MM/yyyy'),
  [time_format] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_time_format] DEFAULT ('24h'),
  [booking_slip] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_booking_slip] DEFAULT (N'{}'),
  [notification_settings] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_notification_settings] DEFAULT (N'{}'),
  [row_version] int NOT NULL CONSTRAINT [DF_pos_settings_row_version] DEFAULT (1),
  [logo_data_url] nvarchar(max) NULL,
  [receipt_design] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_receipt_design] DEFAULT (N'{}'),
  [payment_details] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_payment_details] DEFAULT (N'{}'),
  [whatsapp_settings] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_whatsapp_settings] DEFAULT (N'{}'),
  [receipt_css] nvarchar(max) NOT NULL CONSTRAINT [DF_pos_settings_receipt_css] DEFAULT (''),
  CONSTRAINT [PK_pos_settings] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.pos_settings')) ALTER TABLE dbo.[pos_settings] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.pos_settings', N'id') IS NULL ALTER TABLE dbo.[pos_settings] ADD [id] int NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'id'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_id] DEFAULT (1) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [id]=1 WHERE [id] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [id] int NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[pos_settings] ALTER COLUMN [id] int NOT NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'tax_percentage') IS NULL ALTER TABLE dbo.[pos_settings] ADD [tax_percentage] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'tax_percentage') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'tax_percentage'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_tax_percentage] DEFAULT (0) FOR [tax_percentage];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'tax_percentage' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [tax_percentage]=0 WHERE [tax_percentage] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [tax_percentage] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'enable_tax') IS NULL ALTER TABLE dbo.[pos_settings] ADD [enable_tax] bit NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'enable_tax') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'enable_tax'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_enable_tax] DEFAULT (1) FOR [enable_tax];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'enable_tax' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [enable_tax]=1 WHERE [enable_tax] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [enable_tax] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'tax_mode') IS NULL ALTER TABLE dbo.[pos_settings] ADD [tax_mode] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'tax_mode') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'tax_mode'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_tax_mode] DEFAULT ('exclusive') FOR [tax_mode];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'tax_mode' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [tax_mode]=''exclusive'' WHERE [tax_mode] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [tax_mode] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'paper_size') IS NULL ALTER TABLE dbo.[pos_settings] ADD [paper_size] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'paper_size') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'paper_size'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_paper_size] DEFAULT ('80mm') FOR [paper_size];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'paper_size' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [paper_size]=''80mm'' WHERE [paper_size] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [paper_size] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'header_text') IS NULL ALTER TABLE dbo.[pos_settings] ADD [header_text] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'footer_text') IS NULL ALTER TABLE dbo.[pos_settings] ADD [footer_text] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'show_logo') IS NULL ALTER TABLE dbo.[pos_settings] ADD [show_logo] bit NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'show_logo') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'show_logo'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_show_logo] DEFAULT (1) FOR [show_logo];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'show_logo' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [show_logo]=1 WHERE [show_logo] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [show_logo] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'show_points') IS NULL ALTER TABLE dbo.[pos_settings] ADD [show_points] bit NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'show_points') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'show_points'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_show_points] DEFAULT (1) FOR [show_points];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'show_points' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [show_points]=1 WHERE [show_points] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [show_points] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'show_barcode') IS NULL ALTER TABLE dbo.[pos_settings] ADD [show_barcode] bit NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'show_barcode') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'show_barcode'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_show_barcode] DEFAULT (1) FOR [show_barcode];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'show_barcode' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [show_barcode]=1 WHERE [show_barcode] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [show_barcode] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'show_tax_details') IS NULL ALTER TABLE dbo.[pos_settings] ADD [show_tax_details] bit NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'show_tax_details') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'show_tax_details'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_show_tax_details] DEFAULT (1) FOR [show_tax_details];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'show_tax_details' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [show_tax_details]=1 WHERE [show_tax_details] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [show_tax_details] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'updated_at') IS NULL ALTER TABLE dbo.[pos_settings] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'updated_at'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[pos_settings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'company_name') IS NULL ALTER TABLE dbo.[pos_settings] ADD [company_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'tax_number') IS NULL ALTER TABLE dbo.[pos_settings] ADD [tax_number] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'reg_number') IS NULL ALTER TABLE dbo.[pos_settings] ADD [reg_number] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'phone') IS NULL ALTER TABLE dbo.[pos_settings] ADD [phone] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'website') IS NULL ALTER TABLE dbo.[pos_settings] ADD [website] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'fonts') IS NULL ALTER TABLE dbo.[pos_settings] ADD [fonts] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'fonts') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'fonts'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_fonts] DEFAULT (N'{}') FOR [fonts];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'fonts' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [fonts]=N''{}'' WHERE [fonts] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [fonts] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'custom_lines') IS NULL ALTER TABLE dbo.[pos_settings] ADD [custom_lines] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'custom_lines') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'custom_lines'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_custom_lines] DEFAULT (N'[]') FOR [custom_lines];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'custom_lines' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [custom_lines]=N''[]'' WHERE [custom_lines] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [custom_lines] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'qr') IS NULL ALTER TABLE dbo.[pos_settings] ADD [qr] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'qr') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'qr'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_qr] DEFAULT (N'{}') FOR [qr];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'qr' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [qr]=N''{}'' WHERE [qr] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [qr] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'ui_visibility') IS NULL ALTER TABLE dbo.[pos_settings] ADD [ui_visibility] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'ui_visibility') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'ui_visibility'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_ui_visibility] DEFAULT (N'{"hidden": {}}') FOR [ui_visibility];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'ui_visibility' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [ui_visibility]=N''{"hidden": {}}'' WHERE [ui_visibility] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [ui_visibility] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'integration_settings') IS NULL ALTER TABLE dbo.[pos_settings] ADD [integration_settings] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'integration_settings') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'integration_settings'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_integration_settings] DEFAULT (N'{}') FOR [integration_settings];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'integration_settings' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [integration_settings]=N''{}'' WHERE [integration_settings] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [integration_settings] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'region_country') IS NULL ALTER TABLE dbo.[pos_settings] ADD [region_country] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'region_country') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'region_country'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_region_country] DEFAULT ('') FOR [region_country];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'region_country' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [region_country]='''' WHERE [region_country] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [region_country] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'time_zone') IS NULL ALTER TABLE dbo.[pos_settings] ADD [time_zone] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'time_zone') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'time_zone'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_time_zone] DEFAULT ('') FOR [time_zone];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'time_zone' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [time_zone]='''' WHERE [time_zone] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [time_zone] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'date_format') IS NULL ALTER TABLE dbo.[pos_settings] ADD [date_format] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'date_format') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'date_format'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_date_format] DEFAULT ('dd/MM/yyyy') FOR [date_format];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'date_format' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [date_format]=''dd/MM/yyyy'' WHERE [date_format] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [date_format] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'time_format') IS NULL ALTER TABLE dbo.[pos_settings] ADD [time_format] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'time_format') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'time_format'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_time_format] DEFAULT ('24h') FOR [time_format];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'time_format' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [time_format]=''24h'' WHERE [time_format] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [time_format] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'booking_slip') IS NULL ALTER TABLE dbo.[pos_settings] ADD [booking_slip] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'booking_slip') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'booking_slip'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_booking_slip] DEFAULT (N'{}') FOR [booking_slip];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'booking_slip' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [booking_slip]=N''{}'' WHERE [booking_slip] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [booking_slip] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'notification_settings') IS NULL ALTER TABLE dbo.[pos_settings] ADD [notification_settings] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'notification_settings') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'notification_settings'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_notification_settings] DEFAULT (N'{}') FOR [notification_settings];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'notification_settings' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [notification_settings]=N''{}'' WHERE [notification_settings] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [notification_settings] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'row_version') IS NULL ALTER TABLE dbo.[pos_settings] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'row_version'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'logo_data_url') IS NULL ALTER TABLE dbo.[pos_settings] ADD [logo_data_url] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.pos_settings', N'receipt_design') IS NULL ALTER TABLE dbo.[pos_settings] ADD [receipt_design] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'receipt_design') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'receipt_design'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_receipt_design] DEFAULT (N'{}') FOR [receipt_design];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'receipt_design' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [receipt_design]=N''{}'' WHERE [receipt_design] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [receipt_design] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'payment_details') IS NULL ALTER TABLE dbo.[pos_settings] ADD [payment_details] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'payment_details') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'payment_details'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_payment_details] DEFAULT (N'{}') FOR [payment_details];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'payment_details' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [payment_details]=N''{}'' WHERE [payment_details] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [payment_details] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'whatsapp_settings') IS NULL ALTER TABLE dbo.[pos_settings] ADD [whatsapp_settings] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'whatsapp_settings') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'whatsapp_settings'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_whatsapp_settings] DEFAULT (N'{}') FOR [whatsapp_settings];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'whatsapp_settings' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [whatsapp_settings]=N''{}'' WHERE [whatsapp_settings] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [whatsapp_settings] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_settings', N'receipt_css') IS NULL ALTER TABLE dbo.[pos_settings] ADD [receipt_css] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'receipt_css') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings') AND c.name=N'receipt_css'
) ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_receipt_css] DEFAULT ('') FOR [receipt_css];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'receipt_css' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_settings] SET [receipt_css]='''' WHERE [receipt_css] IS NULL;';
  ALTER TABLE dbo.[pos_settings] ALTER COLUMN [receipt_css] nvarchar(max) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pos_settings') AND name=N'IX_pos_settings_updated_at') CREATE INDEX [IX_pos_settings_updated_at] ON dbo.[pos_settings]([updated_at]);

IF OBJECT_ID(N'dbo.product_barcodes', N'U') IS NULL BEGIN CREATE TABLE dbo.[product_barcodes] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_product_barcodes_id] DEFAULT (NEWID()),
  [product_id] uniqueidentifier NOT NULL,
  [barcode] nvarchar(450) NOT NULL,
  [label] nvarchar(max) NULL,
  [pack_size] decimal(38,12) NOT NULL CONSTRAINT [DF_product_barcodes_pack_size] DEFAULT (1),
  [is_primary] bit NOT NULL CONSTRAINT [DF_product_barcodes_is_primary] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_product_barcodes_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_product_barcodes_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_product_barcodes_row_version] DEFAULT (1),
  [unit_label] nvarchar(max) NULL,
  [deleted_at] nvarchar(max) NULL,
  CONSTRAINT [PK_product_barcodes] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.product_barcodes', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.product_barcodes')) ALTER TABLE dbo.[product_barcodes] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.product_barcodes', N'id') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.product_barcodes', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_barcodes', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'id'
) ALTER TABLE dbo.[product_barcodes] ADD CONSTRAINT [DF_product_barcodes_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_barcodes') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_barcodes] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.product_barcodes', N'product_id') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [product_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'product_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [product_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.product_barcodes', N'barcode') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [barcode] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'barcode' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [barcode] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.product_barcodes', N'label') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [label] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.product_barcodes', N'pack_size') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [pack_size] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.product_barcodes', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_barcodes', N'pack_size') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'pack_size'
) ALTER TABLE dbo.[product_barcodes] ADD CONSTRAINT [DF_product_barcodes_pack_size] DEFAULT (1) FOR [pack_size];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_barcodes') AND name=N'pack_size' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_barcodes] SET [pack_size]=1 WHERE [pack_size] IS NULL;';
  ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [pack_size] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.product_barcodes', N'is_primary') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [is_primary] bit NULL;

IF OBJECT_ID(N'dbo.product_barcodes', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_barcodes', N'is_primary') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'is_primary'
) ALTER TABLE dbo.[product_barcodes] ADD CONSTRAINT [DF_product_barcodes_is_primary] DEFAULT (0) FOR [is_primary];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_barcodes') AND name=N'is_primary' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_barcodes] SET [is_primary]=0 WHERE [is_primary] IS NULL;';
  ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [is_primary] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.product_barcodes', N'created_at') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.product_barcodes', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_barcodes', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'created_at'
) ALTER TABLE dbo.[product_barcodes] ADD CONSTRAINT [DF_product_barcodes_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_barcodes') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_barcodes] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.product_barcodes', N'updated_at') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.product_barcodes', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_barcodes', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'updated_at'
) ALTER TABLE dbo.[product_barcodes] ADD CONSTRAINT [DF_product_barcodes_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_barcodes') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_barcodes] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.product_barcodes', N'row_version') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.product_barcodes', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_barcodes', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_barcodes') AND c.name=N'row_version'
) ALTER TABLE dbo.[product_barcodes] ADD CONSTRAINT [DF_product_barcodes_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_barcodes') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_barcodes] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[product_barcodes] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.product_barcodes', N'unit_label') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [unit_label] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.product_barcodes', N'deleted_at') IS NULL ALTER TABLE dbo.[product_barcodes] ADD [deleted_at] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.product_barcodes') AND name=N'UX_product_barcodes_barcode') CREATE UNIQUE INDEX [UX_product_barcodes_barcode] ON dbo.[product_barcodes]([barcode]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.product_barcodes') AND name=N'IX_product_barcodes_updated_at') CREATE INDEX [IX_product_barcodes_updated_at] ON dbo.[product_barcodes]([updated_at]);

IF OBJECT_ID(N'dbo.product_categories', N'U') IS NULL BEGIN CREATE TABLE dbo.[product_categories] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_product_categories_id] DEFAULT (NEWID()),
  [name] nvarchar(max) NOT NULL,
  [parent_id] uniqueidentifier NULL,
  [sort] int NOT NULL CONSTRAINT [DF_product_categories_sort] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_product_categories_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_product_categories_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [kind] nvarchar(max) NOT NULL CONSTRAINT [DF_product_categories_kind] DEFAULT ('category'),
  [row_version] int NOT NULL CONSTRAINT [DF_product_categories_row_version] DEFAULT (1),
  [is_active] bit NOT NULL CONSTRAINT [DF_product_categories_is_active] DEFAULT (1),
  [deleted_at] nvarchar(max) NULL,
  CONSTRAINT [PK_product_categories] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.product_categories', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.product_categories')) ALTER TABLE dbo.[product_categories] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.product_categories', N'id') IS NULL ALTER TABLE dbo.[product_categories] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.product_categories', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_categories', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'id'
) ALTER TABLE dbo.[product_categories] ADD CONSTRAINT [DF_product_categories_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_categories') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_categories] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[product_categories] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[product_categories] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.product_categories', N'name') IS NULL ALTER TABLE dbo.[product_categories] ADD [name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.product_categories', N'parent_id') IS NULL ALTER TABLE dbo.[product_categories] ADD [parent_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'parent_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[product_categories] ALTER COLUMN [parent_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.product_categories', N'sort') IS NULL ALTER TABLE dbo.[product_categories] ADD [sort] int NULL;

IF OBJECT_ID(N'dbo.product_categories', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_categories', N'sort') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'sort'
) ALTER TABLE dbo.[product_categories] ADD CONSTRAINT [DF_product_categories_sort] DEFAULT (0) FOR [sort];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_categories') AND name=N'sort' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_categories] SET [sort]=0 WHERE [sort] IS NULL;';
  ALTER TABLE dbo.[product_categories] ALTER COLUMN [sort] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.product_categories', N'created_at') IS NULL ALTER TABLE dbo.[product_categories] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.product_categories', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_categories', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'created_at'
) ALTER TABLE dbo.[product_categories] ADD CONSTRAINT [DF_product_categories_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_categories') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_categories] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[product_categories] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.product_categories', N'updated_at') IS NULL ALTER TABLE dbo.[product_categories] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.product_categories', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_categories', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'updated_at'
) ALTER TABLE dbo.[product_categories] ADD CONSTRAINT [DF_product_categories_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_categories') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_categories] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[product_categories] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[product_categories] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.product_categories', N'kind') IS NULL ALTER TABLE dbo.[product_categories] ADD [kind] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.product_categories', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_categories', N'kind') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'kind'
) ALTER TABLE dbo.[product_categories] ADD CONSTRAINT [DF_product_categories_kind] DEFAULT ('category') FOR [kind];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_categories') AND name=N'kind' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_categories] SET [kind]=''category'' WHERE [kind] IS NULL;';
  ALTER TABLE dbo.[product_categories] ALTER COLUMN [kind] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.product_categories', N'row_version') IS NULL ALTER TABLE dbo.[product_categories] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.product_categories', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_categories', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'row_version'
) ALTER TABLE dbo.[product_categories] ADD CONSTRAINT [DF_product_categories_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_categories') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_categories] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[product_categories] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.product_categories', N'is_active') IS NULL ALTER TABLE dbo.[product_categories] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.product_categories', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.product_categories', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.product_categories') AND c.name=N'is_active'
) ALTER TABLE dbo.[product_categories] ADD CONSTRAINT [DF_product_categories_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.product_categories') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[product_categories] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[product_categories] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.product_categories', N'deleted_at') IS NULL ALTER TABLE dbo.[product_categories] ADD [deleted_at] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.product_categories') AND name=N'IX_product_categories_updated_at') CREATE INDEX [IX_product_categories_updated_at] ON dbo.[product_categories]([updated_at]);

IF OBJECT_ID(N'dbo.products', N'U') IS NULL BEGIN CREATE TABLE dbo.[products] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_products_id] DEFAULT (NEWID()),
  [barcode] nvarchar(450) NOT NULL,
  [name] nvarchar(max) NOT NULL,
  [category] nvarchar(max) NULL,
  [cost_price] decimal(38,12) NOT NULL CONSTRAINT [DF_products_cost_price] DEFAULT (0),
  [selling_price] decimal(38,12) NOT NULL CONSTRAINT [DF_products_selling_price] DEFAULT (0),
  [ecom_price] decimal(38,12) NULL,
  [stock_quantity] int NOT NULL CONSTRAINT [DF_products_stock_quantity] DEFAULT (0),
  [custom_points] decimal(38,12) NULL,
  [point_multiplier] decimal(38,12) NOT NULL CONSTRAINT [DF_products_point_multiplier] DEFAULT (1.0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_products_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [sku] nvarchar(max) NULL,
  [reorder_level] int NOT NULL CONSTRAINT [DF_products_reorder_level] DEFAULT (0),
  [tax_rate] decimal(38,12) NOT NULL CONSTRAINT [DF_products_tax_rate] DEFAULT (0),
  [ecom_visible] bit NOT NULL CONSTRAINT [DF_products_ecom_visible] DEFAULT (1),
  [stock_by_store] nvarchar(max) NOT NULL CONSTRAINT [DF_products_stock_by_store] DEFAULT (N'{}'),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_products_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [landing_pct] decimal(38,12) NULL,
  [sub_category] nvarchar(max) NULL,
  [unit] nvarchar(max) NULL,
  [packs] nvarchar(max) NOT NULL CONSTRAINT [DF_products_packs] DEFAULT (N'[]'),
  [barcode_aliases] nvarchar(max) NOT NULL CONSTRAINT [DF_products_barcode_aliases] DEFAULT (N'[]'),
  [is_archived] bit NOT NULL CONSTRAINT [DF_products_is_archived] DEFAULT (0),
  [archived_at] datetimeoffset(7) NULL,
  [brand] nvarchar(max) NULL,
  [product_group] nvarchar(max) NULL,
  [barcode_variants] nvarchar(max) NOT NULL CONSTRAINT [DF_products_barcode_variants] DEFAULT (N'[]'),
  [row_version] int NOT NULL CONSTRAINT [DF_products_row_version] DEFAULT (1),
  [owner_store_id] nvarchar(450) NULL,
  [deleted_at] nvarchar(max) NULL,
  CONSTRAINT [PK_products] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.products')) ALTER TABLE dbo.[products] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.products', N'id') IS NULL ALTER TABLE dbo.[products] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'id'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.products') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[products] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.products', N'barcode') IS NULL ALTER TABLE dbo.[products] ADD [barcode] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.products') AND c.name=N'barcode' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[products] ALTER COLUMN [barcode] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.products', N'name') IS NULL ALTER TABLE dbo.[products] ADD [name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.products', N'category') IS NULL ALTER TABLE dbo.[products] ADD [category] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.products', N'cost_price') IS NULL ALTER TABLE dbo.[products] ADD [cost_price] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'cost_price') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'cost_price'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_cost_price] DEFAULT (0) FOR [cost_price];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'cost_price' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [cost_price]=0 WHERE [cost_price] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [cost_price] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'selling_price') IS NULL ALTER TABLE dbo.[products] ADD [selling_price] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'selling_price') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'selling_price'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_selling_price] DEFAULT (0) FOR [selling_price];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'selling_price' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [selling_price]=0 WHERE [selling_price] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [selling_price] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'ecom_price') IS NULL ALTER TABLE dbo.[products] ADD [ecom_price] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.products', N'stock_quantity') IS NULL ALTER TABLE dbo.[products] ADD [stock_quantity] int NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'stock_quantity') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'stock_quantity'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_stock_quantity] DEFAULT (0) FOR [stock_quantity];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'stock_quantity' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [stock_quantity]=0 WHERE [stock_quantity] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [stock_quantity] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'custom_points') IS NULL ALTER TABLE dbo.[products] ADD [custom_points] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.products', N'point_multiplier') IS NULL ALTER TABLE dbo.[products] ADD [point_multiplier] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'point_multiplier') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'point_multiplier'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_point_multiplier] DEFAULT (1.0) FOR [point_multiplier];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'point_multiplier' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [point_multiplier]=1.0 WHERE [point_multiplier] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [point_multiplier] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'created_at') IS NULL ALTER TABLE dbo.[products] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'created_at'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'sku') IS NULL ALTER TABLE dbo.[products] ADD [sku] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.products', N'reorder_level') IS NULL ALTER TABLE dbo.[products] ADD [reorder_level] int NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'reorder_level') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'reorder_level'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_reorder_level] DEFAULT (0) FOR [reorder_level];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'reorder_level' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [reorder_level]=0 WHERE [reorder_level] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [reorder_level] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'tax_rate') IS NULL ALTER TABLE dbo.[products] ADD [tax_rate] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'tax_rate') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'tax_rate'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_tax_rate] DEFAULT (0) FOR [tax_rate];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'tax_rate' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [tax_rate]=0 WHERE [tax_rate] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [tax_rate] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'ecom_visible') IS NULL ALTER TABLE dbo.[products] ADD [ecom_visible] bit NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'ecom_visible') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'ecom_visible'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_ecom_visible] DEFAULT (1) FOR [ecom_visible];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'ecom_visible' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [ecom_visible]=1 WHERE [ecom_visible] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [ecom_visible] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'stock_by_store') IS NULL ALTER TABLE dbo.[products] ADD [stock_by_store] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'stock_by_store') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'stock_by_store'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_stock_by_store] DEFAULT (N'{}') FOR [stock_by_store];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'stock_by_store' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [stock_by_store]=N''{}'' WHERE [stock_by_store] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [stock_by_store] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'updated_at') IS NULL ALTER TABLE dbo.[products] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'updated_at'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.products') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[products] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.products', N'landing_pct') IS NULL ALTER TABLE dbo.[products] ADD [landing_pct] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.products', N'sub_category') IS NULL ALTER TABLE dbo.[products] ADD [sub_category] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.products', N'unit') IS NULL ALTER TABLE dbo.[products] ADD [unit] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.products', N'packs') IS NULL ALTER TABLE dbo.[products] ADD [packs] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'packs') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'packs'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_packs] DEFAULT (N'[]') FOR [packs];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'packs' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [packs]=N''[]'' WHERE [packs] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [packs] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'barcode_aliases') IS NULL ALTER TABLE dbo.[products] ADD [barcode_aliases] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'barcode_aliases') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'barcode_aliases'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_barcode_aliases] DEFAULT (N'[]') FOR [barcode_aliases];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'barcode_aliases' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [barcode_aliases]=N''[]'' WHERE [barcode_aliases] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [barcode_aliases] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'is_archived') IS NULL ALTER TABLE dbo.[products] ADD [is_archived] bit NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'is_archived') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'is_archived'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_is_archived] DEFAULT (0) FOR [is_archived];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'is_archived' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [is_archived]=0 WHERE [is_archived] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [is_archived] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'archived_at') IS NULL ALTER TABLE dbo.[products] ADD [archived_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.products', N'brand') IS NULL ALTER TABLE dbo.[products] ADD [brand] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.products', N'product_group') IS NULL ALTER TABLE dbo.[products] ADD [product_group] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.products', N'barcode_variants') IS NULL ALTER TABLE dbo.[products] ADD [barcode_variants] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'barcode_variants') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'barcode_variants'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_barcode_variants] DEFAULT (N'[]') FOR [barcode_variants];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'barcode_variants' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [barcode_variants]=N''[]'' WHERE [barcode_variants] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [barcode_variants] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'row_version') IS NULL ALTER TABLE dbo.[products] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products') AND c.name=N'row_version'
) ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[products] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[products] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.products', N'owner_store_id') IS NULL ALTER TABLE dbo.[products] ADD [owner_store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.products') AND c.name=N'owner_store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[products] ALTER COLUMN [owner_store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.products', N'deleted_at') IS NULL ALTER TABLE dbo.[products] ADD [deleted_at] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'UX_products_barcode') CREATE UNIQUE INDEX [UX_products_barcode] ON dbo.[products]([barcode]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.products') AND name=N'IX_products_updated_at') CREATE INDEX [IX_products_updated_at] ON dbo.[products]([updated_at]);

IF OBJECT_ID(N'dbo.promotions', N'U') IS NULL BEGIN CREATE TABLE dbo.[promotions] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_promotions_id] DEFAULT (NEWID()),
  [title] nvarchar(max) NOT NULL,
  [promo_type] nvarchar(max) NOT NULL,
  [min_spend] decimal(38,12) NOT NULL CONSTRAINT [DF_promotions_min_spend] DEFAULT (0),
  [discount_percent] decimal(38,12) NOT NULL CONSTRAINT [DF_promotions_discount_percent] DEFAULT (0),
  [discount_amount] decimal(38,12) NOT NULL CONSTRAINT [DF_promotions_discount_amount] DEFAULT (0),
  [foc_product_id] uniqueidentifier NULL,
  [points_per_dollar] decimal(38,12) NOT NULL CONSTRAINT [DF_promotions_points_per_dollar] DEFAULT (1),
  [tier_rates] nvarchar(max) NULL,
  [is_active] bit NOT NULL CONSTRAINT [DF_promotions_is_active] DEFAULT (1),
  [start_date] date NULL,
  [end_date] date NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_promotions_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_promotions_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_promotions_row_version] DEFAULT (1),
  [deleted_at] nvarchar(max) NULL,
  CONSTRAINT [PK_promotions] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.promotions')) ALTER TABLE dbo.[promotions] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.promotions', N'id') IS NULL ALTER TABLE dbo.[promotions] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.promotions', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'id'
) ALTER TABLE dbo.[promotions] ADD CONSTRAINT [DF_promotions_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[promotions] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[promotions] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[promotions] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.promotions', N'title') IS NULL ALTER TABLE dbo.[promotions] ADD [title] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.promotions', N'promo_type') IS NULL ALTER TABLE dbo.[promotions] ADD [promo_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.promotions', N'min_spend') IS NULL ALTER TABLE dbo.[promotions] ADD [min_spend] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.promotions', N'min_spend') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'min_spend'
) ALTER TABLE dbo.[promotions] ADD CONSTRAINT [DF_promotions_min_spend] DEFAULT (0) FOR [min_spend];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'min_spend' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[promotions] SET [min_spend]=0 WHERE [min_spend] IS NULL;';
  ALTER TABLE dbo.[promotions] ALTER COLUMN [min_spend] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.promotions', N'discount_percent') IS NULL ALTER TABLE dbo.[promotions] ADD [discount_percent] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.promotions', N'discount_percent') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'discount_percent'
) ALTER TABLE dbo.[promotions] ADD CONSTRAINT [DF_promotions_discount_percent] DEFAULT (0) FOR [discount_percent];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'discount_percent' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[promotions] SET [discount_percent]=0 WHERE [discount_percent] IS NULL;';
  ALTER TABLE dbo.[promotions] ALTER COLUMN [discount_percent] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.promotions', N'discount_amount') IS NULL ALTER TABLE dbo.[promotions] ADD [discount_amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.promotions', N'discount_amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'discount_amount'
) ALTER TABLE dbo.[promotions] ADD CONSTRAINT [DF_promotions_discount_amount] DEFAULT (0) FOR [discount_amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'discount_amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[promotions] SET [discount_amount]=0 WHERE [discount_amount] IS NULL;';
  ALTER TABLE dbo.[promotions] ALTER COLUMN [discount_amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.promotions', N'foc_product_id') IS NULL ALTER TABLE dbo.[promotions] ADD [foc_product_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'foc_product_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[promotions] ALTER COLUMN [foc_product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.promotions', N'points_per_dollar') IS NULL ALTER TABLE dbo.[promotions] ADD [points_per_dollar] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.promotions', N'points_per_dollar') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'points_per_dollar'
) ALTER TABLE dbo.[promotions] ADD CONSTRAINT [DF_promotions_points_per_dollar] DEFAULT (1) FOR [points_per_dollar];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'points_per_dollar' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[promotions] SET [points_per_dollar]=1 WHERE [points_per_dollar] IS NULL;';
  ALTER TABLE dbo.[promotions] ALTER COLUMN [points_per_dollar] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.promotions', N'tier_rates') IS NULL ALTER TABLE dbo.[promotions] ADD [tier_rates] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.promotions', N'is_active') IS NULL ALTER TABLE dbo.[promotions] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.promotions', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'is_active'
) ALTER TABLE dbo.[promotions] ADD CONSTRAINT [DF_promotions_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[promotions] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[promotions] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.promotions', N'start_date') IS NULL ALTER TABLE dbo.[promotions] ADD [start_date] date NULL;

IF COL_LENGTH(N'dbo.promotions', N'end_date') IS NULL ALTER TABLE dbo.[promotions] ADD [end_date] date NULL;

IF COL_LENGTH(N'dbo.promotions', N'created_at') IS NULL ALTER TABLE dbo.[promotions] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.promotions', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'created_at'
) ALTER TABLE dbo.[promotions] ADD CONSTRAINT [DF_promotions_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[promotions] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[promotions] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.promotions', N'updated_at') IS NULL ALTER TABLE dbo.[promotions] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.promotions', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'updated_at'
) ALTER TABLE dbo.[promotions] ADD CONSTRAINT [DF_promotions_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[promotions] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[promotions] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[promotions] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.promotions', N'row_version') IS NULL ALTER TABLE dbo.[promotions] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.promotions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.promotions', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.promotions') AND c.name=N'row_version'
) ALTER TABLE dbo.[promotions] ADD CONSTRAINT [DF_promotions_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[promotions] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[promotions] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.promotions', N'deleted_at') IS NULL ALTER TABLE dbo.[promotions] ADD [deleted_at] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.promotions') AND name=N'IX_promotions_updated_at') CREATE INDEX [IX_promotions_updated_at] ON dbo.[promotions]([updated_at]);

IF OBJECT_ID(N'dbo.public_flags', N'U') IS NULL BEGIN CREATE TABLE dbo.[public_flags] (

  [key] nvarchar(450) NOT NULL,
  [enabled] bit NOT NULL CONSTRAINT [DF_public_flags_enabled] DEFAULT (1),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_public_flags_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_public_flags] PRIMARY KEY ([key])

); END;

IF OBJECT_ID(N'dbo.public_flags', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.public_flags')) ALTER TABLE dbo.[public_flags] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.public_flags', N'key') IS NULL ALTER TABLE dbo.[public_flags] ADD [key] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.public_flags') AND c.name=N'key' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[public_flags] ALTER COLUMN [key] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.public_flags', N'enabled') IS NULL ALTER TABLE dbo.[public_flags] ADD [enabled] bit NULL;

IF OBJECT_ID(N'dbo.public_flags', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.public_flags', N'enabled') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.public_flags') AND c.name=N'enabled'
) ALTER TABLE dbo.[public_flags] ADD CONSTRAINT [DF_public_flags_enabled] DEFAULT (1) FOR [enabled];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.public_flags') AND name=N'enabled' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[public_flags] SET [enabled]=1 WHERE [enabled] IS NULL;';
  ALTER TABLE dbo.[public_flags] ALTER COLUMN [enabled] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.public_flags', N'updated_at') IS NULL ALTER TABLE dbo.[public_flags] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.public_flags', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.public_flags', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.public_flags') AND c.name=N'updated_at'
) ALTER TABLE dbo.[public_flags] ADD CONSTRAINT [DF_public_flags_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.public_flags') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[public_flags] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[public_flags] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.public_flags') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[public_flags] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.public_flags') AND name=N'IX_public_flags_updated_at') CREATE INDEX [IX_public_flags_updated_at] ON dbo.[public_flags]([updated_at]);

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NULL BEGIN CREATE TABLE dbo.[purchase_order_items] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_purchase_order_items_id] DEFAULT (NEWID()),
  [po_id] uniqueidentifier NOT NULL,
  [product_id] uniqueidentifier NULL,
  [barcode] nvarchar(max) NULL,
  [product_name] nvarchar(max) NULL,
  [cost_price] decimal(38,12) NOT NULL CONSTRAINT [DF_purchase_order_items_cost_price] DEFAULT (0),
  [selling_price] decimal(38,12) NOT NULL CONSTRAINT [DF_purchase_order_items_selling_price] DEFAULT (0),
  [quantity_received] int NOT NULL CONSTRAINT [DF_purchase_order_items_quantity_received] DEFAULT (0),
  [subtotal_cost] decimal(38,12) NOT NULL CONSTRAINT [DF_purchase_order_items_subtotal_cost] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_purchase_order_items_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [sku] nvarchar(max) NULL,
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_purchase_order_items_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_purchase_order_items_row_version] DEFAULT (1),
  CONSTRAINT [PK_purchase_order_items] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items')) ALTER TABLE dbo.[purchase_order_items] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.purchase_order_items', N'id') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_order_items', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'id'
) ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [DF_purchase_order_items_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_order_items] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.purchase_order_items', N'po_id') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [po_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'po_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [po_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.purchase_order_items', N'product_id') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [product_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'product_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.purchase_order_items', N'barcode') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [barcode] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.purchase_order_items', N'product_name') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [product_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.purchase_order_items', N'cost_price') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [cost_price] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_order_items', N'cost_price') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'cost_price'
) ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [DF_purchase_order_items_cost_price] DEFAULT (0) FOR [cost_price];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'cost_price' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_order_items] SET [cost_price]=0 WHERE [cost_price] IS NULL;';
  ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [cost_price] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_order_items', N'selling_price') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [selling_price] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_order_items', N'selling_price') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'selling_price'
) ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [DF_purchase_order_items_selling_price] DEFAULT (0) FOR [selling_price];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'selling_price' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_order_items] SET [selling_price]=0 WHERE [selling_price] IS NULL;';
  ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [selling_price] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_order_items', N'quantity_received') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [quantity_received] int NULL;

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_order_items', N'quantity_received') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'quantity_received'
) ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [DF_purchase_order_items_quantity_received] DEFAULT (0) FOR [quantity_received];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'quantity_received' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_order_items] SET [quantity_received]=0 WHERE [quantity_received] IS NULL;';
  ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [quantity_received] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_order_items', N'subtotal_cost') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [subtotal_cost] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_order_items', N'subtotal_cost') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'subtotal_cost'
) ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [DF_purchase_order_items_subtotal_cost] DEFAULT (0) FOR [subtotal_cost];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'subtotal_cost' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_order_items] SET [subtotal_cost]=0 WHERE [subtotal_cost] IS NULL;';
  ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [subtotal_cost] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_order_items', N'created_at') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_order_items', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'created_at'
) ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [DF_purchase_order_items_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_order_items] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_order_items', N'sku') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [sku] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.purchase_order_items', N'updated_at') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_order_items', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'updated_at'
) ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [DF_purchase_order_items_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_order_items] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.purchase_order_items', N'row_version') IS NULL ALTER TABLE dbo.[purchase_order_items] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.purchase_order_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_order_items', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND c.name=N'row_version'
) ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [DF_purchase_order_items_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_order_items] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[purchase_order_items] ALTER COLUMN [row_version] int NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'IX_purchase_order_items_updated_at') CREATE INDEX [IX_purchase_order_items_updated_at] ON dbo.[purchase_order_items]([updated_at]);

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NULL BEGIN CREATE TABLE dbo.[purchase_orders] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_purchase_orders_id] DEFAULT (NEWID()),
  [po_number] nvarchar(128) NOT NULL,
  [supplier_name] nvarchar(max) NULL,
  [operator_name] nvarchar(max) NULL,
  [total_cost] decimal(38,12) NOT NULL CONSTRAINT [DF_purchase_orders_total_cost] DEFAULT (0),
  [total_items_count] int NOT NULL CONSTRAINT [DF_purchase_orders_total_items_count] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_purchase_orders_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [supplier_id] uniqueidentifier NULL,
  [store_id] nvarchar(128) NULL,
  [store_code] nvarchar(max) NULL,
  [invoice_date] date NULL,
  [invoice_entry_date] datetimeoffset(7) NULL CONSTRAINT [DF_purchase_orders_invoice_entry_date] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_purchase_orders_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_purchase_orders_row_version] DEFAULT (1),
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_purchase_orders_status] DEFAULT ('posted'),
  [reference] nvarchar(max) NULL,
  [pending_edit_request_id] uniqueidentifier NULL,
  [pending_edit_by] nvarchar(max) NULL,
  [pending_edit_at] datetimeoffset(7) NULL,
  CONSTRAINT [PK_purchase_orders] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.purchase_orders')) ALTER TABLE dbo.[purchase_orders] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.purchase_orders', N'id') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_orders', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'id'
) ALTER TABLE dbo.[purchase_orders] ADD CONSTRAINT [DF_purchase_orders_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_orders] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'po_number') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [po_number] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'po_number' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [po_number] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'supplier_name') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [supplier_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'operator_name') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [operator_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'total_cost') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [total_cost] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_orders', N'total_cost') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'total_cost'
) ALTER TABLE dbo.[purchase_orders] ADD CONSTRAINT [DF_purchase_orders_total_cost] DEFAULT (0) FOR [total_cost];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'total_cost' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_orders] SET [total_cost]=0 WHERE [total_cost] IS NULL;';
  ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [total_cost] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_orders', N'total_items_count') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [total_items_count] int NULL;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_orders', N'total_items_count') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'total_items_count'
) ALTER TABLE dbo.[purchase_orders] ADD CONSTRAINT [DF_purchase_orders_total_items_count] DEFAULT (0) FOR [total_items_count];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'total_items_count' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_orders] SET [total_items_count]=0 WHERE [total_items_count] IS NULL;';
  ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [total_items_count] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_orders', N'created_at') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_orders', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'created_at'
) ALTER TABLE dbo.[purchase_orders] ADD CONSTRAINT [DF_purchase_orders_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_orders] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_orders', N'supplier_id') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [supplier_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'supplier_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [supplier_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'store_id') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [store_id] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [store_id] nvarchar(128) NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'store_code') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [store_code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'invoice_date') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [invoice_date] date NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'invoice_entry_date') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [invoice_entry_date] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_orders', N'invoice_entry_date') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'invoice_entry_date'
) ALTER TABLE dbo.[purchase_orders] ADD CONSTRAINT [DF_purchase_orders_invoice_entry_date] DEFAULT (SYSDATETIMEOFFSET()) FOR [invoice_entry_date];

IF COL_LENGTH(N'dbo.purchase_orders', N'updated_at') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_orders', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'updated_at'
) ALTER TABLE dbo.[purchase_orders] ADD CONSTRAINT [DF_purchase_orders_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_orders] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'row_version') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_orders', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'row_version'
) ALTER TABLE dbo.[purchase_orders] ADD CONSTRAINT [DF_purchase_orders_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_orders] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_orders', N'status') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.purchase_orders', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.purchase_orders') AND c.name=N'status'
) ALTER TABLE dbo.[purchase_orders] ADD CONSTRAINT [DF_purchase_orders_status] DEFAULT ('posted') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[purchase_orders] SET [status]=''posted'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[purchase_orders] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.purchase_orders', N'reference') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [reference] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'pending_edit_request_id') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [pending_edit_request_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'pending_edit_by') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [pending_edit_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.purchase_orders', N'pending_edit_at') IS NULL ALTER TABLE dbo.[purchase_orders] ADD [pending_edit_at] datetimeoffset(7) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'UQ_purchase_orders_0') CREATE UNIQUE INDEX [UQ_purchase_orders_0] ON dbo.[purchase_orders]([store_id],[po_number]) WHERE [store_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'IX_purchase_orders_store_id') CREATE INDEX [IX_purchase_orders_store_id] ON dbo.[purchase_orders]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'IX_purchase_orders_updated_at') CREATE INDEX [IX_purchase_orders_updated_at] ON dbo.[purchase_orders]([updated_at]);

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NULL BEGIN CREATE TABLE dbo.[sale_items] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_sale_items_id] DEFAULT (NEWID()),
  [sale_id] uniqueidentifier NOT NULL,
  [product_id] uniqueidentifier NULL,
  [product_name] nvarchar(max) NOT NULL,
  [variant_code] nvarchar(max) NULL,
  [unit_price] decimal(38,12) NOT NULL CONSTRAINT [DF_sale_items_unit_price] DEFAULT (0),
  [quantity] int NOT NULL CONSTRAINT [DF_sale_items_quantity] DEFAULT (1),
  [discount_percent] decimal(38,12) NOT NULL CONSTRAINT [DF_sale_items_discount_percent] DEFAULT (0),
  [discount_amount] decimal(38,12) NOT NULL CONSTRAINT [DF_sale_items_discount_amount] DEFAULT (0),
  [is_return] bit NOT NULL CONSTRAINT [DF_sale_items_is_return] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_sale_items_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [tax_rate] decimal(38,12) NOT NULL CONSTRAINT [DF_sale_items_tax_rate] DEFAULT (0),
  [is_foc] bit NOT NULL CONSTRAINT [DF_sale_items_is_foc] DEFAULT (0),
  [promo_id] nvarchar(max) NULL,
  [coupon_code] nvarchar(max) NULL,
  [coupon_discount] decimal(38,12) NOT NULL CONSTRAINT [DF_sale_items_coupon_discount] DEFAULT (0),
  [unit_cost] decimal(38,12) NOT NULL CONSTRAINT [DF_sale_items_unit_cost] DEFAULT (0),
  [row_version] int NOT NULL CONSTRAINT [DF_sale_items_row_version] DEFAULT (1),
  [refunded_qty] int NOT NULL CONSTRAINT [DF_sale_items_refunded_qty] DEFAULT (0),
  [branch_id] nvarchar(450) NULL,
  CONSTRAINT [PK_sale_items] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.sale_items')) ALTER TABLE dbo.[sale_items] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.sale_items', N'id') IS NULL ALTER TABLE dbo.[sale_items] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'id'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sale_items] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.sale_items', N'sale_id') IS NULL ALTER TABLE dbo.[sale_items] ADD [sale_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'sale_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sale_items] ALTER COLUMN [sale_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.sale_items', N'product_id') IS NULL ALTER TABLE dbo.[sale_items] ADD [product_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'product_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sale_items] ALTER COLUMN [product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.sale_items', N'product_name') IS NULL ALTER TABLE dbo.[sale_items] ADD [product_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sale_items', N'variant_code') IS NULL ALTER TABLE dbo.[sale_items] ADD [variant_code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sale_items', N'unit_price') IS NULL ALTER TABLE dbo.[sale_items] ADD [unit_price] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'unit_price') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'unit_price'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_unit_price] DEFAULT (0) FOR [unit_price];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'unit_price' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [unit_price]=0 WHERE [unit_price] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [unit_price] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'quantity') IS NULL ALTER TABLE dbo.[sale_items] ADD [quantity] int NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'quantity') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'quantity'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_quantity] DEFAULT (1) FOR [quantity];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'quantity' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [quantity]=1 WHERE [quantity] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [quantity] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'discount_percent') IS NULL ALTER TABLE dbo.[sale_items] ADD [discount_percent] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'discount_percent') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'discount_percent'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_discount_percent] DEFAULT (0) FOR [discount_percent];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'discount_percent' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [discount_percent]=0 WHERE [discount_percent] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [discount_percent] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'discount_amount') IS NULL ALTER TABLE dbo.[sale_items] ADD [discount_amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'discount_amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'discount_amount'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_discount_amount] DEFAULT (0) FOR [discount_amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'discount_amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [discount_amount]=0 WHERE [discount_amount] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [discount_amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'is_return') IS NULL ALTER TABLE dbo.[sale_items] ADD [is_return] bit NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'is_return') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'is_return'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_is_return] DEFAULT (0) FOR [is_return];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'is_return' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [is_return]=0 WHERE [is_return] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [is_return] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'created_at') IS NULL ALTER TABLE dbo.[sale_items] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'created_at'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'tax_rate') IS NULL ALTER TABLE dbo.[sale_items] ADD [tax_rate] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'tax_rate') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'tax_rate'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_tax_rate] DEFAULT (0) FOR [tax_rate];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'tax_rate' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [tax_rate]=0 WHERE [tax_rate] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [tax_rate] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'is_foc') IS NULL ALTER TABLE dbo.[sale_items] ADD [is_foc] bit NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'is_foc') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'is_foc'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_is_foc] DEFAULT (0) FOR [is_foc];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'is_foc' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [is_foc]=0 WHERE [is_foc] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [is_foc] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'promo_id') IS NULL ALTER TABLE dbo.[sale_items] ADD [promo_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sale_items', N'coupon_code') IS NULL ALTER TABLE dbo.[sale_items] ADD [coupon_code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sale_items', N'coupon_discount') IS NULL ALTER TABLE dbo.[sale_items] ADD [coupon_discount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'coupon_discount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'coupon_discount'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_coupon_discount] DEFAULT (0) FOR [coupon_discount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'coupon_discount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [coupon_discount]=0 WHERE [coupon_discount] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [coupon_discount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'unit_cost') IS NULL ALTER TABLE dbo.[sale_items] ADD [unit_cost] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'unit_cost') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'unit_cost'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_unit_cost] DEFAULT (0) FOR [unit_cost];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'unit_cost' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [unit_cost]=0 WHERE [unit_cost] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [unit_cost] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'row_version') IS NULL ALTER TABLE dbo.[sale_items] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'row_version'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'refunded_qty') IS NULL ALTER TABLE dbo.[sale_items] ADD [refunded_qty] int NULL;

IF OBJECT_ID(N'dbo.sale_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sale_items', N'refunded_qty') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'refunded_qty'
) ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [DF_sale_items_refunded_qty] DEFAULT (0) FOR [refunded_qty];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'refunded_qty' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sale_items] SET [refunded_qty]=0 WHERE [refunded_qty] IS NULL;';
  ALTER TABLE dbo.[sale_items] ALTER COLUMN [refunded_qty] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.sale_items', N'branch_id') IS NULL ALTER TABLE dbo.[sale_items] ADD [branch_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sale_items') AND c.name=N'branch_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sale_items] ALTER COLUMN [branch_id] nvarchar(450) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'IX_sale_items_branch_id') CREATE INDEX [IX_sale_items_branch_id] ON dbo.[sale_items]([branch_id]);

IF OBJECT_ID(N'dbo.sales', N'U') IS NULL BEGIN CREATE TABLE dbo.[sales] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_sales_id] DEFAULT (NEWID()),
  [bill_number] nvarchar(450) NOT NULL,
  [member_id] uniqueidentifier NULL,
  [store_id] nvarchar(450) NULL,
  [cashier_name] nvarchar(max) NULL,
  [subtotal_amount] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_subtotal_amount] DEFAULT (0),
  [total_amount] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_total_amount] DEFAULT (0),
  [discount_amount] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_discount_amount] DEFAULT (0),
  [tax_amount] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_tax_amount] DEFAULT (0),
  [payment_type] nvarchar(max) NOT NULL CONSTRAINT [DF_sales_payment_type] DEFAULT ('cash'),
  [points_earned] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_points_earned] DEFAULT (0),
  [points_redeemed] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_points_redeemed] DEFAULT (0),
  [is_exchange] bit NOT NULL CONSTRAINT [DF_sales_is_exchange] DEFAULT (0),
  [original_bill_number] nvarchar(max) NULL,
  [is_refunded] bit NOT NULL CONSTRAINT [DF_sales_is_refunded] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_sales_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [shift_id] nvarchar(max) NULL,
  [paid_amount] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_paid_amount] DEFAULT (0),
  [change_amount] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_change_amount] DEFAULT (0),
  [exchange_credit] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_exchange_credit] DEFAULT (0),
  [exchanged_to_bill_number] nvarchar(max) NULL,
  [coupon_code] nvarchar(max) NULL,
  [coupon_promo_id] nvarchar(max) NULL,
  [coupon_scope] nvarchar(max) NULL,
  [coupon_discount] decimal(38,12) NOT NULL CONSTRAINT [DF_sales_coupon_discount] DEFAULT (0),
  [payments] nvarchar(max) NOT NULL CONSTRAINT [DF_sales_payments] DEFAULT (N'[]'),
  [client_transaction_id] nvarchar(450) NULL,
  [cashier_id] nvarchar(max) NULL,
  [created_by] nvarchar(max) NULL,
  [updated_by] nvarchar(max) NULL,
  [row_version] int NOT NULL CONSTRAINT [DF_sales_row_version] DEFAULT (1),
  [store_name_snapshot] nvarchar(max) NULL,
  [store_address_snapshot] nvarchar(max) NULL,
  [authorization_request_id] uniqueidentifier NULL,
  [authorized_by] nvarchar(max) NULL,
  [authorized_at] datetimeoffset(7) NULL,
  [rounding_adjustment] decimal(18,4) NOT NULL CONSTRAINT [DF_sales_rounding_adjustment] DEFAULT (0),
  [rounding_label] nvarchar(max) NULL,
  [branch_id] nvarchar(450) NULL,
  CONSTRAINT [PK_sales] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.sales')) ALTER TABLE dbo.[sales] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.sales', N'id') IS NULL ALTER TABLE dbo.[sales] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'id'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sales] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.sales', N'bill_number') IS NULL ALTER TABLE dbo.[sales] ADD [bill_number] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'bill_number' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sales] ALTER COLUMN [bill_number] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.sales', N'member_id') IS NULL ALTER TABLE dbo.[sales] ADD [member_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'member_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sales] ALTER COLUMN [member_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.sales', N'store_id') IS NULL ALTER TABLE dbo.[sales] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sales] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.sales', N'cashier_name') IS NULL ALTER TABLE dbo.[sales] ADD [cashier_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'subtotal_amount') IS NULL ALTER TABLE dbo.[sales] ADD [subtotal_amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'subtotal_amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'subtotal_amount'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_subtotal_amount] DEFAULT (0) FOR [subtotal_amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'subtotal_amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [subtotal_amount]=0 WHERE [subtotal_amount] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [subtotal_amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'total_amount') IS NULL ALTER TABLE dbo.[sales] ADD [total_amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'total_amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'total_amount'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_total_amount] DEFAULT (0) FOR [total_amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'total_amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [total_amount]=0 WHERE [total_amount] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [total_amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'discount_amount') IS NULL ALTER TABLE dbo.[sales] ADD [discount_amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'discount_amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'discount_amount'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_discount_amount] DEFAULT (0) FOR [discount_amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'discount_amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [discount_amount]=0 WHERE [discount_amount] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [discount_amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'tax_amount') IS NULL ALTER TABLE dbo.[sales] ADD [tax_amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'tax_amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'tax_amount'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_tax_amount] DEFAULT (0) FOR [tax_amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'tax_amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [tax_amount]=0 WHERE [tax_amount] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [tax_amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'payment_type') IS NULL ALTER TABLE dbo.[sales] ADD [payment_type] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'payment_type') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'payment_type'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_payment_type] DEFAULT ('cash') FOR [payment_type];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'payment_type' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [payment_type]=''cash'' WHERE [payment_type] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [payment_type] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'points_earned') IS NULL ALTER TABLE dbo.[sales] ADD [points_earned] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'points_earned') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'points_earned'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_points_earned] DEFAULT (0) FOR [points_earned];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'points_earned' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [points_earned]=0 WHERE [points_earned] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [points_earned] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'points_redeemed') IS NULL ALTER TABLE dbo.[sales] ADD [points_redeemed] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'points_redeemed') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'points_redeemed'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_points_redeemed] DEFAULT (0) FOR [points_redeemed];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'points_redeemed' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [points_redeemed]=0 WHERE [points_redeemed] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [points_redeemed] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'is_exchange') IS NULL ALTER TABLE dbo.[sales] ADD [is_exchange] bit NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'is_exchange') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'is_exchange'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_is_exchange] DEFAULT (0) FOR [is_exchange];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'is_exchange' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [is_exchange]=0 WHERE [is_exchange] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [is_exchange] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'original_bill_number') IS NULL ALTER TABLE dbo.[sales] ADD [original_bill_number] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'is_refunded') IS NULL ALTER TABLE dbo.[sales] ADD [is_refunded] bit NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'is_refunded') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'is_refunded'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_is_refunded] DEFAULT (0) FOR [is_refunded];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'is_refunded' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [is_refunded]=0 WHERE [is_refunded] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [is_refunded] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'created_at') IS NULL ALTER TABLE dbo.[sales] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'created_at'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'shift_id') IS NULL ALTER TABLE dbo.[sales] ADD [shift_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'paid_amount') IS NULL ALTER TABLE dbo.[sales] ADD [paid_amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'paid_amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'paid_amount'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_paid_amount] DEFAULT (0) FOR [paid_amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'paid_amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [paid_amount]=0 WHERE [paid_amount] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [paid_amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'change_amount') IS NULL ALTER TABLE dbo.[sales] ADD [change_amount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'change_amount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'change_amount'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_change_amount] DEFAULT (0) FOR [change_amount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'change_amount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [change_amount]=0 WHERE [change_amount] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [change_amount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'exchange_credit') IS NULL ALTER TABLE dbo.[sales] ADD [exchange_credit] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'exchange_credit') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'exchange_credit'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_exchange_credit] DEFAULT (0) FOR [exchange_credit];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'exchange_credit' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [exchange_credit]=0 WHERE [exchange_credit] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [exchange_credit] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'exchanged_to_bill_number') IS NULL ALTER TABLE dbo.[sales] ADD [exchanged_to_bill_number] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'coupon_code') IS NULL ALTER TABLE dbo.[sales] ADD [coupon_code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'coupon_promo_id') IS NULL ALTER TABLE dbo.[sales] ADD [coupon_promo_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'coupon_scope') IS NULL ALTER TABLE dbo.[sales] ADD [coupon_scope] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'coupon_discount') IS NULL ALTER TABLE dbo.[sales] ADD [coupon_discount] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'coupon_discount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'coupon_discount'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_coupon_discount] DEFAULT (0) FOR [coupon_discount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'coupon_discount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [coupon_discount]=0 WHERE [coupon_discount] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [coupon_discount] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'payments') IS NULL ALTER TABLE dbo.[sales] ADD [payments] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'payments') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'payments'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_payments] DEFAULT (N'[]') FOR [payments];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'payments' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [payments]=N''[]'' WHERE [payments] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [payments] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'client_transaction_id') IS NULL ALTER TABLE dbo.[sales] ADD [client_transaction_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'client_transaction_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sales] ALTER COLUMN [client_transaction_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.sales', N'cashier_id') IS NULL ALTER TABLE dbo.[sales] ADD [cashier_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'created_by') IS NULL ALTER TABLE dbo.[sales] ADD [created_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'updated_by') IS NULL ALTER TABLE dbo.[sales] ADD [updated_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'row_version') IS NULL ALTER TABLE dbo.[sales] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'row_version'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'store_name_snapshot') IS NULL ALTER TABLE dbo.[sales] ADD [store_name_snapshot] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'store_address_snapshot') IS NULL ALTER TABLE dbo.[sales] ADD [store_address_snapshot] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'authorization_request_id') IS NULL ALTER TABLE dbo.[sales] ADD [authorization_request_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.sales', N'authorized_by') IS NULL ALTER TABLE dbo.[sales] ADD [authorized_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'authorized_at') IS NULL ALTER TABLE dbo.[sales] ADD [authorized_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.sales', N'rounding_adjustment') IS NULL ALTER TABLE dbo.[sales] ADD [rounding_adjustment] decimal(18,4) NULL;

IF OBJECT_ID(N'dbo.sales', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sales', N'rounding_adjustment') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'rounding_adjustment'
) ALTER TABLE dbo.[sales] ADD CONSTRAINT [DF_sales_rounding_adjustment] DEFAULT (0) FOR [rounding_adjustment];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'rounding_adjustment' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sales] SET [rounding_adjustment]=0 WHERE [rounding_adjustment] IS NULL;';
  ALTER TABLE dbo.[sales] ALTER COLUMN [rounding_adjustment] decimal(18,4) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sales', N'rounding_label') IS NULL ALTER TABLE dbo.[sales] ADD [rounding_label] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sales', N'branch_id') IS NULL ALTER TABLE dbo.[sales] ADD [branch_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sales') AND c.name=N'branch_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sales] ALTER COLUMN [branch_id] nvarchar(450) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'UX_sales_bill_number') CREATE UNIQUE INDEX [UX_sales_bill_number] ON dbo.[sales]([bill_number]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'UX_sales_client_transaction_id') CREATE UNIQUE INDEX [UX_sales_client_transaction_id] ON dbo.[sales]([client_transaction_id]) WHERE [client_transaction_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'IX_sales_store_id') CREATE INDEX [IX_sales_store_id] ON dbo.[sales]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sales') AND name=N'IX_sales_branch_id') CREATE INDEX [IX_sales_branch_id] ON dbo.[sales]([branch_id]);

IF OBJECT_ID(N'dbo.secure_settings', N'U') IS NULL BEGIN CREATE TABLE dbo.[secure_settings] (

  [key] nvarchar(450) NOT NULL,
  [ciphertext] nvarchar(max) NOT NULL,
  [hint] nvarchar(max) NULL,
  [updated_by] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_secure_settings_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_secure_settings_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_secure_settings] PRIMARY KEY ([key])

); END;

IF OBJECT_ID(N'dbo.secure_settings', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.secure_settings')) ALTER TABLE dbo.[secure_settings] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.secure_settings', N'key') IS NULL ALTER TABLE dbo.[secure_settings] ADD [key] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.secure_settings') AND c.name=N'key' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[secure_settings] ALTER COLUMN [key] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.secure_settings', N'ciphertext') IS NULL ALTER TABLE dbo.[secure_settings] ADD [ciphertext] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.secure_settings', N'hint') IS NULL ALTER TABLE dbo.[secure_settings] ADD [hint] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.secure_settings', N'updated_by') IS NULL ALTER TABLE dbo.[secure_settings] ADD [updated_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.secure_settings', N'created_at') IS NULL ALTER TABLE dbo.[secure_settings] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.secure_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.secure_settings', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.secure_settings') AND c.name=N'created_at'
) ALTER TABLE dbo.[secure_settings] ADD CONSTRAINT [DF_secure_settings_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.secure_settings') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[secure_settings] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[secure_settings] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.secure_settings', N'updated_at') IS NULL ALTER TABLE dbo.[secure_settings] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.secure_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.secure_settings', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.secure_settings') AND c.name=N'updated_at'
) ALTER TABLE dbo.[secure_settings] ADD CONSTRAINT [DF_secure_settings_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.secure_settings') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[secure_settings] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[secure_settings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.secure_settings') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[secure_settings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.secure_settings') AND name=N'IX_secure_settings_updated_at') CREATE INDEX [IX_secure_settings_updated_at] ON dbo.[secure_settings]([updated_at]);

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NULL BEGIN CREATE TABLE dbo.[security_findings] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_security_findings_id] DEFAULT (NEWID()),
  [fingerprint] nvarchar(450) NOT NULL,
  [source] nvarchar(max) NOT NULL,
  [severity] nvarchar(max) NOT NULL CONSTRAINT [DF_security_findings_severity] DEFAULT ('medium'),
  [title] nvarchar(max) NOT NULL,
  [detail] nvarchar(max) NOT NULL CONSTRAINT [DF_security_findings_detail] DEFAULT (''),
  [deployment_ref] nvarchar(max) NULL,
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_security_findings_status] DEFAULT ('open'),
  [first_seen_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_security_findings_first_seen_at] DEFAULT (SYSDATETIMEOFFSET()),
  [last_seen_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_security_findings_last_seen_at] DEFAULT (SYSDATETIMEOFFSET()),
  [acknowledged_by] nvarchar(max) NULL,
  [acknowledged_at] datetimeoffset(7) NULL,
  [resolved_at] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_security_findings_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_security_findings_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_security_findings] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.security_findings')) ALTER TABLE dbo.[security_findings] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.security_findings', N'id') IS NULL ALTER TABLE dbo.[security_findings] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.security_findings', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'id'
) ALTER TABLE dbo.[security_findings] ADD CONSTRAINT [DF_security_findings_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[security_findings] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[security_findings] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[security_findings] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.security_findings', N'fingerprint') IS NULL ALTER TABLE dbo.[security_findings] ADD [fingerprint] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'fingerprint' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[security_findings] ALTER COLUMN [fingerprint] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.security_findings', N'source') IS NULL ALTER TABLE dbo.[security_findings] ADD [source] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.security_findings', N'severity') IS NULL ALTER TABLE dbo.[security_findings] ADD [severity] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.security_findings', N'severity') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'severity'
) ALTER TABLE dbo.[security_findings] ADD CONSTRAINT [DF_security_findings_severity] DEFAULT ('medium') FOR [severity];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'severity' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[security_findings] SET [severity]=''medium'' WHERE [severity] IS NULL;';
  ALTER TABLE dbo.[security_findings] ALTER COLUMN [severity] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.security_findings', N'title') IS NULL ALTER TABLE dbo.[security_findings] ADD [title] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.security_findings', N'detail') IS NULL ALTER TABLE dbo.[security_findings] ADD [detail] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.security_findings', N'detail') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'detail'
) ALTER TABLE dbo.[security_findings] ADD CONSTRAINT [DF_security_findings_detail] DEFAULT ('') FOR [detail];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'detail' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[security_findings] SET [detail]='''' WHERE [detail] IS NULL;';
  ALTER TABLE dbo.[security_findings] ALTER COLUMN [detail] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.security_findings', N'deployment_ref') IS NULL ALTER TABLE dbo.[security_findings] ADD [deployment_ref] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.security_findings', N'status') IS NULL ALTER TABLE dbo.[security_findings] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.security_findings', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'status'
) ALTER TABLE dbo.[security_findings] ADD CONSTRAINT [DF_security_findings_status] DEFAULT ('open') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[security_findings] SET [status]=''open'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[security_findings] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.security_findings', N'first_seen_at') IS NULL ALTER TABLE dbo.[security_findings] ADD [first_seen_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.security_findings', N'first_seen_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'first_seen_at'
) ALTER TABLE dbo.[security_findings] ADD CONSTRAINT [DF_security_findings_first_seen_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [first_seen_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'first_seen_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[security_findings] SET [first_seen_at]=SYSDATETIMEOFFSET() WHERE [first_seen_at] IS NULL;';
  ALTER TABLE dbo.[security_findings] ALTER COLUMN [first_seen_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.security_findings', N'last_seen_at') IS NULL ALTER TABLE dbo.[security_findings] ADD [last_seen_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.security_findings', N'last_seen_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'last_seen_at'
) ALTER TABLE dbo.[security_findings] ADD CONSTRAINT [DF_security_findings_last_seen_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [last_seen_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'last_seen_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[security_findings] SET [last_seen_at]=SYSDATETIMEOFFSET() WHERE [last_seen_at] IS NULL;';
  ALTER TABLE dbo.[security_findings] ALTER COLUMN [last_seen_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.security_findings', N'acknowledged_by') IS NULL ALTER TABLE dbo.[security_findings] ADD [acknowledged_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.security_findings', N'acknowledged_at') IS NULL ALTER TABLE dbo.[security_findings] ADD [acknowledged_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.security_findings', N'resolved_at') IS NULL ALTER TABLE dbo.[security_findings] ADD [resolved_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.security_findings', N'created_at') IS NULL ALTER TABLE dbo.[security_findings] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.security_findings', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'created_at'
) ALTER TABLE dbo.[security_findings] ADD CONSTRAINT [DF_security_findings_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[security_findings] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[security_findings] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.security_findings', N'updated_at') IS NULL ALTER TABLE dbo.[security_findings] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.security_findings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.security_findings', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'updated_at'
) ALTER TABLE dbo.[security_findings] ADD CONSTRAINT [DF_security_findings_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[security_findings] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[security_findings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.security_findings') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[security_findings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'UX_security_findings_fingerprint') CREATE UNIQUE INDEX [UX_security_findings_fingerprint] ON dbo.[security_findings]([fingerprint]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.security_findings') AND name=N'IX_security_findings_updated_at') CREATE INDEX [IX_security_findings_updated_at] ON dbo.[security_findings]([updated_at]);

IF OBJECT_ID(N'dbo.settings_locks', N'U') IS NULL BEGIN CREATE TABLE dbo.[settings_locks] (

  [section] nvarchar(450) NOT NULL,
  [locked] bit NOT NULL CONSTRAINT [DF_settings_locks_locked] DEFAULT (0),
  [updated_by] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_settings_locks_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_settings_locks_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_settings_locks] PRIMARY KEY ([section])

); END;

IF OBJECT_ID(N'dbo.settings_locks', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.settings_locks')) ALTER TABLE dbo.[settings_locks] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.settings_locks', N'section') IS NULL ALTER TABLE dbo.[settings_locks] ADD [section] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_locks') AND c.name=N'section' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_locks] ALTER COLUMN [section] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.settings_locks', N'locked') IS NULL ALTER TABLE dbo.[settings_locks] ADD [locked] bit NULL;

IF OBJECT_ID(N'dbo.settings_locks', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_locks', N'locked') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_locks') AND c.name=N'locked'
) ALTER TABLE dbo.[settings_locks] ADD CONSTRAINT [DF_settings_locks_locked] DEFAULT (0) FOR [locked];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_locks') AND name=N'locked' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_locks] SET [locked]=0 WHERE [locked] IS NULL;';
  ALTER TABLE dbo.[settings_locks] ALTER COLUMN [locked] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.settings_locks', N'updated_by') IS NULL ALTER TABLE dbo.[settings_locks] ADD [updated_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.settings_locks', N'created_at') IS NULL ALTER TABLE dbo.[settings_locks] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.settings_locks', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_locks', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_locks') AND c.name=N'created_at'
) ALTER TABLE dbo.[settings_locks] ADD CONSTRAINT [DF_settings_locks_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_locks') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_locks] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[settings_locks] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.settings_locks', N'updated_at') IS NULL ALTER TABLE dbo.[settings_locks] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.settings_locks', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_locks', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_locks') AND c.name=N'updated_at'
) ALTER TABLE dbo.[settings_locks] ADD CONSTRAINT [DF_settings_locks_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_locks') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_locks] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[settings_locks] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_locks') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_locks] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.settings_locks') AND name=N'IX_settings_locks_updated_at') CREATE INDEX [IX_settings_locks_updated_at] ON dbo.[settings_locks]([updated_at]);

IF OBJECT_ID(N'dbo.settings_overrides', N'U') IS NULL BEGIN CREATE TABLE dbo.[settings_overrides] (

  [scope] nvarchar(128) NOT NULL CONSTRAINT [DF_settings_overrides_scope] DEFAULT ('BRANCH'),
  [scope_id] nvarchar(128) NOT NULL CONSTRAINT [DF_settings_overrides_scope_id] DEFAULT (''),
  [section] nvarchar(128) NOT NULL,
  [patch] nvarchar(max) NOT NULL CONSTRAINT [DF_settings_overrides_patch] DEFAULT (N'{}'),
  [updated_by] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_settings_overrides_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_settings_overrides_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_settings_overrides_row_version] DEFAULT (1),
  CONSTRAINT [PK_settings_overrides] PRIMARY KEY ([scope], [scope_id], [section])

); END;

IF OBJECT_ID(N'dbo.settings_overrides', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.settings_overrides')) ALTER TABLE dbo.[settings_overrides] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.settings_overrides', N'scope') IS NULL ALTER TABLE dbo.[settings_overrides] ADD [scope] nvarchar(128) NULL;

IF OBJECT_ID(N'dbo.settings_overrides', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_overrides', N'scope') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'scope'
) ALTER TABLE dbo.[settings_overrides] ADD CONSTRAINT [DF_settings_overrides_scope] DEFAULT ('BRANCH') FOR [scope];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_overrides') AND name=N'scope' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_overrides] SET [scope]=''BRANCH'' WHERE [scope] IS NULL;';
  ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [scope] nvarchar(128) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'scope' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [scope] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.settings_overrides', N'scope_id') IS NULL ALTER TABLE dbo.[settings_overrides] ADD [scope_id] nvarchar(128) NULL;

IF OBJECT_ID(N'dbo.settings_overrides', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_overrides', N'scope_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'scope_id'
) ALTER TABLE dbo.[settings_overrides] ADD CONSTRAINT [DF_settings_overrides_scope_id] DEFAULT ('') FOR [scope_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_overrides') AND name=N'scope_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_overrides] SET [scope_id]='''' WHERE [scope_id] IS NULL;';
  ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [scope_id] nvarchar(128) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'scope_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [scope_id] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.settings_overrides', N'section') IS NULL ALTER TABLE dbo.[settings_overrides] ADD [section] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'section' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [section] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.settings_overrides', N'patch') IS NULL ALTER TABLE dbo.[settings_overrides] ADD [patch] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.settings_overrides', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_overrides', N'patch') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'patch'
) ALTER TABLE dbo.[settings_overrides] ADD CONSTRAINT [DF_settings_overrides_patch] DEFAULT (N'{}') FOR [patch];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_overrides') AND name=N'patch' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_overrides] SET [patch]=N''{}'' WHERE [patch] IS NULL;';
  ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [patch] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.settings_overrides', N'updated_by') IS NULL ALTER TABLE dbo.[settings_overrides] ADD [updated_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.settings_overrides', N'created_at') IS NULL ALTER TABLE dbo.[settings_overrides] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.settings_overrides', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_overrides', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'created_at'
) ALTER TABLE dbo.[settings_overrides] ADD CONSTRAINT [DF_settings_overrides_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_overrides') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_overrides] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.settings_overrides', N'updated_at') IS NULL ALTER TABLE dbo.[settings_overrides] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.settings_overrides', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_overrides', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'updated_at'
) ALTER TABLE dbo.[settings_overrides] ADD CONSTRAINT [DF_settings_overrides_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_overrides') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_overrides] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.settings_overrides', N'row_version') IS NULL ALTER TABLE dbo.[settings_overrides] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.settings_overrides', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_overrides', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_overrides') AND c.name=N'row_version'
) ALTER TABLE dbo.[settings_overrides] ADD CONSTRAINT [DF_settings_overrides_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_overrides') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_overrides] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[settings_overrides] ALTER COLUMN [row_version] int NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.settings_overrides') AND name=N'IX_settings_overrides_updated_at') CREATE INDEX [IX_settings_overrides_updated_at] ON dbo.[settings_overrides]([updated_at]);

IF OBJECT_ID(N'dbo.shift_sessions', N'U') IS NULL BEGIN CREATE TABLE dbo.[shift_sessions] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_shift_sessions_id] DEFAULT (NEWID()),
  [shift_id] nvarchar(max) NULL,
  [store_id] nvarchar(450) NOT NULL,
  [terminal_id] nvarchar(max) NULL,
  [terminal_name] nvarchar(max) NULL,
  [staff_id] nvarchar(max) NULL,
  [staff_name] nvarchar(max) NOT NULL,
  [role] nvarchar(max) NULL,
  [signed_in_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shift_sessions_signed_in_at] DEFAULT (SYSDATETIMEOFFSET()),
  [signed_out_at] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shift_sessions_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shift_sessions_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_shift_sessions_row_version] DEFAULT (1),
  CONSTRAINT [PK_shift_sessions] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.shift_sessions', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.shift_sessions')) ALTER TABLE dbo.[shift_sessions] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.shift_sessions', N'id') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.shift_sessions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_sessions', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_sessions') AND c.name=N'id'
) ALTER TABLE dbo.[shift_sessions] ADD CONSTRAINT [DF_shift_sessions_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_sessions') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_sessions] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[shift_sessions] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_sessions') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_sessions] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'shift_id') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [shift_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'store_id') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_sessions') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_sessions] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'terminal_id') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'terminal_name') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [terminal_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'staff_id') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'staff_name') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [staff_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'role') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'signed_in_at') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [signed_in_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shift_sessions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_sessions', N'signed_in_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_sessions') AND c.name=N'signed_in_at'
) ALTER TABLE dbo.[shift_sessions] ADD CONSTRAINT [DF_shift_sessions_signed_in_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [signed_in_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_sessions') AND name=N'signed_in_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_sessions] SET [signed_in_at]=SYSDATETIMEOFFSET() WHERE [signed_in_at] IS NULL;';
  ALTER TABLE dbo.[shift_sessions] ALTER COLUMN [signed_in_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_sessions', N'signed_out_at') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [signed_out_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'created_at') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shift_sessions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_sessions', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_sessions') AND c.name=N'created_at'
) ALTER TABLE dbo.[shift_sessions] ADD CONSTRAINT [DF_shift_sessions_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_sessions') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_sessions] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[shift_sessions] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_sessions', N'updated_at') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shift_sessions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_sessions', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_sessions') AND c.name=N'updated_at'
) ALTER TABLE dbo.[shift_sessions] ADD CONSTRAINT [DF_shift_sessions_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_sessions') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_sessions] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[shift_sessions] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_sessions') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_sessions] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.shift_sessions', N'row_version') IS NULL ALTER TABLE dbo.[shift_sessions] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.shift_sessions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_sessions', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_sessions') AND c.name=N'row_version'
) ALTER TABLE dbo.[shift_sessions] ADD CONSTRAINT [DF_shift_sessions_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_sessions') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_sessions] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[shift_sessions] ALTER COLUMN [row_version] int NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_sessions') AND name=N'IX_shift_sessions_store_id') CREATE INDEX [IX_shift_sessions_store_id] ON dbo.[shift_sessions]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_sessions') AND name=N'IX_shift_sessions_updated_at') CREATE INDEX [IX_shift_sessions_updated_at] ON dbo.[shift_sessions]([updated_at]);

IF OBJECT_ID(N'dbo.sku_audit', N'U') IS NULL BEGIN CREATE TABLE dbo.[sku_audit] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_sku_audit_id] DEFAULT (NEWID()),
  [sku] nvarchar(max) NOT NULL,
  [product_id] uniqueidentifier NULL,
  [product_name] nvarchar(max) NULL,
  [source] nvarchar(max) NOT NULL CONSTRAINT [DF_sku_audit_source] DEFAULT ('auto'),
  [previous_sku] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [store_name] nvarchar(max) NULL,
  [terminal_id] nvarchar(max) NULL,
  [staff_id] nvarchar(max) NULL,
  [staff_name] nvarchar(max) NULL,
  [role] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_sku_audit_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_sku_audit] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.sku_audit', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.sku_audit')) ALTER TABLE dbo.[sku_audit] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.sku_audit', N'id') IS NULL ALTER TABLE dbo.[sku_audit] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.sku_audit', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sku_audit', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sku_audit') AND c.name=N'id'
) ALTER TABLE dbo.[sku_audit] ADD CONSTRAINT [DF_sku_audit_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sku_audit') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sku_audit] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[sku_audit] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sku_audit') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sku_audit] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'sku') IS NULL ALTER TABLE dbo.[sku_audit] ADD [sku] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'product_id') IS NULL ALTER TABLE dbo.[sku_audit] ADD [product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'product_name') IS NULL ALTER TABLE dbo.[sku_audit] ADD [product_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'source') IS NULL ALTER TABLE dbo.[sku_audit] ADD [source] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.sku_audit', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sku_audit', N'source') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sku_audit') AND c.name=N'source'
) ALTER TABLE dbo.[sku_audit] ADD CONSTRAINT [DF_sku_audit_source] DEFAULT ('auto') FOR [source];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sku_audit') AND name=N'source' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sku_audit] SET [source]=''auto'' WHERE [source] IS NULL;';
  ALTER TABLE dbo.[sku_audit] ALTER COLUMN [source] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sku_audit', N'previous_sku') IS NULL ALTER TABLE dbo.[sku_audit] ADD [previous_sku] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'store_id') IS NULL ALTER TABLE dbo.[sku_audit] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sku_audit') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sku_audit] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'store_name') IS NULL ALTER TABLE dbo.[sku_audit] ADD [store_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'terminal_id') IS NULL ALTER TABLE dbo.[sku_audit] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'staff_id') IS NULL ALTER TABLE dbo.[sku_audit] ADD [staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'staff_name') IS NULL ALTER TABLE dbo.[sku_audit] ADD [staff_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'role') IS NULL ALTER TABLE dbo.[sku_audit] ADD [role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sku_audit', N'created_at') IS NULL ALTER TABLE dbo.[sku_audit] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.sku_audit', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sku_audit', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sku_audit') AND c.name=N'created_at'
) ALTER TABLE dbo.[sku_audit] ADD CONSTRAINT [DF_sku_audit_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sku_audit') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sku_audit] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[sku_audit] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sku_audit') AND name=N'IX_sku_audit_store_id') CREATE INDEX [IX_sku_audit_store_id] ON dbo.[sku_audit]([store_id]);

IF OBJECT_ID(N'dbo.staff_roles', N'U') IS NULL BEGIN CREATE TABLE dbo.[staff_roles] (

  [slug] nvarchar(450) NOT NULL,
  [name] nvarchar(max) NOT NULL,
  [base_level] nvarchar(max) NOT NULL CONSTRAINT [DF_staff_roles_base_level] DEFAULT ('cashier'),
  [permissions] nvarchar(max) NOT NULL CONSTRAINT [DF_staff_roles_permissions] DEFAULT (N'{}'),
  [is_core] bit NOT NULL CONSTRAINT [DF_staff_roles_is_core] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_staff_roles_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_staff_roles_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_staff_roles] PRIMARY KEY ([slug])

); END;

IF OBJECT_ID(N'dbo.staff_roles', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.staff_roles')) ALTER TABLE dbo.[staff_roles] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.staff_roles', N'slug') IS NULL ALTER TABLE dbo.[staff_roles] ADD [slug] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.staff_roles') AND c.name=N'slug' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[staff_roles] ALTER COLUMN [slug] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.staff_roles', N'name') IS NULL ALTER TABLE dbo.[staff_roles] ADD [name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.staff_roles', N'base_level') IS NULL ALTER TABLE dbo.[staff_roles] ADD [base_level] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.staff_roles', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.staff_roles', N'base_level') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.staff_roles') AND c.name=N'base_level'
) ALTER TABLE dbo.[staff_roles] ADD CONSTRAINT [DF_staff_roles_base_level] DEFAULT ('cashier') FOR [base_level];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.staff_roles') AND name=N'base_level' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[staff_roles] SET [base_level]=''cashier'' WHERE [base_level] IS NULL;';
  ALTER TABLE dbo.[staff_roles] ALTER COLUMN [base_level] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.staff_roles', N'permissions') IS NULL ALTER TABLE dbo.[staff_roles] ADD [permissions] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.staff_roles', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.staff_roles', N'permissions') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.staff_roles') AND c.name=N'permissions'
) ALTER TABLE dbo.[staff_roles] ADD CONSTRAINT [DF_staff_roles_permissions] DEFAULT (N'{}') FOR [permissions];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.staff_roles') AND name=N'permissions' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[staff_roles] SET [permissions]=N''{}'' WHERE [permissions] IS NULL;';
  ALTER TABLE dbo.[staff_roles] ALTER COLUMN [permissions] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.staff_roles', N'is_core') IS NULL ALTER TABLE dbo.[staff_roles] ADD [is_core] bit NULL;

IF OBJECT_ID(N'dbo.staff_roles', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.staff_roles', N'is_core') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.staff_roles') AND c.name=N'is_core'
) ALTER TABLE dbo.[staff_roles] ADD CONSTRAINT [DF_staff_roles_is_core] DEFAULT (0) FOR [is_core];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.staff_roles') AND name=N'is_core' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[staff_roles] SET [is_core]=0 WHERE [is_core] IS NULL;';
  ALTER TABLE dbo.[staff_roles] ALTER COLUMN [is_core] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.staff_roles', N'created_at') IS NULL ALTER TABLE dbo.[staff_roles] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.staff_roles', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.staff_roles', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.staff_roles') AND c.name=N'created_at'
) ALTER TABLE dbo.[staff_roles] ADD CONSTRAINT [DF_staff_roles_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.staff_roles') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[staff_roles] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[staff_roles] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.staff_roles', N'updated_at') IS NULL ALTER TABLE dbo.[staff_roles] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.staff_roles', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.staff_roles', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.staff_roles') AND c.name=N'updated_at'
) ALTER TABLE dbo.[staff_roles] ADD CONSTRAINT [DF_staff_roles_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.staff_roles') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[staff_roles] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[staff_roles] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.staff_roles') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[staff_roles] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.staff_roles') AND name=N'IX_staff_roles_updated_at') CREATE INDEX [IX_staff_roles_updated_at] ON dbo.[staff_roles]([updated_at]);

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NULL BEGIN CREATE TABLE dbo.[stock_adjustments] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_stock_adjustments_id] DEFAULT (NEWID()),
  [product_id] uniqueidentifier NULL,
  [product_name] nvarchar(max) NULL,
  [sku] nvarchar(max) NULL,
  [barcode] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [terminal_id] nvarchar(max) NULL,
  [reason] nvarchar(max) NOT NULL CONSTRAINT [DF_stock_adjustments_reason] DEFAULT ('manual'),
  [note] nvarchar(max) NOT NULL CONSTRAINT [DF_stock_adjustments_note] DEFAULT (''),
  [previous_stock] int NOT NULL CONSTRAINT [DF_stock_adjustments_previous_stock] DEFAULT (0),
  [updated_stock] int NOT NULL CONSTRAINT [DF_stock_adjustments_updated_stock] DEFAULT (0),
  [delta] int NOT NULL CONSTRAINT [DF_stock_adjustments_delta] DEFAULT (0),
  [cost_impact] decimal(38,12) NOT NULL CONSTRAINT [DF_stock_adjustments_cost_impact] DEFAULT (0),
  [staff_id] nvarchar(max) NULL,
  [staff_name] nvarchar(max) NULL,
  [role] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_stock_adjustments_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_stock_adjustments_row_version] DEFAULT (1),
  [draft_id] uniqueidentifier NULL,
  CONSTRAINT [PK_stock_adjustments] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments')) ALTER TABLE dbo.[stock_adjustments] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.stock_adjustments', N'id') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_adjustments', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'id'
) ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [DF_stock_adjustments_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_adjustments] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'product_id') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [product_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'product_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'product_name') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [product_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'sku') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [sku] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'barcode') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [barcode] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'store_id') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'terminal_id') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'reason') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [reason] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_adjustments', N'reason') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'reason'
) ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [DF_stock_adjustments_reason] DEFAULT ('manual') FOR [reason];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'reason' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_adjustments] SET [reason]=''manual'' WHERE [reason] IS NULL;';
  ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [reason] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_adjustments', N'note') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [note] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_adjustments', N'note') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'note'
) ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [DF_stock_adjustments_note] DEFAULT ('') FOR [note];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'note' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_adjustments] SET [note]='''' WHERE [note] IS NULL;';
  ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [note] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_adjustments', N'previous_stock') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [previous_stock] int NULL;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_adjustments', N'previous_stock') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'previous_stock'
) ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [DF_stock_adjustments_previous_stock] DEFAULT (0) FOR [previous_stock];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'previous_stock' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_adjustments] SET [previous_stock]=0 WHERE [previous_stock] IS NULL;';
  ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [previous_stock] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_adjustments', N'updated_stock') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [updated_stock] int NULL;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_adjustments', N'updated_stock') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'updated_stock'
) ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [DF_stock_adjustments_updated_stock] DEFAULT (0) FOR [updated_stock];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'updated_stock' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_adjustments] SET [updated_stock]=0 WHERE [updated_stock] IS NULL;';
  ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [updated_stock] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_adjustments', N'delta') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [delta] int NULL;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_adjustments', N'delta') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'delta'
) ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [DF_stock_adjustments_delta] DEFAULT (0) FOR [delta];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'delta' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_adjustments] SET [delta]=0 WHERE [delta] IS NULL;';
  ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [delta] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_adjustments', N'cost_impact') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [cost_impact] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_adjustments', N'cost_impact') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'cost_impact'
) ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [DF_stock_adjustments_cost_impact] DEFAULT (0) FOR [cost_impact];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'cost_impact' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_adjustments] SET [cost_impact]=0 WHERE [cost_impact] IS NULL;';
  ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [cost_impact] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_adjustments', N'staff_id') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'staff_name') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [staff_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'role') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_adjustments', N'created_at') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_adjustments', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'created_at'
) ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [DF_stock_adjustments_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_adjustments] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_adjustments', N'row_version') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.stock_adjustments', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_adjustments', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND c.name=N'row_version'
) ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [DF_stock_adjustments_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_adjustments] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[stock_adjustments] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_adjustments', N'draft_id') IS NULL ALTER TABLE dbo.[stock_adjustments] ADD [draft_id] uniqueidentifier NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'IX_stock_adjustments_store_id') CREATE INDEX [IX_stock_adjustments_store_id] ON dbo.[stock_adjustments]([store_id]);

IF OBJECT_ID(N'dbo.stock_delta_applied', N'U') IS NULL BEGIN CREATE TABLE dbo.[stock_delta_applied] (

  [movement_id] uniqueidentifier NOT NULL,
  [product_id] uniqueidentifier NULL,
  [store_id] nvarchar(450) NULL,
  [delta] int NOT NULL CONSTRAINT [DF_stock_delta_applied_delta] DEFAULT (0),
  [applied_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_stock_delta_applied_applied_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_stock_delta_applied] PRIMARY KEY ([movement_id])

); END;

IF OBJECT_ID(N'dbo.stock_delta_applied', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.stock_delta_applied')) ALTER TABLE dbo.[stock_delta_applied] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.stock_delta_applied', N'movement_id') IS NULL ALTER TABLE dbo.[stock_delta_applied] ADD [movement_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_delta_applied') AND c.name=N'movement_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_delta_applied] ALTER COLUMN [movement_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.stock_delta_applied', N'product_id') IS NULL ALTER TABLE dbo.[stock_delta_applied] ADD [product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.stock_delta_applied', N'store_id') IS NULL ALTER TABLE dbo.[stock_delta_applied] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_delta_applied') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_delta_applied] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.stock_delta_applied', N'delta') IS NULL ALTER TABLE dbo.[stock_delta_applied] ADD [delta] int NULL;

IF OBJECT_ID(N'dbo.stock_delta_applied', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_delta_applied', N'delta') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_delta_applied') AND c.name=N'delta'
) ALTER TABLE dbo.[stock_delta_applied] ADD CONSTRAINT [DF_stock_delta_applied_delta] DEFAULT (0) FOR [delta];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_delta_applied') AND name=N'delta' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_delta_applied] SET [delta]=0 WHERE [delta] IS NULL;';
  ALTER TABLE dbo.[stock_delta_applied] ALTER COLUMN [delta] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_delta_applied', N'applied_at') IS NULL ALTER TABLE dbo.[stock_delta_applied] ADD [applied_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.stock_delta_applied', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_delta_applied', N'applied_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_delta_applied') AND c.name=N'applied_at'
) ALTER TABLE dbo.[stock_delta_applied] ADD CONSTRAINT [DF_stock_delta_applied_applied_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [applied_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_delta_applied') AND name=N'applied_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_delta_applied] SET [applied_at]=SYSDATETIMEOFFSET() WHERE [applied_at] IS NULL;';
  ALTER TABLE dbo.[stock_delta_applied] ALTER COLUMN [applied_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.stock_delta_applied') AND name=N'IX_stock_delta_applied_store_id') CREATE INDEX [IX_stock_delta_applied_store_id] ON dbo.[stock_delta_applied]([store_id]);

IF OBJECT_ID(N'dbo.stock_transfer_items', N'U') IS NULL BEGIN CREATE TABLE dbo.[stock_transfer_items] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_stock_transfer_items_id] DEFAULT (NEWID()),
  [transfer_id] uniqueidentifier NOT NULL,
  [product_id] uniqueidentifier NULL,
  [barcode] nvarchar(max) NULL,
  [sku] nvarchar(max) NULL,
  [product_name] nvarchar(max) NULL,
  [quantity] int NOT NULL CONSTRAINT [DF_stock_transfer_items_quantity] DEFAULT (0),
  [quantity_received] int NOT NULL CONSTRAINT [DF_stock_transfer_items_quantity_received] DEFAULT (0),
  [unit_cost] decimal(38,12) NOT NULL CONSTRAINT [DF_stock_transfer_items_unit_cost] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_stock_transfer_items_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_stock_transfer_items_row_version] DEFAULT (1),
  [quantity_approved] int NULL,
  [quantity_dispatched] int NULL,
  [quantity_verified] int NULL,
  CONSTRAINT [PK_stock_transfer_items] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.stock_transfer_items', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.stock_transfer_items')) ALTER TABLE dbo.[stock_transfer_items] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'id') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.stock_transfer_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfer_items', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND c.name=N'id'
) ALTER TABLE dbo.[stock_transfer_items] ADD CONSTRAINT [DF_stock_transfer_items_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfer_items] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[stock_transfer_items] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_transfer_items] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'transfer_id') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [transfer_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND c.name=N'transfer_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_transfer_items] ALTER COLUMN [transfer_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'product_id') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [product_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND c.name=N'product_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_transfer_items] ALTER COLUMN [product_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'barcode') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [barcode] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'sku') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [sku] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'product_name') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [product_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'quantity') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [quantity] int NULL;

IF OBJECT_ID(N'dbo.stock_transfer_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfer_items', N'quantity') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND c.name=N'quantity'
) ALTER TABLE dbo.[stock_transfer_items] ADD CONSTRAINT [DF_stock_transfer_items_quantity] DEFAULT (0) FOR [quantity];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND name=N'quantity' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfer_items] SET [quantity]=0 WHERE [quantity] IS NULL;';
  ALTER TABLE dbo.[stock_transfer_items] ALTER COLUMN [quantity] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'quantity_received') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [quantity_received] int NULL;

IF OBJECT_ID(N'dbo.stock_transfer_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfer_items', N'quantity_received') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND c.name=N'quantity_received'
) ALTER TABLE dbo.[stock_transfer_items] ADD CONSTRAINT [DF_stock_transfer_items_quantity_received] DEFAULT (0) FOR [quantity_received];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND name=N'quantity_received' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfer_items] SET [quantity_received]=0 WHERE [quantity_received] IS NULL;';
  ALTER TABLE dbo.[stock_transfer_items] ALTER COLUMN [quantity_received] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'unit_cost') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [unit_cost] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.stock_transfer_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfer_items', N'unit_cost') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND c.name=N'unit_cost'
) ALTER TABLE dbo.[stock_transfer_items] ADD CONSTRAINT [DF_stock_transfer_items_unit_cost] DEFAULT (0) FOR [unit_cost];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND name=N'unit_cost' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfer_items] SET [unit_cost]=0 WHERE [unit_cost] IS NULL;';
  ALTER TABLE dbo.[stock_transfer_items] ALTER COLUMN [unit_cost] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'created_at') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.stock_transfer_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfer_items', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND c.name=N'created_at'
) ALTER TABLE dbo.[stock_transfer_items] ADD CONSTRAINT [DF_stock_transfer_items_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfer_items] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[stock_transfer_items] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'row_version') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.stock_transfer_items', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfer_items', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND c.name=N'row_version'
) ALTER TABLE dbo.[stock_transfer_items] ADD CONSTRAINT [DF_stock_transfer_items_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfer_items] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[stock_transfer_items] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'quantity_approved') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [quantity_approved] int NULL;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'quantity_dispatched') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [quantity_dispatched] int NULL;

IF COL_LENGTH(N'dbo.stock_transfer_items', N'quantity_verified') IS NULL ALTER TABLE dbo.[stock_transfer_items] ADD [quantity_verified] int NULL;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NULL BEGIN CREATE TABLE dbo.[stock_transfers] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_stock_transfers_id] DEFAULT (NEWID()),
  [ref] nvarchar(450) NOT NULL,
  [kind] nvarchar(max) NOT NULL CONSTRAINT [DF_stock_transfers_kind] DEFAULT ('transfer'),
  [transfer_scope] nvarchar(max) NOT NULL CONSTRAINT [DF_stock_transfers_transfer_scope] DEFAULT ('INTRA_GROUP'),
  [from_store_id] nvarchar(max) NOT NULL,
  [from_store_name] nvarchar(max) NULL,
  [from_group_id] nvarchar(max) NULL,
  [to_store_id] nvarchar(max) NOT NULL,
  [to_store_name] nvarchar(max) NULL,
  [to_group_id] nvarchar(max) NULL,
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_stock_transfers_status] DEFAULT ('pending'),
  [note] nvarchar(max) NOT NULL CONSTRAINT [DF_stock_transfers_note] DEFAULT (''),
  [created_by] nvarchar(max) NULL,
  [approved_by] nvarchar(max) NULL,
  [approved_at] datetimeoffset(7) NULL,
  [received_by] nvarchar(max) NULL,
  [received_at] datetimeoffset(7) NULL,
  [rejected_reason] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_stock_transfers_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_stock_transfers_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_stock_transfers_row_version] DEFAULT (1),
  [verified_by] nvarchar(max) NULL,
  [verified_at] datetimeoffset(7) NULL,
  [posted_at] datetimeoffset(7) NULL,
  [discrepancy_reason] nvarchar(max) NULL,
  [rejected_by] nvarchar(max) NULL,
  [cancelled_reason] nvarchar(max) NULL,
  [dispatched_by] nvarchar(max) NULL,
  [dispatched_at] nvarchar(max) NULL,
  [closed_at] nvarchar(max) NULL,
  [fulfilment] nvarchar(max) NULL,
  [source_request_id] uniqueidentifier NULL,
  CONSTRAINT [PK_stock_transfers] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.stock_transfers')) ALTER TABLE dbo.[stock_transfers] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.stock_transfers', N'id') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfers', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'id'
) ALTER TABLE dbo.[stock_transfers] ADD CONSTRAINT [DF_stock_transfers_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfers] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'ref') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [ref] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'ref' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [ref] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'kind') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [kind] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfers', N'kind') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'kind'
) ALTER TABLE dbo.[stock_transfers] ADD CONSTRAINT [DF_stock_transfers_kind] DEFAULT ('transfer') FOR [kind];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'kind' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfers] SET [kind]=''transfer'' WHERE [kind] IS NULL;';
  ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [kind] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfers', N'transfer_scope') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [transfer_scope] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfers', N'transfer_scope') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'transfer_scope'
) ALTER TABLE dbo.[stock_transfers] ADD CONSTRAINT [DF_stock_transfers_transfer_scope] DEFAULT ('INTRA_GROUP') FOR [transfer_scope];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'transfer_scope' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfers] SET [transfer_scope]=''INTRA_GROUP'' WHERE [transfer_scope] IS NULL;';
  ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [transfer_scope] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfers', N'from_store_id') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [from_store_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'from_store_name') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [from_store_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'from_group_id') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [from_group_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'to_store_id') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [to_store_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'to_store_name') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [to_store_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'to_group_id') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [to_group_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'status') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfers', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'status'
) ALTER TABLE dbo.[stock_transfers] ADD CONSTRAINT [DF_stock_transfers_status] DEFAULT ('pending') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfers] SET [status]=''pending'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfers', N'note') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [note] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfers', N'note') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'note'
) ALTER TABLE dbo.[stock_transfers] ADD CONSTRAINT [DF_stock_transfers_note] DEFAULT ('') FOR [note];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'note' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfers] SET [note]='''' WHERE [note] IS NULL;';
  ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [note] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfers', N'created_by') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [created_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'approved_by') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [approved_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'approved_at') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [approved_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'received_by') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [received_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'received_at') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [received_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'rejected_reason') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [rejected_reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'created_at') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfers', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'created_at'
) ALTER TABLE dbo.[stock_transfers] ADD CONSTRAINT [DF_stock_transfers_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfers] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfers', N'updated_at') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfers', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'updated_at'
) ALTER TABLE dbo.[stock_transfers] ADD CONSTRAINT [DF_stock_transfers_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfers] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'row_version') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.stock_transfers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_transfers', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'row_version'
) ALTER TABLE dbo.[stock_transfers] ADD CONSTRAINT [DF_stock_transfers_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_transfers] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_transfers', N'verified_by') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [verified_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'verified_at') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [verified_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'posted_at') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [posted_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'discrepancy_reason') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [discrepancy_reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'rejected_by') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [rejected_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'cancelled_reason') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [cancelled_reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'dispatched_by') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [dispatched_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'dispatched_at') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [dispatched_at] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'closed_at') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [closed_at] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'fulfilment') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [fulfilment] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_transfers', N'source_request_id') IS NULL ALTER TABLE dbo.[stock_transfers] ADD [source_request_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_transfers') AND c.name=N'source_request_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_transfers] ALTER COLUMN [source_request_id] uniqueidentifier NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'UX_stock_transfers_ref') CREATE UNIQUE INDEX [UX_stock_transfers_ref] ON dbo.[stock_transfers]([ref]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'IX_stock_transfers_updated_at') CREATE INDEX [IX_stock_transfers_updated_at] ON dbo.[stock_transfers]([updated_at]);

IF OBJECT_ID(N'dbo.stores', N'U') IS NULL BEGIN CREATE TABLE dbo.[stores] (

  [id] nvarchar(450) NOT NULL,
  [code] nvarchar(max) NOT NULL,
  [name] nvarchar(max) NOT NULL,
  [address] nvarchar(max) NULL,
  [phone] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_stores_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_stores_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [group_id] nvarchar(450) NULL,
  [row_version] int NOT NULL CONSTRAINT [DF_stores_row_version] DEFAULT (1),
  [location_type] nvarchar(max) NOT NULL CONSTRAINT [DF_stores_location_type] DEFAULT ('store'),
  [parent_id] nvarchar(450) NULL,
  [is_central] bit NOT NULL CONSTRAINT [DF_stores_is_central] DEFAULT (0),
  [building_name] nvarchar(max) NULL,
  [floor_label] nvarchar(max) NULL,
  [is_active] bit NOT NULL CONSTRAINT [DF_stores_is_active] DEFAULT (1),
  [archived_at] datetimeoffset(7) NULL,
  [is_primary_sub] bit NOT NULL CONSTRAINT [DF_stores_is_primary_sub] DEFAULT (0),
  [private_catalogue] bit NOT NULL CONSTRAINT [DF_stores_private_catalogue] DEFAULT (0),
  [receipt_prefix] nvarchar(max) NULL,
  [deleted_at] nvarchar(max) NULL,
  CONSTRAINT [PK_stores] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.stores', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.stores')) ALTER TABLE dbo.[stores] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.stores', N'id') IS NULL ALTER TABLE dbo.[stores] ADD [id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stores] ALTER COLUMN [id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.stores', N'code') IS NULL ALTER TABLE dbo.[stores] ADD [code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stores', N'name') IS NULL ALTER TABLE dbo.[stores] ADD [name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stores', N'address') IS NULL ALTER TABLE dbo.[stores] ADD [address] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stores', N'phone') IS NULL ALTER TABLE dbo.[stores] ADD [phone] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stores', N'created_at') IS NULL ALTER TABLE dbo.[stores] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.stores', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stores', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'created_at'
) ALTER TABLE dbo.[stores] ADD CONSTRAINT [DF_stores_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stores') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stores] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[stores] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stores', N'updated_at') IS NULL ALTER TABLE dbo.[stores] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.stores', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stores', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'updated_at'
) ALTER TABLE dbo.[stores] ADD CONSTRAINT [DF_stores_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stores') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stores] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[stores] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stores] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.stores', N'group_id') IS NULL ALTER TABLE dbo.[stores] ADD [group_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'group_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stores] ALTER COLUMN [group_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.stores', N'row_version') IS NULL ALTER TABLE dbo.[stores] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.stores', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stores', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'row_version'
) ALTER TABLE dbo.[stores] ADD CONSTRAINT [DF_stores_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stores') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stores] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[stores] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stores', N'location_type') IS NULL ALTER TABLE dbo.[stores] ADD [location_type] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stores', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stores', N'location_type') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'location_type'
) ALTER TABLE dbo.[stores] ADD CONSTRAINT [DF_stores_location_type] DEFAULT ('store') FOR [location_type];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stores') AND name=N'location_type' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stores] SET [location_type]=''store'' WHERE [location_type] IS NULL;';
  ALTER TABLE dbo.[stores] ALTER COLUMN [location_type] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stores', N'parent_id') IS NULL ALTER TABLE dbo.[stores] ADD [parent_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'parent_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stores] ALTER COLUMN [parent_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.stores', N'is_central') IS NULL ALTER TABLE dbo.[stores] ADD [is_central] bit NULL;

IF OBJECT_ID(N'dbo.stores', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stores', N'is_central') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'is_central'
) ALTER TABLE dbo.[stores] ADD CONSTRAINT [DF_stores_is_central] DEFAULT (0) FOR [is_central];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stores') AND name=N'is_central' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stores] SET [is_central]=0 WHERE [is_central] IS NULL;';
  ALTER TABLE dbo.[stores] ALTER COLUMN [is_central] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.stores', N'building_name') IS NULL ALTER TABLE dbo.[stores] ADD [building_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stores', N'floor_label') IS NULL ALTER TABLE dbo.[stores] ADD [floor_label] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stores', N'is_active') IS NULL ALTER TABLE dbo.[stores] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.stores', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stores', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'is_active'
) ALTER TABLE dbo.[stores] ADD CONSTRAINT [DF_stores_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stores') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stores] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[stores] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.stores', N'archived_at') IS NULL ALTER TABLE dbo.[stores] ADD [archived_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.stores', N'is_primary_sub') IS NULL ALTER TABLE dbo.[stores] ADD [is_primary_sub] bit NULL;

IF OBJECT_ID(N'dbo.stores', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stores', N'is_primary_sub') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'is_primary_sub'
) ALTER TABLE dbo.[stores] ADD CONSTRAINT [DF_stores_is_primary_sub] DEFAULT (0) FOR [is_primary_sub];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stores') AND name=N'is_primary_sub' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stores] SET [is_primary_sub]=0 WHERE [is_primary_sub] IS NULL;';
  ALTER TABLE dbo.[stores] ALTER COLUMN [is_primary_sub] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.stores', N'private_catalogue') IS NULL ALTER TABLE dbo.[stores] ADD [private_catalogue] bit NULL;

IF OBJECT_ID(N'dbo.stores', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stores', N'private_catalogue') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stores') AND c.name=N'private_catalogue'
) ALTER TABLE dbo.[stores] ADD CONSTRAINT [DF_stores_private_catalogue] DEFAULT (0) FOR [private_catalogue];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stores') AND name=N'private_catalogue' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stores] SET [private_catalogue]=0 WHERE [private_catalogue] IS NULL;';
  ALTER TABLE dbo.[stores] ALTER COLUMN [private_catalogue] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.stores', N'receipt_prefix') IS NULL ALTER TABLE dbo.[stores] ADD [receipt_prefix] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stores', N'deleted_at') IS NULL ALTER TABLE dbo.[stores] ADD [deleted_at] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.stores') AND name=N'IX_stores_updated_at') CREATE INDEX [IX_stores_updated_at] ON dbo.[stores]([updated_at]);

IF OBJECT_ID(N'dbo.suppliers', N'U') IS NULL BEGIN CREATE TABLE dbo.[suppliers] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_suppliers_id] DEFAULT (NEWID()),
  [name] nvarchar(max) NOT NULL,
  [contact_name] nvarchar(max) NULL,
  [phone] nvarchar(max) NULL,
  [email] nvarchar(max) NULL,
  [address] nvarchar(max) NULL,
  [tax_number] nvarchar(max) NULL,
  [notes] nvarchar(max) NULL,
  [is_active] bit NOT NULL CONSTRAINT [DF_suppliers_is_active] DEFAULT (1),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_suppliers_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_suppliers_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_suppliers_row_version] DEFAULT (1),
  [deleted_at] nvarchar(max) NULL,
  CONSTRAINT [PK_suppliers] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.suppliers', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.suppliers')) ALTER TABLE dbo.[suppliers] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.suppliers', N'id') IS NULL ALTER TABLE dbo.[suppliers] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.suppliers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.suppliers', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.suppliers') AND c.name=N'id'
) ALTER TABLE dbo.[suppliers] ADD CONSTRAINT [DF_suppliers_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.suppliers') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[suppliers] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[suppliers] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.suppliers') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[suppliers] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.suppliers', N'name') IS NULL ALTER TABLE dbo.[suppliers] ADD [name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.suppliers', N'contact_name') IS NULL ALTER TABLE dbo.[suppliers] ADD [contact_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.suppliers', N'phone') IS NULL ALTER TABLE dbo.[suppliers] ADD [phone] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.suppliers', N'email') IS NULL ALTER TABLE dbo.[suppliers] ADD [email] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.suppliers', N'address') IS NULL ALTER TABLE dbo.[suppliers] ADD [address] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.suppliers', N'tax_number') IS NULL ALTER TABLE dbo.[suppliers] ADD [tax_number] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.suppliers', N'notes') IS NULL ALTER TABLE dbo.[suppliers] ADD [notes] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.suppliers', N'is_active') IS NULL ALTER TABLE dbo.[suppliers] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.suppliers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.suppliers', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.suppliers') AND c.name=N'is_active'
) ALTER TABLE dbo.[suppliers] ADD CONSTRAINT [DF_suppliers_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.suppliers') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[suppliers] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[suppliers] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.suppliers', N'created_at') IS NULL ALTER TABLE dbo.[suppliers] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.suppliers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.suppliers', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.suppliers') AND c.name=N'created_at'
) ALTER TABLE dbo.[suppliers] ADD CONSTRAINT [DF_suppliers_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.suppliers') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[suppliers] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[suppliers] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.suppliers', N'updated_at') IS NULL ALTER TABLE dbo.[suppliers] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.suppliers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.suppliers', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.suppliers') AND c.name=N'updated_at'
) ALTER TABLE dbo.[suppliers] ADD CONSTRAINT [DF_suppliers_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.suppliers') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[suppliers] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[suppliers] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.suppliers') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[suppliers] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.suppliers', N'row_version') IS NULL ALTER TABLE dbo.[suppliers] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.suppliers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.suppliers', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.suppliers') AND c.name=N'row_version'
) ALTER TABLE dbo.[suppliers] ADD CONSTRAINT [DF_suppliers_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.suppliers') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[suppliers] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[suppliers] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.suppliers', N'deleted_at') IS NULL ALTER TABLE dbo.[suppliers] ADD [deleted_at] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.suppliers') AND name=N'IX_suppliers_updated_at') CREATE INDEX [IX_suppliers_updated_at] ON dbo.[suppliers]([updated_at]);

IF OBJECT_ID(N'dbo.sync_metadata', N'U') IS NULL BEGIN CREATE TABLE dbo.[sync_metadata] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_sync_metadata_id] DEFAULT (NEWID()),
  [store_id] nvarchar(128) NULL,
  [terminal_id] nvarchar(128) NULL,
  [table_name] nvarchar(128) NOT NULL,
  [last_synced_at] datetimeoffset(7) NULL,
  [last_pushed_at] datetimeoffset(7) NULL,
  [rows_pushed] int NOT NULL CONSTRAINT [DF_sync_metadata_rows_pushed] DEFAULT (0),
  [last_error] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_sync_metadata_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_sync_metadata_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_sync_metadata] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.sync_metadata', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.sync_metadata')) ALTER TABLE dbo.[sync_metadata] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.sync_metadata', N'id') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.sync_metadata', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sync_metadata', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sync_metadata') AND c.name=N'id'
) ALTER TABLE dbo.[sync_metadata] ADD CONSTRAINT [DF_sync_metadata_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sync_metadata') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sync_metadata] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[sync_metadata] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sync_metadata') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sync_metadata] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.sync_metadata', N'store_id') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [store_id] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sync_metadata') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sync_metadata] ALTER COLUMN [store_id] nvarchar(128) NULL;

IF COL_LENGTH(N'dbo.sync_metadata', N'terminal_id') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [terminal_id] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sync_metadata') AND c.name=N'terminal_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sync_metadata] ALTER COLUMN [terminal_id] nvarchar(128) NULL;

IF COL_LENGTH(N'dbo.sync_metadata', N'table_name') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [table_name] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sync_metadata') AND c.name=N'table_name' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sync_metadata] ALTER COLUMN [table_name] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.sync_metadata', N'last_synced_at') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [last_synced_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.sync_metadata', N'last_pushed_at') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [last_pushed_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.sync_metadata', N'rows_pushed') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [rows_pushed] int NULL;

IF OBJECT_ID(N'dbo.sync_metadata', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sync_metadata', N'rows_pushed') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sync_metadata') AND c.name=N'rows_pushed'
) ALTER TABLE dbo.[sync_metadata] ADD CONSTRAINT [DF_sync_metadata_rows_pushed] DEFAULT (0) FOR [rows_pushed];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sync_metadata') AND name=N'rows_pushed' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sync_metadata] SET [rows_pushed]=0 WHERE [rows_pushed] IS NULL;';
  ALTER TABLE dbo.[sync_metadata] ALTER COLUMN [rows_pushed] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.sync_metadata', N'last_error') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [last_error] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.sync_metadata', N'created_at') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.sync_metadata', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sync_metadata', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sync_metadata') AND c.name=N'created_at'
) ALTER TABLE dbo.[sync_metadata] ADD CONSTRAINT [DF_sync_metadata_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sync_metadata') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sync_metadata] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[sync_metadata] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.sync_metadata', N'updated_at') IS NULL ALTER TABLE dbo.[sync_metadata] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.sync_metadata', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.sync_metadata', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.sync_metadata') AND c.name=N'updated_at'
) ALTER TABLE dbo.[sync_metadata] ADD CONSTRAINT [DF_sync_metadata_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.sync_metadata') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[sync_metadata] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[sync_metadata] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.sync_metadata') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[sync_metadata] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sync_metadata') AND name=N'UQ_sync_metadata_0') CREATE UNIQUE INDEX [UQ_sync_metadata_0] ON dbo.[sync_metadata]([store_id],[terminal_id],[table_name]) WHERE [store_id] IS NOT NULL AND [terminal_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sync_metadata') AND name=N'IX_sync_metadata_store_id') CREATE INDEX [IX_sync_metadata_store_id] ON dbo.[sync_metadata]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sync_metadata') AND name=N'IX_sync_metadata_updated_at') CREATE INDEX [IX_sync_metadata_updated_at] ON dbo.[sync_metadata]([updated_at]);

IF OBJECT_ID(N'dbo.system_audit_logs', N'U') IS NULL BEGIN CREATE TABLE dbo.[system_audit_logs] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_system_audit_logs_id] DEFAULT (NEWID()),
  [actor_id] nvarchar(max) NULL,
  [actor_name] nvarchar(max) NULL,
  [actor_role] nvarchar(max) NULL,
  [action_type] nvarchar(max) NOT NULL,
  [entity_affected] nvarchar(max) NULL,
  [entity_id] nvarchar(max) NULL,
  [old_value] nvarchar(max) NULL,
  [new_value] nvarchar(max) NULL,
  [terminal_id] nvarchar(max) NULL,
  [ip_address] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [note] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_system_audit_logs_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_system_audit_logs] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.system_audit_logs', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.system_audit_logs')) ALTER TABLE dbo.[system_audit_logs] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.system_audit_logs', N'id') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.system_audit_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.system_audit_logs', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.system_audit_logs') AND c.name=N'id'
) ALTER TABLE dbo.[system_audit_logs] ADD CONSTRAINT [DF_system_audit_logs_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.system_audit_logs') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[system_audit_logs] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[system_audit_logs] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.system_audit_logs') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[system_audit_logs] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'actor_id') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [actor_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'actor_name') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [actor_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'actor_role') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [actor_role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'action_type') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [action_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'entity_affected') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [entity_affected] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'entity_id') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [entity_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'old_value') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [old_value] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'new_value') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [new_value] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'terminal_id') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'ip_address') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [ip_address] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'store_id') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.system_audit_logs') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[system_audit_logs] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'note') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [note] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.system_audit_logs', N'created_at') IS NULL ALTER TABLE dbo.[system_audit_logs] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.system_audit_logs', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.system_audit_logs', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.system_audit_logs') AND c.name=N'created_at'
) ALTER TABLE dbo.[system_audit_logs] ADD CONSTRAINT [DF_system_audit_logs_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.system_audit_logs') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[system_audit_logs] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[system_audit_logs] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.system_audit_logs') AND name=N'IX_system_audit_logs_store_id') CREATE INDEX [IX_system_audit_logs_store_id] ON dbo.[system_audit_logs]([store_id]);

IF OBJECT_ID(N'dbo.terminal_commands', N'U') IS NULL BEGIN CREATE TABLE dbo.[terminal_commands] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_terminal_commands_id] DEFAULT (NEWID()),
  [terminal_id] nvarchar(max) NOT NULL,
  [store_id] nvarchar(450) NULL,
  [command] nvarchar(max) NOT NULL,
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_terminal_commands_status] DEFAULT ('pending'),
  [note] nvarchar(max) NULL,
  [result] nvarchar(max) NULL,
  [issued_by] nvarchar(max) NULL,
  [issued_role] nvarchar(max) NULL,
  [picked_up_at] datetimeoffset(7) NULL,
  [finished_at] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_terminal_commands_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_terminal_commands_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_terminal_commands] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.terminal_commands', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.terminal_commands')) ALTER TABLE dbo.[terminal_commands] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.terminal_commands', N'id') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.terminal_commands', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_commands', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_commands') AND c.name=N'id'
) ALTER TABLE dbo.[terminal_commands] ADD CONSTRAINT [DF_terminal_commands_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_commands') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_commands] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[terminal_commands] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.terminal_commands') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[terminal_commands] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'terminal_id') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'store_id') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.terminal_commands') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[terminal_commands] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'command') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [command] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'status') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.terminal_commands', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_commands', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_commands') AND c.name=N'status'
) ALTER TABLE dbo.[terminal_commands] ADD CONSTRAINT [DF_terminal_commands_status] DEFAULT ('pending') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_commands') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_commands] SET [status]=''pending'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[terminal_commands] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_commands', N'note') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [note] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'result') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [result] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'issued_by') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [issued_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'issued_role') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [issued_role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'picked_up_at') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [picked_up_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'finished_at') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [finished_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_commands', N'created_at') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.terminal_commands', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_commands', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_commands') AND c.name=N'created_at'
) ALTER TABLE dbo.[terminal_commands] ADD CONSTRAINT [DF_terminal_commands_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_commands') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_commands] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[terminal_commands] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_commands', N'updated_at') IS NULL ALTER TABLE dbo.[terminal_commands] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.terminal_commands', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_commands', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_commands') AND c.name=N'updated_at'
) ALTER TABLE dbo.[terminal_commands] ADD CONSTRAINT [DF_terminal_commands_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_commands') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_commands] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[terminal_commands] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.terminal_commands') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[terminal_commands] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.terminal_commands') AND name=N'IX_terminal_commands_store_id') CREATE INDEX [IX_terminal_commands_store_id] ON dbo.[terminal_commands]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.terminal_commands') AND name=N'IX_terminal_commands_updated_at') CREATE INDEX [IX_terminal_commands_updated_at] ON dbo.[terminal_commands]([updated_at]);

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NULL BEGIN CREATE TABLE dbo.[terminal_tokens] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_terminal_tokens_id] DEFAULT (NEWID()),
  [location_id] nvarchar(450) NULL,
  [location_name] nvarchar(max) NULL,
  [device_name] nvarchar(max) NOT NULL,
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_terminal_tokens_status] DEFAULT ('active'),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_terminal_tokens_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [activated_at] datetimeoffset(7) NULL,
  [revoked_at] datetimeoffset(7) NULL,
  [last_seen_at] datetimeoffset(7) NULL,
  [app_version] nvarchar(max) NULL,
  [last_sync_at] datetimeoffset(7) NULL,
  [reissued_at] datetimeoffset(7) NULL,
  [replaced_by] uniqueidentifier NULL,
  [claimed_by_device] nvarchar(max) NULL,
  [claimed_at] datetimeoffset(7) NULL,
  [platform] nvarchar(max) NOT NULL CONSTRAINT [DF_terminal_tokens_platform] DEFAULT ('pc'),
  [row_version] int NOT NULL CONSTRAINT [DF_terminal_tokens_row_version] DEFAULT (1),
  [claim_secret_hash] nvarchar(max) NULL,
  [claim_expires_at] datetimeoffset(7) NULL,
  [credentials_issued_at] datetimeoffset(7) NULL,
  [device_platform] nvarchar(max) NULL,
  [device_os] nvarchar(max) NULL,
  [claimed_proof_hash] nvarchar(max) NULL,
  [claimed_platform] nvarchar(max) NULL,
  [claimed_os] nvarchar(max) NULL,
  [is_claimed] bit NOT NULL CONSTRAINT [DF_terminal_tokens_is_claimed] DEFAULT (0),
  [expires_at] datetimeoffset(7) NULL,
  [claim_proof] nvarchar(max) NULL,
  CONSTRAINT [PK_terminal_tokens] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.terminal_tokens')) ALTER TABLE dbo.[terminal_tokens] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.terminal_tokens', N'id') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_tokens', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_tokens') AND c.name=N'id'
) ALTER TABLE dbo.[terminal_tokens] ADD CONSTRAINT [DF_terminal_tokens_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_tokens') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_tokens] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[terminal_tokens] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.terminal_tokens') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[terminal_tokens] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'location_id') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [location_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.terminal_tokens') AND c.name=N'location_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[terminal_tokens] ALTER COLUMN [location_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'location_name') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [location_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'device_name') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [device_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'status') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_tokens', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_tokens') AND c.name=N'status'
) ALTER TABLE dbo.[terminal_tokens] ADD CONSTRAINT [DF_terminal_tokens_status] DEFAULT ('active') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_tokens') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_tokens] SET [status]=''active'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[terminal_tokens] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_tokens', N'created_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_tokens', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_tokens') AND c.name=N'created_at'
) ALTER TABLE dbo.[terminal_tokens] ADD CONSTRAINT [DF_terminal_tokens_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_tokens') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_tokens] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[terminal_tokens] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_tokens', N'activated_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [activated_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'revoked_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [revoked_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'last_seen_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [last_seen_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'app_version') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [app_version] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'last_sync_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [last_sync_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'reissued_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [reissued_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'replaced_by') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [replaced_by] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'claimed_by_device') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [claimed_by_device] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'claimed_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [claimed_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'platform') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [platform] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_tokens', N'platform') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_tokens') AND c.name=N'platform'
) ALTER TABLE dbo.[terminal_tokens] ADD CONSTRAINT [DF_terminal_tokens_platform] DEFAULT ('pc') FOR [platform];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_tokens') AND name=N'platform' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_tokens] SET [platform]=''pc'' WHERE [platform] IS NULL;';
  ALTER TABLE dbo.[terminal_tokens] ALTER COLUMN [platform] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_tokens', N'row_version') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_tokens', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_tokens') AND c.name=N'row_version'
) ALTER TABLE dbo.[terminal_tokens] ADD CONSTRAINT [DF_terminal_tokens_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_tokens') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_tokens] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[terminal_tokens] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_tokens', N'claim_secret_hash') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [claim_secret_hash] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'claim_expires_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [claim_expires_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'credentials_issued_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [credentials_issued_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'device_platform') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [device_platform] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'device_os') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [device_os] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'claimed_proof_hash') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [claimed_proof_hash] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'claimed_platform') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [claimed_platform] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'claimed_os') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [claimed_os] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'is_claimed') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [is_claimed] bit NULL;

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_tokens', N'is_claimed') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_tokens') AND c.name=N'is_claimed'
) ALTER TABLE dbo.[terminal_tokens] ADD CONSTRAINT [DF_terminal_tokens_is_claimed] DEFAULT (0) FOR [is_claimed];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_tokens') AND name=N'is_claimed' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_tokens] SET [is_claimed]=0 WHERE [is_claimed] IS NULL;';
  ALTER TABLE dbo.[terminal_tokens] ALTER COLUMN [is_claimed] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_tokens', N'expires_at') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [expires_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.terminal_tokens', N'claim_proof') IS NULL ALTER TABLE dbo.[terminal_tokens] ADD [claim_proof] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.uom_units', N'U') IS NULL BEGIN CREATE TABLE dbo.[uom_units] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_uom_units_id] DEFAULT (NEWID()),
  [code] nvarchar(450) NOT NULL,
  [name] nvarchar(max) NOT NULL,
  [allow_decimal] bit NOT NULL CONSTRAINT [DF_uom_units_allow_decimal] DEFAULT (0),
  [sort] int NOT NULL CONSTRAINT [DF_uom_units_sort] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_uom_units_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_uom_units_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_uom_units_row_version] DEFAULT (1),
  [is_active] bit NOT NULL CONSTRAINT [DF_uom_units_is_active] DEFAULT (1),
  [deleted_at] nvarchar(max) NULL,
  CONSTRAINT [PK_uom_units] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.uom_units', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.uom_units')) ALTER TABLE dbo.[uom_units] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.uom_units', N'id') IS NULL ALTER TABLE dbo.[uom_units] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.uom_units', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.uom_units', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'id'
) ALTER TABLE dbo.[uom_units] ADD CONSTRAINT [DF_uom_units_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.uom_units') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[uom_units] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[uom_units] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[uom_units] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.uom_units', N'code') IS NULL ALTER TABLE dbo.[uom_units] ADD [code] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'code' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[uom_units] ALTER COLUMN [code] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.uom_units', N'name') IS NULL ALTER TABLE dbo.[uom_units] ADD [name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.uom_units', N'allow_decimal') IS NULL ALTER TABLE dbo.[uom_units] ADD [allow_decimal] bit NULL;

IF OBJECT_ID(N'dbo.uom_units', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.uom_units', N'allow_decimal') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'allow_decimal'
) ALTER TABLE dbo.[uom_units] ADD CONSTRAINT [DF_uom_units_allow_decimal] DEFAULT (0) FOR [allow_decimal];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.uom_units') AND name=N'allow_decimal' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[uom_units] SET [allow_decimal]=0 WHERE [allow_decimal] IS NULL;';
  ALTER TABLE dbo.[uom_units] ALTER COLUMN [allow_decimal] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.uom_units', N'sort') IS NULL ALTER TABLE dbo.[uom_units] ADD [sort] int NULL;

IF OBJECT_ID(N'dbo.uom_units', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.uom_units', N'sort') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'sort'
) ALTER TABLE dbo.[uom_units] ADD CONSTRAINT [DF_uom_units_sort] DEFAULT (0) FOR [sort];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.uom_units') AND name=N'sort' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[uom_units] SET [sort]=0 WHERE [sort] IS NULL;';
  ALTER TABLE dbo.[uom_units] ALTER COLUMN [sort] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.uom_units', N'created_at') IS NULL ALTER TABLE dbo.[uom_units] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.uom_units', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.uom_units', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'created_at'
) ALTER TABLE dbo.[uom_units] ADD CONSTRAINT [DF_uom_units_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.uom_units') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[uom_units] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[uom_units] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.uom_units', N'updated_at') IS NULL ALTER TABLE dbo.[uom_units] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.uom_units', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.uom_units', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'updated_at'
) ALTER TABLE dbo.[uom_units] ADD CONSTRAINT [DF_uom_units_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.uom_units') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[uom_units] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[uom_units] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[uom_units] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.uom_units', N'row_version') IS NULL ALTER TABLE dbo.[uom_units] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.uom_units', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.uom_units', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'row_version'
) ALTER TABLE dbo.[uom_units] ADD CONSTRAINT [DF_uom_units_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.uom_units') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[uom_units] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[uom_units] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.uom_units', N'is_active') IS NULL ALTER TABLE dbo.[uom_units] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.uom_units', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.uom_units', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.uom_units') AND c.name=N'is_active'
) ALTER TABLE dbo.[uom_units] ADD CONSTRAINT [DF_uom_units_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.uom_units') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[uom_units] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[uom_units] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.uom_units', N'deleted_at') IS NULL ALTER TABLE dbo.[uom_units] ADD [deleted_at] nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.uom_units') AND name=N'UX_uom_units_code') CREATE UNIQUE INDEX [UX_uom_units_code] ON dbo.[uom_units]([code]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.uom_units') AND name=N'IX_uom_units_updated_at') CREATE INDEX [IX_uom_units_updated_at] ON dbo.[uom_units]([updated_at]);

IF OBJECT_ID(N'dbo.user_roles', N'U') IS NULL BEGIN CREATE TABLE dbo.[user_roles] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_user_roles_id] DEFAULT (NEWID()),
  [user_id] uniqueidentifier NOT NULL,
  [role] nvarchar(128) NOT NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_user_roles_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_user_roles] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.user_roles', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.user_roles')) ALTER TABLE dbo.[user_roles] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.user_roles', N'id') IS NULL ALTER TABLE dbo.[user_roles] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.user_roles', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.user_roles', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.user_roles') AND c.name=N'id'
) ALTER TABLE dbo.[user_roles] ADD CONSTRAINT [DF_user_roles_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.user_roles') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[user_roles] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[user_roles] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.user_roles') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[user_roles] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.user_roles', N'user_id') IS NULL ALTER TABLE dbo.[user_roles] ADD [user_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.user_roles') AND c.name=N'user_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[user_roles] ALTER COLUMN [user_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.user_roles', N'role') IS NULL ALTER TABLE dbo.[user_roles] ADD [role] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.user_roles') AND c.name=N'role' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[user_roles] ALTER COLUMN [role] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.user_roles', N'created_at') IS NULL ALTER TABLE dbo.[user_roles] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.user_roles', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.user_roles', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.user_roles') AND c.name=N'created_at'
) ALTER TABLE dbo.[user_roles] ADD CONSTRAINT [DF_user_roles_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.user_roles') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[user_roles] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[user_roles] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.user_roles') AND name=N'UQ_user_roles_0') CREATE UNIQUE INDEX [UQ_user_roles_0] ON dbo.[user_roles]([user_id],[role]);

IF OBJECT_ID(N'dbo.whatsapp_queue', N'U') IS NULL BEGIN CREATE TABLE dbo.[whatsapp_queue] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_whatsapp_queue_id] DEFAULT (NEWID()),
  [phone_number_id] nvarchar(max) NOT NULL CONSTRAINT [DF_whatsapp_queue_phone_number_id] DEFAULT (''),
  [recipient] nvarchar(max) NOT NULL,
  [body] nvarchar(max) NOT NULL CONSTRAINT [DF_whatsapp_queue_body] DEFAULT (''),
  [reference] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_whatsapp_queue_status] DEFAULT ('QUEUED'),
  [error] nvarchar(max) NULL,
  [queued_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_whatsapp_queue_queued_at] DEFAULT (SYSDATETIMEOFFSET()),
  [sent_at] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_whatsapp_queue_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_whatsapp_queue_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_whatsapp_queue] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.whatsapp_queue', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue')) ALTER TABLE dbo.[whatsapp_queue] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'id') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.whatsapp_queue', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.whatsapp_queue', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'id'
) ALTER TABLE dbo.[whatsapp_queue] ADD CONSTRAINT [DF_whatsapp_queue_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[whatsapp_queue] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'phone_number_id') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [phone_number_id] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.whatsapp_queue', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.whatsapp_queue', N'phone_number_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'phone_number_id'
) ALTER TABLE dbo.[whatsapp_queue] ADD CONSTRAINT [DF_whatsapp_queue_phone_number_id] DEFAULT ('') FOR [phone_number_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND name=N'phone_number_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[whatsapp_queue] SET [phone_number_id]='''' WHERE [phone_number_id] IS NULL;';
  ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [phone_number_id] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'recipient') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [recipient] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'body') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [body] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.whatsapp_queue', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.whatsapp_queue', N'body') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'body'
) ALTER TABLE dbo.[whatsapp_queue] ADD CONSTRAINT [DF_whatsapp_queue_body] DEFAULT ('') FOR [body];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND name=N'body' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[whatsapp_queue] SET [body]='''' WHERE [body] IS NULL;';
  ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [body] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'reference') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [reference] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'store_id') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'status') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.whatsapp_queue', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.whatsapp_queue', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'status'
) ALTER TABLE dbo.[whatsapp_queue] ADD CONSTRAINT [DF_whatsapp_queue_status] DEFAULT ('QUEUED') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[whatsapp_queue] SET [status]=''QUEUED'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'error') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [error] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'queued_at') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [queued_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.whatsapp_queue', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.whatsapp_queue', N'queued_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'queued_at'
) ALTER TABLE dbo.[whatsapp_queue] ADD CONSTRAINT [DF_whatsapp_queue_queued_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [queued_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND name=N'queued_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[whatsapp_queue] SET [queued_at]=SYSDATETIMEOFFSET() WHERE [queued_at] IS NULL;';
  ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [queued_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'sent_at') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [sent_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'created_at') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.whatsapp_queue', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.whatsapp_queue', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'created_at'
) ALTER TABLE dbo.[whatsapp_queue] ADD CONSTRAINT [DF_whatsapp_queue_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[whatsapp_queue] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.whatsapp_queue', N'updated_at') IS NULL ALTER TABLE dbo.[whatsapp_queue] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.whatsapp_queue', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.whatsapp_queue', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'updated_at'
) ALTER TABLE dbo.[whatsapp_queue] ADD CONSTRAINT [DF_whatsapp_queue_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[whatsapp_queue] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[whatsapp_queue] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND name=N'IX_whatsapp_queue_store_id') CREATE INDEX [IX_whatsapp_queue_store_id] ON dbo.[whatsapp_queue]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.whatsapp_queue') AND name=N'IX_whatsapp_queue_updated_at') CREATE INDEX [IX_whatsapp_queue_updated_at] ON dbo.[whatsapp_queue]([updated_at]);

IF OBJECT_ID(N'dbo.terminal_recovery_secrets', N'U') IS NULL BEGIN CREATE TABLE dbo.[terminal_recovery_secrets] (

  [terminal_token_id] uniqueidentifier NOT NULL,
  [sealed_secret] nvarchar(max) NOT NULL,
  [fingerprint] nvarchar(max) NOT NULL,
  [platform] nvarchar(max) NOT NULL CONSTRAINT [DF_terminal_recovery_secrets_platform] DEFAULT ('unknown'),
  [device_name] nvarchar(max) NULL,
  [utc_offset_minutes] int NOT NULL CONSTRAINT [DF_terminal_recovery_secrets_utc_offset_minutes] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_terminal_recovery_secrets_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_terminal_recovery_secrets_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_terminal_recovery_secrets] PRIMARY KEY ([terminal_token_id])

); END;

IF OBJECT_ID(N'dbo.terminal_recovery_secrets', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets')) ALTER TABLE dbo.[terminal_recovery_secrets] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.terminal_recovery_secrets', N'terminal_token_id') IS NULL ALTER TABLE dbo.[terminal_recovery_secrets] ADD [terminal_token_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND c.name=N'terminal_token_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[terminal_recovery_secrets] ALTER COLUMN [terminal_token_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.terminal_recovery_secrets', N'sealed_secret') IS NULL ALTER TABLE dbo.[terminal_recovery_secrets] ADD [sealed_secret] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_recovery_secrets', N'fingerprint') IS NULL ALTER TABLE dbo.[terminal_recovery_secrets] ADD [fingerprint] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_recovery_secrets', N'platform') IS NULL ALTER TABLE dbo.[terminal_recovery_secrets] ADD [platform] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.terminal_recovery_secrets', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_recovery_secrets', N'platform') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND c.name=N'platform'
) ALTER TABLE dbo.[terminal_recovery_secrets] ADD CONSTRAINT [DF_terminal_recovery_secrets_platform] DEFAULT ('unknown') FOR [platform];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND name=N'platform' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_recovery_secrets] SET [platform]=''unknown'' WHERE [platform] IS NULL;';
  ALTER TABLE dbo.[terminal_recovery_secrets] ALTER COLUMN [platform] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_recovery_secrets', N'device_name') IS NULL ALTER TABLE dbo.[terminal_recovery_secrets] ADD [device_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.terminal_recovery_secrets', N'utc_offset_minutes') IS NULL ALTER TABLE dbo.[terminal_recovery_secrets] ADD [utc_offset_minutes] int NULL;

IF OBJECT_ID(N'dbo.terminal_recovery_secrets', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_recovery_secrets', N'utc_offset_minutes') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND c.name=N'utc_offset_minutes'
) ALTER TABLE dbo.[terminal_recovery_secrets] ADD CONSTRAINT [DF_terminal_recovery_secrets_utc_offset_minutes] DEFAULT (0) FOR [utc_offset_minutes];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND name=N'utc_offset_minutes' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_recovery_secrets] SET [utc_offset_minutes]=0 WHERE [utc_offset_minutes] IS NULL;';
  ALTER TABLE dbo.[terminal_recovery_secrets] ALTER COLUMN [utc_offset_minutes] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_recovery_secrets', N'created_at') IS NULL ALTER TABLE dbo.[terminal_recovery_secrets] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.terminal_recovery_secrets', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_recovery_secrets', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND c.name=N'created_at'
) ALTER TABLE dbo.[terminal_recovery_secrets] ADD CONSTRAINT [DF_terminal_recovery_secrets_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_recovery_secrets] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[terminal_recovery_secrets] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.terminal_recovery_secrets', N'updated_at') IS NULL ALTER TABLE dbo.[terminal_recovery_secrets] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.terminal_recovery_secrets', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.terminal_recovery_secrets', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND c.name=N'updated_at'
) ALTER TABLE dbo.[terminal_recovery_secrets] ADD CONSTRAINT [DF_terminal_recovery_secrets_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[terminal_recovery_secrets] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[terminal_recovery_secrets] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[terminal_recovery_secrets] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.terminal_recovery_secrets') AND name=N'IX_terminal_recovery_secrets_updated_at') CREATE INDEX [IX_terminal_recovery_secrets_updated_at] ON dbo.[terminal_recovery_secrets]([updated_at]);

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NULL BEGIN CREATE TABLE dbo.[pos_store_settings] (

  [store_id] nvarchar(450) NOT NULL,
  [block_shift_close_on_hold] bit NULL,
  [require_daily_sales_for_shift_close] bit NULL,
  [require_counted_cash_on_close] bit NULL,
  [require_opening_float_count] bit NULL,
  [enable_blind_cash_count] bit NULL,
  [max_drawer_cash_limit] decimal(38,12) NULL,
  [require_reason_for_payout] bit NULL,
  [allow_multiple_shifts_per_terminal] bit NULL,
  [enable_cashier_x_report] bit NULL,
  [show_opening_float_at_close] bit NULL,
  [show_expected_totals_at_close] bit NULL,
  [show_live_variance_at_close] bit NULL,
  [show_itemized_tender_breakdown] bit NULL,
  [require_manager_pin_on_variance] bit NULL,
  [variance_pin_threshold] decimal(38,12) NULL,
  [max_cashier_discount_percent] decimal(38,12) NULL,
  [max_cart_discount_amount] decimal(38,12) NULL,
  [allow_discount_stacking] bit NULL,
  [require_reason_for_price_override] bit NULL,
  [prevent_below_cost_sale] bit NULL,
  [allow_tax_exemption] bit NULL,
  [prevent_negative_stock_sale] bit NULL,
  [require_receipt_for_refund] bit NULL,
  [require_manager_pin_for_refund] bit NULL,
  [max_refund_days_limit] decimal(38,12) NULL,
  [track_item_voids] bit NULL,
  [auto_lock_timeout_seconds] decimal(38,12) NULL,
  [require_manager_pin_for_cash_drawer_open] bit NULL,
  [enable_manager_pin_audit_log] bit NULL,
  [require_pin_void_cart] bit NULL,
  [require_pin_void_line] bit NULL,
  [require_pin_reduce_qty] bit NULL,
  [require_pin_manual_discount] bit NULL,
  [require_pin_price_override] bit NULL,
  [require_pin_stock_adjustment] bit NULL,
  [require_pin_shift_close] bit NULL,
  [require_pin_edit_tenders] bit NULL,
  [require_pin_terminal_reset] bit NULL,
  [row_version] int NOT NULL CONSTRAINT [DF_pos_store_settings_row_version] DEFAULT (1),
  [updated_by] nvarchar(max) NULL,
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_pos_store_settings_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [allow_offline_approvals] bit NOT NULL CONSTRAINT [DF_pos_store_settings_allow_offline_approvals] DEFAULT (1),
  [offline_approval_requires_pin] bit NOT NULL CONSTRAINT [DF_pos_store_settings_offline_approval_requires_pin] DEFAULT (1),
  [online_only_void_cart] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_void_cart] DEFAULT (0),
  [online_only_void_line] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_void_line] DEFAULT (0),
  [online_only_reduce_qty] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_reduce_qty] DEFAULT (0),
  [online_only_manual_discount] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_manual_discount] DEFAULT (0),
  [online_only_price_override] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_price_override] DEFAULT (0),
  [online_only_stock_adjustment] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_stock_adjustment] DEFAULT (0),
  [online_only_shift_close] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_shift_close] DEFAULT (0),
  [online_only_edit_tenders] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_edit_tenders] DEFAULT (0),
  [online_only_terminal_reset] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_terminal_reset] DEFAULT (0),
  [online_only_refund] bit NOT NULL CONSTRAINT [DF_pos_store_settings_online_only_refund] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_pos_store_settings_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [idle_timeout_minutes] int NOT NULL CONSTRAINT [DF_pos_store_settings_idle_timeout_minutes] DEFAULT (30),
  CONSTRAINT [PK_pos_store_settings] PRIMARY KEY ([store_id])

); END;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings')) ALTER TABLE dbo.[pos_store_settings] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.pos_store_settings', N'store_id') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'block_shift_close_on_hold') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [block_shift_close_on_hold] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_daily_sales_for_shift_close') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_daily_sales_for_shift_close] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_counted_cash_on_close') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_counted_cash_on_close] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_opening_float_count') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_opening_float_count] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'enable_blind_cash_count') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [enable_blind_cash_count] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'max_drawer_cash_limit') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [max_drawer_cash_limit] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_reason_for_payout') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_reason_for_payout] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'allow_multiple_shifts_per_terminal') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [allow_multiple_shifts_per_terminal] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'enable_cashier_x_report') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [enable_cashier_x_report] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'show_opening_float_at_close') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [show_opening_float_at_close] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'show_expected_totals_at_close') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [show_expected_totals_at_close] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'show_live_variance_at_close') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [show_live_variance_at_close] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'show_itemized_tender_breakdown') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [show_itemized_tender_breakdown] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_manager_pin_on_variance') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_manager_pin_on_variance] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'variance_pin_threshold') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [variance_pin_threshold] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'max_cashier_discount_percent') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [max_cashier_discount_percent] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'max_cart_discount_amount') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [max_cart_discount_amount] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'allow_discount_stacking') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [allow_discount_stacking] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_reason_for_price_override') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_reason_for_price_override] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'prevent_below_cost_sale') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [prevent_below_cost_sale] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'allow_tax_exemption') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [allow_tax_exemption] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'prevent_negative_stock_sale') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [prevent_negative_stock_sale] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_receipt_for_refund') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_receipt_for_refund] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_manager_pin_for_refund') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_manager_pin_for_refund] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'max_refund_days_limit') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [max_refund_days_limit] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'track_item_voids') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [track_item_voids] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'auto_lock_timeout_seconds') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [auto_lock_timeout_seconds] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_manager_pin_for_cash_drawer_open') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_manager_pin_for_cash_drawer_open] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'enable_manager_pin_audit_log') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [enable_manager_pin_audit_log] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_pin_void_cart') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_pin_void_cart] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_pin_void_line') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_pin_void_line] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_pin_reduce_qty') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_pin_reduce_qty] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_pin_manual_discount') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_pin_manual_discount] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_pin_price_override') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_pin_price_override] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_pin_stock_adjustment') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_pin_stock_adjustment] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_pin_shift_close') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_pin_shift_close] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_pin_edit_tenders') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_pin_edit_tenders] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'require_pin_terminal_reset') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [require_pin_terminal_reset] bit NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'row_version') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'row_version'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'updated_by') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [updated_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'updated_at') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'updated_at'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.pos_store_settings', N'allow_offline_approvals') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [allow_offline_approvals] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'allow_offline_approvals') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'allow_offline_approvals'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_allow_offline_approvals] DEFAULT (1) FOR [allow_offline_approvals];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'allow_offline_approvals' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [allow_offline_approvals]=1 WHERE [allow_offline_approvals] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [allow_offline_approvals] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'offline_approval_requires_pin') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [offline_approval_requires_pin] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'offline_approval_requires_pin') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'offline_approval_requires_pin'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_offline_approval_requires_pin] DEFAULT (1) FOR [offline_approval_requires_pin];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'offline_approval_requires_pin' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [offline_approval_requires_pin]=1 WHERE [offline_approval_requires_pin] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [offline_approval_requires_pin] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_void_cart') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_void_cart] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_void_cart') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_void_cart'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_void_cart] DEFAULT (0) FOR [online_only_void_cart];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_void_cart' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_void_cart]=0 WHERE [online_only_void_cart] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_void_cart] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_void_line') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_void_line] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_void_line') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_void_line'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_void_line] DEFAULT (0) FOR [online_only_void_line];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_void_line' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_void_line]=0 WHERE [online_only_void_line] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_void_line] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_reduce_qty') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_reduce_qty] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_reduce_qty') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_reduce_qty'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_reduce_qty] DEFAULT (0) FOR [online_only_reduce_qty];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_reduce_qty' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_reduce_qty]=0 WHERE [online_only_reduce_qty] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_reduce_qty] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_manual_discount') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_manual_discount] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_manual_discount') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_manual_discount'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_manual_discount] DEFAULT (0) FOR [online_only_manual_discount];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_manual_discount' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_manual_discount]=0 WHERE [online_only_manual_discount] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_manual_discount] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_price_override') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_price_override] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_price_override') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_price_override'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_price_override] DEFAULT (0) FOR [online_only_price_override];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_price_override' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_price_override]=0 WHERE [online_only_price_override] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_price_override] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_stock_adjustment') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_stock_adjustment] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_stock_adjustment') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_stock_adjustment'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_stock_adjustment] DEFAULT (0) FOR [online_only_stock_adjustment];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_stock_adjustment' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_stock_adjustment]=0 WHERE [online_only_stock_adjustment] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_stock_adjustment] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_shift_close') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_shift_close] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_shift_close') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_shift_close'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_shift_close] DEFAULT (0) FOR [online_only_shift_close];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_shift_close' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_shift_close]=0 WHERE [online_only_shift_close] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_shift_close] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_edit_tenders') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_edit_tenders] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_edit_tenders') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_edit_tenders'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_edit_tenders] DEFAULT (0) FOR [online_only_edit_tenders];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_edit_tenders' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_edit_tenders]=0 WHERE [online_only_edit_tenders] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_edit_tenders] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_terminal_reset') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_terminal_reset] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_terminal_reset') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_terminal_reset'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_terminal_reset] DEFAULT (0) FOR [online_only_terminal_reset];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_terminal_reset' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_terminal_reset]=0 WHERE [online_only_terminal_reset] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_terminal_reset] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'online_only_refund') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [online_only_refund] bit NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'online_only_refund') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'online_only_refund'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_online_only_refund] DEFAULT (0) FOR [online_only_refund];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'online_only_refund' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [online_only_refund]=0 WHERE [online_only_refund] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [online_only_refund] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'created_at') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'created_at'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.pos_store_settings', N'idle_timeout_minutes') IS NULL ALTER TABLE dbo.[pos_store_settings] ADD [idle_timeout_minutes] int NULL;

IF OBJECT_ID(N'dbo.pos_store_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_store_settings', N'idle_timeout_minutes') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_store_settings') AND c.name=N'idle_timeout_minutes'
) ALTER TABLE dbo.[pos_store_settings] ADD CONSTRAINT [DF_pos_store_settings_idle_timeout_minutes] DEFAULT (30) FOR [idle_timeout_minutes];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'idle_timeout_minutes' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[pos_store_settings] SET [idle_timeout_minutes]=30 WHERE [idle_timeout_minutes] IS NULL;';
  ALTER TABLE dbo.[pos_store_settings] ALTER COLUMN [idle_timeout_minutes] int NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'IX_pos_store_settings_store_id') CREATE INDEX [IX_pos_store_settings_store_id] ON dbo.[pos_store_settings]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.pos_store_settings') AND name=N'IX_pos_store_settings_updated_at') CREATE INDEX [IX_pos_store_settings_updated_at] ON dbo.[pos_store_settings]([updated_at]);

IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NULL BEGIN CREATE TABLE dbo.[settings_scoped] (

  [scope] nvarchar(128) NOT NULL CONSTRAINT [DF_settings_scoped_scope] DEFAULT ('GLOBAL'),
  [scope_id] nvarchar(128) NOT NULL CONSTRAINT [DF_settings_scoped_scope_id] DEFAULT (''),
  [key] nvarchar(128) NOT NULL,
  [value] nvarchar(max) NULL,
  [is_overridden] bit NOT NULL CONSTRAINT [DF_settings_scoped_is_overridden] DEFAULT (1),
  [updated_by] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_settings_scoped_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_settings_scoped_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] int NOT NULL CONSTRAINT [DF_settings_scoped_row_version] DEFAULT (1),
  CONSTRAINT [PK_settings_scoped] PRIMARY KEY ([scope], [scope_id], [key])

); END;

IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.settings_scoped')) ALTER TABLE dbo.[settings_scoped] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.settings_scoped', N'scope') IS NULL ALTER TABLE dbo.[settings_scoped] ADD [scope] nvarchar(128) NULL;

IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_scoped', N'scope') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'scope'
) ALTER TABLE dbo.[settings_scoped] ADD CONSTRAINT [DF_settings_scoped_scope] DEFAULT ('GLOBAL') FOR [scope];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_scoped') AND name=N'scope' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_scoped] SET [scope]=''GLOBAL'' WHERE [scope] IS NULL;';
  ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [scope] nvarchar(128) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'scope' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [scope] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.settings_scoped', N'scope_id') IS NULL ALTER TABLE dbo.[settings_scoped] ADD [scope_id] nvarchar(128) NULL;

IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_scoped', N'scope_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'scope_id'
) ALTER TABLE dbo.[settings_scoped] ADD CONSTRAINT [DF_settings_scoped_scope_id] DEFAULT ('') FOR [scope_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_scoped') AND name=N'scope_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_scoped] SET [scope_id]='''' WHERE [scope_id] IS NULL;';
  ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [scope_id] nvarchar(128) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'scope_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [scope_id] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.settings_scoped', N'key') IS NULL ALTER TABLE dbo.[settings_scoped] ADD [key] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'key' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [key] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.settings_scoped', N'value') IS NULL ALTER TABLE dbo.[settings_scoped] ADD [value] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.settings_scoped', N'is_overridden') IS NULL ALTER TABLE dbo.[settings_scoped] ADD [is_overridden] bit NULL;

IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_scoped', N'is_overridden') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'is_overridden'
) ALTER TABLE dbo.[settings_scoped] ADD CONSTRAINT [DF_settings_scoped_is_overridden] DEFAULT (1) FOR [is_overridden];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_scoped') AND name=N'is_overridden' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_scoped] SET [is_overridden]=1 WHERE [is_overridden] IS NULL;';
  ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [is_overridden] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.settings_scoped', N'updated_by') IS NULL ALTER TABLE dbo.[settings_scoped] ADD [updated_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.settings_scoped', N'created_at') IS NULL ALTER TABLE dbo.[settings_scoped] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_scoped', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'created_at'
) ALTER TABLE dbo.[settings_scoped] ADD CONSTRAINT [DF_settings_scoped_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_scoped') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_scoped] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.settings_scoped', N'updated_at') IS NULL ALTER TABLE dbo.[settings_scoped] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_scoped', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'updated_at'
) ALTER TABLE dbo.[settings_scoped] ADD CONSTRAINT [DF_settings_scoped_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_scoped') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_scoped] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.settings_scoped', N'row_version') IS NULL ALTER TABLE dbo.[settings_scoped] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_scoped', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_scoped') AND c.name=N'row_version'
) ALTER TABLE dbo.[settings_scoped] ADD CONSTRAINT [DF_settings_scoped_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.settings_scoped') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[settings_scoped] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[settings_scoped] ALTER COLUMN [row_version] int NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.settings_scoped') AND name=N'IX_settings_scoped_updated_at') CREATE INDEX [IX_settings_scoped_updated_at] ON dbo.[settings_scoped]([updated_at]);

IF OBJECT_ID(N'dbo.stock_count_drafts', N'U') IS NULL BEGIN CREATE TABLE dbo.[stock_count_drafts] (

  [id] uniqueidentifier NOT NULL,
  [store_id] nvarchar(450) NULL,
  [terminal_id] nvarchar(max) NULL,
  [staff_id] nvarchar(max) NULL,
  [staff_name] nvarchar(max) NULL,
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_stock_count_drafts_status] DEFAULT ('draft'),
  [reason] nvarchar(max) NULL,
  [note] nvarchar(max) NOT NULL CONSTRAINT [DF_stock_count_drafts_note] DEFAULT (''),
  [lines] nvarchar(max) NOT NULL CONSTRAINT [DF_stock_count_drafts_lines] DEFAULT (N'[]'),
  [line_count] int NOT NULL CONSTRAINT [DF_stock_count_drafts_line_count] DEFAULT (0),
  [total_impact] decimal(18,4) NOT NULL CONSTRAINT [DF_stock_count_drafts_total_impact] DEFAULT (0),
  [posted_at] datetimeoffset(7) NULL,
  [posted_by] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_stock_count_drafts_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_stock_count_drafts_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [reference] nvarchar(450) NULL,
  [store_code] nvarchar(max) NULL,
  [pending_edit_request_id] uniqueidentifier NULL,
  [pending_edit_by] nvarchar(max) NULL,
  [pending_edit_at] datetimeoffset(7) NULL,
  CONSTRAINT [PK_stock_count_drafts] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.stock_count_drafts', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts')) ALTER TABLE dbo.[stock_count_drafts] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'id') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'store_id') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'terminal_id') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'staff_id') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'staff_name') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [staff_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'status') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stock_count_drafts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_count_drafts', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'status'
) ALTER TABLE dbo.[stock_count_drafts] ADD CONSTRAINT [DF_stock_count_drafts_status] DEFAULT ('draft') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_count_drafts] SET [status]=''draft'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'reason') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'note') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [note] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stock_count_drafts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_count_drafts', N'note') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'note'
) ALTER TABLE dbo.[stock_count_drafts] ADD CONSTRAINT [DF_stock_count_drafts_note] DEFAULT ('') FOR [note];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'note' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_count_drafts] SET [note]='''' WHERE [note] IS NULL;';
  ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [note] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'lines') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [lines] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.stock_count_drafts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_count_drafts', N'lines') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'lines'
) ALTER TABLE dbo.[stock_count_drafts] ADD CONSTRAINT [DF_stock_count_drafts_lines] DEFAULT (N'[]') FOR [lines];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'lines' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_count_drafts] SET [lines]=N''[]'' WHERE [lines] IS NULL;';
  ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [lines] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'line_count') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [line_count] int NULL;

IF OBJECT_ID(N'dbo.stock_count_drafts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_count_drafts', N'line_count') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'line_count'
) ALTER TABLE dbo.[stock_count_drafts] ADD CONSTRAINT [DF_stock_count_drafts_line_count] DEFAULT (0) FOR [line_count];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'line_count' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_count_drafts] SET [line_count]=0 WHERE [line_count] IS NULL;';
  ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [line_count] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'total_impact') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [total_impact] decimal(18,4) NULL;

IF OBJECT_ID(N'dbo.stock_count_drafts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_count_drafts', N'total_impact') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'total_impact'
) ALTER TABLE dbo.[stock_count_drafts] ADD CONSTRAINT [DF_stock_count_drafts_total_impact] DEFAULT (0) FOR [total_impact];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'total_impact' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_count_drafts] SET [total_impact]=0 WHERE [total_impact] IS NULL;';
  ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [total_impact] decimal(18,4) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'posted_at') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [posted_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'posted_by') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [posted_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'created_at') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.stock_count_drafts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_count_drafts', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'created_at'
) ALTER TABLE dbo.[stock_count_drafts] ADD CONSTRAINT [DF_stock_count_drafts_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_count_drafts] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'updated_at') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.stock_count_drafts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.stock_count_drafts', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'updated_at'
) ALTER TABLE dbo.[stock_count_drafts] ADD CONSTRAINT [DF_stock_count_drafts_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[stock_count_drafts] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'reference') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [reference] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND c.name=N'reference' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[stock_count_drafts] ALTER COLUMN [reference] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'store_code') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [store_code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'pending_edit_request_id') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [pending_edit_request_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'pending_edit_by') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [pending_edit_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.stock_count_drafts', N'pending_edit_at') IS NULL ALTER TABLE dbo.[stock_count_drafts] ADD [pending_edit_at] datetimeoffset(7) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'UX_stock_count_drafts_reference') CREATE UNIQUE INDEX [UX_stock_count_drafts_reference] ON dbo.[stock_count_drafts]([reference]) WHERE [reference] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'IX_stock_count_drafts_store_id') CREATE INDEX [IX_stock_count_drafts_store_id] ON dbo.[stock_count_drafts]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.stock_count_drafts') AND name=N'IX_stock_count_drafts_updated_at') CREATE INDEX [IX_stock_count_drafts_updated_at] ON dbo.[stock_count_drafts]([updated_at]);

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NULL BEGIN CREATE TABLE dbo.[authorization_actions] (

  [id] uniqueidentifier NOT NULL,
  [action_key] nvarchar(128) NOT NULL,
  [scope_type] nvarchar(128) NOT NULL CONSTRAINT [DF_authorization_actions_scope_type] DEFAULT ('global'),
  [scope_id] nvarchar(128) NOT NULL CONSTRAINT [DF_authorization_actions_scope_id] DEFAULT (''),
  [mode] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_actions_mode] DEFAULT ('none'),
  [allowed_roles] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_actions_allowed_roles] DEFAULT (N'[]'),
  [allowed_user_ids] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_actions_allowed_user_ids] DEFAULT (N'[]'),
  [requester_roles] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_actions_requester_roles] DEFAULT (N'[]'),
  [requester_user_ids] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_actions_requester_user_ids] DEFAULT (N'[]'),
  [authority_limits] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_actions_authority_limits] DEFAULT (N'{}'),
  [extra_authority] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_actions_extra_authority] DEFAULT (N'{}'),
  [absolute_ceilings] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_actions_absolute_ceilings] DEFAULT (N'{}'),
  [approval_timeout_minutes] int NOT NULL CONSTRAINT [DF_authorization_actions_approval_timeout_minutes] DEFAULT (15),
  [escalation_after_minutes] int NULL,
  [escalation_roles] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_actions_escalation_roles] DEFAULT (N'[]'),
  [require_reason] bit NOT NULL CONSTRAINT [DF_authorization_actions_require_reason] DEFAULT (0),
  [threshold] decimal(38,12) NULL,
  [is_enabled] bit NOT NULL CONSTRAINT [DF_authorization_actions_is_enabled] DEFAULT (1),
  [row_version] int NOT NULL CONSTRAINT [DF_authorization_actions_row_version] DEFAULT (1),
  [updated_by] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_authorization_actions_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_authorization_actions_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_authorization_actions] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.authorization_actions')) ALTER TABLE dbo.[authorization_actions] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.authorization_actions', N'id') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.authorization_actions', N'action_key') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [action_key] nvarchar(128) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'action_key' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [action_key] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.authorization_actions', N'scope_type') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [scope_type] nvarchar(128) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'scope_type') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'scope_type'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_scope_type] DEFAULT ('global') FOR [scope_type];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'scope_type' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [scope_type]=''global'' WHERE [scope_type] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [scope_type] nvarchar(128) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'scope_type' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [scope_type] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.authorization_actions', N'scope_id') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [scope_id] nvarchar(128) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'scope_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'scope_id'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_scope_id] DEFAULT ('') FOR [scope_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'scope_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [scope_id]='''' WHERE [scope_id] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [scope_id] nvarchar(128) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'scope_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [scope_id] nvarchar(128) NOT NULL;

IF COL_LENGTH(N'dbo.authorization_actions', N'mode') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [mode] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'mode') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'mode'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_mode] DEFAULT ('none') FOR [mode];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'mode' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [mode]=''none'' WHERE [mode] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [mode] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'allowed_roles') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [allowed_roles] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'allowed_roles') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'allowed_roles'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_allowed_roles] DEFAULT (N'[]') FOR [allowed_roles];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'allowed_roles' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [allowed_roles]=N''[]'' WHERE [allowed_roles] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [allowed_roles] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'allowed_user_ids') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [allowed_user_ids] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'allowed_user_ids') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'allowed_user_ids'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_allowed_user_ids] DEFAULT (N'[]') FOR [allowed_user_ids];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'allowed_user_ids' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [allowed_user_ids]=N''[]'' WHERE [allowed_user_ids] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [allowed_user_ids] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'requester_roles') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [requester_roles] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'requester_roles') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'requester_roles'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_requester_roles] DEFAULT (N'[]') FOR [requester_roles];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'requester_roles' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [requester_roles]=N''[]'' WHERE [requester_roles] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [requester_roles] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'requester_user_ids') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [requester_user_ids] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'requester_user_ids') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'requester_user_ids'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_requester_user_ids] DEFAULT (N'[]') FOR [requester_user_ids];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'requester_user_ids' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [requester_user_ids]=N''[]'' WHERE [requester_user_ids] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [requester_user_ids] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'authority_limits') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [authority_limits] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'authority_limits') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'authority_limits'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_authority_limits] DEFAULT (N'{}') FOR [authority_limits];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'authority_limits' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [authority_limits]=N''{}'' WHERE [authority_limits] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [authority_limits] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'extra_authority') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [extra_authority] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'extra_authority') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'extra_authority'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_extra_authority] DEFAULT (N'{}') FOR [extra_authority];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'extra_authority' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [extra_authority]=N''{}'' WHERE [extra_authority] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [extra_authority] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'absolute_ceilings') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [absolute_ceilings] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'absolute_ceilings') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'absolute_ceilings'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_absolute_ceilings] DEFAULT (N'{}') FOR [absolute_ceilings];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'absolute_ceilings' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [absolute_ceilings]=N''{}'' WHERE [absolute_ceilings] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [absolute_ceilings] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'approval_timeout_minutes') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [approval_timeout_minutes] int NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'approval_timeout_minutes') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'approval_timeout_minutes'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_approval_timeout_minutes] DEFAULT (15) FOR [approval_timeout_minutes];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'approval_timeout_minutes' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [approval_timeout_minutes]=15 WHERE [approval_timeout_minutes] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [approval_timeout_minutes] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'escalation_after_minutes') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [escalation_after_minutes] int NULL;

IF COL_LENGTH(N'dbo.authorization_actions', N'escalation_roles') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [escalation_roles] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'escalation_roles') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'escalation_roles'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_escalation_roles] DEFAULT (N'[]') FOR [escalation_roles];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'escalation_roles' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [escalation_roles]=N''[]'' WHERE [escalation_roles] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [escalation_roles] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'require_reason') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [require_reason] bit NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'require_reason') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'require_reason'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_require_reason] DEFAULT (0) FOR [require_reason];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'require_reason' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [require_reason]=0 WHERE [require_reason] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [require_reason] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'threshold') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [threshold] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.authorization_actions', N'is_enabled') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [is_enabled] bit NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'is_enabled') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'is_enabled'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_is_enabled] DEFAULT (1) FOR [is_enabled];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'is_enabled' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [is_enabled]=1 WHERE [is_enabled] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [is_enabled] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'row_version') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [row_version] int NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'row_version'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [row_version] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'updated_by') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [updated_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_actions', N'created_at') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'created_at'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_actions', N'updated_at') IS NULL ALTER TABLE dbo.[authorization_actions] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'updated_at'
) ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_actions] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_actions') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_actions] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'UQ_authorization_actions_0') CREATE UNIQUE INDEX [UQ_authorization_actions_0] ON dbo.[authorization_actions]([action_key],[scope_type],[scope_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.authorization_actions') AND name=N'IX_authorization_actions_updated_at') CREATE INDEX [IX_authorization_actions_updated_at] ON dbo.[authorization_actions]([updated_at]);

IF OBJECT_ID(N'dbo.authorization_action_history', N'U') IS NULL BEGIN CREATE TABLE dbo.[authorization_action_history] (

  [id] uniqueidentifier NOT NULL,
  [action_id] uniqueidentifier NOT NULL,
  [action_key] nvarchar(max) NOT NULL,
  [scope_type] nvarchar(max) NOT NULL,
  [scope_id] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_action_history_scope_id] DEFAULT (''),
  [row_version] int NOT NULL,
  [changed_by] nvarchar(max) NOT NULL,
  [change_source] nvarchar(max) NOT NULL,
  [change_kind] nvarchar(max) NOT NULL,
  [snapshot] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_action_history_snapshot] DEFAULT (N'{}'),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_authorization_action_history_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_authorization_action_history] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.authorization_action_history', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.authorization_action_history')) ALTER TABLE dbo.[authorization_action_history] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.authorization_action_history', N'id') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_action_history') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_action_history] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.authorization_action_history', N'action_id') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [action_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.authorization_action_history', N'action_key') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [action_key] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_action_history', N'scope_type') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [scope_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_action_history', N'scope_id') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [scope_id] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_action_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_action_history', N'scope_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_action_history') AND c.name=N'scope_id'
) ALTER TABLE dbo.[authorization_action_history] ADD CONSTRAINT [DF_authorization_action_history_scope_id] DEFAULT ('') FOR [scope_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_action_history') AND name=N'scope_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_action_history] SET [scope_id]='''' WHERE [scope_id] IS NULL;';
  ALTER TABLE dbo.[authorization_action_history] ALTER COLUMN [scope_id] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_action_history', N'row_version') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [row_version] int NULL;

IF COL_LENGTH(N'dbo.authorization_action_history', N'changed_by') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [changed_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_action_history', N'change_source') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [change_source] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_action_history', N'change_kind') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [change_kind] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_action_history', N'snapshot') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [snapshot] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_action_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_action_history', N'snapshot') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_action_history') AND c.name=N'snapshot'
) ALTER TABLE dbo.[authorization_action_history] ADD CONSTRAINT [DF_authorization_action_history_snapshot] DEFAULT (N'{}') FOR [snapshot];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_action_history') AND name=N'snapshot' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_action_history] SET [snapshot]=N''{}'' WHERE [snapshot] IS NULL;';
  ALTER TABLE dbo.[authorization_action_history] ALTER COLUMN [snapshot] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_action_history', N'created_at') IS NULL ALTER TABLE dbo.[authorization_action_history] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.authorization_action_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_action_history', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_action_history') AND c.name=N'created_at'
) ALTER TABLE dbo.[authorization_action_history] ADD CONSTRAINT [DF_authorization_action_history_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_action_history') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_action_history] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[authorization_action_history] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NULL BEGIN CREATE TABLE dbo.[authorization_requests] (

  [id] uniqueidentifier NOT NULL,
  [action_key] nvarchar(max) NOT NULL,
  [requested_by] nvarchar(max) NOT NULL,
  [requested_by_name] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_requested_by_name] DEFAULT (''),
  [store_id] nvarchar(450) NOT NULL CONSTRAINT [DF_authorization_requests_store_id] DEFAULT (''),
  [terminal_id] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_terminal_id] DEFAULT (''),
  [reason] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_reason] DEFAULT (''),
  [payload] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_payload] DEFAULT (N'{}'),
  [status] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_status] DEFAULT ('pending'),
  [decided_by] nvarchar(max) NULL,
  [decided_by_name] nvarchar(max) NULL,
  [decided_at] datetimeoffset(7) NULL,
  [decision_note] nvarchar(max) NULL,
  [expires_at] datetimeoffset(7) NOT NULL,
  [consumed_at] datetimeoffset(7) NULL,
  [requester_direct_limit] decimal(38,12) NULL,
  [value_unit] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_value_unit] DEFAULT ('number'),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_authorization_requests_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_authorization_requests_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [approval_route] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_approval_route] DEFAULT (N'{}'),
  [requested_amount] decimal(38,12) NULL,
  [approved_amount] decimal(38,12) NULL,
  [approved_payload] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_approved_payload] DEFAULT (N'{}'),
  [bill_snapshot] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_bill_snapshot] DEFAULT (N'{}'),
  [snapshot_hash] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_requests_snapshot_hash] DEFAULT (''),
  [held_order_id] nvarchar(max) NULL,
  [notified_at] datetimeoffset(7) NULL,
  CONSTRAINT [PK_authorization_requests] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.authorization_requests')) ALTER TABLE dbo.[authorization_requests] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.authorization_requests', N'id') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'action_key') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [action_key] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'requested_by') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [requested_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'requested_by_name') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [requested_by_name] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'requested_by_name') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'requested_by_name'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_requested_by_name] DEFAULT ('') FOR [requested_by_name];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'requested_by_name' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [requested_by_name]='''' WHERE [requested_by_name] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [requested_by_name] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'store_id') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [store_id] nvarchar(450) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'store_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'store_id'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_store_id] DEFAULT ('') FOR [store_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'store_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [store_id]='''' WHERE [store_id] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'terminal_id') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [terminal_id] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'terminal_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'terminal_id'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_terminal_id] DEFAULT ('') FOR [terminal_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'terminal_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [terminal_id]='''' WHERE [terminal_id] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [terminal_id] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'reason') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [reason] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'reason') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'reason'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_reason] DEFAULT ('') FOR [reason];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'reason' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [reason]='''' WHERE [reason] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [reason] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'payload') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [payload] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'payload') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'payload'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_payload] DEFAULT (N'{}') FOR [payload];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'payload' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [payload]=N''{}'' WHERE [payload] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [payload] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'status') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'status'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_status] DEFAULT ('pending') FOR [status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [status]=''pending'' WHERE [status] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'decided_by') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [decided_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'decided_by_name') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [decided_by_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'decided_at') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [decided_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'decision_note') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [decision_note] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'expires_at') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [expires_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'consumed_at') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [consumed_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'requester_direct_limit') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [requester_direct_limit] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'value_unit') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [value_unit] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'value_unit') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'value_unit'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_value_unit] DEFAULT ('number') FOR [value_unit];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'value_unit' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [value_unit]=''number'' WHERE [value_unit] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [value_unit] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'created_at') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'created_at'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'updated_at') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'updated_at'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'approval_route') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [approval_route] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'approval_route') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'approval_route'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_approval_route] DEFAULT (N'{}') FOR [approval_route];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'approval_route' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [approval_route]=N''{}'' WHERE [approval_route] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [approval_route] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'requested_amount') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [requested_amount] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'approved_amount') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [approved_amount] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'approved_payload') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [approved_payload] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'approved_payload') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'approved_payload'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_approved_payload] DEFAULT (N'{}') FOR [approved_payload];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'approved_payload' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [approved_payload]=N''{}'' WHERE [approved_payload] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [approved_payload] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'bill_snapshot') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [bill_snapshot] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'bill_snapshot') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'bill_snapshot'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_bill_snapshot] DEFAULT (N'{}') FOR [bill_snapshot];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'bill_snapshot' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [bill_snapshot]=N''{}'' WHERE [bill_snapshot] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [bill_snapshot] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'snapshot_hash') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [snapshot_hash] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'snapshot_hash') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'snapshot_hash'
) ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_snapshot_hash] DEFAULT ('') FOR [snapshot_hash];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'snapshot_hash' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_requests] SET [snapshot_hash]='''' WHERE [snapshot_hash] IS NULL;';
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [snapshot_hash] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_requests', N'held_order_id') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [held_order_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_requests', N'notified_at') IS NULL ALTER TABLE dbo.[authorization_requests] ADD [notified_at] datetimeoffset(7) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'IX_authorization_requests_store_id') CREATE INDEX [IX_authorization_requests_store_id] ON dbo.[authorization_requests]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.authorization_requests') AND name=N'IX_authorization_requests_updated_at') CREATE INDEX [IX_authorization_requests_updated_at] ON dbo.[authorization_requests]([updated_at]);

IF OBJECT_ID(N'dbo.authorization_log', N'U') IS NULL BEGIN CREATE TABLE dbo.[authorization_log] (

  [id] uniqueidentifier NOT NULL,
  [action_key] nvarchar(max) NOT NULL,
  [mode_used] nvarchar(max) NOT NULL,
  [request_id] uniqueidentifier NULL,
  [requested_by] nvarchar(max) NULL,
  [authorized_by] nvarchar(max) NULL,
  [authorizer_role] nvarchar(max) NULL,
  [store_id] nvarchar(450) NOT NULL CONSTRAINT [DF_authorization_log_store_id] DEFAULT (''),
  [terminal_id] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_log_terminal_id] DEFAULT (''),
  [outcome] nvarchar(max) NOT NULL,
  [detail] nvarchar(max) NOT NULL CONSTRAINT [DF_authorization_log_detail] DEFAULT (N'{}'),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_authorization_log_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_authorization_log] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.authorization_log', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.authorization_log')) ALTER TABLE dbo.[authorization_log] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.authorization_log', N'id') IS NULL ALTER TABLE dbo.[authorization_log] ADD [id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_log') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_log] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.authorization_log', N'action_key') IS NULL ALTER TABLE dbo.[authorization_log] ADD [action_key] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_log', N'mode_used') IS NULL ALTER TABLE dbo.[authorization_log] ADD [mode_used] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_log', N'request_id') IS NULL ALTER TABLE dbo.[authorization_log] ADD [request_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.authorization_log', N'requested_by') IS NULL ALTER TABLE dbo.[authorization_log] ADD [requested_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_log', N'authorized_by') IS NULL ALTER TABLE dbo.[authorization_log] ADD [authorized_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_log', N'authorizer_role') IS NULL ALTER TABLE dbo.[authorization_log] ADD [authorizer_role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_log', N'store_id') IS NULL ALTER TABLE dbo.[authorization_log] ADD [store_id] nvarchar(450) NULL;

IF OBJECT_ID(N'dbo.authorization_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_log', N'store_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_log') AND c.name=N'store_id'
) ALTER TABLE dbo.[authorization_log] ADD CONSTRAINT [DF_authorization_log_store_id] DEFAULT ('') FOR [store_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_log') AND name=N'store_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_log] SET [store_id]='''' WHERE [store_id] IS NULL;';
  ALTER TABLE dbo.[authorization_log] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.authorization_log') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[authorization_log] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.authorization_log', N'terminal_id') IS NULL ALTER TABLE dbo.[authorization_log] ADD [terminal_id] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_log', N'terminal_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_log') AND c.name=N'terminal_id'
) ALTER TABLE dbo.[authorization_log] ADD CONSTRAINT [DF_authorization_log_terminal_id] DEFAULT ('') FOR [terminal_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_log') AND name=N'terminal_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_log] SET [terminal_id]='''' WHERE [terminal_id] IS NULL;';
  ALTER TABLE dbo.[authorization_log] ALTER COLUMN [terminal_id] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_log', N'outcome') IS NULL ALTER TABLE dbo.[authorization_log] ADD [outcome] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.authorization_log', N'detail') IS NULL ALTER TABLE dbo.[authorization_log] ADD [detail] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.authorization_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_log', N'detail') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_log') AND c.name=N'detail'
) ALTER TABLE dbo.[authorization_log] ADD CONSTRAINT [DF_authorization_log_detail] DEFAULT (N'{}') FOR [detail];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_log') AND name=N'detail' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_log] SET [detail]=N''{}'' WHERE [detail] IS NULL;';
  ALTER TABLE dbo.[authorization_log] ALTER COLUMN [detail] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.authorization_log', N'created_at') IS NULL ALTER TABLE dbo.[authorization_log] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.authorization_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_log', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_log') AND c.name=N'created_at'
) ALTER TABLE dbo.[authorization_log] ADD CONSTRAINT [DF_authorization_log_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.authorization_log') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[authorization_log] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[authorization_log] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.authorization_log') AND name=N'IX_authorization_log_store_id') CREATE INDEX [IX_authorization_log_store_id] ON dbo.[authorization_log]([store_id]);

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NULL BEGIN CREATE TABLE dbo.[record_edits] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_record_edits_id] DEFAULT (NEWID()),
  [record_type] nvarchar(max) NOT NULL,
  [record_id] nvarchar(max) NOT NULL,
  [reference] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [terminal_id] nvarchar(max) NULL,
  [action_key] nvarchar(max) NOT NULL,
  [request_id] uniqueidentifier NULL,
  [edited_by] nvarchar(max) NULL,
  [edited_by_name] nvarchar(max) NULL,
  [authorized_by] nvarchar(max) NULL,
  [authorized_by_name] nvarchar(max) NULL,
  [mode_used] nvarchar(max) NULL,
  [before_value] nvarchar(max) NOT NULL CONSTRAINT [DF_record_edits_before_value] DEFAULT (N'{}'),
  [after_value] nvarchar(max) NOT NULL CONSTRAINT [DF_record_edits_after_value] DEFAULT (N'{}'),
  [stock_deltas] nvarchar(max) NOT NULL CONSTRAINT [DF_record_edits_stock_deltas] DEFAULT (N'{}'),
  [note] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_record_edits_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_record_edits] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.record_edits')) ALTER TABLE dbo.[record_edits] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.record_edits', N'id') IS NULL ALTER TABLE dbo.[record_edits] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.record_edits', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.record_edits') AND c.name=N'id'
) ALTER TABLE dbo.[record_edits] ADD CONSTRAINT [DF_record_edits_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.record_edits') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[record_edits] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[record_edits] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.record_edits') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[record_edits] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.record_edits', N'record_type') IS NULL ALTER TABLE dbo.[record_edits] ADD [record_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'record_id') IS NULL ALTER TABLE dbo.[record_edits] ADD [record_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'reference') IS NULL ALTER TABLE dbo.[record_edits] ADD [reference] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'store_id') IS NULL ALTER TABLE dbo.[record_edits] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.record_edits') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[record_edits] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'terminal_id') IS NULL ALTER TABLE dbo.[record_edits] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'action_key') IS NULL ALTER TABLE dbo.[record_edits] ADD [action_key] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'request_id') IS NULL ALTER TABLE dbo.[record_edits] ADD [request_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.record_edits', N'edited_by') IS NULL ALTER TABLE dbo.[record_edits] ADD [edited_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'edited_by_name') IS NULL ALTER TABLE dbo.[record_edits] ADD [edited_by_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'authorized_by') IS NULL ALTER TABLE dbo.[record_edits] ADD [authorized_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'authorized_by_name') IS NULL ALTER TABLE dbo.[record_edits] ADD [authorized_by_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'mode_used') IS NULL ALTER TABLE dbo.[record_edits] ADD [mode_used] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'before_value') IS NULL ALTER TABLE dbo.[record_edits] ADD [before_value] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.record_edits', N'before_value') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.record_edits') AND c.name=N'before_value'
) ALTER TABLE dbo.[record_edits] ADD CONSTRAINT [DF_record_edits_before_value] DEFAULT (N'{}') FOR [before_value];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.record_edits') AND name=N'before_value' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[record_edits] SET [before_value]=N''{}'' WHERE [before_value] IS NULL;';
  ALTER TABLE dbo.[record_edits] ALTER COLUMN [before_value] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.record_edits', N'after_value') IS NULL ALTER TABLE dbo.[record_edits] ADD [after_value] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.record_edits', N'after_value') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.record_edits') AND c.name=N'after_value'
) ALTER TABLE dbo.[record_edits] ADD CONSTRAINT [DF_record_edits_after_value] DEFAULT (N'{}') FOR [after_value];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.record_edits') AND name=N'after_value' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[record_edits] SET [after_value]=N''{}'' WHERE [after_value] IS NULL;';
  ALTER TABLE dbo.[record_edits] ALTER COLUMN [after_value] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.record_edits', N'stock_deltas') IS NULL ALTER TABLE dbo.[record_edits] ADD [stock_deltas] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.record_edits', N'stock_deltas') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.record_edits') AND c.name=N'stock_deltas'
) ALTER TABLE dbo.[record_edits] ADD CONSTRAINT [DF_record_edits_stock_deltas] DEFAULT (N'{}') FOR [stock_deltas];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.record_edits') AND name=N'stock_deltas' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[record_edits] SET [stock_deltas]=N''{}'' WHERE [stock_deltas] IS NULL;';
  ALTER TABLE dbo.[record_edits] ALTER COLUMN [stock_deltas] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.record_edits', N'note') IS NULL ALTER TABLE dbo.[record_edits] ADD [note] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.record_edits', N'created_at') IS NULL ALTER TABLE dbo.[record_edits] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.record_edits', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.record_edits') AND c.name=N'created_at'
) ALTER TABLE dbo.[record_edits] ADD CONSTRAINT [DF_record_edits_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.record_edits') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[record_edits] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[record_edits] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.record_edits') AND name=N'IX_record_edits_store_id') CREATE INDEX [IX_record_edits_store_id] ON dbo.[record_edits]([store_id]);

IF OBJECT_ID(N'dbo.shift_cash_counts', N'U') IS NULL BEGIN CREATE TABLE dbo.[shift_cash_counts] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_shift_cash_counts_id] DEFAULT (NEWID()),
  [shift_id] uniqueidentifier NOT NULL,
  [store_id] nvarchar(450) NOT NULL,
  [terminal_id] nvarchar(max) NULL,
  [kind] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_cash_counts_kind] DEFAULT ('ORIGINAL'),
  [counted_cash] decimal(38,12) NOT NULL,
  [counted_card] decimal(38,12) NULL,
  [counted_digital] decimal(38,12) NULL,
  [reason] nvarchar(max) NULL,
  [counted_by_name] nvarchar(max) NULL,
  [counted_by_staff_id] nvarchar(max) NULL,
  [counted_by_user_id] uniqueidentifier NULL,
  [client_key] nvarchar(450) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shift_cash_counts_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_shift_cash_counts] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.shift_cash_counts', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts')) ALTER TABLE dbo.[shift_cash_counts] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'id') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.shift_cash_counts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_cash_counts', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND c.name=N'id'
) ALTER TABLE dbo.[shift_cash_counts] ADD CONSTRAINT [DF_shift_cash_counts_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_cash_counts] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[shift_cash_counts] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_cash_counts] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'shift_id') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [shift_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND c.name=N'shift_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_cash_counts] ALTER COLUMN [shift_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'store_id') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_cash_counts] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'terminal_id') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'kind') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [kind] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_cash_counts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_cash_counts', N'kind') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND c.name=N'kind'
) ALTER TABLE dbo.[shift_cash_counts] ADD CONSTRAINT [DF_shift_cash_counts_kind] DEFAULT ('ORIGINAL') FOR [kind];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND name=N'kind' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_cash_counts] SET [kind]=''ORIGINAL'' WHERE [kind] IS NULL;';
  ALTER TABLE dbo.[shift_cash_counts] ALTER COLUMN [kind] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'counted_cash') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [counted_cash] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'counted_card') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [counted_card] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'counted_digital') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [counted_digital] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'reason') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'counted_by_name') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [counted_by_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'counted_by_staff_id') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [counted_by_staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'counted_by_user_id') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [counted_by_user_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'client_key') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [client_key] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND c.name=N'client_key' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_cash_counts] ALTER COLUMN [client_key] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.shift_cash_counts', N'created_at') IS NULL ALTER TABLE dbo.[shift_cash_counts] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shift_cash_counts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_cash_counts', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND c.name=N'created_at'
) ALTER TABLE dbo.[shift_cash_counts] ADD CONSTRAINT [DF_shift_cash_counts_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_cash_counts] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[shift_cash_counts] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND name=N'UX_shift_cash_counts_shift_id') CREATE UNIQUE INDEX [UX_shift_cash_counts_shift_id] ON dbo.[shift_cash_counts]([shift_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND name=N'UX_shift_cash_counts_client_key') CREATE UNIQUE INDEX [UX_shift_cash_counts_client_key] ON dbo.[shift_cash_counts]([client_key]) WHERE [client_key] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND name=N'IX_shift_cash_counts_store_id') CREATE INDEX [IX_shift_cash_counts_store_id] ON dbo.[shift_cash_counts]([store_id]);

IF OBJECT_ID(N'dbo.shift_close_events', N'U') IS NULL BEGIN CREATE TABLE dbo.[shift_close_events] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_shift_close_events_id] DEFAULT (NEWID()),
  [shift_id] uniqueidentifier NOT NULL,
  [store_id] nvarchar(450) NOT NULL,
  [terminal_id] nvarchar(max) NULL,
  [event] nvarchar(max) NOT NULL,
  [from_state] nvarchar(max) NULL,
  [to_state] nvarchar(max) NULL,
  [detail] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_close_events_detail] DEFAULT (N'{}'),
  [actor_name] nvarchar(max) NULL,
  [actor_staff_id] nvarchar(max) NULL,
  [actor_user_id] uniqueidentifier NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shift_close_events_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_shift_close_events] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.shift_close_events', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.shift_close_events')) ALTER TABLE dbo.[shift_close_events] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.shift_close_events', N'id') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.shift_close_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_close_events', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_close_events') AND c.name=N'id'
) ALTER TABLE dbo.[shift_close_events] ADD CONSTRAINT [DF_shift_close_events_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_close_events') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_close_events] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[shift_close_events] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_close_events') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_close_events] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'shift_id') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [shift_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_close_events') AND c.name=N'shift_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_close_events] ALTER COLUMN [shift_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'store_id') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_close_events') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_close_events] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'terminal_id') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'event') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [event] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'from_state') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [from_state] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'to_state') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [to_state] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'detail') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [detail] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_close_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_close_events', N'detail') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_close_events') AND c.name=N'detail'
) ALTER TABLE dbo.[shift_close_events] ADD CONSTRAINT [DF_shift_close_events_detail] DEFAULT (N'{}') FOR [detail];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_close_events') AND name=N'detail' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_close_events] SET [detail]=N''{}'' WHERE [detail] IS NULL;';
  ALTER TABLE dbo.[shift_close_events] ALTER COLUMN [detail] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_close_events', N'actor_name') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [actor_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'actor_staff_id') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [actor_staff_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'actor_user_id') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [actor_user_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.shift_close_events', N'created_at') IS NULL ALTER TABLE dbo.[shift_close_events] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shift_close_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_close_events', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_close_events') AND c.name=N'created_at'
) ALTER TABLE dbo.[shift_close_events] ADD CONSTRAINT [DF_shift_close_events_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_close_events') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_close_events] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[shift_close_events] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_close_events') AND name=N'IX_shift_close_events_store_id') CREATE INDEX [IX_shift_close_events_store_id] ON dbo.[shift_close_events]([store_id]);

IF OBJECT_ID(N'dbo.shift_reconciliations', N'U') IS NULL BEGIN CREATE TABLE dbo.[shift_reconciliations] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_shift_reconciliations_id] DEFAULT (NEWID()),
  [shift_id] uniqueidentifier NOT NULL,
  [store_id] nvarchar(450) NOT NULL,
  [count_id] uniqueidentifier NULL,
  [expected_cash] decimal(38,12) NOT NULL CONSTRAINT [DF_shift_reconciliations_expected_cash] DEFAULT (0),
  [expected_card] decimal(38,12) NOT NULL CONSTRAINT [DF_shift_reconciliations_expected_card] DEFAULT (0),
  [expected_digital] decimal(38,12) NOT NULL CONSTRAINT [DF_shift_reconciliations_expected_digital] DEFAULT (0),
  [counted_cash] decimal(38,12) NULL,
  [counted_card] decimal(38,12) NULL,
  [counted_digital] decimal(38,12) NULL,
  [variance_cash] decimal(38,12) NULL,
  [variance_card] decimal(38,12) NULL,
  [variance_digital] decimal(38,12) NULL,
  [variance_total] decimal(38,12) NULL,
  [variance_status] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_reconciliations_variance_status] DEFAULT ('NO_VARIANCE'),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shift_reconciliations_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_shift_reconciliations] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.shift_reconciliations', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.shift_reconciliations')) ALTER TABLE dbo.[shift_reconciliations] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'id') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.shift_reconciliations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_reconciliations', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'id'
) ALTER TABLE dbo.[shift_reconciliations] ADD CONSTRAINT [DF_shift_reconciliations_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_reconciliations] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'shift_id') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [shift_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'shift_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [shift_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'store_id') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'count_id') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [count_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'count_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [count_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'expected_cash') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [expected_cash] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.shift_reconciliations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_reconciliations', N'expected_cash') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'expected_cash'
) ALTER TABLE dbo.[shift_reconciliations] ADD CONSTRAINT [DF_shift_reconciliations_expected_cash] DEFAULT (0) FOR [expected_cash];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND name=N'expected_cash' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_reconciliations] SET [expected_cash]=0 WHERE [expected_cash] IS NULL;';
  ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [expected_cash] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'expected_card') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [expected_card] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.shift_reconciliations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_reconciliations', N'expected_card') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'expected_card'
) ALTER TABLE dbo.[shift_reconciliations] ADD CONSTRAINT [DF_shift_reconciliations_expected_card] DEFAULT (0) FOR [expected_card];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND name=N'expected_card' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_reconciliations] SET [expected_card]=0 WHERE [expected_card] IS NULL;';
  ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [expected_card] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'expected_digital') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [expected_digital] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.shift_reconciliations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_reconciliations', N'expected_digital') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'expected_digital'
) ALTER TABLE dbo.[shift_reconciliations] ADD CONSTRAINT [DF_shift_reconciliations_expected_digital] DEFAULT (0) FOR [expected_digital];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND name=N'expected_digital' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_reconciliations] SET [expected_digital]=0 WHERE [expected_digital] IS NULL;';
  ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [expected_digital] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'counted_cash') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [counted_cash] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'counted_card') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [counted_card] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'counted_digital') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [counted_digital] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'variance_cash') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [variance_cash] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'variance_card') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [variance_card] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'variance_digital') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [variance_digital] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'variance_total') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [variance_total] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'variance_status') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [variance_status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_reconciliations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_reconciliations', N'variance_status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'variance_status'
) ALTER TABLE dbo.[shift_reconciliations] ADD CONSTRAINT [DF_shift_reconciliations_variance_status] DEFAULT ('NO_VARIANCE') FOR [variance_status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND name=N'variance_status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_reconciliations] SET [variance_status]=''NO_VARIANCE'' WHERE [variance_status] IS NULL;';
  ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [variance_status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_reconciliations', N'created_at') IS NULL ALTER TABLE dbo.[shift_reconciliations] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shift_reconciliations', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_reconciliations', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND c.name=N'created_at'
) ALTER TABLE dbo.[shift_reconciliations] ADD CONSTRAINT [DF_shift_reconciliations_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_reconciliations] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[shift_reconciliations] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND name=N'IX_shift_reconciliations_store_id') CREATE INDEX [IX_shift_reconciliations_store_id] ON dbo.[shift_reconciliations]([store_id]);

IF OBJECT_ID(N'dbo.shift_variance_alerts', N'U') IS NULL BEGIN CREATE TABLE dbo.[shift_variance_alerts] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_shift_variance_alerts_id] DEFAULT (NEWID()),
  [shift_id] uniqueidentifier NOT NULL,
  [store_id] nvarchar(450) NOT NULL,
  [reconciliation_id] uniqueidentifier NULL,
  [variance_total] decimal(38,12) NOT NULL,
  [variance_status] nvarchar(max) NOT NULL,
  [severity] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_variance_alerts_severity] DEFAULT ('warning'),
  [message] nvarchar(max) NOT NULL,
  [delivery_status] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_variance_alerts_delivery_status] DEFAULT ('pending'),
  [attempts] int NOT NULL CONSTRAINT [DF_shift_variance_alerts_attempts] DEFAULT (0),
  [last_error] nvarchar(max) NULL,
  [last_attempt_at] datetimeoffset(7) NULL,
  [acknowledged_at] datetimeoffset(7) NULL,
  [acknowledged_by] nvarchar(max) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shift_variance_alerts_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shift_variance_alerts_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_shift_variance_alerts] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.shift_variance_alerts', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts')) ALTER TABLE dbo.[shift_variance_alerts] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'id') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.shift_variance_alerts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_variance_alerts', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'id'
) ALTER TABLE dbo.[shift_variance_alerts] ADD CONSTRAINT [DF_shift_variance_alerts_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_variance_alerts] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'shift_id') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [shift_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'shift_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [shift_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'store_id') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'reconciliation_id') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [reconciliation_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'reconciliation_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [reconciliation_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'variance_total') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [variance_total] decimal(38,12) NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'variance_status') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [variance_status] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'severity') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [severity] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_variance_alerts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_variance_alerts', N'severity') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'severity'
) ALTER TABLE dbo.[shift_variance_alerts] ADD CONSTRAINT [DF_shift_variance_alerts_severity] DEFAULT ('warning') FOR [severity];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'severity' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_variance_alerts] SET [severity]=''warning'' WHERE [severity] IS NULL;';
  ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [severity] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'message') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [message] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'delivery_status') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [delivery_status] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_variance_alerts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_variance_alerts', N'delivery_status') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'delivery_status'
) ALTER TABLE dbo.[shift_variance_alerts] ADD CONSTRAINT [DF_shift_variance_alerts_delivery_status] DEFAULT ('pending') FOR [delivery_status];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'delivery_status' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_variance_alerts] SET [delivery_status]=''pending'' WHERE [delivery_status] IS NULL;';
  ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [delivery_status] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'attempts') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [attempts] int NULL;

IF OBJECT_ID(N'dbo.shift_variance_alerts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_variance_alerts', N'attempts') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'attempts'
) ALTER TABLE dbo.[shift_variance_alerts] ADD CONSTRAINT [DF_shift_variance_alerts_attempts] DEFAULT (0) FOR [attempts];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'attempts' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_variance_alerts] SET [attempts]=0 WHERE [attempts] IS NULL;';
  ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [attempts] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'last_error') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [last_error] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'last_attempt_at') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [last_attempt_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'acknowledged_at') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [acknowledged_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'acknowledged_by') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [acknowledged_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'created_at') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shift_variance_alerts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_variance_alerts', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'created_at'
) ALTER TABLE dbo.[shift_variance_alerts] ADD CONSTRAINT [DF_shift_variance_alerts_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_variance_alerts] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_variance_alerts', N'updated_at') IS NULL ALTER TABLE dbo.[shift_variance_alerts] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shift_variance_alerts', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_variance_alerts', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'updated_at'
) ALTER TABLE dbo.[shift_variance_alerts] ADD CONSTRAINT [DF_shift_variance_alerts_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_variance_alerts] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_variance_alerts] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'UX_shift_variance_alerts_reconciliation_id') CREATE UNIQUE INDEX [UX_shift_variance_alerts_reconciliation_id] ON dbo.[shift_variance_alerts]([reconciliation_id]) WHERE [reconciliation_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'IX_shift_variance_alerts_store_id') CREATE INDEX [IX_shift_variance_alerts_store_id] ON dbo.[shift_variance_alerts]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'IX_shift_variance_alerts_updated_at') CREATE INDEX [IX_shift_variance_alerts_updated_at] ON dbo.[shift_variance_alerts]([updated_at]);

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NULL BEGIN CREATE TABLE dbo.[shift_notifications] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_shift_notifications_id] DEFAULT (NEWID()),
  [shift_id] uniqueidentifier NOT NULL,
  [store_id] nvarchar(450) NOT NULL,
  [store_name] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_notifications_store_name] DEFAULT (''),
  [terminal_name] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_notifications_terminal_name] DEFAULT (''),
  [closed_by] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_notifications_closed_by] DEFAULT (''),
  [opened_at] datetimeoffset(7) NOT NULL,
  [closed_at] datetimeoffset(7) NOT NULL,
  [total_sales] decimal(38,12) NOT NULL CONSTRAINT [DF_shift_notifications_total_sales] DEFAULT (0),
  [transactions] int NOT NULL CONSTRAINT [DF_shift_notifications_transactions] DEFAULT (0),
  [discounts] decimal(38,12) NOT NULL CONSTRAINT [DF_shift_notifications_discounts] DEFAULT (0),
  [refunds] decimal(38,12) NOT NULL CONSTRAINT [DF_shift_notifications_refunds] DEFAULT (0),
  [expected_cash] decimal(38,12) NOT NULL CONSTRAINT [DF_shift_notifications_expected_cash] DEFAULT (0),
  [counted_cash] decimal(38,12) NOT NULL CONSTRAINT [DF_shift_notifications_counted_cash] DEFAULT (0),
  [payment_breakdown] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_notifications_payment_breakdown] DEFAULT (N'{}'),
  [summary] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_notifications_summary] DEFAULT (''),
  [channels] nvarchar(max) NOT NULL CONSTRAINT [DF_shift_notifications_channels] DEFAULT (N'[]'),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_shift_notifications_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_shift_notifications] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.shift_notifications')) ALTER TABLE dbo.[shift_notifications] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.shift_notifications', N'id') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'id'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_notifications', N'shift_id') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [shift_id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'shift_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [shift_id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.shift_notifications', N'store_id') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [store_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.shift_notifications', N'store_name') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [store_name] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'store_name') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'store_name'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_store_name] DEFAULT ('') FOR [store_name];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'store_name' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [store_name]='''' WHERE [store_name] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [store_name] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'terminal_name') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [terminal_name] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'terminal_name') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'terminal_name'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_terminal_name] DEFAULT ('') FOR [terminal_name];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'terminal_name' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [terminal_name]='''' WHERE [terminal_name] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [terminal_name] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'closed_by') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [closed_by] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'closed_by') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'closed_by'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_closed_by] DEFAULT ('') FOR [closed_by];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'closed_by' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [closed_by]='''' WHERE [closed_by] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [closed_by] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'opened_at') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [opened_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.shift_notifications', N'closed_at') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [closed_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.shift_notifications', N'total_sales') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [total_sales] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'total_sales') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'total_sales'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_total_sales] DEFAULT (0) FOR [total_sales];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'total_sales' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [total_sales]=0 WHERE [total_sales] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [total_sales] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'transactions') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [transactions] int NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'transactions') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'transactions'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_transactions] DEFAULT (0) FOR [transactions];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'transactions' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [transactions]=0 WHERE [transactions] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [transactions] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'discounts') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [discounts] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'discounts') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'discounts'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_discounts] DEFAULT (0) FOR [discounts];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'discounts' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [discounts]=0 WHERE [discounts] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [discounts] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'refunds') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [refunds] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'refunds') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'refunds'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_refunds] DEFAULT (0) FOR [refunds];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'refunds' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [refunds]=0 WHERE [refunds] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [refunds] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'expected_cash') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [expected_cash] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'expected_cash') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'expected_cash'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_expected_cash] DEFAULT (0) FOR [expected_cash];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'expected_cash' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [expected_cash]=0 WHERE [expected_cash] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [expected_cash] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'counted_cash') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [counted_cash] decimal(38,12) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'counted_cash') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'counted_cash'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_counted_cash] DEFAULT (0) FOR [counted_cash];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'counted_cash' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [counted_cash]=0 WHERE [counted_cash] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [counted_cash] decimal(38,12) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'payment_breakdown') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [payment_breakdown] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'payment_breakdown') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'payment_breakdown'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_payment_breakdown] DEFAULT (N'{}') FOR [payment_breakdown];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'payment_breakdown' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [payment_breakdown]=N''{}'' WHERE [payment_breakdown] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [payment_breakdown] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'summary') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [summary] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'summary') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'summary'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_summary] DEFAULT ('') FOR [summary];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'summary' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [summary]='''' WHERE [summary] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [summary] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'channels') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [channels] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'channels') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'channels'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_channels] DEFAULT (N'[]') FOR [channels];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'channels' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [channels]=N''[]'' WHERE [channels] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [channels] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.shift_notifications', N'created_at') IS NULL ALTER TABLE dbo.[shift_notifications] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND c.name=N'created_at'
) ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[shift_notifications] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[shift_notifications] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'UX_shift_notifications_shift_id') CREATE UNIQUE INDEX [UX_shift_notifications_shift_id] ON dbo.[shift_notifications]([shift_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'IX_shift_notifications_store_id') CREATE INDEX [IX_shift_notifications_store_id] ON dbo.[shift_notifications]([store_id]);

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NULL BEGIN CREATE TABLE dbo.[entity_status_history] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_entity_status_history_id] DEFAULT (NEWID()),
  [entity_type] nvarchar(max) NOT NULL,
  [entity_id] nvarchar(max) NOT NULL,
  [status_kind] nvarchar(max) NOT NULL CONSTRAINT [DF_entity_status_history_status_kind] DEFAULT ('status'),
  [previous_status] nvarchar(max) NULL,
  [new_status] nvarchar(max) NOT NULL,
  [reason] nvarchar(max) NULL,
  [actor_id] nvarchar(max) NULL,
  [actor_name] nvarchar(max) NULL,
  [actor_role] nvarchar(max) NULL,
  [store_id] nvarchar(450) NULL,
  [branch_id] nvarchar(450) NULL,
  [terminal_id] nvarchar(max) NULL,
  [related_entity_type] nvarchar(max) NULL,
  [related_entity_id] nvarchar(max) NULL,
  [metadata] nvarchar(max) NOT NULL CONSTRAINT [DF_entity_status_history_metadata] DEFAULT (N'{}'),
  [client_event_id] nvarchar(450) NULL,
  [occurred_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_entity_status_history_occurred_at] DEFAULT (SYSDATETIMEOFFSET()),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_entity_status_history_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_entity_status_history_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  [row_version] bigint NOT NULL CONSTRAINT [DF_entity_status_history_row_version] DEFAULT (1),
  CONSTRAINT [PK_entity_status_history] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.entity_status_history')) ALTER TABLE dbo.[entity_status_history] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.entity_status_history', N'id') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.entity_status_history', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'id'
) ALTER TABLE dbo.[entity_status_history] ADD CONSTRAINT [DF_entity_status_history_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[entity_status_history] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'entity_type') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [entity_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'entity_id') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [entity_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'status_kind') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [status_kind] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.entity_status_history', N'status_kind') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'status_kind'
) ALTER TABLE dbo.[entity_status_history] ADD CONSTRAINT [DF_entity_status_history_status_kind] DEFAULT ('status') FOR [status_kind];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'status_kind' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[entity_status_history] SET [status_kind]=''status'' WHERE [status_kind] IS NULL;';
  ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [status_kind] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.entity_status_history', N'previous_status') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [previous_status] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'new_status') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [new_status] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'reason') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [reason] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'actor_id') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [actor_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'actor_name') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [actor_name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'actor_role') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [actor_role] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'store_id') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [store_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'store_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [store_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'branch_id') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [branch_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'branch_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [branch_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'terminal_id') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'related_entity_type') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [related_entity_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'related_entity_id') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [related_entity_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'metadata') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [metadata] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.entity_status_history', N'metadata') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'metadata'
) ALTER TABLE dbo.[entity_status_history] ADD CONSTRAINT [DF_entity_status_history_metadata] DEFAULT (N'{}') FOR [metadata];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'metadata' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[entity_status_history] SET [metadata]=N''{}'' WHERE [metadata] IS NULL;';
  ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [metadata] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.entity_status_history', N'client_event_id') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [client_event_id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'client_event_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [client_event_id] nvarchar(450) NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'occurred_at') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [occurred_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.entity_status_history', N'occurred_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'occurred_at'
) ALTER TABLE dbo.[entity_status_history] ADD CONSTRAINT [DF_entity_status_history_occurred_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [occurred_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'occurred_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[entity_status_history] SET [occurred_at]=SYSDATETIMEOFFSET() WHERE [occurred_at] IS NULL;';
  ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [occurred_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.entity_status_history', N'created_at') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.entity_status_history', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'created_at'
) ALTER TABLE dbo.[entity_status_history] ADD CONSTRAINT [DF_entity_status_history_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[entity_status_history] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.entity_status_history', N'updated_at') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.entity_status_history', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'updated_at'
) ALTER TABLE dbo.[entity_status_history] ADD CONSTRAINT [DF_entity_status_history_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[entity_status_history] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF COL_LENGTH(N'dbo.entity_status_history', N'row_version') IS NULL ALTER TABLE dbo.[entity_status_history] ADD [row_version] bigint NULL;

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.entity_status_history', N'row_version') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.entity_status_history') AND c.name=N'row_version'
) ALTER TABLE dbo.[entity_status_history] ADD CONSTRAINT [DF_entity_status_history_row_version] DEFAULT (1) FOR [row_version];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'row_version' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[entity_status_history] SET [row_version]=1 WHERE [row_version] IS NULL;';
  ALTER TABLE dbo.[entity_status_history] ALTER COLUMN [row_version] bigint NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'UX_entity_status_history_client_event_id') CREATE UNIQUE INDEX [UX_entity_status_history_client_event_id] ON dbo.[entity_status_history]([client_event_id]) WHERE [client_event_id] IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'IX_entity_status_history_store_id') CREATE INDEX [IX_entity_status_history_store_id] ON dbo.[entity_status_history]([store_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'IX_entity_status_history_branch_id') CREATE INDEX [IX_entity_status_history_branch_id] ON dbo.[entity_status_history]([branch_id]);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.entity_status_history') AND name=N'IX_entity_status_history_updated_at') CREATE INDEX [IX_entity_status_history_updated_at] ON dbo.[entity_status_history]([updated_at]);

IF OBJECT_ID(N'dbo.nav_pins', N'U') IS NULL BEGIN CREATE TABLE dbo.[nav_pins] (

  [id] uniqueidentifier NOT NULL,
  [owner_id] uniqueidentifier NULL,
  [item_kind] nvarchar(max) NOT NULL,
  [item_key] nvarchar(max) NOT NULL,
  [sort_order] int NOT NULL CONSTRAINT [DF_nav_pins_sort_order] DEFAULT (0),
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_nav_pins_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_nav_pins_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_nav_pins] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.nav_pins', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.nav_pins')) ALTER TABLE dbo.[nav_pins] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.nav_pins', N'id') IS NULL ALTER TABLE dbo.[nav_pins] ADD [id] uniqueidentifier NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.nav_pins') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[nav_pins] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.nav_pins', N'owner_id') IS NULL ALTER TABLE dbo.[nav_pins] ADD [owner_id] uniqueidentifier NULL;

IF COL_LENGTH(N'dbo.nav_pins', N'item_kind') IS NULL ALTER TABLE dbo.[nav_pins] ADD [item_kind] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.nav_pins', N'item_key') IS NULL ALTER TABLE dbo.[nav_pins] ADD [item_key] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.nav_pins', N'sort_order') IS NULL ALTER TABLE dbo.[nav_pins] ADD [sort_order] int NULL;

IF OBJECT_ID(N'dbo.nav_pins', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.nav_pins', N'sort_order') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.nav_pins') AND c.name=N'sort_order'
) ALTER TABLE dbo.[nav_pins] ADD CONSTRAINT [DF_nav_pins_sort_order] DEFAULT (0) FOR [sort_order];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.nav_pins') AND name=N'sort_order' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[nav_pins] SET [sort_order]=0 WHERE [sort_order] IS NULL;';
  ALTER TABLE dbo.[nav_pins] ALTER COLUMN [sort_order] int NOT NULL;
END;

IF COL_LENGTH(N'dbo.nav_pins', N'created_at') IS NULL ALTER TABLE dbo.[nav_pins] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.nav_pins', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.nav_pins', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.nav_pins') AND c.name=N'created_at'
) ALTER TABLE dbo.[nav_pins] ADD CONSTRAINT [DF_nav_pins_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.nav_pins') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[nav_pins] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[nav_pins] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.nav_pins', N'updated_at') IS NULL ALTER TABLE dbo.[nav_pins] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.nav_pins', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.nav_pins', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.nav_pins') AND c.name=N'updated_at'
) ALTER TABLE dbo.[nav_pins] ADD CONSTRAINT [DF_nav_pins_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.nav_pins') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[nav_pins] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[nav_pins] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.nav_pins') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[nav_pins] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.nav_pins') AND name=N'IX_nav_pins_updated_at') CREATE INDEX [IX_nav_pins_updated_at] ON dbo.[nav_pins]([updated_at]);

IF OBJECT_ID(N'dbo.store_groups', N'U') IS NULL BEGIN CREATE TABLE dbo.[store_groups] (

  [id] nvarchar(450) NOT NULL,
  [code] nvarchar(max) NOT NULL,
  [name] nvarchar(max) NOT NULL,
  [is_active] bit NOT NULL CONSTRAINT [DF_store_groups_is_active] DEFAULT (1),
  [archived_at] datetimeoffset(7) NULL,
  [created_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_store_groups_created_at] DEFAULT (SYSDATETIMEOFFSET()),
  [updated_at] datetimeoffset(7) NOT NULL CONSTRAINT [DF_store_groups_updated_at] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_store_groups] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.store_groups', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.store_groups')) ALTER TABLE dbo.[store_groups] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.store_groups', N'id') IS NULL ALTER TABLE dbo.[store_groups] ADD [id] nvarchar(450) NULL;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.store_groups') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[store_groups] ALTER COLUMN [id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.store_groups', N'code') IS NULL ALTER TABLE dbo.[store_groups] ADD [code] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.store_groups', N'name') IS NULL ALTER TABLE dbo.[store_groups] ADD [name] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.store_groups', N'is_active') IS NULL ALTER TABLE dbo.[store_groups] ADD [is_active] bit NULL;

IF OBJECT_ID(N'dbo.store_groups', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.store_groups', N'is_active') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.store_groups') AND c.name=N'is_active'
) ALTER TABLE dbo.[store_groups] ADD CONSTRAINT [DF_store_groups_is_active] DEFAULT (1) FOR [is_active];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.store_groups') AND name=N'is_active' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[store_groups] SET [is_active]=1 WHERE [is_active] IS NULL;';
  ALTER TABLE dbo.[store_groups] ALTER COLUMN [is_active] bit NOT NULL;
END;

IF COL_LENGTH(N'dbo.store_groups', N'archived_at') IS NULL ALTER TABLE dbo.[store_groups] ADD [archived_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.store_groups', N'created_at') IS NULL ALTER TABLE dbo.[store_groups] ADD [created_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.store_groups', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.store_groups', N'created_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.store_groups') AND c.name=N'created_at'
) ALTER TABLE dbo.[store_groups] ADD CONSTRAINT [DF_store_groups_created_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [created_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.store_groups') AND name=N'created_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[store_groups] SET [created_at]=SYSDATETIMEOFFSET() WHERE [created_at] IS NULL;';
  ALTER TABLE dbo.[store_groups] ALTER COLUMN [created_at] datetimeoffset(7) NOT NULL;
END;

IF COL_LENGTH(N'dbo.store_groups', N'updated_at') IS NULL ALTER TABLE dbo.[store_groups] ADD [updated_at] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.store_groups', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.store_groups', N'updated_at') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.store_groups') AND c.name=N'updated_at'
) ALTER TABLE dbo.[store_groups] ADD CONSTRAINT [DF_store_groups_updated_at] DEFAULT (SYSDATETIMEOFFSET()) FOR [updated_at];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.store_groups') AND name=N'updated_at' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[store_groups] SET [updated_at]=SYSDATETIMEOFFSET() WHERE [updated_at] IS NULL;';
  ALTER TABLE dbo.[store_groups] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.store_groups') AND c.name=N'updated_at' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[store_groups] ALTER COLUMN [updated_at] datetimeoffset(7) NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.store_groups') AND name=N'IX_store_groups_updated_at') CREATE INDEX [IX_store_groups_updated_at] ON dbo.[store_groups]([updated_at]);

IF OBJECT_ID(N'dbo.change_history', N'U') IS NULL BEGIN CREATE TABLE dbo.[change_history] (

  [id] uniqueidentifier NOT NULL CONSTRAINT [DF_change_history_id] DEFAULT (NEWID()),
  [organization_id] nvarchar(450) NOT NULL CONSTRAINT [DF_change_history_organization_id] DEFAULT ('default'),
  [entity_type] nvarchar(max) NOT NULL,
  [entity_id] nvarchar(max) NOT NULL,
  [action] nvarchar(max) NOT NULL,
  [old_value] nvarchar(max) NULL,
  [new_value] nvarchar(max) NULL,
  [revision] bigint NOT NULL,
  [scope_type] nvarchar(max) NOT NULL CONSTRAINT [DF_change_history_scope_type] DEFAULT ('GLOBAL'),
  [scope_id] nvarchar(max) NULL,
  [changed_by] nvarchar(max) NULL,
  [source_application] nvarchar(max) NOT NULL CONSTRAINT [DF_change_history_source_application] DEFAULT ('web'),
  [device_id] nvarchar(max) NULL,
  [terminal_id] nvarchar(max) NULL,
  [server_timestamp] datetimeoffset(7) NOT NULL CONSTRAINT [DF_change_history_server_timestamp] DEFAULT (SYSDATETIMEOFFSET()),
  CONSTRAINT [PK_change_history] PRIMARY KEY ([id])

); END;

IF OBJECT_ID(N'dbo.change_history', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id=OBJECT_ID(N'dbo.change_history')) ALTER TABLE dbo.[change_history] ENABLE CHANGE_TRACKING;

IF COL_LENGTH(N'dbo.change_history', N'id') IS NULL ALTER TABLE dbo.[change_history] ADD [id] uniqueidentifier NULL;

IF OBJECT_ID(N'dbo.change_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.change_history', N'id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.change_history') AND c.name=N'id'
) ALTER TABLE dbo.[change_history] ADD CONSTRAINT [DF_change_history_id] DEFAULT (NEWID()) FOR [id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.change_history') AND name=N'id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[change_history] SET [id]=NEWID() WHERE [id] IS NULL;';
  ALTER TABLE dbo.[change_history] ALTER COLUMN [id] uniqueidentifier NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.change_history') AND c.name=N'id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[change_history] ALTER COLUMN [id] uniqueidentifier NOT NULL;

IF COL_LENGTH(N'dbo.change_history', N'organization_id') IS NULL ALTER TABLE dbo.[change_history] ADD [organization_id] nvarchar(450) NULL;

IF OBJECT_ID(N'dbo.change_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.change_history', N'organization_id') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.change_history') AND c.name=N'organization_id'
) ALTER TABLE dbo.[change_history] ADD CONSTRAINT [DF_change_history_organization_id] DEFAULT ('default') FOR [organization_id];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.change_history') AND name=N'organization_id' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[change_history] SET [organization_id]=''default'' WHERE [organization_id] IS NULL;';
  ALTER TABLE dbo.[change_history] ALTER COLUMN [organization_id] nvarchar(450) NOT NULL;
END;

IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.object_id=OBJECT_ID(N'dbo.change_history') AND c.name=N'organization_id' AND t.name IN (N'nvarchar',N'varchar') AND c.max_length=-1) ALTER TABLE dbo.[change_history] ALTER COLUMN [organization_id] nvarchar(450) NOT NULL;

IF COL_LENGTH(N'dbo.change_history', N'entity_type') IS NULL ALTER TABLE dbo.[change_history] ADD [entity_type] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.change_history', N'entity_id') IS NULL ALTER TABLE dbo.[change_history] ADD [entity_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.change_history', N'action') IS NULL ALTER TABLE dbo.[change_history] ADD [action] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.change_history', N'old_value') IS NULL ALTER TABLE dbo.[change_history] ADD [old_value] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.change_history', N'new_value') IS NULL ALTER TABLE dbo.[change_history] ADD [new_value] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.change_history', N'revision') IS NULL ALTER TABLE dbo.[change_history] ADD [revision] bigint NULL;

IF COL_LENGTH(N'dbo.change_history', N'scope_type') IS NULL ALTER TABLE dbo.[change_history] ADD [scope_type] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.change_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.change_history', N'scope_type') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.change_history') AND c.name=N'scope_type'
) ALTER TABLE dbo.[change_history] ADD CONSTRAINT [DF_change_history_scope_type] DEFAULT ('GLOBAL') FOR [scope_type];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.change_history') AND name=N'scope_type' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[change_history] SET [scope_type]=''GLOBAL'' WHERE [scope_type] IS NULL;';
  ALTER TABLE dbo.[change_history] ALTER COLUMN [scope_type] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.change_history', N'scope_id') IS NULL ALTER TABLE dbo.[change_history] ADD [scope_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.change_history', N'changed_by') IS NULL ALTER TABLE dbo.[change_history] ADD [changed_by] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.change_history', N'source_application') IS NULL ALTER TABLE dbo.[change_history] ADD [source_application] nvarchar(max) NULL;

IF OBJECT_ID(N'dbo.change_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.change_history', N'source_application') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.change_history') AND c.name=N'source_application'
) ALTER TABLE dbo.[change_history] ADD CONSTRAINT [DF_change_history_source_application] DEFAULT ('web') FOR [source_application];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.change_history') AND name=N'source_application' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[change_history] SET [source_application]=''web'' WHERE [source_application] IS NULL;';
  ALTER TABLE dbo.[change_history] ALTER COLUMN [source_application] nvarchar(max) NOT NULL;
END;

IF COL_LENGTH(N'dbo.change_history', N'device_id') IS NULL ALTER TABLE dbo.[change_history] ADD [device_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.change_history', N'terminal_id') IS NULL ALTER TABLE dbo.[change_history] ADD [terminal_id] nvarchar(max) NULL;

IF COL_LENGTH(N'dbo.change_history', N'server_timestamp') IS NULL ALTER TABLE dbo.[change_history] ADD [server_timestamp] datetimeoffset(7) NULL;

IF OBJECT_ID(N'dbo.change_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.change_history', N'server_timestamp') IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM sys.default_constraints dc
  JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
  WHERE dc.parent_object_id=OBJECT_ID(N'dbo.change_history') AND c.name=N'server_timestamp'
) ALTER TABLE dbo.[change_history] ADD CONSTRAINT [DF_change_history_server_timestamp] DEFAULT (SYSDATETIMEOFFSET()) FOR [server_timestamp];

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.change_history') AND name=N'server_timestamp' AND is_nullable=1) BEGIN
  EXEC sys.sp_executesql N'UPDATE dbo.[change_history] SET [server_timestamp]=SYSDATETIMEOFFSET() WHERE [server_timestamp] IS NULL;';
  ALTER TABLE dbo.[change_history] ALTER COLUMN [server_timestamp] datetimeoffset(7) NOT NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.change_history') AND name=N'IX_change_history_organization_id') CREATE INDEX [IX_change_history_organization_id] ON dbo.[change_history]([organization_id]);

-- Local member verification compatibility (excluded from sync)

IF COL_LENGTH(N'dbo.members', N'is_verified') IS NULL ALTER TABLE dbo.[members] ADD [is_verified] bit NOT NULL CONSTRAINT [DF_members_is_verified] DEFAULT (0) WITH VALUES;

IF COL_LENGTH(N'dbo.members', N'verified_at') IS NULL ALTER TABLE dbo.[members] ADD [verified_at] datetimeoffset(7) NULL;

IF COL_LENGTH(N'dbo.members', N'verified_channel') IS NULL ALTER TABLE dbo.[members] ADD [verified_channel] nvarchar(max) NULL;

GO
-- Store groups: preserve existing groups and repair missing parents
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.stores', N'U') IS NULL
    THROW 51100, 'POS_Local is missing dbo.stores. Run the complete POS_Local schema first.', 1;

  IF OBJECT_ID(N'dbo.store_groups', N'U') IS NULL
    THROW 51101, 'POS_Local is missing dbo.store_groups. Run the complete POS_Local schema first.', 1;

  /*
    0x434C4F5544 is the application's CLOUD change-tracking context. These
    repair rows satisfy local parent references and must not be uploaded as
    newly-authored local group changes. The next synchronization replaces
    their display fields with the authoritative Supabase rows.
  */
  WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
  MERGE dbo.store_groups WITH (HOLDLOCK) AS target
  USING (
    SELECT
      source_group.id,
      source_group.code,
      source_group.name
    FROM (
      SELECT
        CAST(N'default' AS nvarchar(450)) AS id,
        CAST(N'DEFAULT' AS nvarchar(max)) AS code,
        CAST(N'Default group' AS nvarchar(max)) AS name
      UNION ALL
      SELECT DISTINCT
        CAST(LTRIM(RTRIM(store_row.group_id)) AS nvarchar(450)) AS id,
        CAST(LTRIM(RTRIM(store_row.group_id)) AS nvarchar(max)) AS code,
        CAST(LTRIM(RTRIM(store_row.group_id)) AS nvarchar(max)) AS name
      FROM dbo.stores AS store_row
      WHERE NULLIF(LTRIM(RTRIM(store_row.group_id)), N'') IS NOT NULL
        AND LTRIM(RTRIM(store_row.group_id)) <> N'default'
    ) AS source_group
  ) AS source
  ON target.id = source.id
  WHEN NOT MATCHED THEN
    INSERT (id, code, name, is_active, archived_at, created_at, updated_at)
    VALUES (source.id, source.code, source.name, 1, NULL, SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET());

  IF EXISTS (
    SELECT 1
    FROM dbo.stores AS store_row
    LEFT JOIN dbo.store_groups AS group_row ON group_row.id = store_row.group_id
    WHERE NULLIF(LTRIM(RTRIM(store_row.group_id)), N'') IS NOT NULL
      AND group_row.id IS NULL
  )
    THROW 51102, 'Some stores still reference a missing store group. The transaction was rolled back.', 1;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.foreign_keys
    WHERE parent_object_id = OBJECT_ID(N'dbo.stores')
      AND name = N'FK_stores_group_id'
  )
    ALTER TABLE dbo.stores WITH CHECK
      ADD CONSTRAINT FK_stores_group_id
      FOREIGN KEY (group_id) REFERENCES dbo.store_groups(id);

  ALTER TABLE dbo.stores WITH CHECK CHECK CONSTRAINT FK_stores_group_id;

  COMMIT TRANSACTION;

  SELECT
    N'REPAIRED' AS status,
    (SELECT COUNT_BIG(*) FROM dbo.store_groups) AS local_store_groups,
    (SELECT COUNT_BIG(*) FROM dbo.stores WHERE group_id IS NOT NULL) AS stores_with_group;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO


IF OBJECT_ID(N'dbo.coupon_campaigns',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.issued_vouchers') AND name=N'FK_issued_vouchers_campaign_id') ALTER TABLE dbo.[issued_vouchers] ADD CONSTRAINT [FK_issued_vouchers_campaign_id] FOREIGN KEY ([campaign_id]) REFERENCES dbo.[coupon_campaigns]([id]);

IF OBJECT_ID(N'dbo.members',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.issued_vouchers') AND name=N'FK_issued_vouchers_member_id') ALTER TABLE dbo.[issued_vouchers] ADD CONSTRAINT [FK_issued_vouchers_member_id] FOREIGN KEY ([member_id]) REFERENCES dbo.[members]([id]);

IF OBJECT_ID(N'dbo.bookings',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.booking_payments') AND name=N'FK_booking_payments_booking_id') ALTER TABLE dbo.[booking_payments] ADD CONSTRAINT [FK_booking_payments_booking_id] FOREIGN KEY ([booking_id]) REFERENCES dbo.[bookings]([id]);

IF OBJECT_ID(N'dbo.members',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.bookings') AND name=N'FK_bookings_member_id') ALTER TABLE dbo.[bookings] ADD CONSTRAINT [FK_bookings_member_id] FOREIGN KEY ([member_id]) REFERENCES dbo.[members]([id]);

IF OBJECT_ID(N'dbo.coupon_campaigns',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.coupon_events') AND name=N'FK_coupon_events_campaign_id') ALTER TABLE dbo.[coupon_events] ADD CONSTRAINT [FK_coupon_events_campaign_id] FOREIGN KEY ([campaign_id]) REFERENCES dbo.[coupon_campaigns]([id]);

IF OBJECT_ID(N'dbo.members',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.coupon_events') AND name=N'FK_coupon_events_member_id') ALTER TABLE dbo.[coupon_events] ADD CONSTRAINT [FK_coupon_events_member_id] FOREIGN KEY ([member_id]) REFERENCES dbo.[members]([id]);

IF OBJECT_ID(N'dbo.products',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.item_activity_logs') AND name=N'FK_item_activity_logs_product_id') ALTER TABLE dbo.[item_activity_logs] ADD CONSTRAINT [FK_item_activity_logs_product_id] FOREIGN KEY ([product_id]) REFERENCES dbo.[products]([id]);

IF OBJECT_ID(N'dbo.members',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.member_verifications') AND name=N'FK_member_verifications_member_id') ALTER TABLE dbo.[member_verifications] ADD CONSTRAINT [FK_member_verifications_member_id] FOREIGN KEY ([member_id]) REFERENCES dbo.[members]([id]);

IF OBJECT_ID(N'dbo.membership_tiers',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.members') AND name=N'FK_members_tier_id') ALTER TABLE dbo.[members] ADD CONSTRAINT [FK_members_tier_id] FOREIGN KEY ([tier_id]) REFERENCES dbo.[membership_tiers]([id]);

IF OBJECT_ID(N'dbo.sales',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'FK_payment_transactions_sale_id') ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [FK_payment_transactions_sale_id] FOREIGN KEY ([sale_id]) REFERENCES dbo.[sales]([id]);

IF OBJECT_ID(N'dbo.bookings',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'FK_payment_transactions_booking_id') ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [FK_payment_transactions_booking_id] FOREIGN KEY ([booking_id]) REFERENCES dbo.[bookings]([id]);

IF OBJECT_ID(N'dbo.members',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.payment_transactions') AND name=N'FK_payment_transactions_member_id') ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [FK_payment_transactions_member_id] FOREIGN KEY ([member_id]) REFERENCES dbo.[members]([id]);

IF OBJECT_ID(N'dbo.products',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.product_barcodes') AND name=N'FK_product_barcodes_product_id') ALTER TABLE dbo.[product_barcodes] ADD CONSTRAINT [FK_product_barcodes_product_id] FOREIGN KEY ([product_id]) REFERENCES dbo.[products]([id]);

IF OBJECT_ID(N'dbo.product_categories',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.product_categories') AND name=N'FK_product_categories_parent_id') ALTER TABLE dbo.[product_categories] ADD CONSTRAINT [FK_product_categories_parent_id] FOREIGN KEY ([parent_id]) REFERENCES dbo.[product_categories]([id]);

IF OBJECT_ID(N'dbo.stores',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.products') AND name=N'FK_products_owner_store_id') ALTER TABLE dbo.[products] ADD CONSTRAINT [FK_products_owner_store_id] FOREIGN KEY ([owner_store_id]) REFERENCES dbo.[stores]([id]);

IF OBJECT_ID(N'dbo.products',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.promotions') AND name=N'FK_promotions_foc_product_id') ALTER TABLE dbo.[promotions] ADD CONSTRAINT [FK_promotions_foc_product_id] FOREIGN KEY ([foc_product_id]) REFERENCES dbo.[products]([id]);

IF OBJECT_ID(N'dbo.purchase_orders',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'FK_purchase_order_items_po_id') ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [FK_purchase_order_items_po_id] FOREIGN KEY ([po_id]) REFERENCES dbo.[purchase_orders]([id]);

IF OBJECT_ID(N'dbo.products',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.purchase_order_items') AND name=N'FK_purchase_order_items_product_id') ALTER TABLE dbo.[purchase_order_items] ADD CONSTRAINT [FK_purchase_order_items_product_id] FOREIGN KEY ([product_id]) REFERENCES dbo.[products]([id]);

IF OBJECT_ID(N'dbo.suppliers',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'FK_purchase_orders_supplier_id') ALTER TABLE dbo.[purchase_orders] ADD CONSTRAINT [FK_purchase_orders_supplier_id] FOREIGN KEY ([supplier_id]) REFERENCES dbo.[suppliers]([id]);

IF OBJECT_ID(N'dbo.sales',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'FK_sale_items_sale_id') ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [FK_sale_items_sale_id] FOREIGN KEY ([sale_id]) REFERENCES dbo.[sales]([id]);

IF OBJECT_ID(N'dbo.products',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.sale_items') AND name=N'FK_sale_items_product_id') ALTER TABLE dbo.[sale_items] ADD CONSTRAINT [FK_sale_items_product_id] FOREIGN KEY ([product_id]) REFERENCES dbo.[products]([id]);

IF OBJECT_ID(N'dbo.members',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.sales') AND name=N'FK_sales_member_id') ALTER TABLE dbo.[sales] ADD CONSTRAINT [FK_sales_member_id] FOREIGN KEY ([member_id]) REFERENCES dbo.[members]([id]);

IF OBJECT_ID(N'dbo.products',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.stock_adjustments') AND name=N'FK_stock_adjustments_product_id') ALTER TABLE dbo.[stock_adjustments] ADD CONSTRAINT [FK_stock_adjustments_product_id] FOREIGN KEY ([product_id]) REFERENCES dbo.[products]([id]);

IF OBJECT_ID(N'dbo.stock_transfers',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND name=N'FK_stock_transfer_items_transfer_id') ALTER TABLE dbo.[stock_transfer_items] ADD CONSTRAINT [FK_stock_transfer_items_transfer_id] FOREIGN KEY ([transfer_id]) REFERENCES dbo.[stock_transfers]([id]);

IF OBJECT_ID(N'dbo.products',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.stock_transfer_items') AND name=N'FK_stock_transfer_items_product_id') ALTER TABLE dbo.[stock_transfer_items] ADD CONSTRAINT [FK_stock_transfer_items_product_id] FOREIGN KEY ([product_id]) REFERENCES dbo.[products]([id]);

IF OBJECT_ID(N'dbo.stock_transfers',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.stock_transfers') AND name=N'FK_stock_transfers_source_request_id') ALTER TABLE dbo.[stock_transfers] ADD CONSTRAINT [FK_stock_transfers_source_request_id] FOREIGN KEY ([source_request_id]) REFERENCES dbo.[stock_transfers]([id]);

IF OBJECT_ID(N'dbo.store_groups',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.stores') AND name=N'FK_stores_group_id') ALTER TABLE dbo.[stores] ADD CONSTRAINT [FK_stores_group_id] FOREIGN KEY ([group_id]) REFERENCES dbo.[store_groups]([id]);

IF OBJECT_ID(N'dbo.stores',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.stores') AND name=N'FK_stores_parent_id') ALTER TABLE dbo.[stores] ADD CONSTRAINT [FK_stores_parent_id] FOREIGN KEY ([parent_id]) REFERENCES dbo.[stores]([id]);

IF OBJECT_ID(N'dbo.stores',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.terminal_tokens') AND name=N'FK_terminal_tokens_location_id') ALTER TABLE dbo.[terminal_tokens] ADD CONSTRAINT [FK_terminal_tokens_location_id] FOREIGN KEY ([location_id]) REFERENCES dbo.[stores]([id]);

IF OBJECT_ID(N'dbo.shifts',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND name=N'FK_shift_cash_counts_shift_id') ALTER TABLE dbo.[shift_cash_counts] ADD CONSTRAINT [FK_shift_cash_counts_shift_id] FOREIGN KEY ([shift_id]) REFERENCES dbo.[shifts]([id]);

IF OBJECT_ID(N'dbo.shifts',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.shift_close_events') AND name=N'FK_shift_close_events_shift_id') ALTER TABLE dbo.[shift_close_events] ADD CONSTRAINT [FK_shift_close_events_shift_id] FOREIGN KEY ([shift_id]) REFERENCES dbo.[shifts]([id]);

IF OBJECT_ID(N'dbo.shifts',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND name=N'FK_shift_reconciliations_shift_id') ALTER TABLE dbo.[shift_reconciliations] ADD CONSTRAINT [FK_shift_reconciliations_shift_id] FOREIGN KEY ([shift_id]) REFERENCES dbo.[shifts]([id]);

IF OBJECT_ID(N'dbo.shift_cash_counts',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.shift_reconciliations') AND name=N'FK_shift_reconciliations_count_id') ALTER TABLE dbo.[shift_reconciliations] ADD CONSTRAINT [FK_shift_reconciliations_count_id] FOREIGN KEY ([count_id]) REFERENCES dbo.[shift_cash_counts]([id]);

IF OBJECT_ID(N'dbo.shifts',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'FK_shift_variance_alerts_shift_id') ALTER TABLE dbo.[shift_variance_alerts] ADD CONSTRAINT [FK_shift_variance_alerts_shift_id] FOREIGN KEY ([shift_id]) REFERENCES dbo.[shifts]([id]);

IF OBJECT_ID(N'dbo.shift_reconciliations',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.shift_variance_alerts') AND name=N'FK_shift_variance_alerts_reconciliation_id') ALTER TABLE dbo.[shift_variance_alerts] ADD CONSTRAINT [FK_shift_variance_alerts_reconciliation_id] FOREIGN KEY ([reconciliation_id]) REFERENCES dbo.[shift_reconciliations]([id]);

IF OBJECT_ID(N'dbo.shifts',N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE parent_object_id=OBJECT_ID(N'dbo.shift_notifications') AND name=N'FK_shift_notifications_shift_id') ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [FK_shift_notifications_shift_id] FOREIGN KEY ([shift_id]) REFERENCES dbo.[shifts]([id]);

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.activity_events', N'meta') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_0 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.activity_events')
      AND c.name=N'meta'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_0 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_0_sql nvarchar(max) = N'ALTER TABLE dbo.[activity_events] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_0);
    EXEC sys.sp_executesql @legacy_json_default_0_sql;
    ALTER TABLE dbo.[activity_events] ADD CONSTRAINT [DF_activity_events_meta] DEFAULT (N'{}') FOR [meta];
  END;
END;

IF OBJECT_ID(N'dbo.bookings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.bookings', N'charges') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_1 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.bookings')
      AND c.name=N'charges'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_1 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_1_sql nvarchar(max) = N'ALTER TABLE dbo.[bookings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_1);
    EXEC sys.sp_executesql @legacy_json_default_1_sql;
    ALTER TABLE dbo.[bookings] ADD CONSTRAINT [DF_bookings_charges] DEFAULT (N'{}') FOR [charges];
  END;
END;

IF OBJECT_ID(N'dbo.cashiers', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.cashiers', N'permissions') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_2 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.cashiers')
      AND c.name=N'permissions'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_2 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_2_sql nvarchar(max) = N'ALTER TABLE dbo.[cashiers] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_2);
    EXEC sys.sp_executesql @legacy_json_default_2_sql;
    ALTER TABLE dbo.[cashiers] ADD CONSTRAINT [DF_cashiers_permissions] DEFAULT (N'{}') FOR [permissions];
  END;
END;

IF OBJECT_ID(N'dbo.integration_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.integration_settings', N'api_keys_encrypted') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_3 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.integration_settings')
      AND c.name=N'api_keys_encrypted'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_3 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_3_sql nvarchar(max) = N'ALTER TABLE dbo.[integration_settings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_3);
    EXEC sys.sp_executesql @legacy_json_default_3_sql;
    ALTER TABLE dbo.[integration_settings] ADD CONSTRAINT [DF_integration_settings_api_keys_encrypted] DEFAULT (N'{}') FOR [api_keys_encrypted];
  END;
END;

IF OBJECT_ID(N'dbo.payment_transactions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.payment_transactions', N'metadata') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_4 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.payment_transactions')
      AND c.name=N'metadata'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_4 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_4_sql nvarchar(max) = N'ALTER TABLE dbo.[payment_transactions] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_4);
    EXEC sys.sp_executesql @legacy_json_default_4_sql;
    ALTER TABLE dbo.[payment_transactions] ADD CONSTRAINT [DF_payment_transactions_metadata] DEFAULT (N'{}') FOR [metadata];
  END;
END;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'fonts') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_5 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings')
      AND c.name=N'fonts'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_5 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_5_sql nvarchar(max) = N'ALTER TABLE dbo.[pos_settings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_5);
    EXEC sys.sp_executesql @legacy_json_default_5_sql;
    ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_fonts] DEFAULT (N'{}') FOR [fonts];
  END;
END;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'qr') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_6 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings')
      AND c.name=N'qr'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_6 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_6_sql nvarchar(max) = N'ALTER TABLE dbo.[pos_settings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_6);
    EXEC sys.sp_executesql @legacy_json_default_6_sql;
    ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_qr] DEFAULT (N'{}') FOR [qr];
  END;
END;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'integration_settings') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_7 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings')
      AND c.name=N'integration_settings'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_7 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_7_sql nvarchar(max) = N'ALTER TABLE dbo.[pos_settings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_7);
    EXEC sys.sp_executesql @legacy_json_default_7_sql;
    ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_integration_settings] DEFAULT (N'{}') FOR [integration_settings];
  END;
END;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'booking_slip') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_8 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings')
      AND c.name=N'booking_slip'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_8 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_8_sql nvarchar(max) = N'ALTER TABLE dbo.[pos_settings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_8);
    EXEC sys.sp_executesql @legacy_json_default_8_sql;
    ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_booking_slip] DEFAULT (N'{}') FOR [booking_slip];
  END;
END;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'notification_settings') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_9 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings')
      AND c.name=N'notification_settings'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_9 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_9_sql nvarchar(max) = N'ALTER TABLE dbo.[pos_settings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_9);
    EXEC sys.sp_executesql @legacy_json_default_9_sql;
    ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_notification_settings] DEFAULT (N'{}') FOR [notification_settings];
  END;
END;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'receipt_design') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_10 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings')
      AND c.name=N'receipt_design'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_10 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_10_sql nvarchar(max) = N'ALTER TABLE dbo.[pos_settings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_10);
    EXEC sys.sp_executesql @legacy_json_default_10_sql;
    ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_receipt_design] DEFAULT (N'{}') FOR [receipt_design];
  END;
END;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'payment_details') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_11 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings')
      AND c.name=N'payment_details'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_11 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_11_sql nvarchar(max) = N'ALTER TABLE dbo.[pos_settings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_11);
    EXEC sys.sp_executesql @legacy_json_default_11_sql;
    ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_payment_details] DEFAULT (N'{}') FOR [payment_details];
  END;
END;

IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.pos_settings', N'whatsapp_settings') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_12 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.pos_settings')
      AND c.name=N'whatsapp_settings'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_12 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_12_sql nvarchar(max) = N'ALTER TABLE dbo.[pos_settings] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_12);
    EXEC sys.sp_executesql @legacy_json_default_12_sql;
    ALTER TABLE dbo.[pos_settings] ADD CONSTRAINT [DF_pos_settings_whatsapp_settings] DEFAULT (N'{}') FOR [whatsapp_settings];
  END;
END;

IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.products', N'stock_by_store') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_13 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.products')
      AND c.name=N'stock_by_store'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_13 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_13_sql nvarchar(max) = N'ALTER TABLE dbo.[products] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_13);
    EXEC sys.sp_executesql @legacy_json_default_13_sql;
    ALTER TABLE dbo.[products] ADD CONSTRAINT [DF_products_stock_by_store] DEFAULT (N'{}') FOR [stock_by_store];
  END;
END;

IF OBJECT_ID(N'dbo.settings_overrides', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.settings_overrides', N'patch') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_14 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.settings_overrides')
      AND c.name=N'patch'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_14 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_14_sql nvarchar(max) = N'ALTER TABLE dbo.[settings_overrides] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_14);
    EXEC sys.sp_executesql @legacy_json_default_14_sql;
    ALTER TABLE dbo.[settings_overrides] ADD CONSTRAINT [DF_settings_overrides_patch] DEFAULT (N'{}') FOR [patch];
  END;
END;

IF OBJECT_ID(N'dbo.staff_roles', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.staff_roles', N'permissions') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_15 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.staff_roles')
      AND c.name=N'permissions'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_15 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_15_sql nvarchar(max) = N'ALTER TABLE dbo.[staff_roles] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_15);
    EXEC sys.sp_executesql @legacy_json_default_15_sql;
    ALTER TABLE dbo.[staff_roles] ADD CONSTRAINT [DF_staff_roles_permissions] DEFAULT (N'{}') FOR [permissions];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'authority_limits') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_16 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions')
      AND c.name=N'authority_limits'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_16 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_16_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_actions] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_16);
    EXEC sys.sp_executesql @legacy_json_default_16_sql;
    ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_authority_limits] DEFAULT (N'{}') FOR [authority_limits];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'extra_authority') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_17 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions')
      AND c.name=N'extra_authority'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_17 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_17_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_actions] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_17);
    EXEC sys.sp_executesql @legacy_json_default_17_sql;
    ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_extra_authority] DEFAULT (N'{}') FOR [extra_authority];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_actions', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_actions', N'absolute_ceilings') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_18 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_actions')
      AND c.name=N'absolute_ceilings'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_18 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_18_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_actions] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_18);
    EXEC sys.sp_executesql @legacy_json_default_18_sql;
    ALTER TABLE dbo.[authorization_actions] ADD CONSTRAINT [DF_authorization_actions_absolute_ceilings] DEFAULT (N'{}') FOR [absolute_ceilings];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_action_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_action_history', N'snapshot') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_19 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_action_history')
      AND c.name=N'snapshot'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_19 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_19_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_action_history] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_19);
    EXEC sys.sp_executesql @legacy_json_default_19_sql;
    ALTER TABLE dbo.[authorization_action_history] ADD CONSTRAINT [DF_authorization_action_history_snapshot] DEFAULT (N'{}') FOR [snapshot];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'payload') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_20 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests')
      AND c.name=N'payload'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_20 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_20_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_requests] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_20);
    EXEC sys.sp_executesql @legacy_json_default_20_sql;
    ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_payload] DEFAULT (N'{}') FOR [payload];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'approval_route') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_21 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests')
      AND c.name=N'approval_route'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_21 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_21_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_requests] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_21);
    EXEC sys.sp_executesql @legacy_json_default_21_sql;
    ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_approval_route] DEFAULT (N'{}') FOR [approval_route];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'approved_payload') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_22 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests')
      AND c.name=N'approved_payload'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_22 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_22_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_requests] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_22);
    EXEC sys.sp_executesql @legacy_json_default_22_sql;
    ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_approved_payload] DEFAULT (N'{}') FOR [approved_payload];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'bill_snapshot') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_23 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests')
      AND c.name=N'bill_snapshot'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_23 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_23_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_requests] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_23);
    EXEC sys.sp_executesql @legacy_json_default_23_sql;
    ALTER TABLE dbo.[authorization_requests] ADD CONSTRAINT [DF_authorization_requests_bill_snapshot] DEFAULT (N'{}') FOR [bill_snapshot];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_log', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_log', N'detail') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_24 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_log')
      AND c.name=N'detail'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_24 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_24_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_log] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_24);
    EXEC sys.sp_executesql @legacy_json_default_24_sql;
    ALTER TABLE dbo.[authorization_log] ADD CONSTRAINT [DF_authorization_log_detail] DEFAULT (N'{}') FOR [detail];
  END;
END;

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.record_edits', N'before_value') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_25 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.record_edits')
      AND c.name=N'before_value'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_25 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_25_sql nvarchar(max) = N'ALTER TABLE dbo.[record_edits] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_25);
    EXEC sys.sp_executesql @legacy_json_default_25_sql;
    ALTER TABLE dbo.[record_edits] ADD CONSTRAINT [DF_record_edits_before_value] DEFAULT (N'{}') FOR [before_value];
  END;
END;

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.record_edits', N'after_value') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_26 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.record_edits')
      AND c.name=N'after_value'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_26 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_26_sql nvarchar(max) = N'ALTER TABLE dbo.[record_edits] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_26);
    EXEC sys.sp_executesql @legacy_json_default_26_sql;
    ALTER TABLE dbo.[record_edits] ADD CONSTRAINT [DF_record_edits_after_value] DEFAULT (N'{}') FOR [after_value];
  END;
END;

IF OBJECT_ID(N'dbo.record_edits', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.record_edits', N'stock_deltas') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_27 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.record_edits')
      AND c.name=N'stock_deltas'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_27 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_27_sql nvarchar(max) = N'ALTER TABLE dbo.[record_edits] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_27);
    EXEC sys.sp_executesql @legacy_json_default_27_sql;
    ALTER TABLE dbo.[record_edits] ADD CONSTRAINT [DF_record_edits_stock_deltas] DEFAULT (N'{}') FOR [stock_deltas];
  END;
END;

IF OBJECT_ID(N'dbo.shift_close_events', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_close_events', N'detail') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_28 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_close_events')
      AND c.name=N'detail'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_28 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_28_sql nvarchar(max) = N'ALTER TABLE dbo.[shift_close_events] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_28);
    EXEC sys.sp_executesql @legacy_json_default_28_sql;
    ALTER TABLE dbo.[shift_close_events] ADD CONSTRAINT [DF_shift_close_events_detail] DEFAULT (N'{}') FOR [detail];
  END;
END;

IF OBJECT_ID(N'dbo.shift_notifications', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.shift_notifications', N'payment_breakdown') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_29 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.shift_notifications')
      AND c.name=N'payment_breakdown'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_29 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_29_sql nvarchar(max) = N'ALTER TABLE dbo.[shift_notifications] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_29);
    EXEC sys.sp_executesql @legacy_json_default_29_sql;
    ALTER TABLE dbo.[shift_notifications] ADD CONSTRAINT [DF_shift_notifications_payment_breakdown] DEFAULT (N'{}') FOR [payment_breakdown];
  END;
END;

IF OBJECT_ID(N'dbo.entity_status_history', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.entity_status_history', N'metadata') IS NOT NULL BEGIN
  DECLARE @legacy_json_default_30 sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.entity_status_history')
      AND c.name=N'metadata'
      AND dc.definition IN (N'(N''[]'')',N'N''[]''',N'(''[]'')',N'''[]''')
  );
  IF @legacy_json_default_30 IS NOT NULL BEGIN
    DECLARE @legacy_json_default_30_sql nvarchar(max) = N'ALTER TABLE dbo.[entity_status_history] DROP CONSTRAINT ' + QUOTENAME(@legacy_json_default_30);
    EXEC sys.sp_executesql @legacy_json_default_30_sql;
    ALTER TABLE dbo.[entity_status_history] ADD CONSTRAINT [DF_entity_status_history_metadata] DEFAULT (N'{}') FOR [metadata];
  END;
END;

IF OBJECT_ID(N'dbo.authorization_requests', N'U') IS NOT NULL AND COL_LENGTH(N'dbo.authorization_requests', N'requested_amount') IS NOT NULL BEGIN
  DECLARE @legacy_requested_amount_default sysname = (
    SELECT dc.name FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id=dc.parent_object_id AND c.column_id=dc.parent_column_id
    WHERE dc.parent_object_id=OBJECT_ID(N'dbo.authorization_requests') AND c.name=N'requested_amount'
  );
  IF @legacy_requested_amount_default IS NOT NULL BEGIN
    DECLARE @legacy_requested_amount_default_sql nvarchar(max) = N'ALTER TABLE dbo.[authorization_requests] DROP CONSTRAINT ' + QUOTENAME(@legacy_requested_amount_default);
    EXEC sys.sp_executesql @legacy_requested_amount_default_sql;
  END;
  ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [requested_amount] decimal(38,12) NULL;
END;

IF OBJECT_ID(N'dbo.pos_jobs', N'U') IS NULL CREATE TABLE dbo.pos_jobs (
 job_id uniqueidentifier NOT NULL PRIMARY KEY, job_type nvarchar(40) NOT NULL, status nvarchar(20) NOT NULL,
 organization_id nvarchar(128) NULL, organization_name nvarchar(256) NULL, branch_id nvarchar(128) NULL,
 branch_name nvarchar(256) NULL, branch_code nvarchar(64) NULL, terminal_id nvarchar(128) NULL,
 terminal_name nvarchar(256) NULL, phase nvarchar(40) NULL, current_table nvarchar(128) NULL,
 dependency_index int NOT NULL DEFAULT 0, last_committed_cursor nvarchar(512) NULL,
 completed_rows bigint NOT NULL DEFAULT 0, estimated_total_rows bigint NULL, completed_bytes bigint NOT NULL DEFAULT 0,
 batch_number int NOT NULL DEFAULT 0, batch_size int NOT NULL DEFAULT 500, retry_count int NOT NULL DEFAULT 0,
 next_retry_at datetimeoffset(7) NULL, started_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
 updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(), finished_at datetimeoffset(7) NULL,
 error_code nvarchar(64) NULL, error_message nvarchar(1000) NULL);

IF OBJECT_ID(N'dbo.sync_checkpoints', N'U') IS NULL CREATE TABLE dbo.sync_checkpoints (
 organization_id nvarchar(128) NOT NULL, branch_id nvarchar(128) NOT NULL, entity_type nvarchar(128) NOT NULL,
 direction nvarchar(8) NOT NULL, committed_cursor nvarchar(512) NULL, change_tracking_version bigint NULL,
 acknowledged_at datetimeoffset(7) NULL, updated_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
 CONSTRAINT PK_sync_checkpoints PRIMARY KEY (organization_id,branch_id,entity_type,direction));

IF OBJECT_ID(N'dbo.sync_change_journal', N'U') IS NULL CREATE TABLE dbo.sync_change_journal (
 change_id bigint IDENTITY(1,1) NOT NULL PRIMARY KEY, entity_type nvarchar(128) NOT NULL,
 entity_id nvarchar(128) NOT NULL, operation nvarchar(10) NOT NULL, branch_id nvarchar(128) NOT NULL,
 entity_version bigint NOT NULL, aggregate_id uniqueidentifier NULL, acknowledged_at datetimeoffset(7) NULL,
 retry_count int NOT NULL DEFAULT 0, last_error nvarchar(1000) NULL,
 created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
 CONSTRAINT CK_sync_change_journal_metadata_only CHECK (operation IN ('insert','update','delete')));

IF COL_LENGTH(N'dbo.sync_change_journal',N'aggregate_id') IS NULL ALTER TABLE dbo.sync_change_journal ADD aggregate_id uniqueidentifier NULL;
IF COL_LENGTH(N'dbo.sync_change_journal',N'acknowledged_at') IS NULL ALTER TABLE dbo.sync_change_journal ADD acknowledged_at datetimeoffset(7) NULL;
IF COL_LENGTH(N'dbo.sync_change_journal',N'retry_count') IS NULL ALTER TABLE dbo.sync_change_journal ADD retry_count int NOT NULL CONSTRAINT DF_sync_change_journal_retry_count DEFAULT 0;
IF COL_LENGTH(N'dbo.sync_change_journal',N'last_error') IS NULL ALTER TABLE dbo.sync_change_journal ADD last_error nvarchar(1000) NULL;
IF NOT EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.sync_change_journal') AND name=N'IX_sync_change_journal_pending') EXEC(N'CREATE INDEX IX_sync_change_journal_pending ON dbo.sync_change_journal(branch_id,acknowledged_at,aggregate_id,change_id)');

IF OBJECT_ID(N'dbo.sync_conflicts', N'U') IS NULL CREATE TABLE dbo.sync_conflicts (
 conflict_id uniqueidentifier NOT NULL PRIMARY KEY, entity_type nvarchar(128) NOT NULL, entity_id nvarchar(128) NOT NULL,
 branch_id nvarchar(128) NOT NULL, local_version bigint NULL, remote_version bigint NULL, reason nvarchar(1000) NOT NULL,
 status nvarchar(20) NOT NULL DEFAULT 'unresolved', created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(), resolved_at datetimeoffset(7) NULL);

IF OBJECT_ID(N'dbo.local_operation_receipts', N'U') IS NULL CREATE TABLE dbo.local_operation_receipts (
 operation_id uniqueidentifier NOT NULL PRIMARY KEY, operation_type nvarchar(40) NOT NULL, entity_id nvarchar(128) NOT NULL,
 note nvarchar(400) NULL, committed_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET());

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL CREATE TABLE dbo.pos_schema_migrations (
 version int NOT NULL PRIMARY KEY, name nvarchar(200) NOT NULL, applied_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET());
IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=1) INSERT dbo.pos_schema_migrations(version,name) VALUES(1,N'initial_sqlserver_parity');

GO
-- SECTION 2: Local upgrade 002_sync_pipeline.sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.sync_change_journal', N'U') IS NULL
  THROW 51000, 'Migration 001 must be applied before the sync pipeline upgrade.', 1;

IF COL_LENGTH(N'dbo.sync_change_journal',N'aggregate_id') IS NULL
  ALTER TABLE dbo.sync_change_journal ADD aggregate_id uniqueidentifier NULL;
IF COL_LENGTH(N'dbo.sync_change_journal',N'acknowledged_at') IS NULL
  ALTER TABLE dbo.sync_change_journal ADD acknowledged_at datetimeoffset(7) NULL;
IF COL_LENGTH(N'dbo.sync_change_journal',N'retry_count') IS NULL
  ALTER TABLE dbo.sync_change_journal ADD retry_count int NOT NULL
    CONSTRAINT DF_sync_change_journal_retry_count DEFAULT 0;
IF COL_LENGTH(N'dbo.sync_change_journal',N'last_error') IS NULL
  ALTER TABLE dbo.sync_change_journal ADD last_error nvarchar(1000) NULL;

IF NOT EXISTS(
  SELECT 1 FROM sys.indexes
  WHERE object_id=OBJECT_ID(N'dbo.sync_change_journal')
    AND name=N'IX_sync_change_journal_pending'
)
  EXEC(N'CREATE INDEX IX_sync_change_journal_pending
    ON dbo.sync_change_journal(branch_id,acknowledged_at,aggregate_id,change_id)');

IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=2)
  INSERT dbo.pos_schema_migrations(version,name)
  VALUES(2,N'sync_pipeline_jobs_bootstrap_retention');

GO
-- SECTION 2: Local upgrade 003_activity_notification_preferences.sql
/*
  Durable per-user notification clear/reopen state for existing POS_Local
  databases. Re-runnable, additive, and safe for databases created before the
  cleared_by column was introduced.
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.activity_events', N'U') IS NULL
  THROW 51000, 'Migration 001 must be applied before notification preferences.', 1;
GO

IF COL_LENGTH(N'dbo.activity_events', N'cleared_by') IS NULL
  ALTER TABLE dbo.activity_events ADD cleared_by nvarchar(max) NULL;
GO

UPDATE dbo.activity_events
SET cleared_by = N'[]'
WHERE cleared_by IS NULL
   OR ISJSON(cleared_by) <> 1
   OR LEFT(LTRIM(cleared_by), 1) <> N'[';
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.activity_events')
    AND c.name = N'cleared_by'
)
  ALTER TABLE dbo.activity_events
    ADD CONSTRAINT DF_activity_events_cleared_by DEFAULT (N'[]') FOR cleared_by;
GO

IF EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.activity_events')
    AND name = N'cleared_by'
    AND is_nullable = 1
)
  ALTER TABLE dbo.activity_events ALTER COLUMN cleared_by nvarchar(max) NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.check_constraints
  WHERE parent_object_id = OBJECT_ID(N'dbo.activity_events')
    AND name = N'CK_activity_events_cleared_by_json_array'
)
  ALTER TABLE dbo.activity_events WITH CHECK
    ADD CONSTRAINT CK_activity_events_cleared_by_json_array
    CHECK (ISJSON(cleared_by) = 1 AND LEFT(LTRIM(cleared_by), 1) = N'[');
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.activity_events')
    AND name = N'IX_activity_events_store_created'
)
  CREATE INDEX IX_activity_events_store_created
    ON dbo.activity_events(store_id, created_at DESC, id);
GO

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
  CREATE TABLE dbo.pos_schema_migrations (
    version int NOT NULL PRIMARY KEY,
    name nvarchar(200) NOT NULL,
    applied_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
GO

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 3)
  INSERT dbo.pos_schema_migrations(version, name)
  VALUES (3, N'activity_notification_preferences');
GO

GO
-- SECTION 2: Local upgrade 004_repair_terminal_platform_default.sql
/*
  Repair databases created by an older installer that assigned 'unknown' as
  the terminal platform default. Existing non-null platform values are data
  and are intentionally preserved; only the default for future rows changes.
*/

SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.terminal_tokens', N'U') IS NULL
  THROW 51000, 'Migration 001 must be applied before repairing terminal defaults.', 1;
GO

IF COL_LENGTH(N'dbo.terminal_tokens', N'platform') IS NULL
  THROW 51000, 'The terminal_tokens.platform column is missing.', 1;
GO

IF NOT EXISTS (
  SELECT 1
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.terminal_tokens')
    AND c.name = N'platform'
    AND LOWER(REPLACE(REPLACE(REPLACE(dc.definition, N'(', N''), N')', N''), N' ', N''))
      IN (N'''pc''', N'n''pc''')
)
BEGIN
  DECLARE @terminal_platform_default sysname;
  DECLARE @terminal_platform_drop_sql nvarchar(max);
  SELECT @terminal_platform_default = dc.name
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.terminal_tokens')
    AND c.name = N'platform';

  IF @terminal_platform_default IS NOT NULL
  BEGIN
    SET @terminal_platform_drop_sql =
      N'ALTER TABLE dbo.terminal_tokens DROP CONSTRAINT '
      + QUOTENAME(@terminal_platform_default)
      + N';';
    EXEC sys.sp_executesql @terminal_platform_drop_sql;
  END;

  ALTER TABLE dbo.terminal_tokens
    ADD CONSTRAINT DF_terminal_tokens_platform DEFAULT (N'pc') FOR platform;
END;
GO

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
  CREATE TABLE dbo.pos_schema_migrations (
    version int NOT NULL PRIMARY KEY,
    name nvarchar(200) NOT NULL,
    applied_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
GO

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 4)
  INSERT dbo.pos_schema_migrations(version, name)
  VALUES (4, N'repair_terminal_platform_default');
GO

GO
-- SECTION 2: Local upgrade 005_staff_sql_and_member_directory.sql
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

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
  CREATE TABLE dbo.pos_schema_migrations (
    version int NOT NULL PRIMARY KEY,
    name nvarchar(200) NOT NULL,
    applied_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );

-- Older releases could copy private membership profile fields to a till.
-- Offline lookup requires only the minimal directory; clear those local-only
-- copies without changing the central POS or membership databases.
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 5)
BEGIN
  UPDATE dbo.members
  SET email = NULL, address = NULL, country_code = NULL, postal_code = NULL, date_of_birth = NULL
  WHERE email IS NOT NULL OR address IS NOT NULL OR country_code IS NOT NULL
     OR postal_code IS NOT NULL OR date_of_birth IS NOT NULL;
END;

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

GO
-- SECTION 2: Local upgrade 006_allow_missing_company_name.sql
-- Cloud company_name may be NULL until an administrator enters the business name.
-- Run in the configured POS_Local database, never in Supabase/PostgreSQL.
IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.pos_settings', N'company_name') IS NOT NULL
BEGIN
  DECLARE @company_name_default sysname;
  SELECT @company_name_default = dc.name
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.pos_settings')
    AND c.name = N'company_name';
  IF @company_name_default IS NOT NULL
  BEGIN
    DECLARE @drop_company_name_default_sql nvarchar(max);
    SET @drop_company_name_default_sql =
      N'ALTER TABLE dbo.pos_settings DROP CONSTRAINT ' + QUOTENAME(@company_name_default);
    EXEC sys.sp_executesql @drop_company_name_default_sql;
  END;

  IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.pos_settings')
      AND name = N'company_name' AND is_nullable = 0
  ) ALTER TABLE dbo.pos_settings ALTER COLUMN company_name nvarchar(max) NULL;
END;

-- Older local writes stored JSON scalar strings as bare nvarchar. Keep the
-- original text but encode it as a JSON string so change tracking can push it.
IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.settings_scoped', N'value') IS NOT NULL
  UPDATE dbo.settings_scoped
  SET [value] = N'"' + STRING_ESCAPE([value], 'json') + N'"'
  WHERE [value] IS NOT NULL AND ISJSON(N'[' + [value] + N']') <> 1;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 6)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (6, N'006_allow_missing_company_name', SYSDATETIMEOFFSET());

GO
-- SECTION 2: Local upgrade 007_repair_scoped_json_values.sql
-- Re-run the scoped JSON repair on upgrades where migration 006 was already
-- recorded but an older Electron build subsequently wrote plain text again.
IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.settings_scoped', N'value') IS NOT NULL
  UPDATE dbo.settings_scoped
  SET [value] = N'"' + STRING_ESCAPE([value], 'json') + N'"'
  WHERE [value] IS NOT NULL AND ISJSON(N'[' + [value] + N']') <> 1;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 7)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (7, N'007_repair_scoped_json_values', SYSDATETIMEOFFSET());

GO
-- SECTION 2: Local upgrade 008_repair_scoped_values_and_company_name.sql
-- Reassert nullable company_name for local databases that recorded an older
-- repair, and preserve bare-text scoped settings as valid JSON strings.
IF OBJECT_ID(N'dbo.pos_settings', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.pos_settings', N'company_name') IS NOT NULL
BEGIN
  DECLARE @company_name_default sysname;
  SELECT @company_name_default = dc.name
  FROM sys.default_constraints AS dc
  JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.pos_settings')
    AND c.name = N'company_name';

  IF @company_name_default IS NOT NULL
  BEGIN
    DECLARE @drop_company_name_default_sql nvarchar(max);
    SET @drop_company_name_default_sql =
      N'ALTER TABLE dbo.pos_settings DROP CONSTRAINT ' + QUOTENAME(@company_name_default);
    EXEC sys.sp_executesql @drop_company_name_default_sql;
  END;

  IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.pos_settings')
      AND name = N'company_name' AND is_nullable = 0
  ) ALTER TABLE dbo.pos_settings ALTER COLUMN company_name nvarchar(max) NULL;
END;

-- Wrapping value in [] alone was insufficient: an empty value becomes [].
-- Other malformed legacy strings are also handled at the Electron sync
-- boundary, without requiring a particular SQL Server compatibility level.
IF OBJECT_ID(N'dbo.settings_scoped', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.settings_scoped', N'value') IS NOT NULL
  UPDATE dbo.settings_scoped
  SET [value] = N'"' + STRING_ESCAPE([value], 'json') + N'"'
  WHERE [value] IS NOT NULL
    AND (LTRIM(RTRIM([value])) = N'' OR ISJSON(N'[' + [value] + N']') <> 1);

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 8)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (8, N'008_repair_scoped_values_and_company_name', SYSDATETIMEOFFSET());

GO
-- SECTION 2: Local upgrade 009_persist_held_approval_fingerprint.sql
IF OBJECT_ID(N'dbo.held_orders', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.held_orders', N'approval_snapshot_hash') IS NULL
  ALTER TABLE dbo.held_orders ADD approval_snapshot_hash nvarchar(max) NULL;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 9)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (9, N'009_persist_held_approval_fingerprint', SYSDATETIMEOFFSET());

GO
-- SECTION 2: Local upgrade 010_namespace_receiving_draft_numbers.sql
SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.purchase_orders', N'U') IS NOT NULL
BEGIN
  UPDATE dbo.purchase_orders
  SET po_number = CONCAT(
    N'__draft__:',
    CONVERT(nvarchar(36), id),
    N':',
    LEFT(COALESCE(po_number, N''), 400)
  )
  WHERE status = N'draft'
    AND LEFT(COALESCE(po_number, N''), 10) <> N'__draft__:';
END;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 10)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (10, N'010_namespace_receiving_draft_numbers', SYSDATETIMEOFFSET());

GO
-- SECTION 2: Local upgrade 011_preserve_booking_kind.sql
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.pos_schema_migrations (
    version int NOT NULL PRIMARY KEY,
    name nvarchar(200) NOT NULL,
    applied_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET()
  );
END;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 11)
BEGIN
  BEGIN TRANSACTION;

  IF COL_LENGTH(N'dbo.bookings', N'booking_kind') IS NULL
  BEGIN
    ALTER TABLE dbo.bookings
      ADD booking_kind nvarchar(max) NOT NULL
        CONSTRAINT DF_bookings_booking_kind DEFAULT (N'standard') WITH VALUES;
  END;

  -- Legacy job_status is always "received", including for ordinary bookings.
  -- Repair only rows carrying a genuine racket/job-card signal.
  EXEC sys.sp_executesql N'
    UPDATE dbo.bookings
       SET booking_kind = N''racket''
     WHERE COALESCE(booking_kind, N''standard'') = N''standard''
       AND (
         NULLIF(LTRIM(RTRIM(COALESCE(racket_model, N''''))), N'''') IS NOT NULL
         OR NULLIF(LTRIM(RTRIM(COALESCE(string_type, N''''))), N'''') IS NOT NULL
         OR tension_main IS NOT NULL OR tension_cross IS NOT NULL
         OR NULLIF(LTRIM(RTRIM(COALESCE(grommet_notes, N''''))), N'''') IS NOT NULL
         OR NULLIF(LTRIM(RTRIM(COALESCE(job_notes, N''''))), N'''') IS NOT NULL
         OR dropped_off_at IS NOT NULL OR promised_at IS NOT NULL
         OR job_status_by IS NOT NULL OR job_status_at IS NOT NULL
         OR NULLIF(LTRIM(RTRIM(COALESCE(tag_id, N''''))), N'''') IS NOT NULL
         OR NULLIF(LTRIM(RTRIM(COALESCE(string_origin, N''''))), N'''') IS NOT NULL
         OR string_source_product_id IS NOT NULL OR grip_product_id IS NOT NULL
         OR NULLIF(LTRIM(RTRIM(COALESCE(technician, N''''))), N'''') IS NOT NULL
       );';

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID(N'dbo.bookings')
      AND name = N'CK_bookings_booking_kind'
  )
    ALTER TABLE dbo.bookings WITH CHECK
      ADD CONSTRAINT CK_bookings_booking_kind
      CHECK (booking_kind IN (N'standard', N'racket'));

  EXEC sys.sp_executesql N'
    CREATE OR ALTER TRIGGER dbo.TR_bookings_set_kind
    ON dbo.bookings
    AFTER INSERT, UPDATE
    AS
    BEGIN
      SET NOCOUNT ON;
      UPDATE booking
         SET booking_kind = N''racket''
        FROM dbo.bookings booking
        JOIN inserted incoming ON incoming.id = booking.id
       WHERE COALESCE(booking.booking_kind, N''standard'') <> N''racket''
         AND (
           NULLIF(LTRIM(RTRIM(COALESCE(incoming.racket_model, N''''))), N'''') IS NOT NULL
           OR NULLIF(LTRIM(RTRIM(COALESCE(incoming.string_type, N''''))), N'''') IS NOT NULL
           OR incoming.tension_main IS NOT NULL OR incoming.tension_cross IS NOT NULL
           OR incoming.dropped_off_at IS NOT NULL OR incoming.promised_at IS NOT NULL
           OR incoming.job_status_by IS NOT NULL OR incoming.job_status_at IS NOT NULL
           OR NULLIF(LTRIM(RTRIM(COALESCE(incoming.tag_id, N''''))), N'''') IS NOT NULL
           OR NULLIF(LTRIM(RTRIM(COALESCE(incoming.string_origin, N''''))), N'''') IS NOT NULL
           OR incoming.string_source_product_id IS NOT NULL OR incoming.grip_product_id IS NOT NULL
           OR NULLIF(LTRIM(RTRIM(COALESCE(incoming.technician, N''''))), N'''') IS NOT NULL
         );
    END;';

  INSERT INTO dbo.pos_schema_migrations(version, name)
  VALUES (11, N'preserve_booking_kind');

  COMMIT TRANSACTION;
END;

GO
-- SECTION 2: Local upgrade 012_repair_products_row_version_default.sql
SET NOCOUNT ON;
SET XACT_ABORT ON;

-- Older local installers created products.row_version with DEFAULT (0), while
-- the synchronized cloud contract starts every row at version 1. Replace only
-- the default constraint: existing product values and business data are not
-- rewritten.
IF OBJECT_ID(N'dbo.products', N'U') IS NOT NULL
   AND COL_LENGTH(N'dbo.products', N'row_version') IS NOT NULL
BEGIN
  DECLARE @products_row_version_default sysname;
  DECLARE @products_row_version_definition nvarchar(max);

  SELECT
    @products_row_version_default = dc.name,
    @products_row_version_definition = dc.definition
  FROM sys.default_constraints dc
  JOIN sys.columns c
    ON c.object_id = dc.parent_object_id
   AND c.column_id = dc.parent_column_id
  WHERE dc.parent_object_id = OBJECT_ID(N'dbo.products')
    AND c.name = N'row_version';

  IF @products_row_version_default IS NOT NULL
     AND LOWER(
       REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
         @products_row_version_definition,
         N'(', N''), N')', N''), N' ', N''), NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N'')
     ) <> N'1'
  BEGIN
    DECLARE @drop_products_row_version_default nvarchar(max) =
      N'ALTER TABLE dbo.products DROP CONSTRAINT ' + QUOTENAME(@products_row_version_default) + N';';
    EXEC sys.sp_executesql @drop_products_row_version_default;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM sys.default_constraints dc
    JOIN sys.columns c
      ON c.object_id = dc.parent_object_id
     AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID(N'dbo.products')
      AND c.name = N'row_version'
  )
    ALTER TABLE dbo.products
      ADD CONSTRAINT DF_products_row_version DEFAULT (1) FOR row_version;
END;

IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 12)
  INSERT INTO dbo.pos_schema_migrations(version, name, applied_at)
  VALUES (12, N'012_repair_products_row_version_default', SYSDATETIMEOFFSET());

GO
-- SECTION 2: Local upgrade 013_scope_purchase_invoice_numbers.sql
SET XACT_ABORT ON;
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=13)
BEGIN
  BEGIN TRANSACTION;
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'UX_purchase_orders_po_number')
    DROP INDEX [UX_purchase_orders_po_number] ON dbo.purchase_orders;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'UQ_purchase_orders_0')
    CREATE UNIQUE INDEX [UQ_purchase_orders_0] ON dbo.purchase_orders([store_id],[po_number]) WHERE [store_id] IS NOT NULL;
  INSERT INTO dbo.pos_schema_migrations(version,name) VALUES(13,N'013_scope_purchase_invoice_numbers.sql');
  COMMIT TRANSACTION;
END;

GO
-- SECTION 2: Local upgrade 014_repair_purchase_order_key_widths.sql
-- Existing terminals retained the old single-key nvarchar(450) widths when
-- migration 013 introduced the branch-scoped composite invoice key.
SET XACT_ABORT ON;
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=14)
BEGIN
  BEGIN TRY
    BEGIN TRANSACTION;
    -- Hold the table lock through index recreation so concurrent writes cannot
    -- introduce an oversized value between this check and ALTER COLUMN.
    -- DATALENGTH includes trailing spaces and UTF-16 surrogate pairs.
    IF EXISTS (SELECT 1 FROM dbo.purchase_orders WITH (TABLOCKX, HOLDLOCK)
               WHERE DATALENGTH(po_number)>256 OR DATALENGTH(store_id)>256)
      THROW 51014, 'Purchase order identifiers exceed 128 UTF-16 code units. No identifiers were truncated. Review po_number and store_id before retrying the update.', 1;

    IF EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id=OBJECT_ID(N'dbo.purchase_orders')
                 AND name IN (N'po_number',N'store_id') AND max_length<>256)
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'UQ_purchase_orders_0')
        DROP INDEX [UQ_purchase_orders_0] ON dbo.purchase_orders;
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'IX_purchase_orders_store_id')
        DROP INDEX [IX_purchase_orders_store_id] ON dbo.purchase_orders;
      -- Do not restore the obsolete global invoice uniqueness rule from 012.
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.purchase_orders') AND name=N'UX_purchase_orders_po_number')
        DROP INDEX [UX_purchase_orders_po_number] ON dbo.purchase_orders;

      ALTER TABLE dbo.purchase_orders ALTER COLUMN po_number nvarchar(128) NOT NULL;
      ALTER TABLE dbo.purchase_orders ALTER COLUMN store_id nvarchar(128) NULL;

      CREATE UNIQUE INDEX [UQ_purchase_orders_0] ON dbo.purchase_orders([store_id],[po_number]) WHERE [store_id] IS NOT NULL;
      CREATE INDEX [IX_purchase_orders_store_id] ON dbo.purchase_orders([store_id]);
    END;
    INSERT INTO dbo.pos_schema_migrations(version,name) VALUES(14,N'014_repair_purchase_order_key_widths.sql');
    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;

GO
-- SECTION 2: Local upgrade 015_restore_stocked_products_automatically.sql
-- Automatic catalogue state follows net company stock on both receipt and depletion.
SET XACT_ABORT ON;
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=15)
BEGIN
 BEGIN TRY
  BEGIN TRANSACTION;
  EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.products_zero_stock_catalog_lifecycle ON dbo.products
AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF TRIGGER_NESTLEVEL(OBJECT_ID(N''dbo.products_zero_stock_catalog_lifecycle''))>1 RETURN;
 IF NOT (UPDATE(stock_by_store) OR UPDATE(is_archived)) RETURN;
 IF COALESCE((SELECT LOWER(COALESCE(JSON_VALUE(CASE WHEN ISJSON(integration_settings)=1 THEN integration_settings ELSE N''{}'' END,''$.autoArchiveZeroStock''),N''true'')) FROM dbo.pos_settings WHERE id=1),N''true'')<>N''true'' RETURN;
 UPDATE p
SET is_archived=CASE WHEN s.quantity>0 THEN 0 ELSE 1 END,
    archived_at=CASE WHEN s.quantity>0 THEN NULL ELSE COALESCE(p.archived_at,SYSDATETIMEOFFSET()) END,
    updated_at=SYSDATETIMEOFFSET(), row_version=COALESCE(p.row_version,0)+1
FROM dbo.products p
JOIN inserted i ON i.id=p.id
CROSS APPLY (SELECT COALESCE(SUM(TRY_CONVERT(decimal(38,12),j.[value])),0) AS quantity
 FROM OPENJSON(CASE WHEN ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N''{'' THEN p.stock_by_store ELSE N''{}'' END) j) s
WHERE p.deleted_at IS NULL AND ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N''{''
 AND (p.is_archived<>CASE WHEN s.quantity>0 THEN 0 ELSE 1 END
      OR (s.quantity>0 AND p.archived_at IS NOT NULL));
END;';
  EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.pos_settings_zero_stock_catalog_backfill ON dbo.pos_settings
AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT UPDATE(integration_settings) RETURN;
 IF COALESCE((SELECT LOWER(COALESCE(JSON_VALUE(CASE WHEN ISJSON(integration_settings)=1 THEN integration_settings ELSE N''{}'' END,''$.autoArchiveZeroStock''),N''true'')) FROM inserted WHERE id=1),N''false'')<>N''true'' RETURN;
 IF EXISTS (SELECT 1 FROM deleted WHERE id=1 AND LOWER(COALESCE(JSON_VALUE(CASE WHEN ISJSON(integration_settings)=1 THEN integration_settings ELSE N''{}'' END,''$.autoArchiveZeroStock''),N''true''))=N''true'') RETURN;
 UPDATE p
SET is_archived=CASE WHEN s.quantity>0 THEN 0 ELSE 1 END,
    archived_at=CASE WHEN s.quantity>0 THEN NULL ELSE COALESCE(p.archived_at,SYSDATETIMEOFFSET()) END,
    updated_at=SYSDATETIMEOFFSET(), row_version=COALESCE(p.row_version,0)+1
FROM dbo.products p

CROSS APPLY (SELECT COALESCE(SUM(TRY_CONVERT(decimal(38,12),j.[value])),0) AS quantity
 FROM OPENJSON(CASE WHEN ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N''{'' THEN p.stock_by_store ELSE N''{}'' END) j) s
WHERE p.deleted_at IS NULL AND ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N''{''
 AND (p.is_archived<>CASE WHEN s.quantity>0 THEN 0 ELSE 1 END
      OR (s.quantity>0 AND p.archived_at IS NOT NULL));
END;';
  IF COALESCE((SELECT LOWER(COALESCE(JSON_VALUE(CASE WHEN ISJSON(integration_settings)=1 THEN integration_settings ELSE N'{}' END,'$.autoArchiveZeroStock'),N'true')) FROM dbo.pos_settings WHERE id=1),N'true')=N'true'
  BEGIN
   UPDATE p
SET is_archived=CASE WHEN s.quantity>0 THEN 0 ELSE 1 END,
    archived_at=CASE WHEN s.quantity>0 THEN NULL ELSE COALESCE(p.archived_at,SYSDATETIMEOFFSET()) END,
    updated_at=SYSDATETIMEOFFSET(), row_version=COALESCE(p.row_version,0)+1
FROM dbo.products p

CROSS APPLY (SELECT COALESCE(SUM(TRY_CONVERT(decimal(38,12),j.[value])),0) AS quantity
 FROM OPENJSON(CASE WHEN ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N'{' THEN p.stock_by_store ELSE N'{}' END) j) s
WHERE p.deleted_at IS NULL AND ISJSON(p.stock_by_store)=1 AND LEFT(LTRIM(p.stock_by_store),1)=N'{'
 AND (p.is_archived<>CASE WHEN s.quantity>0 THEN 0 ELSE 1 END
      OR (s.quantity>0 AND p.archived_at IS NOT NULL));
  END;
  INSERT INTO dbo.pos_schema_migrations(version,name) VALUES(15,N'015_restore_stocked_products_automatically.sql');
  COMMIT TRANSACTION;
 END TRY
 BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
 END CATCH;
END;

GO
-- SECTION 2: Local upgrade 016_synced_register_drafts.sql
-- Additive ticket lifecycle guards. No existing business records are deleted.
EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.held_orders_lifecycle ON dbo.held_orders
AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF TRIGGER_NESTLEVEL(OBJECT_ID(N''dbo.held_orders_lifecycle''))>1 RETURN;
 IF EXISTS(SELECT 1 FROM inserted i WHERE i.status=''completed''
 AND NOT EXISTS(SELECT 1 FROM dbo.sales s WHERE s.store_id=i.store_id AND s.bill_number=i.bill_no)
 AND NOT EXISTS(SELECT 1 FROM dbo.bookings b WHERE i.note=N''booking:''+CONVERT(nvarchar(36),b.id) AND b.store_id=i.store_id AND b.shift_id=i.shift_id))
 THROW 51023,''Only a saved sale or matching booking may finish a draft bill.'',1;
 -- Keep terminal states from old rows, and recognize sales synced before drafts.
 UPDATE h SET status=CASE WHEN d.status IN (''completed'',''cancelled'') THEN d.status ELSE ''completed'' END,
 row_version=COALESCE(h.row_version,0)+1,updated_at=SYSDATETIMEOFFSET()
 FROM dbo.held_orders h JOIN inserted i ON i.id=h.id LEFT JOIN deleted d ON d.id=i.id
 WHERE (d.status IN (''completed'',''cancelled'') AND h.status<>d.status)
 OR (h.status NOT IN (''completed'',''cancelled'') AND EXISTS(SELECT 1 FROM dbo.sales s WHERE s.store_id=h.store_id AND s.bill_number=h.bill_no));
 IF EXISTS(SELECT 1 FROM dbo.held_orders h JOIN inserted i ON i.id=h.id
 LEFT JOIN dbo.shifts s WITH (UPDLOCK,HOLDLOCK) ON CONVERT(nvarchar(36),s.id)=h.shift_id AND s.store_id=h.store_id
 WHERE h.status NOT IN (''completed'',''cancelled'') AND h.shift_id IS NOT NULL AND (s.id IS NULL OR s.state<>N''ACTIVE''))
 THROW 51020,''This shift is closing or closed. The draft cannot be changed.'',1;
END;';
GO
EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.sales_complete_held_ticket ON dbo.sales
AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN dbo.held_orders h ON h.store_id=i.store_id AND h.bill_no=i.bill_number WHERE h.status=''cancelled'')
 THROW 51021,''This draft bill was cancelled. Start a new bill.'',1;
 UPDATE h SET status=''completed'',row_version=COALESCE(h.row_version,0)+1,updated_at=SYSDATETIMEOFFSET()
 FROM dbo.held_orders h JOIN inserted i ON i.store_id=h.store_id AND i.bill_number=h.bill_no
 WHERE h.status NOT IN (''completed'',''cancelled'');
END;';
GO
EXEC sys.sp_executesql N'CREATE OR ALTER TRIGGER dbo.shifts_unfinished_tickets ON dbo.shifts
AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS(SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id
 JOIN dbo.held_orders h WITH (UPDLOCK,HOLDLOCK) ON h.store_id=i.store_id AND (h.shift_id=CONVERT(nvarchar(36),i.id) OR h.shift_id IS NULL)
 WHERE d.state=''ACTIVE'' AND (i.state<>''ACTIVE'' OR i.closed_at IS NOT NULL) AND h.status NOT IN (''completed'',''cancelled''))
 THROW 51022,''Complete or cancel all draft and held bills before closing this shift.'',1;
END;';
GO
IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=16)
 INSERT dbo.pos_schema_migrations(version,name) VALUES(16,N'synced_register_drafts');
GO

GO

-- SECTION 3: Verify all required tables, columns and migration versions

DECLARE @RequiredTables TABLE ([name] sysname NOT NULL PRIMARY KEY);
INSERT INTO @RequiredTables ([name]) VALUES
  (N'coupon_campaigns'),
  (N'shifts'),
  (N'issued_vouchers'),
  (N'activity_events'),
  (N'app_users'),
  (N'audit_logs'),
  (N'booking_payments'),
  (N'bookings'),
  (N'branch_telemetry'),
  (N'cashiers'),
  (N'coupon_events'),
  (N'drawer_events'),
  (N'held_orders'),
  (N'integration_settings'),
  (N'item_activity_logs'),
  (N'member_verifications'),
  (N'members'),
  (N'membership_tiers'),
  (N'offline_sync_audit_log'),
  (N'payment_transactions'),
  (N'payment_types'),
  (N'pin_attempts'),
  (N'pos_settings'),
  (N'product_barcodes'),
  (N'product_categories'),
  (N'products'),
  (N'promotions'),
  (N'public_flags'),
  (N'purchase_order_items'),
  (N'purchase_orders'),
  (N'sale_items'),
  (N'sales'),
  (N'secure_settings'),
  (N'security_findings'),
  (N'settings_locks'),
  (N'settings_overrides'),
  (N'shift_sessions'),
  (N'sku_audit'),
  (N'staff_roles'),
  (N'stock_adjustments'),
  (N'stock_delta_applied'),
  (N'stock_transfer_items'),
  (N'stock_transfers'),
  (N'stores'),
  (N'suppliers'),
  (N'sync_metadata'),
  (N'system_audit_logs'),
  (N'terminal_commands'),
  (N'terminal_tokens'),
  (N'uom_units'),
  (N'user_roles'),
  (N'whatsapp_queue'),
  (N'terminal_recovery_secrets'),
  (N'pos_store_settings'),
  (N'settings_scoped'),
  (N'stock_count_drafts'),
  (N'authorization_actions'),
  (N'authorization_action_history'),
  (N'authorization_requests'),
  (N'authorization_log'),
  (N'record_edits'),
  (N'shift_cash_counts'),
  (N'shift_close_events'),
  (N'shift_reconciliations'),
  (N'shift_variance_alerts'),
  (N'shift_notifications'),
  (N'entity_status_history'),
  (N'nav_pins'),
  (N'store_groups'),
  (N'change_history');

DECLARE @Required int = (SELECT COUNT(*) FROM @RequiredTables);
DECLARE @Present int = (
  SELECT COUNT(*)
  FROM @RequiredTables AS required_table
  WHERE OBJECT_ID(N'dbo.' + required_table.[name], N'U') IS NOT NULL
);
DECLARE @Missing int = @Required - @Present;

SELECT
  DB_NAME() AS database_name,
  N'1.4.55' AS application_version,
  @Required AS required_tables,
  @Present AS present_tables,
  @Missing AS missing_tables,
  CASE WHEN @Missing = 0 THEN N'VALID' ELSE N'INCOMPLETE' END AS schema_status;

SELECT required_table.[name] AS missing_table
FROM @RequiredTables AS required_table
WHERE OBJECT_ID(N'dbo.' + required_table.[name], N'U') IS NULL
ORDER BY required_table.[name];

IF @Missing > 0
  THROW 51001, 'Retail POS local database schema validation failed.', 1;

DECLARE @RequiredColumns TABLE (
  table_name sysname NOT NULL,
  column_name sysname NOT NULL,
  PRIMARY KEY (table_name, column_name)
);
INSERT INTO @RequiredColumns (table_name, column_name) VALUES
  (N'coupon_campaigns', N'id'),
  (N'coupon_campaigns', N'name'),
  (N'coupon_campaigns', N'slug'),
  (N'coupon_campaigns', N'discount_type'),
  (N'coupon_campaigns', N'discount_value'),
  (N'coupon_campaigns', N'scope'),
  (N'coupon_campaigns', N'scope_value'),
  (N'coupon_campaigns', N'max_claims'),
  (N'coupon_campaigns', N'max_per_member'),
  (N'coupon_campaigns', N'claims_count'),
  (N'coupon_campaigns', N'starts_at'),
  (N'coupon_campaigns', N'expires_at'),
  (N'coupon_campaigns', N'is_active'),
  (N'coupon_campaigns', N'is_welcome'),
  (N'coupon_campaigns', N'created_at'),
  (N'coupon_campaigns', N'updated_at'),
  (N'coupon_campaigns', N'row_version'),
  (N'shifts', N'id'),
  (N'shifts', N'store_id'),
  (N'shifts', N'terminal_id'),
  (N'shifts', N'terminal_name'),
  (N'shifts', N'opened_by_name'),
  (N'shifts', N'opened_by_staff_id'),
  (N'shifts', N'opened_by_role'),
  (N'shifts', N'closed_by_name'),
  (N'shifts', N'closed_by_staff_id'),
  (N'shifts', N'closed_by_role'),
  (N'shifts', N'opened_at'),
  (N'shifts', N'closed_at'),
  (N'shifts', N'opening_float'),
  (N'shifts', N'counted_cash'),
  (N'shifts', N'expected_cash'),
  (N'shifts', N'note'),
  (N'shifts', N'overdue'),
  (N'shifts', N'created_at'),
  (N'shifts', N'updated_at'),
  (N'shifts', N'status'),
  (N'shifts', N'closing_float'),
  (N'shifts', N'user_id'),
  (N'shifts', N'row_version'),
  (N'shifts', N'counted_card'),
  (N'shifts', N'counted_digital'),
  (N'shifts', N'expected_card'),
  (N'shifts', N'expected_digital'),
  (N'shifts', N'variance_cash'),
  (N'shifts', N'variance_card'),
  (N'shifts', N'variance_digital'),
  (N'shifts', N'variance_total'),
  (N'shifts', N'state'),
  (N'shifts', N'close_reason'),
  (N'shifts', N'closing_started_at'),
  (N'shifts', N'closing_started_by'),
  (N'shifts', N'final_counted_cash'),
  (N'shifts', N'variance_status'),
  (N'issued_vouchers', N'id'),
  (N'issued_vouchers', N'token_slug'),
  (N'issued_vouchers', N'campaign_id'),
  (N'issued_vouchers', N'member_id'),
  (N'issued_vouchers', N'status'),
  (N'issued_vouchers', N'issued_at'),
  (N'issued_vouchers', N'expires_at'),
  (N'issued_vouchers', N'issued_by'),
  (N'issued_vouchers', N'issued_source'),
  (N'issued_vouchers', N'redeemed_at'),
  (N'issued_vouchers', N'redeemed_by'),
  (N'issued_vouchers', N'redeemed_sale_id'),
  (N'issued_vouchers', N'disabled_at'),
  (N'issued_vouchers', N'disabled_by'),
  (N'issued_vouchers', N'disable_reason'),
  (N'issued_vouchers', N'store_id'),
  (N'issued_vouchers', N'row_version'),
  (N'activity_events', N'id'),
  (N'activity_events', N'event_type'),
  (N'activity_events', N'severity'),
  (N'activity_events', N'title'),
  (N'activity_events', N'message'),
  (N'activity_events', N'actor_id'),
  (N'activity_events', N'actor_name'),
  (N'activity_events', N'actor_role'),
  (N'activity_events', N'terminal_id'),
  (N'activity_events', N'terminal_name'),
  (N'activity_events', N'store_id'),
  (N'activity_events', N'entity_type'),
  (N'activity_events', N'entity_id'),
  (N'activity_events', N'amount'),
  (N'activity_events', N'meta'),
  (N'activity_events', N'whatsapp_status'),
  (N'activity_events', N'whatsapp_error'),
  (N'activity_events', N'client_event_id'),
  (N'activity_events', N'created_at'),
  (N'activity_events', N'previous_state'),
  (N'activity_events', N'new_state'),
  (N'activity_events', N'cleared_by'),
  (N'activity_events', N'branch_id'),
  (N'app_users', N'id'),
  (N'app_users', N'user_id'),
  (N'app_users', N'full_name'),
  (N'app_users', N'email'),
  (N'app_users', N'role'),
  (N'app_users', N'store_id'),
  (N'app_users', N'is_active'),
  (N'app_users', N'permissions'),
  (N'app_users', N'pin_hash'),
  (N'app_users', N'auth_user_id'),
  (N'app_users', N'last_login_at'),
  (N'app_users', N'created_at'),
  (N'app_users', N'updated_at'),
  (N'app_users', N'role_slug'),
  (N'app_users', N'pin_length'),
  (N'app_users', N'row_version'),
  (N'app_users', N'pin_set_at'),
  (N'app_users', N'pin_updated_by'),
  (N'app_users', N'auth_secret'),
  (N'app_users', N'idle_timeout_minutes'),
  (N'audit_logs', N'id'),
  (N'audit_logs', N'user_name'),
  (N'audit_logs', N'action_category'),
  (N'audit_logs', N'action_name'),
  (N'audit_logs', N'target_module'),
  (N'audit_logs', N'details'),
  (N'audit_logs', N'created_at'),
  (N'audit_logs', N'user_id'),
  (N'audit_logs', N'action'),
  (N'audit_logs', N'entity'),
  (N'audit_logs', N'before_state'),
  (N'audit_logs', N'after_state'),
  (N'audit_logs', N'store_id'),
  (N'booking_payments', N'id'),
  (N'booking_payments', N'booking_id'),
  (N'booking_payments', N'amount'),
  (N'booking_payments', N'method'),
  (N'booking_payments', N'cashier'),
  (N'booking_payments', N'paid_at'),
  (N'booking_payments', N'created_at'),
  (N'booking_payments', N'row_version'),
  (N'booking_payments', N'status'),
  (N'booking_payments', N'client_payment_id'),
  (N'booking_payments', N'reference'),
  (N'booking_payments', N'reversed_at'),
  (N'booking_payments', N'reversed_by'),
  (N'booking_payments', N'kind'),
  (N'booking_payments', N'refund_reason'),
  (N'booking_payments', N'refunds_payment_id'),
  (N'booking_payments', N'change_given'),
  (N'bookings', N'id'),
  (N'bookings', N'ref'),
  (N'bookings', N'store_id'),
  (N'bookings', N'shift_id'),
  (N'bookings', N'customer_name'),
  (N'bookings', N'customer_phone'),
  (N'bookings', N'member_id'),
  (N'bookings', N'service_type_id'),
  (N'bookings', N'service_name'),
  (N'bookings', N'service_fee'),
  (N'bookings', N'payment_timing'),
  (N'bookings', N'lines'),
  (N'bookings', N'subtotal'),
  (N'bookings', N'discount'),
  (N'bookings', N'tax'),
  (N'bookings', N'total'),
  (N'bookings', N'paid'),
  (N'bookings', N'due_date'),
  (N'bookings', N'note'),
  (N'bookings', N'cashier'),
  (N'bookings', N'status'),
  (N'bookings', N'booking_kind'),
  (N'bookings', N'sale_receipt_no'),
  (N'bookings', N'closed_at'),
  (N'bookings', N'racket_model'),
  (N'bookings', N'string_type'),
  (N'bookings', N'tension_main'),
  (N'bookings', N'tension_cross'),
  (N'bookings', N'tension_unit'),
  (N'bookings', N'grommet_notes'),
  (N'bookings', N'job_notes'),
  (N'bookings', N'dropped_off_at'),
  (N'bookings', N'promised_at'),
  (N'bookings', N'job_status'),
  (N'bookings', N'job_status_by'),
  (N'bookings', N'job_status_at'),
  (N'bookings', N'notify_whatsapp'),
  (N'bookings', N'created_at'),
  (N'bookings', N'updated_at'),
  (N'bookings', N'tag_id'),
  (N'bookings', N'intake_note'),
  (N'bookings', N'string_origin'),
  (N'bookings', N'string_source_product_id'),
  (N'bookings', N'grip_product_id'),
  (N'bookings', N'charges'),
  (N'bookings', N'technician'),
  (N'bookings', N'liability_accepted'),
  (N'bookings', N'incident_note'),
  (N'bookings', N'row_version'),
  (N'bookings', N'cancel_reason'),
  (N'bookings', N'cancelled_by'),
  (N'bookings', N'cancelled_at'),
  (N'bookings', N'cancelled_terminal'),
  (N'bookings', N'cancel_money_action'),
  (N'bookings', N'booking_ref'),
  (N'branch_telemetry', N'terminal_id'),
  (N'branch_telemetry', N'store_id'),
  (N'branch_telemetry', N'terminal_name'),
  (N'branch_telemetry', N'staff_name'),
  (N'branch_telemetry', N'staff_role'),
  (N'branch_telemetry', N'db_mode'),
  (N'branch_telemetry', N'connection_status'),
  (N'branch_telemetry', N'storage_engine'),
  (N'branch_telemetry', N'pending_count'),
  (N'branch_telemetry', N'conflict_count'),
  (N'branch_telemetry', N'last_synced_at'),
  (N'branch_telemetry', N'app_version'),
  (N'branch_telemetry', N'platform'),
  (N'branch_telemetry', N'last_seen_at'),
  (N'branch_telemetry', N'created_at'),
  (N'branch_telemetry', N'updated_at'),
  (N'branch_telemetry', N'branch_id'),
  (N'branch_telemetry', N'pending_queue_count'),
  (N'branch_telemetry', N'last_ping'),
  (N'branch_telemetry', N'status'),
  (N'branch_telemetry', N'branch_code'),
  (N'branch_telemetry', N'session_status'),
  (N'branch_telemetry', N'sql_server_state'),
  (N'branch_telemetry', N'database_name'),
  (N'branch_telemetry', N'schema_version'),
  (N'branch_telemetry', N'failed_count'),
  (N'branch_telemetry', N'sync_phase'),
  (N'branch_telemetry', N'current_table'),
  (N'branch_telemetry', N'last_push_at'),
  (N'branch_telemetry', N'last_pull_at'),
  (N'branch_telemetry', N'device_name'),
  (N'branch_telemetry', N'device_type'),
  (N'branch_telemetry', N'location_name'),
  (N'branch_telemetry', N'last_heartbeat_at'),
  (N'cashiers', N'id'),
  (N'cashiers', N'username'),
  (N'cashiers', N'full_name'),
  (N'cashiers', N'pin_hash'),
  (N'cashiers', N'store_id'),
  (N'cashiers', N'permissions'),
  (N'cashiers', N'is_active'),
  (N'cashiers', N'last_login_at'),
  (N'cashiers', N'created_at'),
  (N'cashiers', N'updated_at'),
  (N'cashiers', N'role_slug'),
  (N'cashiers', N'idle_timeout_minutes'),
  (N'coupon_events', N'id'),
  (N'coupon_events', N'event_type'),
  (N'coupon_events', N'campaign_id'),
  (N'coupon_events', N'campaign_name'),
  (N'coupon_events', N'voucher_token'),
  (N'coupon_events', N'member_id'),
  (N'coupon_events', N'member_phone'),
  (N'coupon_events', N'store_id'),
  (N'coupon_events', N'terminal_id'),
  (N'coupon_events', N'staff_name'),
  (N'coupon_events', N'staff_role'),
  (N'coupon_events', N'sale_id'),
  (N'coupon_events', N'note'),
  (N'coupon_events', N'created_at'),
  (N'drawer_events', N'id'),
  (N'drawer_events', N'store_id'),
  (N'drawer_events', N'terminal_id'),
  (N'drawer_events', N'shift_id'),
  (N'drawer_events', N'staff_id'),
  (N'drawer_events', N'staff_name'),
  (N'drawer_events', N'role'),
  (N'drawer_events', N'reason'),
  (N'drawer_events', N'note'),
  (N'drawer_events', N'approved_by'),
  (N'drawer_events', N'created_at'),
  (N'held_orders', N'id'),
  (N'held_orders', N'label'),
  (N'held_orders', N'store_id'),
  (N'held_orders', N'shift_id'),
  (N'held_orders', N'held_by'),
  (N'held_orders', N'total'),
  (N'held_orders', N'lines'),
  (N'held_orders', N'cart_discount'),
  (N'held_orders', N'cart_discount_type'),
  (N'held_orders', N'exchange_ref'),
  (N'held_orders', N'member_id'),
  (N'held_orders', N'member_name'),
  (N'held_orders', N'coupon'),
  (N'held_orders', N'note'),
  (N'held_orders', N'cancelled_from'),
  (N'held_orders', N'held_at'),
  (N'held_orders', N'created_at'),
  (N'held_orders', N'updated_at'),
  (N'held_orders', N'row_version'),
  (N'held_orders', N'status'),
  (N'held_orders', N'pending_request_id'),
  (N'held_orders', N'approval_snapshot_hash'),
  (N'held_orders', N'bill_no'),
  (N'integration_settings', N'id'),
  (N'integration_settings', N'provider_name'),
  (N'integration_settings', N'api_keys_encrypted'),
  (N'integration_settings', N'verification_channel'),
  (N'integration_settings', N'strict_verification'),
  (N'integration_settings', N'is_active'),
  (N'integration_settings', N'updated_by'),
  (N'integration_settings', N'created_at'),
  (N'integration_settings', N'updated_at'),
  (N'item_activity_logs', N'id'),
  (N'item_activity_logs', N'product_id'),
  (N'item_activity_logs', N'product_name'),
  (N'item_activity_logs', N'sku'),
  (N'item_activity_logs', N'barcode'),
  (N'item_activity_logs', N'store_id'),
  (N'item_activity_logs', N'terminal_id'),
  (N'item_activity_logs', N'activity_type'),
  (N'item_activity_logs', N'reference'),
  (N'item_activity_logs', N'quantity_delta'),
  (N'item_activity_logs', N'stock_before'),
  (N'item_activity_logs', N'stock_after'),
  (N'item_activity_logs', N'unit_cost'),
  (N'item_activity_logs', N'staff_id'),
  (N'item_activity_logs', N'staff_name'),
  (N'item_activity_logs', N'role'),
  (N'item_activity_logs', N'note'),
  (N'item_activity_logs', N'created_at'),
  (N'item_activity_logs', N'row_version'),
  (N'item_activity_logs', N'item_id'),
  (N'item_activity_logs', N'sale_id'),
  (N'item_activity_logs', N'transfer_id'),
  (N'item_activity_logs', N'quantity'),
  (N'item_activity_logs', N'created_by'),
  (N'item_activity_logs', N'notes'),
  (N'member_verifications', N'id'),
  (N'member_verifications', N'member_id'),
  (N'member_verifications', N'phone'),
  (N'member_verifications', N'email'),
  (N'member_verifications', N'channel'),
  (N'member_verifications', N'otp_code'),
  (N'member_verifications', N'attempts'),
  (N'member_verifications', N'status'),
  (N'member_verifications', N'sent_by'),
  (N'member_verifications', N'store_id'),
  (N'member_verifications', N'expires_at'),
  (N'member_verifications', N'verified_at'),
  (N'member_verifications', N'created_at'),
  (N'members', N'id'),
  (N'members', N'member_code'),
  (N'members', N'full_name'),
  (N'members', N'phone'),
  (N'members', N'email'),
  (N'members', N'address'),
  (N'members', N'country_code'),
  (N'members', N'postal_code'),
  (N'members', N'date_of_birth'),
  (N'members', N'tier_id'),
  (N'members', N'loyalty_points'),
  (N'members', N'total_spent'),
  (N'members', N'created_at'),
  (N'members', N'updated_at'),
  (N'members', N'row_version'),
  (N'members', N'deleted_at'),
  (N'membership_tiers', N'id'),
  (N'membership_tiers', N'name'),
  (N'membership_tiers', N'discount_percentage'),
  (N'membership_tiers', N'points_multiplier'),
  (N'membership_tiers', N'created_at'),
  (N'membership_tiers', N'updated_at'),
  (N'membership_tiers', N'row_version'),
  (N'membership_tiers', N'deleted_at'),
  (N'offline_sync_audit_log', N'id'),
  (N'offline_sync_audit_log', N'terminal_id'),
  (N'offline_sync_audit_log', N'store_id'),
  (N'offline_sync_audit_log', N'direction'),
  (N'offline_sync_audit_log', N'table_name'),
  (N'offline_sync_audit_log', N'record_id'),
  (N'offline_sync_audit_log', N'records'),
  (N'offline_sync_audit_log', N'status'),
  (N'offline_sync_audit_log', N'error_message'),
  (N'offline_sync_audit_log', N'started_at'),
  (N'offline_sync_audit_log', N'finished_at'),
  (N'offline_sync_audit_log', N'created_at'),
  (N'payment_transactions', N'id'),
  (N'payment_transactions', N'source_type'),
  (N'payment_transactions', N'sale_id'),
  (N'payment_transactions', N'booking_id'),
  (N'payment_transactions', N'member_id'),
  (N'payment_transactions', N'store_id'),
  (N'payment_transactions', N'shift_id'),
  (N'payment_transactions', N'terminal_id'),
  (N'payment_transactions', N'amount'),
  (N'payment_transactions', N'method'),
  (N'payment_transactions', N'kind'),
  (N'payment_transactions', N'reference'),
  (N'payment_transactions', N'cashier_id'),
  (N'payment_transactions', N'cashier_name'),
  (N'payment_transactions', N'note'),
  (N'payment_transactions', N'paid_at'),
  (N'payment_transactions', N'created_at'),
  (N'payment_transactions', N'updated_at'),
  (N'payment_transactions', N'row_version'),
  (N'payment_transactions', N'status'),
  (N'payment_transactions', N'metadata'),
  (N'payment_transactions', N'client_transaction_id'),
  (N'payment_transactions', N'order_id'),
  (N'payment_transactions', N'payment_method'),
  (N'payment_transactions', N'transaction_reference'),
  (N'payment_types', N'id'),
  (N'payment_types', N'name'),
  (N'payment_types', N'type_code'),
  (N'payment_types', N'requires_reference'),
  (N'payment_types', N'is_active'),
  (N'payment_types', N'icon'),
  (N'payment_types', N'sort_order'),
  (N'payment_types', N'is_system'),
  (N'payment_types', N'created_at'),
  (N'payment_types', N'updated_at'),
  (N'payment_types', N'row_version'),
  (N'pin_attempts', N'key'),
  (N'pin_attempts', N'attempts'),
  (N'pin_attempts', N'window_started_at'),
  (N'pin_attempts', N'locked_until'),
  (N'pin_attempts', N'created_at'),
  (N'pin_attempts', N'updated_at'),
  (N'pos_settings', N'id'),
  (N'pos_settings', N'tax_percentage'),
  (N'pos_settings', N'enable_tax'),
  (N'pos_settings', N'tax_mode'),
  (N'pos_settings', N'paper_size'),
  (N'pos_settings', N'header_text'),
  (N'pos_settings', N'footer_text'),
  (N'pos_settings', N'show_logo'),
  (N'pos_settings', N'show_points'),
  (N'pos_settings', N'show_barcode'),
  (N'pos_settings', N'show_tax_details'),
  (N'pos_settings', N'updated_at'),
  (N'pos_settings', N'company_name'),
  (N'pos_settings', N'tax_number'),
  (N'pos_settings', N'reg_number'),
  (N'pos_settings', N'phone'),
  (N'pos_settings', N'website'),
  (N'pos_settings', N'fonts'),
  (N'pos_settings', N'custom_lines'),
  (N'pos_settings', N'qr'),
  (N'pos_settings', N'ui_visibility'),
  (N'pos_settings', N'integration_settings'),
  (N'pos_settings', N'region_country'),
  (N'pos_settings', N'time_zone'),
  (N'pos_settings', N'date_format'),
  (N'pos_settings', N'time_format'),
  (N'pos_settings', N'booking_slip'),
  (N'pos_settings', N'notification_settings'),
  (N'pos_settings', N'row_version'),
  (N'pos_settings', N'logo_data_url'),
  (N'pos_settings', N'receipt_design'),
  (N'pos_settings', N'payment_details'),
  (N'pos_settings', N'whatsapp_settings'),
  (N'pos_settings', N'receipt_css'),
  (N'product_barcodes', N'id'),
  (N'product_barcodes', N'product_id'),
  (N'product_barcodes', N'barcode'),
  (N'product_barcodes', N'label'),
  (N'product_barcodes', N'pack_size'),
  (N'product_barcodes', N'is_primary'),
  (N'product_barcodes', N'created_at'),
  (N'product_barcodes', N'updated_at'),
  (N'product_barcodes', N'row_version'),
  (N'product_barcodes', N'unit_label'),
  (N'product_barcodes', N'deleted_at'),
  (N'product_categories', N'id'),
  (N'product_categories', N'name'),
  (N'product_categories', N'parent_id'),
  (N'product_categories', N'sort'),
  (N'product_categories', N'created_at'),
  (N'product_categories', N'updated_at'),
  (N'product_categories', N'kind'),
  (N'product_categories', N'row_version'),
  (N'product_categories', N'is_active'),
  (N'product_categories', N'deleted_at'),
  (N'products', N'id'),
  (N'products', N'barcode'),
  (N'products', N'name'),
  (N'products', N'category'),
  (N'products', N'cost_price'),
  (N'products', N'selling_price'),
  (N'products', N'ecom_price'),
  (N'products', N'stock_quantity'),
  (N'products', N'custom_points'),
  (N'products', N'point_multiplier'),
  (N'products', N'created_at'),
  (N'products', N'sku'),
  (N'products', N'reorder_level'),
  (N'products', N'tax_rate'),
  (N'products', N'ecom_visible'),
  (N'products', N'stock_by_store'),
  (N'products', N'updated_at'),
  (N'products', N'landing_pct'),
  (N'products', N'sub_category'),
  (N'products', N'unit'),
  (N'products', N'packs'),
  (N'products', N'barcode_aliases'),
  (N'products', N'is_archived'),
  (N'products', N'archived_at'),
  (N'products', N'brand'),
  (N'products', N'product_group'),
  (N'products', N'barcode_variants'),
  (N'products', N'row_version'),
  (N'products', N'owner_store_id'),
  (N'products', N'deleted_at'),
  (N'promotions', N'id'),
  (N'promotions', N'title'),
  (N'promotions', N'promo_type'),
  (N'promotions', N'min_spend'),
  (N'promotions', N'discount_percent'),
  (N'promotions', N'discount_amount'),
  (N'promotions', N'foc_product_id'),
  (N'promotions', N'points_per_dollar'),
  (N'promotions', N'tier_rates'),
  (N'promotions', N'is_active'),
  (N'promotions', N'start_date'),
  (N'promotions', N'end_date'),
  (N'promotions', N'created_at'),
  (N'promotions', N'updated_at'),
  (N'promotions', N'row_version'),
  (N'promotions', N'deleted_at'),
  (N'public_flags', N'key'),
  (N'public_flags', N'enabled'),
  (N'public_flags', N'updated_at'),
  (N'purchase_order_items', N'id'),
  (N'purchase_order_items', N'po_id'),
  (N'purchase_order_items', N'product_id'),
  (N'purchase_order_items', N'barcode'),
  (N'purchase_order_items', N'product_name'),
  (N'purchase_order_items', N'cost_price'),
  (N'purchase_order_items', N'selling_price'),
  (N'purchase_order_items', N'quantity_received'),
  (N'purchase_order_items', N'subtotal_cost'),
  (N'purchase_order_items', N'created_at'),
  (N'purchase_order_items', N'sku'),
  (N'purchase_order_items', N'updated_at'),
  (N'purchase_order_items', N'row_version'),
  (N'purchase_orders', N'id'),
  (N'purchase_orders', N'po_number'),
  (N'purchase_orders', N'supplier_name'),
  (N'purchase_orders', N'operator_name'),
  (N'purchase_orders', N'total_cost'),
  (N'purchase_orders', N'total_items_count'),
  (N'purchase_orders', N'created_at'),
  (N'purchase_orders', N'supplier_id'),
  (N'purchase_orders', N'store_id'),
  (N'purchase_orders', N'store_code'),
  (N'purchase_orders', N'invoice_date'),
  (N'purchase_orders', N'invoice_entry_date'),
  (N'purchase_orders', N'updated_at'),
  (N'purchase_orders', N'row_version'),
  (N'purchase_orders', N'status'),
  (N'purchase_orders', N'reference'),
  (N'purchase_orders', N'pending_edit_request_id'),
  (N'purchase_orders', N'pending_edit_by'),
  (N'purchase_orders', N'pending_edit_at'),
  (N'sale_items', N'id'),
  (N'sale_items', N'sale_id'),
  (N'sale_items', N'product_id'),
  (N'sale_items', N'product_name'),
  (N'sale_items', N'variant_code'),
  (N'sale_items', N'unit_price'),
  (N'sale_items', N'quantity'),
  (N'sale_items', N'discount_percent'),
  (N'sale_items', N'discount_amount'),
  (N'sale_items', N'is_return'),
  (N'sale_items', N'created_at'),
  (N'sale_items', N'tax_rate'),
  (N'sale_items', N'is_foc'),
  (N'sale_items', N'promo_id'),
  (N'sale_items', N'coupon_code'),
  (N'sale_items', N'coupon_discount'),
  (N'sale_items', N'unit_cost'),
  (N'sale_items', N'row_version'),
  (N'sale_items', N'refunded_qty'),
  (N'sale_items', N'branch_id'),
  (N'sales', N'id'),
  (N'sales', N'bill_number'),
  (N'sales', N'member_id'),
  (N'sales', N'store_id'),
  (N'sales', N'cashier_name'),
  (N'sales', N'subtotal_amount'),
  (N'sales', N'total_amount'),
  (N'sales', N'discount_amount'),
  (N'sales', N'tax_amount'),
  (N'sales', N'payment_type'),
  (N'sales', N'points_earned'),
  (N'sales', N'points_redeemed'),
  (N'sales', N'is_exchange'),
  (N'sales', N'original_bill_number'),
  (N'sales', N'is_refunded'),
  (N'sales', N'created_at'),
  (N'sales', N'shift_id'),
  (N'sales', N'paid_amount'),
  (N'sales', N'change_amount'),
  (N'sales', N'exchange_credit'),
  (N'sales', N'exchanged_to_bill_number'),
  (N'sales', N'coupon_code'),
  (N'sales', N'coupon_promo_id'),
  (N'sales', N'coupon_scope'),
  (N'sales', N'coupon_discount'),
  (N'sales', N'payments'),
  (N'sales', N'client_transaction_id'),
  (N'sales', N'cashier_id'),
  (N'sales', N'created_by'),
  (N'sales', N'updated_by'),
  (N'sales', N'row_version'),
  (N'sales', N'store_name_snapshot'),
  (N'sales', N'store_address_snapshot'),
  (N'sales', N'authorization_request_id'),
  (N'sales', N'authorized_by'),
  (N'sales', N'authorized_at'),
  (N'sales', N'rounding_adjustment'),
  (N'sales', N'rounding_label'),
  (N'sales', N'branch_id'),
  (N'secure_settings', N'key'),
  (N'secure_settings', N'ciphertext'),
  (N'secure_settings', N'hint'),
  (N'secure_settings', N'updated_by'),
  (N'secure_settings', N'created_at'),
  (N'secure_settings', N'updated_at'),
  (N'security_findings', N'id'),
  (N'security_findings', N'fingerprint'),
  (N'security_findings', N'source'),
  (N'security_findings', N'severity'),
  (N'security_findings', N'title'),
  (N'security_findings', N'detail'),
  (N'security_findings', N'deployment_ref'),
  (N'security_findings', N'status'),
  (N'security_findings', N'first_seen_at'),
  (N'security_findings', N'last_seen_at'),
  (N'security_findings', N'acknowledged_by'),
  (N'security_findings', N'acknowledged_at'),
  (N'security_findings', N'resolved_at'),
  (N'security_findings', N'created_at'),
  (N'security_findings', N'updated_at'),
  (N'settings_locks', N'section'),
  (N'settings_locks', N'locked'),
  (N'settings_locks', N'updated_by'),
  (N'settings_locks', N'created_at'),
  (N'settings_locks', N'updated_at'),
  (N'settings_overrides', N'scope'),
  (N'settings_overrides', N'scope_id'),
  (N'settings_overrides', N'section'),
  (N'settings_overrides', N'patch'),
  (N'settings_overrides', N'updated_by'),
  (N'settings_overrides', N'created_at'),
  (N'settings_overrides', N'updated_at'),
  (N'settings_overrides', N'row_version'),
  (N'shift_sessions', N'id'),
  (N'shift_sessions', N'shift_id'),
  (N'shift_sessions', N'store_id'),
  (N'shift_sessions', N'terminal_id'),
  (N'shift_sessions', N'terminal_name'),
  (N'shift_sessions', N'staff_id'),
  (N'shift_sessions', N'staff_name'),
  (N'shift_sessions', N'role'),
  (N'shift_sessions', N'signed_in_at'),
  (N'shift_sessions', N'signed_out_at'),
  (N'shift_sessions', N'created_at'),
  (N'shift_sessions', N'updated_at'),
  (N'shift_sessions', N'row_version'),
  (N'sku_audit', N'id'),
  (N'sku_audit', N'sku'),
  (N'sku_audit', N'product_id'),
  (N'sku_audit', N'product_name'),
  (N'sku_audit', N'source'),
  (N'sku_audit', N'previous_sku'),
  (N'sku_audit', N'store_id'),
  (N'sku_audit', N'store_name'),
  (N'sku_audit', N'terminal_id'),
  (N'sku_audit', N'staff_id'),
  (N'sku_audit', N'staff_name'),
  (N'sku_audit', N'role'),
  (N'sku_audit', N'created_at'),
  (N'staff_roles', N'slug'),
  (N'staff_roles', N'name'),
  (N'staff_roles', N'base_level'),
  (N'staff_roles', N'permissions'),
  (N'staff_roles', N'is_core'),
  (N'staff_roles', N'created_at'),
  (N'staff_roles', N'updated_at'),
  (N'stock_adjustments', N'id'),
  (N'stock_adjustments', N'product_id'),
  (N'stock_adjustments', N'product_name'),
  (N'stock_adjustments', N'sku'),
  (N'stock_adjustments', N'barcode'),
  (N'stock_adjustments', N'store_id'),
  (N'stock_adjustments', N'terminal_id'),
  (N'stock_adjustments', N'reason'),
  (N'stock_adjustments', N'note'),
  (N'stock_adjustments', N'previous_stock'),
  (N'stock_adjustments', N'updated_stock'),
  (N'stock_adjustments', N'delta'),
  (N'stock_adjustments', N'cost_impact'),
  (N'stock_adjustments', N'staff_id'),
  (N'stock_adjustments', N'staff_name'),
  (N'stock_adjustments', N'role'),
  (N'stock_adjustments', N'created_at'),
  (N'stock_adjustments', N'row_version'),
  (N'stock_adjustments', N'draft_id'),
  (N'stock_delta_applied', N'movement_id'),
  (N'stock_delta_applied', N'product_id'),
  (N'stock_delta_applied', N'store_id'),
  (N'stock_delta_applied', N'delta'),
  (N'stock_delta_applied', N'applied_at'),
  (N'stock_transfer_items', N'id'),
  (N'stock_transfer_items', N'transfer_id'),
  (N'stock_transfer_items', N'product_id'),
  (N'stock_transfer_items', N'barcode'),
  (N'stock_transfer_items', N'sku'),
  (N'stock_transfer_items', N'product_name'),
  (N'stock_transfer_items', N'quantity'),
  (N'stock_transfer_items', N'quantity_received'),
  (N'stock_transfer_items', N'unit_cost'),
  (N'stock_transfer_items', N'created_at'),
  (N'stock_transfer_items', N'row_version'),
  (N'stock_transfer_items', N'quantity_approved'),
  (N'stock_transfer_items', N'quantity_dispatched'),
  (N'stock_transfer_items', N'quantity_verified'),
  (N'stock_transfers', N'id'),
  (N'stock_transfers', N'ref'),
  (N'stock_transfers', N'kind'),
  (N'stock_transfers', N'transfer_scope'),
  (N'stock_transfers', N'from_store_id'),
  (N'stock_transfers', N'from_store_name'),
  (N'stock_transfers', N'from_group_id'),
  (N'stock_transfers', N'to_store_id'),
  (N'stock_transfers', N'to_store_name'),
  (N'stock_transfers', N'to_group_id'),
  (N'stock_transfers', N'status'),
  (N'stock_transfers', N'note'),
  (N'stock_transfers', N'created_by'),
  (N'stock_transfers', N'approved_by'),
  (N'stock_transfers', N'approved_at'),
  (N'stock_transfers', N'received_by'),
  (N'stock_transfers', N'received_at'),
  (N'stock_transfers', N'rejected_reason'),
  (N'stock_transfers', N'created_at'),
  (N'stock_transfers', N'updated_at'),
  (N'stock_transfers', N'row_version'),
  (N'stock_transfers', N'verified_by'),
  (N'stock_transfers', N'verified_at'),
  (N'stock_transfers', N'posted_at'),
  (N'stock_transfers', N'discrepancy_reason'),
  (N'stock_transfers', N'rejected_by'),
  (N'stock_transfers', N'cancelled_reason'),
  (N'stock_transfers', N'dispatched_by'),
  (N'stock_transfers', N'dispatched_at'),
  (N'stock_transfers', N'closed_at'),
  (N'stock_transfers', N'fulfilment'),
  (N'stock_transfers', N'source_request_id'),
  (N'stores', N'id'),
  (N'stores', N'code'),
  (N'stores', N'name'),
  (N'stores', N'address'),
  (N'stores', N'phone'),
  (N'stores', N'created_at'),
  (N'stores', N'updated_at'),
  (N'stores', N'group_id'),
  (N'stores', N'row_version'),
  (N'stores', N'location_type'),
  (N'stores', N'parent_id'),
  (N'stores', N'is_central'),
  (N'stores', N'building_name'),
  (N'stores', N'floor_label'),
  (N'stores', N'is_active'),
  (N'stores', N'archived_at'),
  (N'stores', N'is_primary_sub'),
  (N'stores', N'private_catalogue'),
  (N'stores', N'receipt_prefix'),
  (N'stores', N'deleted_at'),
  (N'suppliers', N'id'),
  (N'suppliers', N'name'),
  (N'suppliers', N'contact_name'),
  (N'suppliers', N'phone'),
  (N'suppliers', N'email'),
  (N'suppliers', N'address'),
  (N'suppliers', N'tax_number'),
  (N'suppliers', N'notes'),
  (N'suppliers', N'is_active'),
  (N'suppliers', N'created_at'),
  (N'suppliers', N'updated_at'),
  (N'suppliers', N'row_version'),
  (N'suppliers', N'deleted_at'),
  (N'sync_metadata', N'id'),
  (N'sync_metadata', N'store_id'),
  (N'sync_metadata', N'terminal_id'),
  (N'sync_metadata', N'table_name'),
  (N'sync_metadata', N'last_synced_at'),
  (N'sync_metadata', N'last_pushed_at'),
  (N'sync_metadata', N'rows_pushed'),
  (N'sync_metadata', N'last_error'),
  (N'sync_metadata', N'created_at'),
  (N'sync_metadata', N'updated_at'),
  (N'system_audit_logs', N'id'),
  (N'system_audit_logs', N'actor_id'),
  (N'system_audit_logs', N'actor_name'),
  (N'system_audit_logs', N'actor_role'),
  (N'system_audit_logs', N'action_type'),
  (N'system_audit_logs', N'entity_affected'),
  (N'system_audit_logs', N'entity_id'),
  (N'system_audit_logs', N'old_value'),
  (N'system_audit_logs', N'new_value'),
  (N'system_audit_logs', N'terminal_id'),
  (N'system_audit_logs', N'ip_address'),
  (N'system_audit_logs', N'store_id'),
  (N'system_audit_logs', N'note'),
  (N'system_audit_logs', N'created_at'),
  (N'terminal_commands', N'id'),
  (N'terminal_commands', N'terminal_id'),
  (N'terminal_commands', N'store_id'),
  (N'terminal_commands', N'command'),
  (N'terminal_commands', N'status'),
  (N'terminal_commands', N'note'),
  (N'terminal_commands', N'result'),
  (N'terminal_commands', N'issued_by'),
  (N'terminal_commands', N'issued_role'),
  (N'terminal_commands', N'picked_up_at'),
  (N'terminal_commands', N'finished_at'),
  (N'terminal_commands', N'created_at'),
  (N'terminal_commands', N'updated_at'),
  (N'terminal_tokens', N'id'),
  (N'terminal_tokens', N'location_id'),
  (N'terminal_tokens', N'location_name'),
  (N'terminal_tokens', N'device_name'),
  (N'terminal_tokens', N'status'),
  (N'terminal_tokens', N'created_at'),
  (N'terminal_tokens', N'activated_at'),
  (N'terminal_tokens', N'revoked_at'),
  (N'terminal_tokens', N'last_seen_at'),
  (N'terminal_tokens', N'app_version'),
  (N'terminal_tokens', N'last_sync_at'),
  (N'terminal_tokens', N'reissued_at'),
  (N'terminal_tokens', N'replaced_by'),
  (N'terminal_tokens', N'claimed_by_device'),
  (N'terminal_tokens', N'claimed_at'),
  (N'terminal_tokens', N'platform'),
  (N'terminal_tokens', N'row_version'),
  (N'terminal_tokens', N'claim_secret_hash'),
  (N'terminal_tokens', N'claim_expires_at'),
  (N'terminal_tokens', N'credentials_issued_at'),
  (N'terminal_tokens', N'device_platform'),
  (N'terminal_tokens', N'device_os'),
  (N'terminal_tokens', N'claimed_proof_hash'),
  (N'terminal_tokens', N'claimed_platform'),
  (N'terminal_tokens', N'claimed_os'),
  (N'terminal_tokens', N'is_claimed'),
  (N'terminal_tokens', N'expires_at'),
  (N'terminal_tokens', N'claim_proof'),
  (N'uom_units', N'id'),
  (N'uom_units', N'code'),
  (N'uom_units', N'name'),
  (N'uom_units', N'allow_decimal'),
  (N'uom_units', N'sort'),
  (N'uom_units', N'created_at'),
  (N'uom_units', N'updated_at'),
  (N'uom_units', N'row_version'),
  (N'uom_units', N'is_active'),
  (N'uom_units', N'deleted_at'),
  (N'user_roles', N'id'),
  (N'user_roles', N'user_id'),
  (N'user_roles', N'role'),
  (N'user_roles', N'created_at'),
  (N'whatsapp_queue', N'id'),
  (N'whatsapp_queue', N'phone_number_id'),
  (N'whatsapp_queue', N'recipient'),
  (N'whatsapp_queue', N'body'),
  (N'whatsapp_queue', N'reference'),
  (N'whatsapp_queue', N'store_id'),
  (N'whatsapp_queue', N'status'),
  (N'whatsapp_queue', N'error'),
  (N'whatsapp_queue', N'queued_at'),
  (N'whatsapp_queue', N'sent_at'),
  (N'whatsapp_queue', N'created_at'),
  (N'whatsapp_queue', N'updated_at'),
  (N'terminal_recovery_secrets', N'terminal_token_id'),
  (N'terminal_recovery_secrets', N'sealed_secret'),
  (N'terminal_recovery_secrets', N'fingerprint'),
  (N'terminal_recovery_secrets', N'platform'),
  (N'terminal_recovery_secrets', N'device_name'),
  (N'terminal_recovery_secrets', N'utc_offset_minutes'),
  (N'terminal_recovery_secrets', N'created_at'),
  (N'terminal_recovery_secrets', N'updated_at'),
  (N'pos_store_settings', N'store_id'),
  (N'pos_store_settings', N'block_shift_close_on_hold'),
  (N'pos_store_settings', N'require_daily_sales_for_shift_close'),
  (N'pos_store_settings', N'require_counted_cash_on_close'),
  (N'pos_store_settings', N'require_opening_float_count'),
  (N'pos_store_settings', N'enable_blind_cash_count'),
  (N'pos_store_settings', N'max_drawer_cash_limit'),
  (N'pos_store_settings', N'require_reason_for_payout'),
  (N'pos_store_settings', N'allow_multiple_shifts_per_terminal'),
  (N'pos_store_settings', N'enable_cashier_x_report'),
  (N'pos_store_settings', N'show_opening_float_at_close'),
  (N'pos_store_settings', N'show_expected_totals_at_close'),
  (N'pos_store_settings', N'show_live_variance_at_close'),
  (N'pos_store_settings', N'show_itemized_tender_breakdown'),
  (N'pos_store_settings', N'require_manager_pin_on_variance'),
  (N'pos_store_settings', N'variance_pin_threshold'),
  (N'pos_store_settings', N'max_cashier_discount_percent'),
  (N'pos_store_settings', N'max_cart_discount_amount'),
  (N'pos_store_settings', N'allow_discount_stacking'),
  (N'pos_store_settings', N'require_reason_for_price_override'),
  (N'pos_store_settings', N'prevent_below_cost_sale'),
  (N'pos_store_settings', N'allow_tax_exemption'),
  (N'pos_store_settings', N'prevent_negative_stock_sale'),
  (N'pos_store_settings', N'require_receipt_for_refund'),
  (N'pos_store_settings', N'require_manager_pin_for_refund'),
  (N'pos_store_settings', N'max_refund_days_limit'),
  (N'pos_store_settings', N'track_item_voids'),
  (N'pos_store_settings', N'auto_lock_timeout_seconds'),
  (N'pos_store_settings', N'require_manager_pin_for_cash_drawer_open'),
  (N'pos_store_settings', N'enable_manager_pin_audit_log'),
  (N'pos_store_settings', N'require_pin_void_cart'),
  (N'pos_store_settings', N'require_pin_void_line'),
  (N'pos_store_settings', N'require_pin_reduce_qty'),
  (N'pos_store_settings', N'require_pin_manual_discount'),
  (N'pos_store_settings', N'require_pin_price_override'),
  (N'pos_store_settings', N'require_pin_stock_adjustment'),
  (N'pos_store_settings', N'require_pin_shift_close'),
  (N'pos_store_settings', N'require_pin_edit_tenders'),
  (N'pos_store_settings', N'require_pin_terminal_reset'),
  (N'pos_store_settings', N'row_version'),
  (N'pos_store_settings', N'updated_by'),
  (N'pos_store_settings', N'updated_at'),
  (N'pos_store_settings', N'allow_offline_approvals'),
  (N'pos_store_settings', N'offline_approval_requires_pin'),
  (N'pos_store_settings', N'online_only_void_cart'),
  (N'pos_store_settings', N'online_only_void_line'),
  (N'pos_store_settings', N'online_only_reduce_qty'),
  (N'pos_store_settings', N'online_only_manual_discount'),
  (N'pos_store_settings', N'online_only_price_override'),
  (N'pos_store_settings', N'online_only_stock_adjustment'),
  (N'pos_store_settings', N'online_only_shift_close'),
  (N'pos_store_settings', N'online_only_edit_tenders'),
  (N'pos_store_settings', N'online_only_terminal_reset'),
  (N'pos_store_settings', N'online_only_refund'),
  (N'pos_store_settings', N'created_at'),
  (N'pos_store_settings', N'idle_timeout_minutes'),
  (N'settings_scoped', N'scope'),
  (N'settings_scoped', N'scope_id'),
  (N'settings_scoped', N'key'),
  (N'settings_scoped', N'value'),
  (N'settings_scoped', N'is_overridden'),
  (N'settings_scoped', N'updated_by'),
  (N'settings_scoped', N'created_at'),
  (N'settings_scoped', N'updated_at'),
  (N'settings_scoped', N'row_version'),
  (N'stock_count_drafts', N'id'),
  (N'stock_count_drafts', N'store_id'),
  (N'stock_count_drafts', N'terminal_id'),
  (N'stock_count_drafts', N'staff_id'),
  (N'stock_count_drafts', N'staff_name'),
  (N'stock_count_drafts', N'status'),
  (N'stock_count_drafts', N'reason'),
  (N'stock_count_drafts', N'note'),
  (N'stock_count_drafts', N'lines'),
  (N'stock_count_drafts', N'line_count'),
  (N'stock_count_drafts', N'total_impact'),
  (N'stock_count_drafts', N'posted_at'),
  (N'stock_count_drafts', N'posted_by'),
  (N'stock_count_drafts', N'created_at'),
  (N'stock_count_drafts', N'updated_at'),
  (N'stock_count_drafts', N'reference'),
  (N'stock_count_drafts', N'store_code'),
  (N'stock_count_drafts', N'pending_edit_request_id'),
  (N'stock_count_drafts', N'pending_edit_by'),
  (N'stock_count_drafts', N'pending_edit_at'),
  (N'authorization_actions', N'id'),
  (N'authorization_actions', N'action_key'),
  (N'authorization_actions', N'scope_type'),
  (N'authorization_actions', N'scope_id'),
  (N'authorization_actions', N'mode'),
  (N'authorization_actions', N'allowed_roles'),
  (N'authorization_actions', N'allowed_user_ids'),
  (N'authorization_actions', N'requester_roles'),
  (N'authorization_actions', N'requester_user_ids'),
  (N'authorization_actions', N'authority_limits'),
  (N'authorization_actions', N'extra_authority'),
  (N'authorization_actions', N'absolute_ceilings'),
  (N'authorization_actions', N'approval_timeout_minutes'),
  (N'authorization_actions', N'escalation_after_minutes'),
  (N'authorization_actions', N'escalation_roles'),
  (N'authorization_actions', N'require_reason'),
  (N'authorization_actions', N'threshold'),
  (N'authorization_actions', N'is_enabled'),
  (N'authorization_actions', N'row_version'),
  (N'authorization_actions', N'updated_by'),
  (N'authorization_actions', N'created_at'),
  (N'authorization_actions', N'updated_at'),
  (N'authorization_action_history', N'id'),
  (N'authorization_action_history', N'action_id'),
  (N'authorization_action_history', N'action_key'),
  (N'authorization_action_history', N'scope_type'),
  (N'authorization_action_history', N'scope_id'),
  (N'authorization_action_history', N'row_version'),
  (N'authorization_action_history', N'changed_by'),
  (N'authorization_action_history', N'change_source'),
  (N'authorization_action_history', N'change_kind'),
  (N'authorization_action_history', N'snapshot'),
  (N'authorization_action_history', N'created_at');
INSERT INTO @RequiredColumns (table_name, column_name) VALUES
  (N'authorization_requests', N'id'),
  (N'authorization_requests', N'action_key'),
  (N'authorization_requests', N'requested_by'),
  (N'authorization_requests', N'requested_by_name'),
  (N'authorization_requests', N'store_id'),
  (N'authorization_requests', N'terminal_id'),
  (N'authorization_requests', N'reason'),
  (N'authorization_requests', N'payload'),
  (N'authorization_requests', N'status'),
  (N'authorization_requests', N'decided_by'),
  (N'authorization_requests', N'decided_by_name'),
  (N'authorization_requests', N'decided_at'),
  (N'authorization_requests', N'decision_note'),
  (N'authorization_requests', N'expires_at'),
  (N'authorization_requests', N'consumed_at'),
  (N'authorization_requests', N'requester_direct_limit'),
  (N'authorization_requests', N'value_unit'),
  (N'authorization_requests', N'created_at'),
  (N'authorization_requests', N'updated_at'),
  (N'authorization_requests', N'approval_route'),
  (N'authorization_requests', N'requested_amount'),
  (N'authorization_requests', N'approved_amount'),
  (N'authorization_requests', N'approved_payload'),
  (N'authorization_requests', N'bill_snapshot'),
  (N'authorization_requests', N'snapshot_hash'),
  (N'authorization_requests', N'held_order_id'),
  (N'authorization_requests', N'notified_at'),
  (N'authorization_log', N'id'),
  (N'authorization_log', N'action_key'),
  (N'authorization_log', N'mode_used'),
  (N'authorization_log', N'request_id'),
  (N'authorization_log', N'requested_by'),
  (N'authorization_log', N'authorized_by'),
  (N'authorization_log', N'authorizer_role'),
  (N'authorization_log', N'store_id'),
  (N'authorization_log', N'terminal_id'),
  (N'authorization_log', N'outcome'),
  (N'authorization_log', N'detail'),
  (N'authorization_log', N'created_at'),
  (N'record_edits', N'id'),
  (N'record_edits', N'record_type'),
  (N'record_edits', N'record_id'),
  (N'record_edits', N'reference'),
  (N'record_edits', N'store_id'),
  (N'record_edits', N'terminal_id'),
  (N'record_edits', N'action_key'),
  (N'record_edits', N'request_id'),
  (N'record_edits', N'edited_by'),
  (N'record_edits', N'edited_by_name'),
  (N'record_edits', N'authorized_by'),
  (N'record_edits', N'authorized_by_name'),
  (N'record_edits', N'mode_used'),
  (N'record_edits', N'before_value'),
  (N'record_edits', N'after_value'),
  (N'record_edits', N'stock_deltas'),
  (N'record_edits', N'note'),
  (N'record_edits', N'created_at'),
  (N'shift_cash_counts', N'id'),
  (N'shift_cash_counts', N'shift_id'),
  (N'shift_cash_counts', N'store_id'),
  (N'shift_cash_counts', N'terminal_id'),
  (N'shift_cash_counts', N'kind'),
  (N'shift_cash_counts', N'counted_cash'),
  (N'shift_cash_counts', N'counted_card'),
  (N'shift_cash_counts', N'counted_digital'),
  (N'shift_cash_counts', N'reason'),
  (N'shift_cash_counts', N'counted_by_name'),
  (N'shift_cash_counts', N'counted_by_staff_id'),
  (N'shift_cash_counts', N'counted_by_user_id'),
  (N'shift_cash_counts', N'client_key'),
  (N'shift_cash_counts', N'created_at'),
  (N'shift_close_events', N'id'),
  (N'shift_close_events', N'shift_id'),
  (N'shift_close_events', N'store_id'),
  (N'shift_close_events', N'terminal_id'),
  (N'shift_close_events', N'event'),
  (N'shift_close_events', N'from_state'),
  (N'shift_close_events', N'to_state'),
  (N'shift_close_events', N'detail'),
  (N'shift_close_events', N'actor_name'),
  (N'shift_close_events', N'actor_staff_id'),
  (N'shift_close_events', N'actor_user_id'),
  (N'shift_close_events', N'created_at'),
  (N'shift_reconciliations', N'id'),
  (N'shift_reconciliations', N'shift_id'),
  (N'shift_reconciliations', N'store_id'),
  (N'shift_reconciliations', N'count_id'),
  (N'shift_reconciliations', N'expected_cash'),
  (N'shift_reconciliations', N'expected_card'),
  (N'shift_reconciliations', N'expected_digital'),
  (N'shift_reconciliations', N'counted_cash'),
  (N'shift_reconciliations', N'counted_card'),
  (N'shift_reconciliations', N'counted_digital'),
  (N'shift_reconciliations', N'variance_cash'),
  (N'shift_reconciliations', N'variance_card'),
  (N'shift_reconciliations', N'variance_digital'),
  (N'shift_reconciliations', N'variance_total'),
  (N'shift_reconciliations', N'variance_status'),
  (N'shift_reconciliations', N'created_at'),
  (N'shift_variance_alerts', N'id'),
  (N'shift_variance_alerts', N'shift_id'),
  (N'shift_variance_alerts', N'store_id'),
  (N'shift_variance_alerts', N'reconciliation_id'),
  (N'shift_variance_alerts', N'variance_total'),
  (N'shift_variance_alerts', N'variance_status'),
  (N'shift_variance_alerts', N'severity'),
  (N'shift_variance_alerts', N'message'),
  (N'shift_variance_alerts', N'delivery_status'),
  (N'shift_variance_alerts', N'attempts'),
  (N'shift_variance_alerts', N'last_error'),
  (N'shift_variance_alerts', N'last_attempt_at'),
  (N'shift_variance_alerts', N'acknowledged_at'),
  (N'shift_variance_alerts', N'acknowledged_by'),
  (N'shift_variance_alerts', N'created_at'),
  (N'shift_variance_alerts', N'updated_at'),
  (N'shift_notifications', N'id'),
  (N'shift_notifications', N'shift_id'),
  (N'shift_notifications', N'store_id'),
  (N'shift_notifications', N'store_name'),
  (N'shift_notifications', N'terminal_name'),
  (N'shift_notifications', N'closed_by'),
  (N'shift_notifications', N'opened_at'),
  (N'shift_notifications', N'closed_at'),
  (N'shift_notifications', N'total_sales'),
  (N'shift_notifications', N'transactions'),
  (N'shift_notifications', N'discounts'),
  (N'shift_notifications', N'refunds'),
  (N'shift_notifications', N'expected_cash'),
  (N'shift_notifications', N'counted_cash'),
  (N'shift_notifications', N'payment_breakdown'),
  (N'shift_notifications', N'summary'),
  (N'shift_notifications', N'channels'),
  (N'shift_notifications', N'created_at'),
  (N'entity_status_history', N'id'),
  (N'entity_status_history', N'entity_type'),
  (N'entity_status_history', N'entity_id'),
  (N'entity_status_history', N'status_kind'),
  (N'entity_status_history', N'previous_status'),
  (N'entity_status_history', N'new_status'),
  (N'entity_status_history', N'reason'),
  (N'entity_status_history', N'actor_id'),
  (N'entity_status_history', N'actor_name'),
  (N'entity_status_history', N'actor_role'),
  (N'entity_status_history', N'store_id'),
  (N'entity_status_history', N'branch_id'),
  (N'entity_status_history', N'terminal_id'),
  (N'entity_status_history', N'related_entity_type'),
  (N'entity_status_history', N'related_entity_id'),
  (N'entity_status_history', N'metadata'),
  (N'entity_status_history', N'client_event_id'),
  (N'entity_status_history', N'occurred_at'),
  (N'entity_status_history', N'created_at'),
  (N'entity_status_history', N'updated_at'),
  (N'entity_status_history', N'row_version'),
  (N'nav_pins', N'id'),
  (N'nav_pins', N'owner_id'),
  (N'nav_pins', N'item_kind'),
  (N'nav_pins', N'item_key'),
  (N'nav_pins', N'sort_order'),
  (N'nav_pins', N'created_at'),
  (N'nav_pins', N'updated_at'),
  (N'store_groups', N'id'),
  (N'store_groups', N'code'),
  (N'store_groups', N'name'),
  (N'store_groups', N'is_active'),
  (N'store_groups', N'archived_at'),
  (N'store_groups', N'created_at'),
  (N'store_groups', N'updated_at'),
  (N'change_history', N'id'),
  (N'change_history', N'organization_id'),
  (N'change_history', N'entity_type'),
  (N'change_history', N'entity_id'),
  (N'change_history', N'action'),
  (N'change_history', N'old_value'),
  (N'change_history', N'new_value'),
  (N'change_history', N'revision'),
  (N'change_history', N'scope_type'),
  (N'change_history', N'scope_id'),
  (N'change_history', N'changed_by'),
  (N'change_history', N'source_application'),
  (N'change_history', N'device_id'),
  (N'change_history', N'terminal_id'),
  (N'change_history', N'server_timestamp'),
  (N'members', N'is_verified'),
  (N'members', N'verified_at'),
  (N'members', N'verified_channel');

DECLARE @RequiredColumnCount int = (SELECT COUNT(*) FROM @RequiredColumns);
DECLARE @PresentColumnCount int = (
  SELECT COUNT(*)
  FROM @RequiredColumns AS required_column
  WHERE COL_LENGTH(N'dbo.' + required_column.table_name, required_column.column_name) IS NOT NULL
);
DECLARE @MissingColumnCount int = @RequiredColumnCount - @PresentColumnCount;

SELECT
  @RequiredColumnCount AS required_columns,
  @PresentColumnCount AS present_columns,
  @MissingColumnCount AS missing_columns,
  CASE WHEN @MissingColumnCount = 0 THEN N'VALID' ELSE N'INCOMPLETE' END AS column_status;

SELECT required_column.table_name AS table_name, required_column.column_name AS missing_column
FROM @RequiredColumns AS required_column
WHERE COL_LENGTH(N'dbo.' + required_column.table_name, required_column.column_name) IS NULL
ORDER BY required_column.table_name, required_column.column_name;

IF @MissingColumnCount > 0
  THROW 51003, 'Retail POS local database column validation failed.', 1;

IF OBJECT_ID(N'dbo.pos_schema_migrations', N'U') IS NULL
  THROW 51002, 'Retail POS local database migration history table is missing.', 1;

EXEC(N'IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 1) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 2) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 3) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 4) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 5) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 6) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 7) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 8) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 9) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 10) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 11) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 12) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 13) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 14) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 15) OR NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version = 16)
  THROW 51002, ''Retail POS local database migration history is incomplete.'', 1;');

EXEC(N'SELECT version, name, applied_at
FROM dbo.pos_schema_migrations
ORDER BY version;');

PRINT N'Retail POS 1.4.55: POS_Local installation and validation completed successfully.';
GO
