export const displayImportMoney = (value: number | null) => value === null || !Number.isFinite(value) ? ""
  : value.toLocaleString("en-US", { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 20 });
