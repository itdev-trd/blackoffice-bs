const HEADER_ALIASES = {
  customer_name: ["ชื่อ", "ชื่อลูกค้า", "ชื่อเฟส", "ชื่อเฟซบุ๊ก", "ชื่อ facebook", "name", "customer", "customer name", "customer_name", "facebook name"],
  trade_id: ["ไอดีเทรด", "เลขบัญชีเทรด", "บัญชีเทรด", "trade id", "trade_id", "trading id", "mt4", "mt5", "login"],
  phone: ["เบอร์", "เบอร์โทร", "เบอร์โทรศัพท์", "โทรศัพท์", "มือถือ", "phone", "phone number", "mobile", "tel", "telephone"],
  email: ["อีเมล", "เมล", "email", "e-mail"],
  username: ["username", "username tv", "ยูสเซอร์เนม", "ยูสเซอร์เนม tv", "tradingview", "tradingview username", "username tradingview", "tv username"],
  stage: ["สถานะ", "สถานะลูกค้า", "stage", "status", "customer status"],
};

export function normalizeCustomerName(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("th-TH");
}

export function normalizeImportHeader(value) {
  return normalizeCustomerName(value).replace(/[_.()\[\]{}\-–—/:\\]+/g, " ").replace(/\s+/g, " ").trim();
}

const HEADER_LOOKUP = new Map(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => aliases.map((alias) => [normalizeImportHeader(alias), field])),
);

function cellText(cell) {
  if (cell == null) return "";
  if (typeof cell.text === "string" && cell.text.trim()) return cell.text.trim();
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (value.result != null) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("").trim();
    if (value.text != null) return String(value.text).trim();
  }
  return String(value).trim();
}

export function detectCustomerImportColumns(headers) {
  const columns = {};
  headers.forEach((header, index) => {
    const field = HEADER_LOOKUP.get(normalizeImportHeader(header));
    if (field && columns[field] == null) columns[field] = index;
  });
  return columns;
}

export async function parseCustomerImportExcel(file) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("ไฟล์นี้ไม่มีชีตข้อมูล");

  let headerRow = 0;
  let columns = {};
  const scanUntil = Math.min(worksheet.rowCount, 20);
  for (let rowNo = 1; rowNo <= scanUntil; rowNo++) {
    const row = worksheet.getRow(rowNo);
    const headers = Array.from({ length: Math.max(row.cellCount, worksheet.columnCount) }, (_, i) => cellText(row.getCell(i + 1)));
    const detected = detectCustomerImportColumns(headers);
    if (detected.customer_name != null && Object.keys(detected).length >= 2) {
      headerRow = rowNo;
      columns = detected;
      break;
    }
  }
  if (!headerRow) throw new Error("ไม่พบหัวตารางชื่อของลูกค้าและข้อมูลอย่างน้อย 1 ช่อง");

  const records = [];
  for (let rowNo = headerRow + 1; rowNo <= worksheet.rowCount; rowNo++) {
    const row = worksheet.getRow(rowNo);
    const record = { row_number: rowNo };
    for (const [field, index] of Object.entries(columns)) record[field] = cellText(row.getCell(index + 1));
    if (!record.customer_name && !Object.keys(columns).some((field) => field !== "customer_name" && record[field])) continue;
    records.push(record);
  }
  if (!records.length) throw new Error("ไม่พบข้อมูลลูกค้าในไฟล์");
  if (records.length > 5000) throw new Error("ไฟล์มีข้อมูลเกิน 5,000 แถว กรุณาแบ่งไฟล์แล้วนำเข้าใหม่");
  return { sheetName: worksheet.name, headerRow, columns, records };
}

