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
