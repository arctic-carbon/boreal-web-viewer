import type { LayerState } from "../hooks/useLayerState.js";
import { SOURCES } from "../sources.js";

type BasemapKey = "dark" | "satellite";

export type LayerPanelProps = {
  state: LayerState;
  basemap: BasemapKey;
  onToggleBasemap: () => void;
  side?: "left" | "right";
  compareMode?: boolean;
  onMatchScale?: () => void;
  matchScaleEnabled?: boolean;
};

function fmtVal(raw: number, src: (typeof SOURCES)[number]): string {
  return (raw * src.displayScale).toFixed(src.displayScale < 1 ? 2 : 0);
}

export function LayerPanel({
  state,
  basemap,
  onToggleBasemap,
  side,
  compareMode = false,
  onMatchScale,
  matchScaleEnabled = false,
}: LayerPanelProps) {
  const isRight = side === "right";

  const toggleBtnStyle: React.CSSProperties = {
    position: "absolute",
    top: "20px",
    ...(isRight ? { right: "20px" } : { left: "20px" }),
    zIndex: 1000,
    width: "36px",
    height: "36px",
    borderRadius: "8px",
    border: "none",
    background: "white",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    cursor: "pointer",
    fontSize: "18px",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const panelStyle: React.CSSProperties = {
    position: "absolute",
    top: "20px",
    ...(isRight ? { right: "20px" } : { left: "20px" }),
    zIndex: 1000,
    background: "white",
    padding: "16px",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
    maxWidth: "320px",
    width: "calc(100vw - 40px)",
    boxSizing: "border-box" as const,
  };

  if (!state.panelOpen) {
    return (
      <button
        type="button"
        onClick={() => state.setPanelOpen(true)}
        style={toggleBtnStyle}
        aria-label="Open settings"
      >
        &#9776;
      </button>
    );
  }

  return (
    <div style={panelStyle}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 4px 0", fontSize: "16px" }}>
            Potential Wildfire Carbon Losses
          </h3>
          <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#666" }}>
            Scenarios: historical, SSP-126, or SSP-585
          </p>
        </div>
        <button
          type="button"
          onClick={() => state.setPanelOpen(false)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: "18px",
            lineHeight: 1,
            padding: "0 0 0 8px",
            color: "#999",
          }}
          aria-label="Close settings"
        >
          &#10005;
        </button>
      </div>

      {/* Source selector */}
      <div>
        <p style={{ margin: "0 0 12px 0", fontSize: "12px", color: "#666" }}>
          Select layer
        </p>
        <select
          value={state.selectedIndex}
          onChange={(e) => state.setSelectedIndex(Number(e.target.value))}
          style={{
            width: "100%",
            padding: "6px 12px",
            fontSize: "12px",
            background: "#f0f0f0",
            border: "1px solid #ccc",
            borderRadius: "4px",
            cursor: "pointer",
            marginBottom: "12px",
          }}
        >
          {SOURCES.map((src, i) => (
            <option key={src.id} value={i}>
              {src.title}
            </option>
          ))}
        </select>
      </div>

      {/* Min slider */}
      <div style={{ marginBottom: "8px" }}>
        <label
          style={{
            display: "block",
            fontSize: "12px",
            color: "#666",
            marginBottom: "2px",
          }}
        >
          Min: {fmtVal(state.rangeMin, state.selected)} {state.selected.units}
          <input
            type="range"
            min={state.selected.dataMin}
            max={state.selected.dataMax}
            step={1}
            value={state.rangeMin}
            onChange={(e) =>
              state.setRangeMin(
                Math.min(parseFloat(e.target.value), state.rangeMax - 1),
              )
            }
            style={{ width: "100%", cursor: "pointer" }}
          />
        </label>
      </div>

      {/* Max slider */}
      <div style={{ marginBottom: "8px" }}>
        <label
          style={{
            display: "block",
            fontSize: "12px",
            color: "#666",
            marginBottom: "2px",
          }}
        >
          Max: {fmtVal(state.rangeMax, state.selected)} {state.selected.units}
          <input
            type="range"
            min={state.selected.dataMin}
            max={state.selected.dataMax}
            step={1}
            value={state.rangeMax}
            onChange={(e) =>
              state.setRangeMax(
                Math.max(parseFloat(e.target.value), state.rangeMin + 1),
              )
            }
            style={{ width: "100%", cursor: "pointer" }}
          />
        </label>
      </div>

      {/* Auto-scale button */}
      <div style={{ marginBottom: "12px" }}>
        <button
          type="button"
          onClick={state.applyAutoScale}
          disabled={state.pendingAutoScale === null}
          style={{
            width: "100%",
            padding: "6px 12px",
            fontSize: "12px",
            cursor: state.pendingAutoScale === null ? "default" : "pointer",
            background: "#f0f0f0",
            border: "1px solid #ccc",
            borderRadius: "4px",
            opacity: state.pendingAutoScale === null ? 0.5 : 1,
          }}
        >
          Auto-scale
        </button>
      </div>

      {/* Basemap toggle */}
      <div style={{ marginBottom: "12px" }}>
        <button
          type="button"
          onClick={onToggleBasemap}
          style={{
            width: "100%",
            padding: "6px 12px",
            fontSize: "12px",
            cursor: "pointer",
            background: "#f0f0f0",
            border: "1px solid #ccc",
            borderRadius: "4px",
          }}
        >
          {basemap === "dark"
            ? "Switch to satellite basemap"
            : "Switch to dark basemap"}
        </button>
      </div>

      {/* Opacity slider */}
      <div style={{ marginBottom: "12px" }}>
        <label
          style={{
            display: "block",
            fontSize: "12px",
            color: "#666",
            marginBottom: "2px",
          }}
        >
          Data Opacity: {Math.round(state.dataOpacity * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.dataOpacity}
            onChange={(e) => state.setDataOpacity(parseFloat(e.target.value))}
            style={{ width: "100%", cursor: "pointer" }}
          />
        </label>
      </div>

      {/* Colormap gradient with min/max labels */}
      <div
        style={{
          height: "12px",
          borderRadius: "2px",
          background:
            "linear-gradient(to right, #440154, #3b528b, #21918c, #5ec962, #b5de2b, #fde725)",
          marginBottom: "4px",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "11px",
          color: "#999",
          marginBottom: "12px",
        }}
      >
        <span>{fmtVal(state.rangeMin, state.selected)}</span>
        <span>{state.selected.units}</span>
        <span>{fmtVal(state.rangeMax, state.selected)}</span>
      </div>

      {/* Match scale button — right panel in compare mode only */}
      {compareMode && isRight && (
        <div style={{ marginBottom: "12px" }}>
          <button
            type="button"
            onClick={onMatchScale}
            disabled={!matchScaleEnabled}
            title={
              matchScaleEnabled
                ? undefined
                : "Sources must have the same units to match scale"
            }
            style={{
              width: "100%",
              padding: "6px 12px",
              fontSize: "12px",
              cursor: matchScaleEnabled ? "pointer" : "default",
              background: "#f0f0f0",
              border: "1px solid #ccc",
              borderRadius: "4px",
              opacity: matchScaleEnabled ? 1 : 0.5,
            }}
          >
            ← Match scale
          </button>
        </div>
      )}

      <p style={{ margin: 0, fontSize: "11px", color: "#999" }}>
        Data:{" "}
        <a
          href="https://source.coop/luddaludwig/boreal-fire-carbon"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#666" }}
        >
          source.coop
        </a>
        {" | "}
        Rendered with{" "}
        <a
          href="https://github.com/developmentseed/deck.gl-raster"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#666", fontFamily: "monospace", fontSize: "10px" }}
        >
          deck.gl-raster
        </a>
      </p>
    </div>
  );
}
