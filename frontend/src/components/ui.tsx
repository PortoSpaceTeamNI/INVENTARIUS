import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Bookmark,
  BookmarkX,
  Boxes,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Flame,
  MapPin,
  Package,
  PackagePlus,
  Pencil,
  Rocket,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, type ItemKind, type MovementRow } from "../api";
import { useT } from "../i18n";
import { serverText } from "../i18n/server";
import { forLabel, locationPaths, qty, useLocations, useMeta, when } from "../lib";

/* ---------------------------------------------------------------- layout */

export function Page(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: { label: ReactNode; to: string }[];
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div>
      {props.crumbs && props.crumbs.length > 0 && (
        <nav className="crumbs" aria-label={t.nav.breadcrumb}>
          {props.crumbs.map((c, i) => (
            <span key={c.to} className="row" style={{ gap: "0.2rem" }}>
              {i > 0 && <ChevronRight size={13} />}
              <Link to={c.to}>{c.label}</Link>
            </span>
          ))}
        </nav>
      )}
      <header className="page-header">
        <div className="page-header-text">
          <h1>{props.title}</h1>
          {props.subtitle && <div className="page-subtitle">{props.subtitle}</div>}
        </div>
        {props.actions && <div className="page-actions">{props.actions}</div>}
      </header>
      {props.children}
    </div>
  );
}

export function Card(props: {
  title?: ReactNode;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${props.className ?? ""}`}>
      {(props.title || props.actions) && (
        <header className="card-header">
          <h2>
            {props.title}
            {props.count !== undefined && <span className="count">{props.count}</span>}
          </h2>
          {props.actions && <div className="row">{props.actions}</div>}
        </header>
      )}
      {props.children}
      {props.footer && <footer className="card-footer">{props.footer}</footer>}
    </section>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  const t = useT();
  return (
    <div className="stack" role="status" aria-busy="true" aria-label={t.common.loading}>
      <div className="skeleton" style={{ height: 28, width: "40%" }} />
      <div className="card">
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <div key={i} className="list-row">
            <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 9 }} />
            <div style={{ flex: 1 }} className="stack-sm">
              <div className="skeleton" style={{ height: 12, width: `${50 + ((i * 17) % 35)}%` }} />
              <div className="skeleton" style={{ height: 10, width: "30%" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shows an error; server messages (and strings from the server) are translated when known. */
export function ErrorBox({ error }: { error: unknown }) {
  useT(); // re-render in the new language
  if (!error) return null;
  return (
    <div className="alert alert-danger" role="alert">
      <AlertTriangle size={16} />
      <span>
        {error instanceof ApiError || typeof error === "string"
          ? serverText(error instanceof Error ? error.message : error)
          : error instanceof Error
            ? error.message
            : String(error)}
      </span>
    </div>
  );
}

export function Empty(props: {
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{props.icon ?? <Boxes size={20} />}</div>
      {props.title && <strong>{props.title}</strong>}
      {props.children && <div>{props.children}</div>}
      {props.action}
    </div>
  );
}

export function Stat(props: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  to?: string;
  icon?: ReactNode;
}) {
  const body = (
    <>
      <div className="stat-label">
        {props.icon}
        {props.label}
      </div>
      <div className="stat-value">{props.value}</div>
      {props.hint && <div className="stat-hint">{props.hint}</div>}
    </>
  );
  return props.to ? (
    <Link to={props.to} className="stat">
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

/* ---------------------------------------------------------------- icons */

const kindIcons: Record<ItemKind, typeof Package> = {
  consumable: Package,
  tool: Wrench,
  hazmat: Flame,
  flight_hw: Rocket,
};

/** Square icon tile for an item kind, or its photo if it has one. */
export function ItemIcon({ kind, photo, size = 18 }: { kind: ItemKind; photo?: string; size?: number }) {
  const Icon = kindIcons[kind];
  return (
    <span className={`row-icon kind-${kind}`}>
      {photo ? <img src={`/photos/${photo}`} alt="" loading="lazy" /> : <Icon size={size} />}
    </span>
  );
}

export function PlaceIcon({ size = 17 }: { size?: number }) {
  return (
    <span className="row-icon kind-place">
      <MapPin size={size} />
    </span>
  );
}

/** The app mark: a Data Matrix-style "L" finder with a few modules. */
export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#2563eb" />
      <g fill="#fff">
        <rect x="7" y="7" width="3" height="18" />
        <rect x="7" y="22" width="18" height="3" />
        <rect x="13" y="7" width="3" height="3" />
        <rect x="19" y="7" width="3" height="3" />
        <rect x="16" y="10" width="3" height="3" />
        <rect x="22" y="10" width="3" height="3" />
        <rect x="13" y="13" width="3" height="3" />
        <rect x="19" y="16" width="6" height="3" />
        <rect x="16" y="16" width="3" height="3" />
      </g>
    </svg>
  );
}

/* ---------------------------------------------------------------- sheet */

/** A modal built on <dialog>; a bottom sheet on phones. */
export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    // Clicking the backdrop closes; Escape is handled by <dialog> itself.
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above
    <dialog
      ref={ref}
      className="sheet"
      onClose={props.onClose}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      <div className="sheet-body">
        <div className="sheet-head">
          <div>
            <h2>{props.title}</h2>
            {props.subtitle && <p>{props.subtitle}</p>}
          </div>
          <button
            type="button"
            className="btn btn-ghost icon-btn btn-sm"
            onClick={props.onClose}
            aria-label={t.common.close}
          >
            <XCircle size={18} />
          </button>
        </div>
        {props.open && props.children}
      </div>
    </dialog>
  );
}

/* ---------------------------------------------------------------- menu */

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

/** A dropdown of secondary actions. */
export function Menu(props: {
  trigger: ReactNode;
  items: (MenuItem | false | undefined)[];
  label: string;
  up?: boolean;
  /** "lg" matches the large buttons in action bars. */
  size?: "lg";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const items = props.items.filter(Boolean) as MenuItem[];
  if (items.length === 0) return null;
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={`btn icon-btn ${props.size === "lg" ? "btn-lg" : ""}`}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {props.trigger}
      </button>
      {open && (
        <div className={`menu-list ${props.up ? "up" : ""}`} role="menu">
          {items.map((it) => (
            <div key={it.label}>
              {it.separatorBefore && <hr />}
              <button
                type="button"
                role="menuitem"
                className={it.danger ? "danger" : ""}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                {it.icon}
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- history */

const kindStyle: Record<string, [typeof Package, string]> = {
  receive: [PackagePlus, "in"],
  take: [ArrowUpRight, "out"],
  return: [ArrowDownLeft, "in"],
  move: [ArrowRightLeft, "info"],
  adjust: [ClipboardCheck, "info"],
  write_off: [Trash2, "danger"],
  borrow: [ArrowUpRight, "out"],
  give_back: [ArrowDownLeft, "in"],
  asset_create: [PackagePlus, "in"],
  asset_update: [Pencil, ""],
  reserve: [Bookmark, "info"],
  unreserve: [BookmarkX, ""],
};

/** The audit log as a timeline. */
export function History({ rows, showItem }: { rows: MovementRow[]; showItem?: boolean }) {
  const { data: meta } = useMeta();
  const { data: locs } = useLocations();
  const t = useT();
  const paths = locationPaths(locs);
  if (rows.length === 0) return <Empty icon={<ClipboardCheck size={20} />}>{t.history.empty}</Empty>;
  return (
    <ul className="timeline">
      {rows.map(({ movement: m, user_name, item_name, item_unit }) => {
        const [Icon, tone] = kindStyle[m.kind] ?? [CheckCircle2, ""];
        const purpose = forLabel(meta, m.project_id, m.department_id);
        const from = m.from_location_id ? paths.get(m.from_location_id) : undefined;
        const to = m.to_location_id ? paths.get(m.to_location_id) : undefined;
        const showQty = !m.asset_id && m.kind !== "asset_create" && m.quantity !== 0;
        return (
          <li key={m.id}>
            <span className={`tl-icon ${tone}`}>
              <Icon size={14} />
            </span>
            <div className="tl-body">
              <div>
                <strong>{user_name}</strong> {t.history.kind[m.kind] ?? m.kind}{" "}
                {showQty && m.kind !== "adjust" && (
                  <strong className="num">{qty(Math.abs(m.quantity), item_unit)} </strong>
                )}
                {showItem && (
                  <Link to={m.asset_id ? `/assets/${m.asset_id}` : `/items/${m.item_id}`}>{item_name}</Link>
                )}
                {m.kind === "adjust" && m.quantity !== 0 && (
                  <span className={m.quantity > 0 ? "text-ok" : "text-warn"}>
                    {" "}
                    ({m.quantity > 0 ? "+" : "−"}
                    {qty(Math.abs(m.quantity))})
                  </span>
                )}
                {m.kind === "move" && from && to && (
                  <span className="muted">
                    {" "}
                    {from} → {to}
                  </span>
                )}
                {purpose && <span className="badge badge-info">{purpose}</span>}
              </div>
              {m.note && <div className="tl-note">“{serverText(m.note)}”</div>}
              <div className="tl-time">{when(m.at)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- toast */

const ToastCtx = createContext<(msg: string, kind?: "ok" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: string; n: number } | null>(null);
  const show = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    setToast((t) => ({ msg, kind, n: (t?.n ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === "error" ? 6000 : 2800);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <output key={toast.n} className={`toast ${toast.kind}`}>
          {toast.kind === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
          {toast.msg}
        </output>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
