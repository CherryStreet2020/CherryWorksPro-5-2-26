import { parseHours } from "./import-parsers";

export type Platform = "freshbooks" | "quickbooks" | "harvest" | "xero" | "wave" | "bigtime" | "scoro" | "paymo" | "generic" | "unknown";
export type DataType = "clients" | "vendors" | "services" | "time_entry_details" | "invoice_details" | "expense_details" | "gl_balances" | "projects" | "unknown";

interface PlatformSignature {
  platform: Platform;
  dataType: DataType;
  requiredHeaders: string[];
}

const SIGNATURES: PlatformSignature[] = [
  { platform: "freshbooks", dataType: "clients", requiredHeaders: ["Organization", "First Name", "Last Name", "Email", "Phone"] },
  { platform: "freshbooks", dataType: "vendors", requiredHeaders: ["Organization", "First Name", "Last Name", "Account Number", "Email"] },
  { platform: "freshbooks", dataType: "services", requiredHeaders: ["Name", "Type", "Rate", "Income Account"] },
  { platform: "freshbooks", dataType: "time_entry_details", requiredHeaders: ["Date", "Client", "Project", "Service", "Team Member", "Hours"] },
  { platform: "freshbooks", dataType: "invoice_details", requiredHeaders: ["Client Name", "Invoice #", "Date Issued", "Invoice Status"] },
  { platform: "freshbooks", dataType: "expense_details", requiredHeaders: ["Date", "Parent Category", "Merchant", "Amount"] },

  { platform: "harvest", dataType: "time_entry_details", requiredHeaders: ["Date", "Client", "Project", "Task", "Hours", "First Name", "Last Name"] },
  { platform: "harvest", dataType: "clients", requiredHeaders: ["Client", "Contact First Name", "Contact Last Name"] },
  { platform: "harvest", dataType: "expense_details", requiredHeaders: ["Date", "Client", "Project", "Category", "Amount", "First Name", "Last Name"] },
  { platform: "harvest", dataType: "invoice_details", requiredHeaders: ["Invoice Number", "Client", "Amount", "Status"] },
  { platform: "harvest", dataType: "services", requiredHeaders: ["Client", "Project", "Project code"] },

  { platform: "quickbooks", dataType: "clients", requiredHeaders: ["Customer", "Email", "Phone"] },
  { platform: "quickbooks", dataType: "clients", requiredHeaders: ["Display Name", "Email", "Phone"] },
  { platform: "quickbooks", dataType: "invoice_details", requiredHeaders: ["Invoice No", "Customer", "Invoice Date", "Due Date", "Amount"] },
  { platform: "quickbooks", dataType: "invoice_details", requiredHeaders: ["Num", "Customer", "Date", "Due Date", "Amount"] },
  { platform: "quickbooks", dataType: "time_entry_details", requiredHeaders: ["Date", "Name", "Customer", "Service", "Duration"] },
  { platform: "quickbooks", dataType: "expense_details", requiredHeaders: ["Date", "Payee", "Category", "Amount"] },
  { platform: "quickbooks", dataType: "services", requiredHeaders: ["Name", "Type", "Rate", "Description"] },

  { platform: "xero", dataType: "clients", requiredHeaders: ["ContactName", "EmailAddress"] },
  { platform: "xero", dataType: "invoice_details", requiredHeaders: ["ContactName", "InvoiceNumber", "InvoiceDate", "DueDate", "UnitAmount"] },
  { platform: "xero", dataType: "services", requiredHeaders: ["AccountCode", "AccountName", "AccountType"] },

  { platform: "wave", dataType: "clients", requiredHeaders: ["Company Name", "First Name", "Last Name", "Email"] },
  { platform: "wave", dataType: "invoice_details", requiredHeaders: ["Invoice Number", "Customer", "Total Amount"] },
  { platform: "wave", dataType: "invoice_details", requiredHeaders: ["Invoice Number", "Invoice Date", "Amount"] },
  { platform: "wave", dataType: "expense_details", requiredHeaders: ["Date", "Description", "Amount"] },

  { platform: "bigtime", dataType: "time_entry_details", requiredHeaders: ["Date", "Staff", "Project", "Task", "Hours"] },
  { platform: "bigtime", dataType: "time_entry_details", requiredHeaders: ["Date", "Employee", "Client", "Input Hours"] },
  { platform: "bigtime", dataType: "clients", requiredHeaders: ["Client", "Legal Name"] },
  { platform: "bigtime", dataType: "clients", requiredHeaders: ["Client Name", "Contact"] },
  { platform: "bigtime", dataType: "invoice_details", requiredHeaders: ["Invoice", "Client", "Amount", "Date"] },
  { platform: "bigtime", dataType: "expense_details", requiredHeaders: ["Date", "Category", "Amount"] },

  { platform: "scoro", dataType: "time_entry_details", requiredHeaders: ["Date", "User", "Project", "Duration"] },
  { platform: "scoro", dataType: "time_entry_details", requiredHeaders: ["Date", "Employee", "Activity", "Time"] },
  { platform: "scoro", dataType: "clients", requiredHeaders: ["Company name", "Email"] },
  { platform: "scoro", dataType: "clients", requiredHeaders: ["Contact name", "Email"] },
  { platform: "scoro", dataType: "invoice_details", requiredHeaders: ["Invoice no", "Client", "Date", "Sum"] },
  { platform: "scoro", dataType: "invoice_details", requiredHeaders: ["Number", "Company", "Issue date", "Total"] },
  { platform: "scoro", dataType: "expense_details", requiredHeaders: ["Date", "Description", "Amount", "Project"] },

  { platform: "paymo", dataType: "time_entry_details", requiredHeaders: ["Date", "Task", "Duration", "User"] },
  { platform: "paymo", dataType: "time_entry_details", requiredHeaders: ["Date", "Description", "Duration", "Project"] },
  { platform: "paymo", dataType: "clients", requiredHeaders: ["Client", "Status"] },
  { platform: "paymo", dataType: "clients", requiredHeaders: ["Name", "Active projects"] },
  { platform: "paymo", dataType: "invoice_details", requiredHeaders: ["Invoice", "Client", "Total", "Status"] },

  { platform: "freshbooks", dataType: "gl_balances", requiredHeaders: ["account_number", "account_name", "account_type", "balance"] },
  { platform: "quickbooks", dataType: "gl_balances", requiredHeaders: ["Account", "Type", "Detail Type", "Balance"] },
  { platform: "quickbooks", dataType: "gl_balances", requiredHeaders: ["Account #", "Account", "Type", "Balance"] },
  { platform: "xero", dataType: "gl_balances", requiredHeaders: ["Code", "Name", "Type", "Debit", "Credit"] },
  { platform: "wave", dataType: "gl_balances", requiredHeaders: ["Account #", "Account Name", "Account Type", "Balance"] },

  { platform: "harvest", dataType: "projects", requiredHeaders: ["Client", "Project", "Project code", "Start date", "End date"] },
  { platform: "bigtime", dataType: "projects", requiredHeaders: ["Project Name", "Client", "Status", "Budget"] },
  { platform: "scoro", dataType: "projects", requiredHeaders: ["Contact name", "Date", "Deadline", "Estimated duration"] },
  { platform: "paymo", dataType: "projects", requiredHeaders: ["Client", "Project", "Code", "Budget hours", "Price per hour"] },

  { platform: "generic", dataType: "clients", requiredHeaders: ["Name", "Email"] },
  { platform: "generic", dataType: "time_entry_details", requiredHeaders: ["Date", "Hours"] },
];

(function validateSignatures() {
  const seen = new Set<string>();
  for (const sig of SIGNATURES) {
    const key = `${sig.platform}|${sig.dataType}|${[...sig.requiredHeaders].sort().join(",")}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate platform signature detected: ${key}`);
    }
    seen.add(key);
  }
})();

type ColumnMap = Record<string, string>;

const COLUMN_MAPS: Record<Platform, Record<DataType, ColumnMap>> = {
  freshbooks: {
    clients: {},
    vendors: {},
    services: {},
    time_entry_details: {},
    invoice_details: {},
    expense_details: {},
    gl_balances: { "account_number": "AccountCode", "account_name": "AccountName", "account_type": "AccountType", "balance": "Debit" },
    projects: {},
    unknown: {},
  },

  harvest: {
    clients: {
      "Client": "Organization",
      "Contact First Name": "First Name",
      "Contact Last Name": "Last Name",
      "Contact Email": "Email",
      "Contact Phone": "Phone",
    },
    time_entry_details: {
      "Task": "Service",
      "Notes": "Note",
      "Billable?": "Status",
    },
    expense_details: {
      "Category": "Parent Category",
      "Notes": "Description",
      "Billable?": "Subcategory",
    },
    invoice_details: {
      "Invoice Number": "Invoice #",
      "Issue Date": "Date Issued",
      "Due Date": "Date Due",
      "Client": "Client Name",
      "Amount": "Line Total",
      "Status": "Invoice Status",
    },
    services: {
      "Project": "Name",
      "Project code": "Type",
    },
    vendors: {},
    gl_balances: {},
    projects: { "Project": "ProjectName", "Client": "ClientName", "Project code": "ProjectCode", "Start date": "StartDate", "End date": "EndDate" },
    unknown: {},
  },

  quickbooks: {
    clients: {
      "Customer": "Organization",
      "Display Name": "Organization",
      "Street": "Address Line 1",
      "City": "City",
      "State": "State",
      "Zip": "Zip",
    },
    time_entry_details: {
      "Name": "Team Member",
      "Customer": "Client",
      "Service": "Service",
      "Duration": "Hours",
      "Memo": "Note",
      "Description": "Note",
    },
    invoice_details: {
      "Invoice No": "Invoice #",
      "Num": "Invoice #",
      "Customer": "Client Name",
      "Invoice Date": "Date Issued",
      "Date": "Date Issued",
      "Due Date": "Date Due",
      "Amount": "Line Total",
      "Status": "Invoice Status",
      "Balance": "Line Total",
    },
    expense_details: {
      "Payee": "Merchant",
      "Category": "Parent Category",
      "Memo": "Description",
    },
    services: {
      "Description": "Income Account",
    },
    vendors: {},
    gl_balances: { "Account": "AccountName", "Account #": "AccountCode", "Type": "AccountType", "Detail Type": "AccountType", "Balance": "Debit" },
    projects: {},
    unknown: {},
  },

  xero: {
    clients: { "ContactName": "Organization", "EmailAddress": "Email", "Phone": "Phone" },
    time_entry_details: {},
    invoice_details: { "InvoiceNumber": "Invoice #", "InvoiceDate": "Date Issued", "DueDate": "Date Due", "ContactName": "Client Name", "UnitAmount": "Line Total", "AccountCode": "Service" },
    services: { "AccountName": "Name", "AccountCode": "Type" },
    vendors: {},
    expense_details: {},
    gl_balances: { "Code": "AccountCode", "Name": "AccountName", "Type": "AccountType" },
    projects: {},
    unknown: {},
  },

  wave: {
    clients: { "Company Name": "Organization" },
    time_entry_details: {},
    invoice_details: { "Invoice Number": "Invoice #", "Customer": "Client Name", "Invoice Date": "Date Issued", "Due Date": "Date Due", "Total Amount": "Line Total", "Amount": "Line Total", "Status": "Invoice Status" },
    expense_details: { "Description": "Subcategory" },
    services: {},
    vendors: {},
    gl_balances: { "Account #": "AccountCode", "Account Name": "AccountName", "Account Type": "AccountType", "Balance": "Debit" },
    projects: {},
    unknown: {},
  },

  bigtime: {
    clients: { "Client": "Organization", "Client Name": "Organization", "Legal Name": "Organization" },
    time_entry_details: { "Staff": "Team Member", "Employee": "Team Member", "Task": "Service", "Input Hours": "Hours", "Notes": "Note" },
    invoice_details: { "Invoice": "Invoice #", "Client": "Client Name", "Date": "Date Issued", "Due": "Date Due", "Amount": "Line Total" },
    expense_details: { "Category": "Parent Category", "Notes": "Description" },
    services: {},
    vendors: {},
    gl_balances: {},
    projects: { "Project Name": "ProjectName", "Client": "ClientName", "Status": "Status", "Budget": "Budget" },
    unknown: {},
  },

  scoro: {
    clients: { "Company name": "Organization", "Contact name": "Organization" },
    time_entry_details: { "User": "Team Member", "Employee": "Team Member", "Activity": "Service", "Duration": "Hours", "Time": "Hours", "Comment": "Note", "Description": "Note" },
    invoice_details: { "Invoice no": "Invoice #", "Number": "Invoice #", "Client": "Client Name", "Company": "Client Name", "Date": "Date Issued", "Issue date": "Date Issued", "Deadline": "Date Due", "Sum": "Line Total", "Total": "Line Total" },
    expense_details: { "Category": "Parent Category" },
    services: {},
    vendors: {},
    gl_balances: {},
    projects: { "Contact name": "ClientName", "Date": "StartDate", "Deadline": "EndDate", "Estimated duration": "BudgetHours" },
    unknown: {},
  },

  paymo: {
    clients: { "Client": "Organization", "Name": "Organization" },
    time_entry_details: { "User": "Team Member", "Task": "Service", "Duration": "Hours", "Description": "Note" },
    invoice_details: { "Invoice": "Invoice #", "Client": "Client Name", "Date": "Date Issued", "Due date": "Date Due", "Total": "Line Total", "Status": "Invoice Status" },
    expense_details: {},
    services: {},
    vendors: {},
    gl_balances: {},
    projects: { "Client": "ClientName", "Project": "ProjectName", "Code": "ProjectCode", "Budget hours": "BudgetHours", "Price per hour": "Budget" },
    unknown: {},
  },

  generic: {
    clients: {
      "Name": "Organization",
      "Company": "Organization",
      "Client": "Organization",
    },
    time_entry_details: {
      "Person": "Team Member",
      "User": "Team Member",
      "Member": "Team Member",
      "Task": "Service",
      "Activity": "Service",
      "Notes": "Note",
      "Description": "Note",
    },
    vendors: {},
    services: {},
    invoice_details: {},
    expense_details: {},
    gl_balances: {},
    projects: {},
    unknown: {},
  },

  unknown: {
    clients: {}, vendors: {}, services: {},
    time_entry_details: {}, invoice_details: {}, expense_details: {},
    gl_balances: {}, projects: {}, unknown: {},
  },
};

function stripBOM(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1);
  return text;
}

function parseHeaderLine(firstLine: string): string[] {
  return stripBOM(firstLine)
    .replace(/"/g, "")
    .split(",")
    .map(h => h.trim());
}

export function detectPlatformAndType(firstLine: string): { platform: Platform; dataType: DataType } {
  const headers = parseHeaderLine(firstLine);
  const headerSet = new Set(headers);

  for (const sig of SIGNATURES) {
    if (sig.requiredHeaders.every(h => headerSet.has(h))) {
      return { platform: sig.platform, dataType: sig.dataType };
    }
  }

  return { platform: "unknown", dataType: "unknown" };
}

export function normalizeRows(
  rows: Record<string, string>[],
  platform: Platform,
  dataType: DataType,
): Record<string, string>[] {
  if (platform === "freshbooks" || platform === "unknown") {
    return rows;
  }

  const columnMap = COLUMN_MAPS[platform]?.[dataType] || {};
  if (Object.keys(columnMap).length === 0) {
    return rows;
  }

  return rows.map(row => {
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(row)) {
      normalized[key] = value;
    }

    for (const [sourceCol, targetCol] of Object.entries(columnMap)) {
      if (row[sourceCol] !== undefined && !normalized[targetCol]) {
        normalized[targetCol] = row[sourceCol];
      }
    }

    if (platform === "harvest" && dataType === "time_entry_details") {
      if (!normalized["Team Member"] && (row["First Name"] || row["Last Name"])) {
        normalized["Team Member"] = `${row["First Name"] || ""} ${row["Last Name"] || ""}`.trim();
      }
    }

    if (platform === "harvest" && dataType === "clients") {
      if (!normalized["Organization"] && row["Client"]) {
        normalized["Organization"] = row["Client"];
      }
    }

    if (platform === "xero" && dataType === "invoice_details") {
      if (row["Quantity"] && row["UnitAmount"]) {
        const qty = parseFloat(row["Quantity"]);
        const unit = parseFloat(row["UnitAmount"]);
        if (!isNaN(qty) && !isNaN(unit)) {
          normalized["Line Total"] = (Math.round((qty * unit + Number.EPSILON) * 100) / 100).toFixed(2);
        }
      }
    }

    if (platform === "bigtime" && dataType === "time_entry_details") {
      if (!normalized["Hours"] && (row["Billable Hours"] || row["Non-Billable Hours"])) {
        const bh = parseFloat(row["Billable Hours"] || "0") || 0;
        const nbh = parseFloat(row["Non-Billable Hours"] || "0") || 0;
        normalized["Hours"] = (bh + nbh).toFixed(2);
      }
    }

    if (platform === "scoro" && dataType === "time_entry_details") {
      if (normalized["Hours"]) {
        const parsed = parseHours(normalized["Hours"]);
        if (!isNaN(parsed)) {
          normalized["Hours"] = parsed.toFixed(2);
        }
      }
    }

    if (platform === "paymo" && dataType === "time_entry_details") {
      const dur = row["Duration"] || "";
      if (dur && /^\d+$/.test(dur.trim()) && Number(dur) > 100) {
        normalized["Hours"] = (Number(dur) / 3600).toFixed(2);
      }
    }

    if (platform === "quickbooks" && dataType === "time_entry_details") {
      if (normalized["Hours"]) {
        const parsed = parseHours(normalized["Hours"]);
        if (!isNaN(parsed)) {
          normalized["Hours"] = parsed.toFixed(2);
        }
      }
    }

    if ((platform === "bigtime" || platform === "scoro" || platform === "paymo" || platform === "harvest") && dataType === "time_entry_details") {
      const billableCol = row["Billable"] || row["Billable?"] || row["Billing status"] || row["Billed"] || "";
      if (billableCol && !normalized["Status"]) {
        const lower = billableCol.toString().toLowerCase().trim();
        const isBillable = ["y", "yes", "true", "1", "billable", "billed", "t"].includes(lower);
        const isNonBillable = ["n", "no", "false", "0", "non-billable", "nonbillable", "f", "unbillable"].includes(lower);
        if (isBillable) {
          normalized["Status"] = "Billed";
        } else if (isNonBillable) {
          normalized["Status"] = "Non-billable";
        } else {
          console.warn(`[import] Unknown billable status "${billableCol}" — defaulting to Billed`);
          normalized["Status"] = "Billed";
        }
      }
    }

    if (platform === "quickbooks" && dataType === "clients") {
      const parts = [row["Street"], row["City"], row["State"], row["Zip"]].filter(Boolean);
      if (parts.length > 0 && !normalized["Address Line 1"]) {
        normalized["Address Line 1"] = parts.join(", ");
      }
    }

    return normalized;
  });
}

export interface PlatformInfo {
  id: Platform;
  name: string;
  supportedTypes: DataType[];
  exportInstructions: string;
}

export const PLATFORM_INFO: PlatformInfo[] = [
  {
    id: "freshbooks",
    name: "FreshBooks",
    supportedTypes: ["clients", "vendors", "services", "time_entry_details", "invoice_details", "expense_details"],
    exportInstructions: "In FreshBooks, go to each section (Clients, Invoices, etc.) and use the Export or Download CSV option. For time entries, go to Reports → Time Entry Details.",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    supportedTypes: ["clients", "services", "time_entry_details", "invoice_details", "expense_details"],
    exportInstructions: "In QuickBooks Online, go to Settings (gear icon) → Export Data. Select the data types you want. You can also export from Reports → run any report → Export to Excel/CSV.",
  },
  {
    id: "harvest",
    name: "Harvest",
    supportedTypes: ["clients", "services", "time_entry_details", "invoice_details", "expense_details"],
    exportInstructions: "In Harvest, go to Settings → Import/Export. Click 'Export all time' for time data. For clients, go to Manage → Clients → Export. For invoices, go to Invoices → Report → Export.",
  },
  {
    id: "xero",
    name: "Xero",
    supportedTypes: ["clients", "services", "invoice_details"],
    exportInstructions: "In Xero, export contacts from Contacts → All Contacts → Export CSV. Export invoices from Business → Invoices → Export. Use YYYY-MM-DD date format for best compatibility across regions.",
  },
  {
    id: "wave",
    name: "Wave",
    supportedTypes: ["clients", "invoice_details", "expense_details"],
    exportInstructions: "In Wave, go to Settings → Data Export → Download all data (generates ZIP with CSVs). Or export customers from Sales → Customers → Export CSV. For invoices, run a report and export.",
  },
  {
    id: "bigtime",
    name: "BigTime",
    supportedTypes: ["clients", "time_entry_details", "invoice_details", "expense_details"],
    exportInstructions: "In BigTime, export from Reports. Use the CUSTOMIZE button to add/remove columns. Click EXPORT DATA to download as CSV or Excel.",
  },
  {
    id: "scoro",
    name: "Scoro",
    supportedTypes: ["clients", "time_entry_details", "invoice_details", "expense_details"],
    exportInstructions: "In Scoro, export from any list view. Choose 'Export displayed columns' for cleaner data. Select comma as the column separator for best compatibility.",
  },
  {
    id: "paymo",
    name: "Paymo",
    supportedTypes: ["clients", "time_entry_details", "invoice_details"],
    exportInstructions: "In Paymo, switch to Table View, select items, then Export as CSV. For time entries, use Reports → Detailed Time → Export CSV.",
  },
];

export function getPlatformInfo(platform: Platform): PlatformInfo | undefined {
  return PLATFORM_INFO.find(p => p.id === platform);
}
