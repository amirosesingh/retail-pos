-- SHIFT-34: preserve one ORIGINAL and any number of immutable RECOUNT records.
-- No stored count is rewritten. Unexpected index shapes/data require review.
SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON; SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON; SET ARITHABORT ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
BEGIN TRY
 BEGIN TRANSACTION;
 IF OBJECT_ID(N'dbo.shift_cash_counts',N'U') IS NULL
    OR COL_LENGTH(N'dbo.shift_cash_counts',N'shift_id') IS NULL
    OR COL_LENGTH(N'dbo.shift_cash_counts',N'kind') IS NULL
  THROW 51021,'Shift count table is incomplete; no uniqueness repair was applied.',1;
 DECLARE @shift34Default nvarchar(max);
 SELECT @shift34Default=dc.definition FROM sys.columns c
 JOIN sys.types t ON t.user_type_id=c.user_type_id
 LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
 WHERE c.object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND c.name=N'kind'
   AND t.name=N'nvarchar' AND c.is_nullable=0 AND c.is_computed=0 AND (c.max_length=-1 OR c.max_length>=16);
 IF @shift34Default IS NULL OR
    REPLACE(REPLACE(REPLACE(@shift34Default,N'(',N''),N')',N''),N' ',N'') COLLATE Latin1_General_100_BIN2
      NOT IN(N'''ORIGINAL''',N'N''ORIGINAL''')
  THROW 51021,'Unexpected shift count kind type/default; no uniqueness repair was applied.',1;
 DECLARE @shift34Rows bigint;
 SELECT @shift34Rows=COUNT_BIG(*) FROM dbo.shift_cash_counts WITH (TABLOCKX,HOLDLOCK);
 IF EXISTS(SELECT 1 FROM dbo.shift_cash_counts WHERE kind IS NULL
    OR kind COLLATE Latin1_General_100_BIN2 NOT IN(N'ORIGINAL',N'RECOUNT')
    OR DATALENGTH(kind) NOT IN(14,16))
    OR EXISTS(SELECT shift_id FROM dbo.shift_cash_counts WHERE kind=N'ORIGINAL'
       GROUP BY shift_id HAVING COUNT_BIG(*)>1)
  THROW 51021,'Shift count data conflicts with ORIGINAL-only uniqueness; no records were changed.',1;
 DECLARE @shift34Index int,@shift34Filter nvarchar(max);
 SELECT @shift34Index=index_id,@shift34Filter=filter_definition
 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND name=N'UX_shift_cash_counts_shift_id';
 IF @shift34Index IS NOT NULL AND (
    EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND index_id=@shift34Index
      AND (is_unique<>1 OR type<>2 OR is_primary_key=1 OR is_unique_constraint=1 OR is_disabled=1 OR is_hypothetical=1
        OR ignore_dup_key=1 OR fill_factor<>0 OR is_padded=1 OR allow_row_locks<>1 OR allow_page_locks<>1 OR data_space_id<>1))
    OR EXISTS(SELECT 1 FROM sys.stats WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND stats_id=@shift34Index AND no_recompute=1)
    OR EXISTS(SELECT 1 FROM sys.partitions WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND index_id=@shift34Index AND data_compression<>0)
    OR EXISTS(SELECT 1 FROM sys.indexes i WHERE i.object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND i.index_id=@shift34Index
      AND (COALESCE(JSON_VALUE((SELECT i.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),'$.optimize_for_sequential_key'),'false') NOT IN('false','0')
        OR COALESCE(JSON_VALUE((SELECT i.* FOR JSON PATH,WITHOUT_ARRAY_WRAPPER),'$.suppress_dup_key_messages'),'false') NOT IN('false','0')))
    OR (SELECT COUNT(*) FROM sys.index_columns WHERE object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND index_id=@shift34Index)<>1
    OR NOT EXISTS(SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
      WHERE ic.object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND ic.index_id=@shift34Index AND ic.key_ordinal=1 AND ic.is_descending_key=0 AND c.name=N'shift_id')
    OR (@shift34Filter IS NOT NULL AND
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(@shift34Filter,N'(',N''),N')',N''),N'[',N''),N']',N''),N' ',N'')<>N'kind=N''ORIGINAL'''))
  THROW 51021,'Unexpected named shift count index; no uniqueness repair was applied.',1;
 IF EXISTS(SELECT 1 FROM sys.indexes i
    WHERE i.object_id=OBJECT_ID(N'dbo.shift_cash_counts') AND i.is_unique=1
      AND i.index_id<>COALESCE(@shift34Index,-1)
      AND EXISTS(SELECT 1 FROM sys.index_columns ic JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
        WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND c.name=N'shift_id'))
  THROW 51021,'An unreviewed shift-related unique index exists; no uniqueness repair was applied.',1;
 IF @shift34Index IS NULL OR @shift34Filter IS NULL
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM sys.filegroups WHERE data_space_id=1 AND is_default=1)
   THROW 51021,'Unexpected default filegroup; no uniqueness repair was applied.',1;
  IF @shift34Index IS NOT NULL DROP INDEX [UX_shift_cash_counts_shift_id] ON dbo.[shift_cash_counts];
  CREATE UNIQUE INDEX [UX_shift_cash_counts_shift_id] ON dbo.[shift_cash_counts]([shift_id]) WHERE [kind]=N'ORIGINAL';
 END;
 COMMIT TRANSACTION;
END TRY
BEGIN CATCH
 IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
 THROW;
END CATCH;
-- SHIFT34_HISTORY_BEGIN: the generator also embeds the guarded repair above.
IF NOT EXISTS(SELECT 1 FROM dbo.pos_schema_migrations WHERE version=21)
 INSERT dbo.pos_schema_migrations(version,name) VALUES(21,N'shift_count_original_uniqueness');
