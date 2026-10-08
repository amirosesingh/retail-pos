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
