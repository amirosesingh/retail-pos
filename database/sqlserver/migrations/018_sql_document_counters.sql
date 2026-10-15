-- Device reservations live in SQL Server, never in Electron settings or browser storage.
IF OBJECT_ID(N'dbo.pos_document_counters',N'U') IS NULL
 CREATE TABLE dbo.pos_document_counters (
  prefix nvarchar(200) NOT NULL CONSTRAINT PK_pos_document_counters PRIMARY KEY,
  branch_id nvarchar(128) NOT NULL,
  next_value bigint NOT NULL,
  updated_at datetimeoffset(7) NOT NULL CONSTRAINT DF_pos_document_counters_updated DEFAULT SYSDATETIMEOFFSET(),
  CONSTRAINT CK_pos_document_counters_value CHECK (next_value BETWEEN 1 AND 9007199254740991)
 );
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=18)
 INSERT dbo.pos_schema_migrations(version,name) VALUES(18,N'sql_document_counters');
