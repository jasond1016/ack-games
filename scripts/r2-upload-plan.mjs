export function createR2UploadPlan(manifest) {
  return Object.values(manifest).flatMap((entry) => {
    if (!entry.objectKey || !entry.previewObjectKey) {
      throw new Error("Every racing model manifest entry requires objectKey and previewObjectKey.");
    }
    return [
      { objectKey: entry.objectKey, bytes: entry.bytes, sha256: entry.sha256 },
      { objectKey: entry.previewObjectKey, bytes: entry.previewBytes, sha256: entry.previewSha256 }
    ];
  });
}
