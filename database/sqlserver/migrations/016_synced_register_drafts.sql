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
