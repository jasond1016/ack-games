import test from "node:test";
import assert from "node:assert/strict";

import {
  disposeObject3DTree,
  disposePhysicsState,
  disposeRenderer,
  disposeSceneResources,
  markMaterialsOnlyDispose
} from "../racing-resource-cleanup.mjs";

function createNode({ geometry = null, material = null, children = [], userData = {} } = {}) {
  const node = {
    geometry,
    material,
    children: [],
    userData,
    parent: null,
    removeFromParent() {
      if (!this.parent) {
        return;
      }

      const index = this.parent.children.indexOf(this);
      if (index >= 0) {
        this.parent.children.splice(index, 1);
      }
      this.parent = null;
    }
  };

  for (const child of children) {
    child.parent = node;
    node.children.push(child);
  }

  return node;
}

function createGeometry() {
  return {
    disposed: 0,
    dispose() {
      this.disposed += 1;
    }
  };
}

function createTexture() {
  return {
    isTexture: true,
    disposed: 0,
    dispose() {
      this.disposed += 1;
    }
  };
}

function createMaterial(texture = null) {
  return {
    map: texture,
    disposed: 0,
    dispose() {
      this.disposed += 1;
    }
  };
}

test("disposeObject3DTree keeps shared template geometry and textures intact for materials-only subtrees", () => {
  const sharedGeometry = createGeometry();
  const sharedTexture = createTexture();
  const clonedMaterial = createMaterial(sharedTexture);
  const templateClone = createNode({
    geometry: sharedGeometry,
    material: clonedMaterial
  });
  markMaterialsOnlyDispose(templateClone);

  const sceneOwnedGeometry = createGeometry();
  const sceneOwnedTexture = createTexture();
  const sceneOwnedMaterial = createMaterial(sceneOwnedTexture);
  const ownedMesh = createNode({
    geometry: sceneOwnedGeometry,
    material: sceneOwnedMaterial
  });

  const root = createNode({
    children: [templateClone, ownedMesh]
  });

  disposeObject3DTree(root);

  assert.equal(clonedMaterial.disposed, 1);
  assert.equal(sharedGeometry.disposed, 0);
  assert.equal(sharedTexture.disposed, 0);

  assert.equal(sceneOwnedGeometry.disposed, 1);
  assert.equal(sceneOwnedMaterial.disposed, 1);
  assert.equal(sceneOwnedTexture.disposed, 1);
  assert.equal(root.children.length, 0);
});

test("disposeSceneResources releases environment textures and clears the scene", () => {
  const environment = createTexture();
  const background = createTexture();
  const mesh = createNode({
    geometry: createGeometry(),
    material: createMaterial(createTexture())
  });
  const scene = createNode({ children: [mesh] });
  scene.environment = environment;
  scene.background = background;
  scene.clear = function clear() {
    this.children = [];
  };

  disposeSceneResources(scene);

  assert.equal(environment.disposed, 1);
  assert.equal(background.disposed, 1);
  assert.equal(scene.environment, null);
  assert.equal(scene.background, null);
  assert.equal(scene.children.length, 0);
});

test("disposeRenderer tears down renderer internals without losing reusable contexts by default", () => {
  const renderer = {
    disposeCalls: 0,
    forceContextLossCalls: 0,
    renderLists: {
      disposeCalls: 0,
      dispose() {
        this.disposeCalls += 1;
      }
    },
    dispose() {
      this.disposeCalls += 1;
    },
    forceContextLoss() {
      this.forceContextLossCalls += 1;
    }
  };

  disposeRenderer(renderer);

  assert.equal(renderer.renderLists.disposeCalls, 1);
  assert.equal(renderer.disposeCalls, 1);
  assert.equal(renderer.forceContextLossCalls, 0);
});

test("disposeRenderer can explicitly lose the context for throwaway canvases", () => {
  const renderer = {
    disposeCalls: 0,
    forceContextLossCalls: 0,
    renderLists: {
      disposeCalls: 0,
      dispose() {
        this.disposeCalls += 1;
      }
    },
    dispose() {
      this.disposeCalls += 1;
    },
    forceContextLoss() {
      this.forceContextLossCalls += 1;
    }
  };

  disposeRenderer(renderer, { loseContext: true });

  assert.equal(renderer.renderLists.disposeCalls, 1);
  assert.equal(renderer.disposeCalls, 1);
  assert.equal(renderer.forceContextLossCalls, 1);
});

test("disposePhysicsState frees rapier resources and clears live handles", () => {
  const physics = {
    colliderTags: new Map([[1, "player"]]),
    eventQueue: {
      freeCalls: 0,
      free() {
        this.freeCalls += 1;
      }
    },
    world: {
      freeCalls: 0,
      free() {
        this.freeCalls += 1;
      }
    },
    playerBody: {},
    playerCollider: {},
    opponentBody: {},
    opponentCollider: {}
  };

  disposePhysicsState(physics);

  assert.equal(physics.colliderTags.size, 0);
  assert.equal(physics.eventQueue.freeCalls, 1);
  assert.equal(physics.world.freeCalls, 1);
  assert.equal(physics.playerBody, null);
  assert.equal(physics.playerCollider, null);
  assert.equal(physics.opponentBody, null);
  assert.equal(physics.opponentCollider, null);
});
