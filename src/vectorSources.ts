export type VectorSource = {
  id: string;
  label: string;
  file: string;
  geomType: "line" | "polygon";
  color: [number, number, number, number];
  width?: number;
};

export const VECTOR_SOURCES: VectorSource[] = [
  {
    id: "highway",
    label: "Highway",
    file: "highway.fgb",
    geomType: "line",
    color: [255, 200, 0, 200],
    width: 2,
  },
  {
    id: "road",
    label: "Road",
    file: "road.fgb",
    geomType: "line",
    color: [200, 200, 200, 180],
    width: 1,
  },
  {
    id: "trail",
    label: "Trail",
    file: "trail.fgb",
    geomType: "line",
    color: [180, 120, 60, 180],
    width: 1,
  },
  {
    id: "railroad",
    label: "Railroad",
    file: "railroad.fgb",
    geomType: "line",
    color: [160, 160, 220, 180],
    width: 1.5,
  },
  {
    id: "place",
    label: "Urban",
    file: "place.fgb",
    geomType: "polygon",
    color: [100, 150, 200, 90],
  },
];
