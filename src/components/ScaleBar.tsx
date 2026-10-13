const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6_378_137;
const KM_LADDER = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000,
];
const TARGET_WIDTH_PX = 120;

function computeScaleBar(
  zoom: number,
  latitude: number,
): { widthPx: number; label: string } {
  const metersPerPx =
    (Math.cos((latitude * Math.PI) / 180) * EARTH_CIRCUMFERENCE) /
    (256 * 2 ** zoom);
  const targetKm = (metersPerPx * TARGET_WIDTH_PX) / 1000;

  let niceKm = KM_LADDER[0];
  for (const km of KM_LADDER) {
    if (km <= targetKm) {
      niceKm = km;
    }
  }

  const widthPx = (niceKm * 1000) / metersPerPx;
  const label = niceKm < 1 ? `${Math.round(niceKm * 1000)} m` : `${niceKm} km`;
  return { widthPx, label };
}

export function ScaleBar({
  zoom,
  latitude,
}: {
  zoom: number;
  latitude: number;
}) {
  const { widthPx, label } = computeScaleBar(zoom, latitude);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 20,
        left: 20,
        zIndex: 1000,
        pointerEvents: "none",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: "11px",
        color: "white",
        textShadow: "1px 1px 2px rgba(0,0,0,0.8)",
        userSelect: "none",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "3px" }}>{label}</div>
      <div
        style={{
          width: `${widthPx}px`,
          height: "6px",
          borderLeft: "2px solid white",
          borderRight: "2px solid white",
          borderBottom: "2px solid white",
          boxSizing: "border-box",
          filter: "drop-shadow(1px 1px 1px rgba(0,0,0,0.8))",
        }}
      />
    </div>
  );
}
