import { sceneColors } from "@/components/storageScene/sceneColors";
import {
  pointsAttribute,
  type IsometricPoint2d,
} from "@/lib/storageLayouts/isometricGeometry";

export type SceneRole = {
  kind: "location" | "package";
  selected?: boolean;
  held?: boolean;
  invalid?: boolean;
  source?: boolean;
};
export function sceneStyle({
  kind,
  selected = false,
  held = false,
  invalid = false,
  source = false,
}: SceneRole) {
  return {
    solid: kind === "package" && selected,
    stroke: invalid
      ? sceneColors.invalid
      : selected
        ? sceneColors.selected
        : source
          ? "#b6c2d1"
          : held
            ? sceneColors.reserved
            : kind === "location"
              ? sceneColors.free
              : sceneColors.stored,
    strokeWidth: selected ? 2.2 : 1.2,
    dash: held || source ? "5 4" : undefined,
  };
}
const edges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;
/** Bottom corners 0..3, matching top corners 4..7; callers retain their camera and interactions. */
export function SceneBox({
  points,
  mode,
  ...role
}: SceneRole & { points: readonly IsometricPoint2d[]; mode: "plan" | "3d" }) {
  if (points.length !== 8) return null;
  const style = sceneStyle(role);
  const faces =
    mode === "plan"
      ? [[0, 1, 2, 3]]
      : [
          [0, 1, 5, 4],
          [1, 2, 6, 5],
          [2, 3, 7, 6],
          [3, 0, 4, 7],
        ]
          .sort(
            (a, b) =>
              Math.max(...a.map((i) => points[i]!.y)) -
              Math.max(...b.map((i) => points[i]!.y)),
          )
          .concat([[4, 5, 6, 7]]);
  return (
    <g
      data-scene-kind={role.kind}
      data-scene-solid={style.solid}
      stroke={style.stroke}
      strokeWidth={style.strokeWidth}
      strokeDasharray={style.dash}
      className="group-focus-visible:stroke-text"
    >
      {faces.map((face, index) => (
        <polygon
          key={index}
          data-placement-face={
            role.kind === "package" && index === faces.length - 1
              ? "top"
              : undefined
          }
          data-zone-face={
            role.kind === "location" && role.selected
              ? mode === "plan"
                ? "plan"
                : index === faces.length - 1
                  ? "top"
                  : "side"
              : undefined
          }
          points={pointsAttribute(face.map((i) => points[i]!))}
          fill={
            style.solid
              ? index === faces.length - 1
                ? "#cfaa77"
                : index % 2
                  ? "#957449"
                  : "#b18d5c"
              : "transparent"
          }
          stroke={style.solid ? style.stroke : "none"}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {(!style.solid ? (mode === "plan" ? edges.slice(0, 4) : edges) : []).map(
        ([a, b]) => (
          <line
            key={`${a}-${b}`}
            data-scene-edge={`${a}-${b}`}
            x1={points[a]!.x}
            y1={points[a]!.y}
            x2={points[b]!.x}
            y2={points[b]!.y}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ),
      )}
    </g>
  );
}

/** Legend uses the same role/status palette as the scene. */
export function SceneLegendMark(role: SceneRole) {
  const style = sceneStyle(role);
  return (
    <span
      aria-hidden="true"
      className="mr-1.5 inline-block size-3 rounded-sm align-middle"
      style={{
        borderColor: style.stroke,
        borderStyle: style.dash ? "dashed" : "solid",
        borderWidth: role.selected ? 2 : 1,
        backgroundColor: style.solid ? "#cfaa77" : "transparent",
      }}
    />
  );
}
