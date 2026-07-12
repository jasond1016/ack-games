import assert from "node:assert/strict";
import test from "node:test";
import { createR2UploadPlan } from "../scripts/r2-upload-plan.mjs";

test("R2 upload plan includes both race and preview model objects", () => {
  const plan = createR2UploadPlan({
    aventador: {
      objectKey: "cars/aventador.full.glb",
      previewObjectKey: "cars/previews/aventador.preview.glb",
      bytes: 10,
      previewBytes: 5,
      sha256: "full-hash",
      previewSha256: "preview-hash"
    }
  });

  assert.deepEqual(plan, [
    { objectKey: "cars/aventador.full.glb", bytes: 10, sha256: "full-hash" },
    { objectKey: "cars/previews/aventador.preview.glb", bytes: 5, sha256: "preview-hash" }
  ]);
});
