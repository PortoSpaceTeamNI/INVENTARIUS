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
import { useMe } from "./lib";
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
  return (
    <div className="empty">
      <strong>Page not found</strong>
      <Link to="/" className="btn">
        Go home
      </Link>
    </div>
  );
}

/** Layout for signed-in pages; sends everyone else to /login. */
function SignedIn() {
  const me = useMe();
  const loc = useLocation();
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
        <div className="alert alert-danger">Cannot reach the server: {me.error.message}</div>
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
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Home">
        <BrandMark />
      </Link>
      <button type="button" className="search-trigger" onClick={openSearch}>
        <Search size={16} />
        <span>Search items, parts, places…</span>
        <kbd className="only-desktop">/</kbd>
      </button>
      <span className="spacer only-desktop" />
      <Link to="/scan" className="btn btn-primary only-desktop">
        <ScanLine size={16} /> Scan
      </Link>
      <Link to="/me" className="avatar-link" aria-label="Your profile">
        <Avatar me={me} />
      </Link>
    </header>
  );
}

function Sidebar({ me }: { me: User }) {
  const loans = useQuery({ queryKey: ["loans", "all"], queryFn: () => get<OpenLoan[]>("/api/loans") });
  const overdue = loans.data?.filter((l) => l.overdue).length ?? 0;
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
          <Home size={17} /> Home
        </NavLink>
        <NavLink to="/items">
          <Boxes size={17} /> Items
        </NavLink>
        <NavLink to="/locations">
          <MapPin size={17} /> Locations
        </NavLink>
        <NavLink to="/loans">
          <Wrench size={17} /> Loans
          {overdue > 0 && <span className="nav-count">{overdue}</span>}
        </NavLink>
        <div className="nav-label">Tools</div>
        <NavLink to="/scan">
          <ScanLine size={17} /> Scan
        </NavLink>
        <NavLink to="/print">
          <Printer size={17} /> Labels
        </NavLink>
        <NavLink to="/import">
          <FileUp size={17} /> Import
        </NavLink>
        {me.role === "admin" && (
          <>
            <div className="nav-label">Admin</div>
            <NavLink to="/users">
              <Users size={17} /> People
            </NavLink>
          </>
        )}
      </nav>
      <Link to="/me" className="sidebar-foot">
        <Avatar me={me} />
        <div>
          {me.name}
          <small>{me.email}</small>
        </div>
        <Settings size={16} style={{ marginLeft: "auto", opacity: 0.6 }} />
      </Link>
    </aside>
  );
}

function TabBar() {
  return (
    <nav className="tabbar">
      <NavLink to="/" end>
        <Home size={21} />
        Home
      </NavLink>
      <NavLink to="/items">
        <Boxes size={21} />
        Items
      </NavLink>
      <NavLink to="/scan" aria-label="Scan">
        <span className="scan-bubble">
          <ScanLine size={24} />
        </span>
      </NavLink>
      <NavLink to="/locations">
        <MapPin size={21} />
        Places
      </NavLink>
      <NavLink to="/loans">
        <Wrench size={21} />
        Loans
      </NavLink>
    </nav>
  );
}
