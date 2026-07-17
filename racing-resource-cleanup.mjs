export const DISPOSE_MODE_FULL = "full";
export const DISPOSE_MODE_MATERIALS_ONLY = "materials-only";

export function markMaterialsOnlyDispose(root) {
  if (!root) {
    return root;
  }

  root.userData = root.userData || {};
  root.userData.disposeMode = DISPOSE_MODE_MATERIALS_ONLY;
  return root;
}

export function disposeSceneResources(scene) {
  if (!scene) {
    return;
  }

  const seenGeometries = new Set();
  const seenMaterials = new Set();
  const seenTextures = new Set();

  disposeTexture(scene.environment, seenTextures);
  if (scene.background && scene.background !== scene.environment) {
    disposeTexture(scene.background, seenTextures);
  }

  disposeObject3DTree(scene, {
    inheritedMode: DISPOSE_MODE_FULL,
    seenGeometries,
    seenMaterials,
    seenTextures
  });

  if (typeof scene.clear === "function") {
    scene.clear();
  }

  scene.environment = null;
  if (scene.background?.isTexture) {
    scene.background = null;
  }
}

export function disposeObject3DTree(
  object3d,
  {
    inheritedMode = DISPOSE_MODE_FULL,
    seenGeometries = new Set(),
    seenMaterials = new Set(),
    seenTextures = new Set()
  } = {}
) {
  if (!object3d) {
    return;
  }

  const disposeMode = object3d.userData?.disposeMode ?? inheritedMode;
  const children = Array.isArray(object3d.children) ? [...object3d.children] : [];

  for (const child of children) {
    disposeObject3DTree(child, {
      inheritedMode: disposeMode,
      seenGeometries,
      seenMaterials,
      seenTextures
    });
  }

  if (disposeMode === DISPOSE_MODE_FULL) {
    disposeGeometry(object3d.geometry, seenGeometries);
  }

  disposeMaterialValue(object3d.material, disposeMode, seenMaterials, seenTextures);

  if (typeof object3d.removeFromParent === "function") {
    object3d.removeFromParent();
  } else if (object3d.parent?.remove) {
    object3d.parent.remove(object3d);
  }
}

export function disposeRenderer(renderer, { loseContext = false } = {}) {
  if (!renderer) {
    return;
  }

  if (renderer.renderLists?.dispose) {
    renderer.renderLists.dispose();
  }
  renderer.dispose?.();
  if (loseContext) {
    renderer.forceContextLoss?.();
  }
}

export function disposePhysicsState(physics) {
  if (!physics) {
    return;
  }

  if (physics.playerVehicle?.controller) {
    physics.world?.removeVehicleController?.(physics.playerVehicle.controller);
    physics.playerVehicle = null;
  }
  physics.colliderTags?.clear?.();
  physics.eventQueue?.free?.();
  physics.world?.free?.();

  physics.playerBody = null;
  physics.playerCollider = null;
  physics.opponentBody = null;
  physics.opponentCollider = null;
}

function disposeGeometry(geometry, seenGeometries) {
  if (!geometry || seenGeometries.has(geometry)) {
    return;
  }

  seenGeometries.add(geometry);
  geometry.dispose?.();
}

function disposeMaterialValue(materialValue, disposeMode, seenMaterials, seenTextures) {
  if (Array.isArray(materialValue)) {
    for (const material of materialValue) {
      disposeMaterial(material, disposeMode, seenMaterials, seenTextures);
    }
    return;
  }

  disposeMaterial(materialValue, disposeMode, seenMaterials, seenTextures);
}

function disposeMaterial(material, disposeMode, seenMaterials, seenTextures) {
  if (!material || seenMaterials.has(material)) {
    return;
  }

  seenMaterials.add(material);

  if (disposeMode === DISPOSE_MODE_FULL) {
    for (const value of Object.values(material)) {
      disposeTexture(value, seenTextures);
    }
  }

  material.dispose?.();
}

function disposeTexture(texture, seenTextures) {
  if (!texture?.isTexture || seenTextures.has(texture)) {
    return;
  }

  seenTextures.add(texture);
  texture.dispose?.();
}
