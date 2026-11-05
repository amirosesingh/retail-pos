-- Editable POS contact, separate from verified membership identity.
IF OBJECT_ID(N'dbo.members',N'U') IS NOT NULL AND COL_LENGTH(N'dbo.members',N'contact_email') IS NULL
 ALTER TABLE dbo.members ADD contact_email nvarchar(max) NULL;
IF NOT EXISTS (SELECT 1 FROM dbo.pos_schema_migrations WHERE version=19)
 INSERT dbo.pos_schema_migrations(version,name) VALUES(19,N'member_contact_email');
