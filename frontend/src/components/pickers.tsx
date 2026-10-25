import { useMemo } from "react";
import { useT } from "../i18n";
import { locationPaths, useLocations, useMeta } from "../lib";

/** Encodes team / project / department as "", "p:<id>", "d:<id>". */
export function ownerValue(projectId: number | null, departmentId: number | null): string {
  if (departmentId) return `d:${departmentId}`;
  if (projectId) return `p:${projectId}`;
  return "";
}

export function parseOwnerValue(v: string): { project_id: number | null; department_id: number | null } {
  const [k, id] = v.split(":");
  return {
    project_id: k === "p" ? Number(id) : null,
    department_id: k === "d" ? Number(id) : null,
  };
}

/** Select for an owner (team, a project or a department) or a purpose. */
export function OrgSelect(props: {
  value: string;
  onChange: (v: string) => void;
  noneLabel: string;
  id?: string;
}) {
  const { data: meta } = useMeta();
  const t = useT();
  return (
    <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">{props.noneLabel}</option>
      {meta?.projects.map((p) => (
        <optgroup key={p.id} label={p.name}>
          <option value={`p:${p.id}`}>{t.common.wholeProject(p.name)}</option>
          {meta.departments
            .filter((d) => d.project_id === p.id)
            .map((d) => (
              <option key={d.id} value={`d:${d.id}`}>
                {d.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function LocationSelect(props: {
  value: number | null;
  onChange: (id: number | null) => void;
  emptyLabel?: string;
  exclude?: number;
  id?: string;
  required?: boolean;
}) {
  const { data: locs } = useLocations();
  const t = useT();
  const sorted = useMemo(() => {
    const paths = locationPaths(locs);
    return [...paths.entries()]
      .filter(([id]) => id !== props.exclude)
      .sort((a, b) => a[1].localeCompare(b[1]));
  }, [locs, props.exclude]);
  return (
    <select
      id={props.id}
      required={props.required}
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{props.emptyLabel ?? t.common.chooseLocation}</option>
      {sorted.map(([id, path]) => (
        <option key={id} value={id}>
          {path}
        </option>
      ))}
    </select>
  );
}
