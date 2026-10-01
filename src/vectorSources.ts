export type VectorSource = {
  id: string;
  file: string;
  geomType: "line" | "polygon";
  color: [number, number, number, number];
  width?: number;
};

export const VECTOR_SOURCES: VectorSource[] = [
  {
    id: "highway",
    file: "highway.fgb",
    geomType: "line",
    color: [255, 200, 0, 200],
    width: 2,
  },
  {
    id: "road",
    file: "road.fgb",
    geomType: "line",
    color: [200, 200, 200, 180],
    width: 1,
  },
  {
    id: "trail",
    file: "trail.fgb",
    geomType: "line",
    color: [180, 120, 60, 180],
    width: 1,
  },
  {
    id: "railroad",
    file: "railroad.fgb",
    geomType: "line",
    color: [160, 160, 220, 180],
    width: 1.5,
  },
  {
    id: "place",
    file: "place.fgb",
    geomType: "polygon",
    color: [100, 150, 200, 38],
  },
];
