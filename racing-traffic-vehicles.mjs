/**
 * Coastal free-cruise civilian traffic vehicles (not garage cars).
 */

function modelUrl(fileName) {
  return new URL(`./assets/freedrive/models/${fileName}`, import.meta.url).href;
}

export const TRAFFIC_CRUISE_SPEED_BAND_KMH = Object.freeze({
  min: 48,
  max: 72
});

/** Spawn progress along the track loop (0–1), spaced to avoid clustering. */
export const TRAFFIC_SPAWN_PROGRESS = Object.freeze([0.14, 0.37, 0.61, 0.84]);

export const TRAFFIC_VEHICLE_CATALOG = Object.freeze([
  Object.freeze({
    id: "traffic-sedan",
    typeId: "sedan",
    label: "Sedan",
    modelFile: "traffic-sedan-lod0.glb",
    modelUrl: modelUrl("traffic-sedan-lod0.glb"),
    sourceUrl: "https://poly.pizza/m/Cz6yDaUcM9",
    author: "Quaternius",
    license: "CC0",
    substituteNote: null,
    targetLength: 4.4,
    cruiseSpeedKmh: 68,
    collider: Object.freeze({ halfWidth: 0.92, halfHeight: 0.42, halfLength: 2.15 }),
    tint: 0x2f5e8d
  }),
  Object.freeze({
    id: "traffic-suv",
    typeId: "suv",
    label: "SUV",
    modelFile: "traffic-suv-lod0.glb",
    modelUrl: modelUrl("traffic-suv-lod0.glb"),
    sourceUrl: "https://poly.pizza/m/xsMtZhBkxL",
    author: "Quaternius",
    license: "CC0",
    substituteNote: null,
    targetLength: 4.7,
    cruiseSpeedKmh: 58,
    collider: Object.freeze({ halfWidth: 1.02, halfHeight: 0.58, halfLength: 2.35 }),
    tint: 0xd8d6ce
  }),
  Object.freeze({
    id: "traffic-mini",
    typeId: "mini",
    label: "Hatchback",
    modelFile: "traffic-mini-lod0.glb",
    modelUrl: modelUrl("traffic-mini-lod0.glb"),
    sourceUrl: "https://poly.pizza/m/BG0KAhmGDt",
    author: "Kay Lousberg",
    license: "CC0",
    substituteNote: "Mini Cooper stand-in: Kay Lousberg hatchback (small two-box civilian)",
    targetLength: 3.6,
    cruiseSpeedKmh: 62,
    collider: Object.freeze({ halfWidth: 0.78, halfHeight: 0.4, halfLength: 1.75 }),
    tint: 0x9b2533
  }),
  Object.freeze({
    id: "traffic-truck",
    typeId: "truck",
    label: "Pickup",
    modelFile: "traffic-truck-lod0.glb",
    modelUrl: modelUrl("traffic-truck-lod0.glb"),
    sourceUrl: "https://poly.pizza/m/qn4grQgHm8",
    author: "Quaternius",
    license: "CC0",
    substituteNote: "Truck stand-in: Quaternius pickup (light truck / ute silhouette)",
    targetLength: 5.1,
    cruiseSpeedKmh: 50,
    collider: Object.freeze({ halfWidth: 1.08, halfHeight: 0.68, halfLength: 2.65 }),
    tint: 0x33383c
  })
]);

export function listTrafficVehicleTypeIds() {
  return TRAFFIC_VEHICLE_CATALOG.map(({ typeId }) => typeId);
}

export function createTrafficCarSpec(entry) {
  return Object.freeze({
    id: entry.id,
    make: "Traffic",
    name: entry.label,
    modelUrl: entry.modelUrl,
    previewModelUrl: entry.modelUrl,
    modelRotationDegrees: 0,
    targetLength: entry.targetLength,
    defaultPaintColor: null,
    boostExhausts: Object.freeze([])
  });
}

export function resolveTrafficCatalogCruiseSpeedMps(entry) {
  const kmh = clamp(
    Number(entry?.cruiseSpeedKmh) || TRAFFIC_CRUISE_SPEED_BAND_KMH.min,
    TRAFFIC_CRUISE_SPEED_BAND_KMH.min,
    TRAFFIC_CRUISE_SPEED_BAND_KMH.max
  );
  return kmh / 3.6;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
