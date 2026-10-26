import type { PointerEvent as ReactPointerEvent, Ref } from "react";
import type { MapShape } from "../api";
import { shapeColor } from "../map";

/** Black or white, whichever reads better on a fill colour. */
function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111827" : "#ffffff";
}

/** The label sized to fit its shape, turned sideways in tall narrow shapes. */
function ShapeLabel({ s }: { s: MapShape }) {
  if (!s.label) return null;
  const sideways = s.h > s.w * 1.4;
  const [along, across] = sideways ? [s.h, s.w] : [s.w, s.h];
  const size = Math.min(22, across * 0.42, (along * 0.9) / (s.label.length * 0.58));
  if (size < 8) return null; // too small to read; the tooltip still has it
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  return (
    <text
      x={cx}
      y={cy}
      fontSize={size}
      fill={inkOn(shapeColor(s))}
      textAnchor="middle"
      dominantBaseline="central"
      transform={sideways ? `rotate(-90 ${cx} ${cy})` : undefined}
      className="room-label"
    >
      {s.label}
    </text>
  );
}

const HANDLE = 14;

/**
 * Draws a room map in centimetres. The viewer passes counts and highlights;
 * the editor passes onPointerDown to drag shapes and their resize handles.
 */
export function RoomCanvas(props: {
  width: number;
  height: number;
  shapes: MapShape[];
  selected?: string | null;
  highlighted?: Set<string>;
  /** Things stored in each shape's place, shown as a badge. */
  counts?: Map<string, number>;
  editing?: boolean;
  onSelect?: (s: MapShape) => void;
  onPointerDown?: (e: ReactPointerEvent, s: MapShape, part: "body" | "handle") => void;
  onPointerMove?: (e: ReactPointerEvent) => void;
  onPointerUp?: () => void;
  onBackground?: () => void;
  svgRef?: Ref<SVGSVGElement>;
  label: string;
}) {
  const { width, height, highlighted } = props;
  const dim = highlighted && highlighted.size > 0;
  // Fixtures go underneath so they never cover a cabinet.
  const ordered = [...props.shapes].sort(
    (a, b) => Number(b.kind === "fixture") - Number(a.kind === "fixture"),
  );
  return (
    <svg
      ref={props.svgRef}
      className={`room-canvas ${props.editing ? "editing" : ""}`}
      viewBox={`-12 -12 ${width + 24} ${height + 24}`}
      role="img"
      aria-label={props.label}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerUp}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as Element).classList.contains("room-floor"))
          props.onBackground?.();
      }}
    >
      <defs>
        <pattern id="room-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" className="room-grid-line" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={width} height={height} className="room-floor" />
      {props.editing && (
        <rect x={0} y={0} width={width} height={height} fill="url(#room-grid)" pointerEvents="none" />
      )}
      <rect x={0} y={0} width={width} height={height} className="room-wall" pointerEvents="none" />
      {ordered.map((s) => {
        const clickable = props.editing || s.link !== "";
        const on = highlighted?.has(s.id);
        const count = props.counts?.get(s.id) ?? 0;
        const cls = [
          "room-shape",
          `room-${s.kind}`,
          clickable && "clickable",
          props.selected === s.id && "selected",
          on && "highlighted",
          dim && !on && "dimmed",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: an SVG group; it gets role="button" when it can be tapped
          <g
            key={s.id}
            className={cls}
            role={clickable ? "button" : undefined}
            tabIndex={clickable && !props.editing ? 0 : undefined}
            aria-label={s.label}
            onClick={() => clickable && props.onSelect?.(s)}
            onKeyDown={(e) => {
              if (clickable && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                props.onSelect?.(s);
              }
            }}
            onPointerDown={(e) => props.onPointerDown?.(e, s, "body")}
          >
            <title>{s.label}</title>
            <rect
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx={2}
              fill={shapeColor(s)}
              className="room-rect"
            />
            <ShapeLabel s={s} />
            {count > 0 && !props.editing && (
              <g className="room-badge" pointerEvents="none">
                <circle cx={s.x + s.w - 2} cy={s.y + 2} r={11} />
                <text
                  x={s.x + s.w - 2}
                  y={s.y + 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={12}
                >
                  {count > 99 ? "99+" : count}
                </text>
              </g>
            )}
            {props.editing && props.selected === s.id && (
              <rect
                x={s.x + s.w - HANDLE / 2}
                y={s.y + s.h - HANDLE / 2}
                width={HANDLE}
                height={HANDLE}
                className="room-handle"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  props.onPointerDown?.(e, s, "handle");
                }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
