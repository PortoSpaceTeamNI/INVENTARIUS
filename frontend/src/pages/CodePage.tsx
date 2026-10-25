import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { get } from "../api";
import { ErrorBox, Loading, Page } from "../components/ui";
import { useT } from "../i18n";

/** Where a QR label lands (/A107 redirects here): opens the page for the code. */
export function CodePage() {
  const { code = "" } = useParams();
  const t = useT();
  const r = useQuery({
    queryKey: ["code", code],
    queryFn: () => get<{ path: string }>(`/api/codes/${encodeURIComponent(code)}`),
  });
  if (r.data) return <Navigate to={r.data.path} replace />;
  if (r.error)
    return (
      <Page title={t.scan.labelTitle(code)}>
        <div className="stack" style={{ maxWidth: 520 }}>
          <ErrorBox error={r.error} />
          <div>
            <Link to="/scan" className="btn btn-primary">
              {t.scan.another}
            </Link>
          </div>
        </div>
      </Page>
    );
  return <Loading />;
}
