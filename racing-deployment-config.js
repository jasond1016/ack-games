export const racingDeploymentConfig = Object.freeze({
  modelAssetBaseUrl: new URL("./assets/cars-optimized/", import.meta.url).href,
  previewModelAssetBaseUrl: new URL("./assets/cars-preview-optimized/", import.meta.url).href,
  modelAssetVersion: null,
  useHashedModelAssets: false
});
