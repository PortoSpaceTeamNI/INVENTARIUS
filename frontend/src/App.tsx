import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  FileUp,
  Home,
  MapPin,
  Printer,
  ScanLine,
  Search,
  Settings,
  Users,
  Wrench,
} from "lucide-react";
import { useEffect } from "react";
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ApiError, get, type OpenLoan, type User } from "./api";
import { SearchPaletteProvider, useOpenSearch } from "./components/SearchPalette";
import { BrandMark, Loading } from "./components/ui";
import { LangToggle, useT } from "./i18n";
import { useMe, usePrintHold } from "./lib";
import { AssetPage } from "./pages/AssetPage";
import { CodePage } from "./pages/CodePage";
import { HomePage } from "./pages/HomePage";
import { ImportPage } from "./pages/ImportPage";
import { ItemEditPage } from "./pages/ItemForm";
import { ItemPage } from "./pages/ItemPage";
import { ItemsPage } from "./pages/ItemsPage";
import { LoansPage } from "./pages/LoansPage";
import { LocationPage } from "./pages/LocationPage";
import { LocationsPage } from "./pages/LocationsPage";
import { LoginPage } from "./pages/LoginPage";
import { PrintPage } from "./pages/PrintPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ScanPage } from "./pages/ScanPage";
import { StockPage } from "./pages/StockPage";
import { UsersPage } from "./pages/UsersPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<SignedIn />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/scan" element={<ScanPage />} />
        <Route path="/c/:code" element={<CodePage />} />
        <Route path="/locations" element={<LocationsPage />} />
        <Route path="/locations/:id" element={<LocationPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/items/new" element={<ItemEditPage />} />
        <Route path="/items/:id" element={<ItemPage />} />
        <Route path="/items/:id/edit" element={<ItemEditPage />} />
        <Route path="/stock/:id" element={<StockPage />} />
        <Route path="/assets/:id" element={<AssetPage />} />
        <Route path="/loans" element={<LoansPage />} />
        <Route path="/print" element={<PrintPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/me" element={<ProfilePage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function NotFound() {
  const t = useT();
  return (
    <div className="empty">
      <strong>{t.common.pageNotFound}</strong>
      <Link to="/" className="btn">
        {t.common.goHome}
      </Link>
    </div>
  );
}

/** Layout for signed-in pages; sends everyone else to /login. */
function SignedIn() {
  const me = useMe();
  const loc = useLocation();
  const t = useT();
  // Scroll to the top when moving between pages.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  if (me.isPending)
    return (
      <div className="content">
        <Loading />
      </div>
    );
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      const next = encodeURIComponent(loc.pathname + loc.search);
      return <Navigate to={`/login?next=${next}`} replace />;
    }
    return (
      <div className="content">
        <div className="alert alert-danger">{t.common.cannotReach(me.error.message)}</div>
      </div>
    );
  }
  return (
    <SearchPaletteProvider>
      <div className="shell">
        <Sidebar me={me.data} />
        <div className="shell-main">
          <TopBar me={me.data} />
          <main className="content">
            <Outlet />
          </main>
        </div>
        <TabBar />
      </div>
    </SearchPaletteProvider>
  );
}

function Avatar({ me }: { me: User }) {
  return (
    <span className="avatar">
      {me.picture ? (
        <img src={me.picture} alt="" referrerPolicy="no-referrer" />
      ) : (
        me.name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

function TopBar({ me }: { me: User }) {
  const openSearch = useOpenSearch();
  const t = useT();
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label={t.nav.home}>
        <BrandMark />
      </Link>
      <button type="button" className="search-trigger" onClick={openSearch}>
        <Search size={16} />
        <span>{t.nav.searchHint}</span>
        <kbd className="only-desktop">/</kbd>
      </button>
      <span className="spacer only-desktop" />
      <Link to="/scan" className="btn btn-primary only-desktop">
        <ScanLine size={16} /> {t.nav.scan}
      </Link>
      <Link to="/me" className="avatar-link" aria-label={t.nav.profile}>
        <Avatar me={me} />
      </Link>
    </header>
  );
}

function Sidebar({ me }: { me: User }) {
  const loans = useQuery({ queryKey: ["loans", "all"], queryFn: () => get<OpenLoan[]>("/api/loans") });
  const overdue = loans.data?.filter((l) => l.overdue).length ?? 0;
  const { data: hold } = usePrintHold();
  const t = useT();
  return (
    <aside className="sidebar">
      <Link to="/" className="brand">
        <BrandMark />
        <span>
          INVENTARIUS
          <small>Porto Space Team</small>
        </span>
      </Link>
      <nav className="nav">
        <NavLink to="/" end>
          <Home size={17} /> {t.nav.home}
        </NavLink>
        <NavLink to="/items">
          <Boxes size={17} /> {t.nav.items}
        </NavLink>
        <NavLink to="/locations">
          <MapPin size={17} /> {t.nav.locations}
        </NavLink>
        <NavLink to="/loans">
          <Wrench size={17} /> {t.nav.loans}
          {overdue > 0 && <span className="nav-count">{overdue}</span>}
        </NavLink>
        <div className="nav-label">{t.nav.tools}</div>
        <NavLink to="/scan">
          <ScanLine size={17} /> {t.nav.scan}
        </NavLink>
        <NavLink to="/print">
          <Printer size={17} /> {t.nav.labels}
          {hold?.hold && hold.waiting > 0 && (
            <span className="nav-count" title={t.print.waiting(hold.waiting)}>
              {hold.waiting}
            </span>
          )}
        </NavLink>
        <NavLink to="/import">
          <FileUp size={17} /> {t.nav.import}
        </NavLink>
        {me.role === "admin" && (
          <>
            <div className="nav-label">{t.nav.admin}</div>
            <NavLink to="/users">
              <Users size={17} /> {t.nav.people}
            </NavLink>
          </>
        )}
      </nav>
      <div className="sidebar-bottom">
        <LangToggle tone="dark" />
        <Link to="/me" className="sidebar-foot">
          <Avatar me={me} />
          <div>
            {me.name}
            <small>{me.email}</small>
          </div>
          <Settings size={16} style={{ marginLeft: "auto", opacity: 0.6 }} />
        </Link>
      </div>
    </aside>
  );
}

function TabBar() {
  const t = useT();
  return (
    <nav className="tabbar">
      <NavLink to="/" end>
        <Home size={21} />
        {t.nav.home}
      </NavLink>
      <NavLink to="/items">
        <Boxes size={21} />
        {t.nav.items}
      </NavLink>
      <NavLink to="/scan" aria-label={t.nav.scan}>
        <span className="scan-bubble">
          <ScanLine size={24} />
        </span>
      </NavLink>
      <NavLink to="/locations">
        <MapPin size={21} />
        {t.nav.places}
      </NavLink>
      <NavLink to="/loans">
        <Wrench size={21} />
        {t.nav.loans}
      </NavLink>
    </nav>
  );
}
