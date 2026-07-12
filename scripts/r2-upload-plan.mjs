export function createR2UploadPlan(manifest) {
  return Object.values(manifest).flatMap((entry) => {
    if (!entry.objectKey || !entry.previewObjectKey) {
      throw new Error("Every racing model manifest entry requires objectKey and previewObjectKey.");
    }
    return [
      { objectKey: entry.objectKey },
      { objectKey: entry.previewObjectKey }
    ];
  });
}
