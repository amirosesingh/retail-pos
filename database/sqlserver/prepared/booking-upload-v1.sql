-- An additive companion to core 24. It does not change the reviewed core ledger or existing tables.
IF OBJECT_ID(N'dbo.pos_sync_booking_payloads_v1', N'U') IS NULL
  CREATE TABLE dbo.pos_sync_booking_payloads_v1 (
    operation_id uniqueidentifier NOT NULL CONSTRAINT PK_pos_sync_booking_payloads_v1 PRIMARY KEY,
    payload_json nvarchar(max) NOT NULL,
    payload_sha256 char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    CONSTRAINT CK_pos_sync_booking_payloads_v1_json CHECK (
      ISJSON(payload_json)=1 AND DATALENGTH(payload_json)<=12582912),
    CONSTRAINT CK_pos_sync_booking_payloads_v1_hash CHECK (payload_sha256 NOT LIKE '%[^0-9a-f]%')
  );

DECLARE @bookingPayloadTable int=OBJECT_ID(N'dbo.pos_sync_booking_payloads_v1',N'U');
IF (SELECT COUNT(*) FROM sys.columns WHERE object_id=@bookingPayloadTable)<>3
  OR EXISTS (
    SELECT 1 FROM (VALUES(N'operation_id',N'uniqueidentifier',16),(N'payload_json',N'nvarchar',-1),(N'payload_sha256',N'char',64))
      AS expected(name,type_name,max_length)
    LEFT JOIN sys.columns AS column_info ON column_info.object_id=@bookingPayloadTable AND column_info.name=expected.name
    WHERE column_info.column_id IS NULL OR TYPE_NAME(column_info.user_type_id)<>expected.type_name
      OR column_info.max_length<>expected.max_length OR column_info.is_nullable=1
      OR column_info.is_identity=1 OR column_info.is_computed=1 OR column_info.default_object_id<>0)
  OR NOT EXISTS (
    SELECT 1 FROM sys.indexes AS pk
    JOIN sys.index_columns AS key_column ON key_column.object_id=pk.object_id AND key_column.index_id=pk.index_id
    JOIN sys.columns AS column_info ON column_info.object_id=key_column.object_id AND column_info.column_id=key_column.column_id
    WHERE pk.object_id=@bookingPayloadTable AND pk.is_primary_key=1 AND pk.is_disabled=0
      AND key_column.key_ordinal=1 AND column_info.name=N'operation_id'
      AND NOT EXISTS (SELECT 1 FROM sys.index_columns AS extra
        WHERE extra.object_id=pk.object_id AND extra.index_id=pk.index_id AND extra.key_ordinal>1))
  OR 2<>(SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id=@bookingPayloadTable
    AND name IN(N'CK_pos_sync_booking_payloads_v1_json',N'CK_pos_sync_booking_payloads_v1_hash')
    AND is_not_trusted=0 AND is_disabled=0)
  THROW 51041, 'The existing native booking payload storage requires review.', 1;
