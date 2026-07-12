import assert from "node:assert/strict";
import test from "node:test";
import { createR2UploadPlan } from "../scripts/r2-upload-plan.mjs";

test("R2 upload plan includes both race and preview model objects", () => {
  const plan = createR2UploadPlan({
    aventador: {
      objectKey: "cars/aventador.full.glb",
      previewObjectKey: "cars/previews/aventador.preview.glb"
    }
  });

  assert.deepEqual(plan, [
    { objectKey: "cars/aventador.full.glb" },
    { objectKey: "cars/previews/aventador.preview.glb" }
  ]);
});
