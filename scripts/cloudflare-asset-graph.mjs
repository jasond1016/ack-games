export const cloudflarePagesAssetGraph = Object.freeze({
  pages: Object.freeze({
    files: Object.freeze([
      "index.html", "styles.css", "game.js", "game-lifecycle.mjs",
      "vacuum-game.js", "typing-garage-game.js", "bus-rush-prototype.js",
      "racing-car-config.js", "racing-editor.js",
      "racing-finish-cinematic.js", "racing-game.js", "racing-map-library-core.mjs",
      "racing-map-select.js", "racing-map.js",
      "racing-resource-cleanup.mjs", "racing-resource-leases.mjs",
      "racing-runtime-adapters.mjs", "racing-session.mjs", "racing-start-config.js",
      "racing-track.mjs"
    ]),
    directories: Object.freeze(["assets/typing-garage"]),
    generated: Object.freeze(["racing-model-manifest.js", "racing-deployment-config.js", "_headers"]),
    limits: Object.freeze({ maxFiles: 20_000, maxFileBytes: 25 * 1024 * 1024 })
  })
});

export function createCloudflareAssetGraph(racingCarCatalog) {
  return Object.freeze({
    pages: cloudflarePagesAssetGraph.pages,
    cars: Object.freeze(racingCarCatalog.map((car) => Object.freeze({
    id: car.id,
    modelSourcePath: car.modelSourcePath,
    thumbnailSource: `assets/car-thumbnails/${car.id}.webp`
    })))
  });
}

export function createCloudflareBuildPlan(graph) {
  const targets = new Set();
  for (const file of [...graph.pages.files, ...graph.pages.generated]) {
    if (targets.has(file)) throw new Error(`Duplicate Pages target: ${file}`);
    targets.add(file);
  }
  const carIds = new Set();
  for (const car of graph.cars) {
    if (carIds.has(car.id)) throw new Error(`Duplicate racing car id: ${car.id}`);
    carIds.add(car.id);
  }
  return Object.freeze({ pagesFiles: [...graph.pages.files], pagesDirectories: [...graph.pages.directories], cars: [...graph.cars] });
}
