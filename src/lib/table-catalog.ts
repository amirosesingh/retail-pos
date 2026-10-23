/** Stable settings keys for POS tables; update entries when adding a table. */
export const TABLE_CATALOG = [
  {
    "id": "platforms/web/components/pos/BulkImportDialog#1",
    "title": "Bulk Import Dialog",
    "columns": [
      "Column 1",
      "Barcode / SKU",
      "Product name",
      "Category",
      "Unit",
      "Price",
      "Cost",
      "Tax %",
      "Stock",
      "Status",
      "Resolve"
    ]
  },
  {
    "id": "platforms/web/components/pos/CampaignVouchers#1",
    "title": "Campaign Vouchers",
    "columns": [
      "Token",
      "Campaign",
      "Member",
      "Issued",
      "Expires",
      "Status",
      "Actions"
    ]
  },
  {
    "id": "platforms/web/components/pos/CouponAnalytics#1",
    "title": "Coupon Analytics",
    "columns": [
      "Campaign",
      "Issued",
      "Manual",
      "Redeemed",
      "Rate",
      "Revenue",
      "Discount given"
    ]
  },
  {
    "id": "platforms/web/components/pos/CouponAuditLog#1",
    "title": "Coupon Audit Log",
    "columns": [
      "When",
      "Event",
      "Campaign",
      "Voucher",
      "Member",
      "Shop",
      "Cashier",
      "Bill"
    ]
  },
  {
    "id": "platforms/web/components/pos/ItemSalesReport#1",
    "title": "Item Sales Report",
    "columns": [
      "Date & time",
      "Receipt",
      "Store",
      "Cashier",
      "Item",
      "Qty",
      "Price",
      "Discount",
      "Revenue",
      "Cost",
      "Profit",
      "Margin"
    ]
  },
  {
    "id": "platforms/web/components/pos/PaymentsReport#1",
    "title": "Payments Report",
    "columns": [
      "Cashier",
      "Bills",
      "Taken",
      "Cash",
      "Card",
      "Other",
      "Avg basket"
    ]
  },
  {
    "id": "platforms/web/components/pos/PaymentsReport#2",
    "title": "Payments Report 2",
    "columns": [
      "Time",
      "Bill",
      "Store",
      "Cashier",
      "Tenders",
      "Total"
    ]
  },
  {
    "id": "platforms/web/components/pos/ReceivingRecordView#1",
    "title": "Receiving Record View",
    "columns": [
      "Item number / SKU",
      "Product",
      "Cost",
      "Selling",
      "Qty",
      "Subtotal"
    ]
  },
  {
    "id": "platforms/web/components/pos/settings/panels/TelemetryPanel#1",
    "title": "Telemetry Panel",
    "columns": [
      "Device",
      "Location",
      "Signed in",
      "Connection",
      "Storage",
      "Waiting",
      "Last sync",
      "Last seen",
      "Requests"
    ]
  },
  {
    "id": "platforms/web/components/pos/settings/panels/TelemetryPanel#2",
    "title": "Telemetry Panel 2",
    "columns": [
      "Time",
      "Terminal",
      "Direction",
      "Data",
      "Records",
      "Status"
    ]
  },
  {
    "id": "platforms/web/components/pos/settings/panels/TelemetryPanel#3",
    "title": "Telemetry Panel 3",
    "columns": [
      "Sent",
      "Terminal",
      "Request",
      "By",
      "Status",
      "Outcome"
    ]
  },
  {
    "id": "platforms/web/components/pos/StockCountDialog#1",
    "title": "Stock Count Dialog",
    "columns": [
      "SKU",
      "Name",
      "Category",
      "Sub-category",
      "System",
      "Counted",
      "Delta",
      "Unit cost",
      "Impact"
    ]
  },
  {
    "id": "platforms/web/components/pos/TerminalTokens#1",
    "title": "Terminal Tokens",
    "columns": [
      "Device name",
      "Location / warehouse",
      "Version",
      "Last seen",
      "Last sync",
      "Activated",
      "Action"
    ]
  },
  {
    "id": "platforms/web/components/pos/TransferComposer#1",
    "title": "Transfer Composer",
    "columns": [
      "Product",
      "Here",
      "Source",
      "Quantity",
      "Estimated cost"
    ]
  },
  {
    "id": "platforms/web/components/pos/TransferWorkspace#1",
    "title": "Transfer Workspace",
    "columns": [
      "Product",
      "Requested",
      "Approved",
      "Sent",
      "Counted",
      "Shortfall",
      "On hand here"
    ]
  },
  {
    "id": "routes/alerts#1",
    "title": "alerts",
    "columns": [
      "Alert",
      "Location & time",
      "Amount / quantity",
      "Status",
      "Details"
    ]
  },
  {
    "id": "routes/all-shops#1",
    "title": "all shops",
    "columns": [
      "Time",
      "Branch",
      "Bill",
      "Cashier",
      "Total"
    ]
  },
  {
    "id": "routes/audit#1",
    "title": "audit",
    "columns": [
      "Date & time",
      "Staff",
      "Category",
      "Action description",
      "Sync",
      "Details"
    ]
  },
  {
    "id": "routes/audit#2",
    "title": "audit 2",
    "columns": [
      "When",
      "Record",
      "Branch",
      "Changed fields",
      "Reason",
      "Edited / authorised by",
      "Details"
    ]
  },
  {
    "id": "routes/coupons#1",
    "title": "coupons",
    "columns": [
      "Campaign",
      "Discount",
      "Validity",
      "Claimed",
      "Redeemed",
      "Status",
      "Actions"
    ]
  },
  {
    "id": "routes/dashboard#1",
    "title": "dashboard",
    "columns": [
      "When",
      "Employee",
      "Reason",
      "Note",
      "Approved by"
    ]
  },
  {
    "id": "routes/dashboard#2",
    "title": "dashboard 2",
    "columns": [
      "Receipt",
      "When",
      "Tenders",
      "Total"
    ]
  },
  {
    "id": "routes/holds#1",
    "title": "holds",
    "columns": [
      "Ticket",
      "Held by",
      "Waiting",
      "Items",
      "Value",
      "Actions"
    ]
  },
  {
    "id": "routes/inventory#1",
    "title": "inventory",
    "columns": [
      "Column 1",
      "Product",
      "Category",
      "Sub-category",
      "Purchase Cost",
      "Total Unit Cost",
      "Price",
      "Margin",
      "On web",
      "Stock ·",
      "Other stores"
    ]
  },
  {
    "id": "routes/inventory#2",
    "title": "inventory 2",
    "columns": [
      "Duplicate code",
      "Products using it",
      "Action"
    ]
  },
  {
    "id": "routes/purchasing#1",
    "title": "purchasing",
    "columns": [
      "Barcode",
      "Product",
      "Cost price",
      "Selling price",
      "Qty received",
      "Subtotal cost"
    ]
  },
  {
    "id": "routes/purchasing#2",
    "title": "purchasing 2",
    "columns": [
      "Reference",
      "Status",
      "Invoice no.",
      "Supplier",
      "Invoice date",
      "Entry date",
      "Unique items",
      "Total units",
      "Total cost",
      "Operator",
      "Branch"
    ]
  },
  {
    "id": "routes/purchasing#3",
    "title": "purchasing 3",
    "columns": [
      "Item number / SKU",
      "Product",
      "Cost",
      "Selling",
      "Qty",
      "Subtotal"
    ]
  },
  {
    "id": "routes/receiving.$id#1",
    "title": "receiving  id",
    "columns": [
      "Product",
      "Sent",
      "Counted",
      "Difference"
    ]
  },
  {
    "id": "routes/receiving.index#1",
    "title": "receiving index",
    "columns": [
      "Reference",
      "From",
      "Lines",
      "Status"
    ]
  },
  {
    "id": "routes/reports.activity#1",
    "title": "reports activity",
    "columns": [
      "Time",
      "Staff",
      "Action",
      "What happened"
    ]
  },
  {
    "id": "routes/reports.analytics#1",
    "title": "reports analytics",
    "columns": [
      "Shop",
      "Revenue",
      "Share",
      "Cost",
      "Profit",
      "Margin"
    ]
  },
  {
    "id": "routes/reports.business#1",
    "title": "reports business",
    "columns": [
      "Product",
      "Arrived",
      "Units",
      "Revenue",
      "Profit",
      "Margin",
      "Units/day",
      "On hand",
      "Days cover"
    ]
  },
  {
    "id": "routes/reports.business#2",
    "title": "reports business 2",
    "columns": [
      "Cashier",
      "Bills",
      "Revenue",
      "Profit",
      "Discount given",
      "Average bill"
    ]
  },
  {
    "id": "routes/reports.catalog#1",
    "title": "reports catalog",
    "columns": [
      "Time",
      "Staff",
      "Action",
      "What changed"
    ]
  },
  {
    "id": "routes/reports.coupons#1",
    "title": "reports coupons",
    "columns": [
      "Coupon",
      "Partner",
      "Times redeemed",
      "Value given away"
    ]
  },
  {
    "id": "routes/reports.coupons#2",
    "title": "reports coupons 2",
    "columns": [
      "Time",
      "Coupon",
      "Partner",
      "Applied to",
      "Scope",
      "Receipt",
      "Staff",
      "Value",
      "Status"
    ]
  },
  {
    "id": "routes/reports.history#1",
    "title": "reports history",
    "columns": [
      "When",
      "Requested by",
      "Approved / acted by",
      "Action",
      "Method",
      "Where / reference",
      "Purpose / details",
      "Terminal"
    ]
  },
  {
    "id": "routes/reports.notifications#1",
    "title": "reports notifications",
    "columns": [
      "When",
      "Event",
      "What happened",
      "Person",
      "Terminal",
      "Branch",
      "WhatsApp",
      "Status",
      "Action"
    ]
  },
  {
    "id": "routes/reports.sales#1",
    "title": "reports sales",
    "columns": [
      "Time",
      "Receipt",
      "Cashier",
      "Method",
      "Discount",
      "Tax",
      "Total"
    ]
  },
  {
    "id": "routes/reports.stock#1",
    "title": "reports stock",
    "columns": [
      "Time",
      "Product",
      "Branch",
      "Reason",
      "Before",
      "After",
      "Diff",
      "Cost impact",
      "Staff"
    ]
  },
  {
    "id": "routes/reports.voids#1",
    "title": "reports voids",
    "columns": [
      "Staff",
      "Voids",
      "Line removals",
      "Refunds",
      "Cancellations",
      "Value"
    ]
  },
  {
    "id": "routes/reports.voids#2",
    "title": "reports voids 2",
    "columns": [
      "Time",
      "Type",
      "Staff",
      "Store",
      "What happened",
      "Reason",
      "Value"
    ]
  },
  {
    "id": "routes/requests.index#1",
    "title": "requests index",
    "columns": [
      "Reference",
      "From",
      "To",
      "Lines",
      "Requested units",
      "Sent units",
      "Requested estimate",
      "Status"
    ]
  },
  {
    "id": "routes/shifts#1",
    "title": "shifts",
    "columns": [
      "User",
      "Staff ID",
      "Role",
      "First sign-in",
      "Last seen"
    ]
  },
  {
    "id": "routes/shifts#2",
    "title": "shifts 2",
    "columns": [
      "User",
      "Role",
      "Terminal",
      "Signed in",
      "Signed out"
    ]
  },
  {
    "id": "routes/shifts#3",
    "title": "shifts 3",
    "columns": [
      "Cashier",
      "Status",
      "Opened",
      "Closed",
      "Closed by",
      "Terminal",
      "Duration",
      "Float",
      "Closing float",
      "Over / short",
      "Z report",
      "Correction"
    ]
  },
  {
    "id": "routes/stock-operations#1",
    "title": "stock operations",
    "columns": [
      "Reference",
      "Status",
      "Date",
      "Branch",
      "Items",
      "Impact",
      "Created by",
      "Posted by"
    ]
  },
  {
    "id": "routes/suppliers#1",
    "title": "suppliers",
    "columns": [
      "Supplier",
      "Contact",
      "Phone",
      "Email",
      "Tax no.",
      "Active",
      "Actions"
    ]
  },
  {
    "id": "routes/transfers.index#1",
    "title": "transfers index",
    "columns": [
      "Reference",
      "Product",
      "Qty",
      "Route",
      "Status",
      "Requested estimate",
      "Sent estimate",
      "Open"
    ]
  },
  {
    "id": "platforms/web/components/pos/ReportReceiptLink#1",
    "title": "Receipt links",
    "columns": [
      "Item",
      "Quantity",
      "Unit price",
      "Line discount",
      "Net before tax"
    ]
  },
  {
    "id": "platforms/web/components/admin/StaffManager.native#1",
    "title": "Staff Manager",
    "columns": [
      "Staff",
      "Sign-in",
      "Last login",
      "Actions"
    ]
  },
  {
    "id": "platforms/web/components/pos/MemberHistoryDialog.native#1",
    "title": "Member History Dialog",
    "columns": [
      "Bill no",
      "Date & time",
      "Total",
      "Points",
      "Payment",
      "Actions"
    ]
  },
  {
    "id": "platforms/web/components/pos/MemberHistoryDialog.native#2",
    "title": "Member History Dialog 2",
    "columns": [
      "Product",
      "Qty purchased",
      "Last purchased",
      "Total spent",
      "Points earned"
    ]
  },
  {
    "id": "platforms/web/components/pos/ProductPicker.native#1",
    "title": "Product Picker",
    "columns": [
      "Barcode",
      "Item",
      "Current branch",
      "Available"
    ]
  },
  {
    "id": "platforms/web/components/pos/settings/panels/FeatureSchemaReport.native#1",
    "title": "Feature Schema Report",
    "columns": [
      "Feature",
      "Status",
      "Detail"
    ]
  },
  {
    "id": "platforms/web/components/pos/settings/panels/LogicHealthPanel.native#1",
    "title": "Logic Health Panel",
    "columns": [
      "Severity",
      "Area",
      "What was found",
      "Where"
    ]
  },
  {
    "id": "platforms/web/components/pos/settings/ScopeControls.native#1",
    "title": "Scope Controls",
    "columns": [
      "Setting",
      "Global",
      "Column 3",
      "Effective now"
    ]
  },
  {
    "id": "platforms/windows/components/LocalDatabaseOperations.native#1",
    "title": "Local Database Operations",
    "columns": [
      "Table",
      "Activity",
      "Rows",
      "Updated"
    ]
  },
  {
    "id": "routes/approvals.native#1",
    "title": "approvals",
    "columns": [
      "Item",
      "Qty",
      "Price",
      "Disc",
      "Total"
    ]
  },
  {
    "id": "routes/promotions.native#1",
    "title": "promotions",
    "columns": [
      "Rule",
      "Type",
      "Configuration",
      "Window",
      "Status",
      "Actions"
    ]
  },
  {
    "id": "routes/settings.sessions.native#1",
    "title": "settings sessions",
    "columns": [
      "User / device",
      "Activity",
      "Action"
    ]
  },
  {
    "id": "routes/verifications.native#1",
    "title": "verifications",
    "columns": [
      "Sent",
      "Sent to",
      "Channel",
      "Outcome",
      "Attempts",
      "By",
      "Confirmed"
    ]
  },
] as const;
