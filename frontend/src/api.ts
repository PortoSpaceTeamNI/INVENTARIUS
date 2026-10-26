// Types mirror the backend's JSON (sqlc models, snake_case).

export type Role = "member" | "dept_lead" | "admin";
export type ItemKind = "consumable" | "tool" | "hazmat" | "flight_hw";
export type AssetStatus = "available" | "on_loan" | "broken" | "in_repair" | "retired";
export type Symbology = "datamatrix" | "qr" | "code128";
/** exact: counted; approx: an estimate; uncounted: plenty, nobody counted. */
export type CountState = "exact" | "approx" | "uncounted";

export interface User {
  id: number;
  email: string;
  name: string;
  picture: string;
  role: Role;
  active: boolean;
  created_at: string;
  department_ids: number[];
}

export interface Project {
  id: number;
  code: string;
  name: string;
}

export interface Department {
  id: number;
  project_id: number;
  name: string;
}

export interface Meta {
  projects: Project[];
  departments: Department[];
  symbology: Symbology;
  label_url: string;
  /** Whether GET /api/parts (Mouser lookup) is set up on the server. */
  part_lookup: boolean;
}

/** What the distributor's catalogue knows about a part (GET /api/parts). */
export interface PartInfo {
  mpn: string;
  manufacturer: string;
  description: string;
  category: string;
  package: string;
  datasheet_url: string;
  product_url: string;
  image_url: string;
  supplier_part: string;
  /** The team's category for this kind of part, if one exists... */
  category_id: number | null;
  /** ...otherwise a name for a new one ("Condensadores"), or "". */
  new_category: string;
  /** Short text for labels ("Capacitors 1uF 0402"). */
  label_text: string;
}

export interface Owned {
  owner_project_id: number | null;
  owner_department_id: number | null;
}

export interface Location {
  id: number;
  parent_id: number | null;
  name: string;
  description: string;
  created_at: string;
  /** Bumped by every edit; sent back so a save from an outdated form is refused. */
  version: number;
}

export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  version: number;
}

export interface Item extends Owned {
  id: number;
  name: string;
  kind: ItemKind;
  category_id: number | null;
  description: string;
  manufacturer: string;
  mpn: string;
  supplier_url: string;
  datasheet_url: string;
  unit: string;
  min_stock: number | null;
  photo: string;
  hazard_class: string;
  storage_notes: string;
  /** Package / footprint, e.g. "0603". */
  package: string;
  /** Short text printed on labels instead of the name; "" for the name. */
  label_text: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface ItemSummary extends Item {
  total_quantity: number;
  asset_count: number;
  available_count: number;
  reserved_quantity: number;
  reserved_assets: number;
  uncounted_lots: number;
  approx_lots: number;
}

/** Something set aside for a project/department: part of a stock lot, or one asset. */
export interface Reservation {
  id: number;
  item_id: number;
  stock_id: number | null;
  asset_id: number | null;
  quantity: number;
  user_id: number;
  user_name: string;
  project_id: number | null;
  department_id: number | null;
  note: string;
  until: string | null;
  created_at: string;
}

export interface Stock extends Owned {
  id: number;
  item_id: number;
  location_id: number;
  quantity: number;
  count_state: CountState;
  lot: string;
  expires_on: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Asset extends Owned {
  id: number;
  item_id: number;
  serial: string;
  location_id: number | null;
  condition: string;
  status: AssetStatus;
  notes: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Loan {
  id: number;
  asset_id: number;
  user_id: number;
  project_id: number | null;
  department_id: number | null;
  taken_at: string;
  due_at: string | null;
  returned_at: string | null;
  note: string;
}

export interface OpenLoan {
  loan: Loan;
  user_name: string;
  user_email: string;
  item_id: number;
  item_name: string;
  asset_serial: string;
  overdue: boolean;
}

export interface Movement {
  id: number;
  at: string;
  user_id: number;
  kind: string;
  item_id: number;
  stock_id: number | null;
  asset_id: number | null;
  from_location_id: number | null;
  to_location_id: number | null;
  quantity: number;
  project_id: number | null;
  department_id: number | null;
  note: string;
}

export interface MovementRow {
  movement: Movement;
  user_name: string;
  item_name: string;
  item_unit: string;
}

export interface PrintJob {
  id: number;
  created_at: string;
  user_id: number;
  code: string;
  symbology: Symbology;
  caption: string;
  status: "queued" | "printing" | "done" | "failed" | "cancelled";
  attempts: number;
  error: string;
  printed_at: string | null;
}

export interface PrintHold {
  hold: boolean;
  /** Labels queued and not yet printed. */
  waiting: number;
}

/** A label to print; caption left out means its usual one. */
export interface PrintLabel {
  code: string;
  symbology?: Symbology;
  caption?: string;
}

export interface PrinterState {
  enabled: boolean;
  model?: string;
  tape_mm: number;
  problems: string[];
  error?: string;
  checked_at: string;
  busy: boolean;
  /** Estimate for the loaded cassette, counted from what the app printed. */
  tape_roll?: TapeRoll;
}

export interface TapeRoll {
  width_mm: number;
  length_mm: number;
  used_mm: number;
  loaded_at: string;
}

export interface LocationDetail {
  location: Location;
  path: Location[];
  children: Location[];
  stock: {
    stock: Stock;
    item_name: string;
    item_unit: string;
    item_kind: ItemKind;
    item_datasheet_url: string;
    item_package: string;
    reserved: number;
  }[];
  assets: { asset: Asset; item_name: string; item_kind: ItemKind; reserved: boolean }[];
}

export interface ItemDetail {
  item: Item;
  stock: Stock[];
  assets: Asset[];
  movements: MovementRow[];
  reservations: Reservation[];
  can_edit: boolean;
}

export interface StockDetail {
  stock: Stock;
  item: Item;
  location: Location;
  movements: MovementRow[];
  reservations: Reservation[];
  can_edit: boolean;
}

export interface AssetDetail {
  asset: Asset;
  item: Item;
  location: Location | null;
  loans: { loan: Loan; user_name: string }[];
  movements: MovementRow[];
  reservations: Reservation[];
  can_edit: boolean;
}

export interface SearchResult {
  items: ItemSummary[];
  locations: Location[];
  code: { code: string; path: string } | null;
}

export interface ImportRow {
  line: number;
  name: string;
  kind: string;
  quantity: number;
  location: string;
  errors: string[];
}

export interface ImportResult {
  rows: ImportRow[];
  valid: boolean;
  committed: boolean;
  created_items?: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = void>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof Blob || typeof body === "string") {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const get = <T>(path: string) => api<T>("GET", path);
