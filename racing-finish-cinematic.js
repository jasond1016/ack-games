import * as THREE from "three";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/loaders/DRACOLoader.js";
import { disposeRenderer, disposeSceneResources } from "./racing-resource-cleanup.mjs";

const dracoDecoderPath = "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/draco/";
const roadTopY = .205;
const tireClearance = .035;
const groundCarY = roadTopY + tireClearance;
const rampCenterX = -6.5;
const rampCenterY = 1.34;
const rampHalfThickness = .125;
const rampAngle = Math.PI / 12;
const launchX = -2.2;
const halfWheelbase = 1.55;

function rampTopYAt(x) {
  const localX = (x - rampCenterX + rampHalfThickness * Math.sin(rampAngle)) / Math.cos(rampAngle);
  return rampCenterY + localX * Math.sin(rampAngle) + rampHalfThickness * Math.cos(rampAngle);
}

const rampEntryLocalX = (roadTopY - rampCenterY - rampHalfThickness * Math.cos(rampAngle)) / Math.sin(rampAngle);
const rampEntryX = rampCenterX + rampEntryLocalX * Math.cos(rampAngle) - rampHalfThickness * Math.sin(rampAngle);
const launchCarY = rampTopYAt(launchX) + tireClearance;

function takeoffSurfaceYAt(x) {
  return x <= rampEntryX ? roadTopY : rampTopYAt(x);
}

export function createRacingFinishCinematic({ overlay, canvas }) {
  let renderer = null;
  let scene = null;
  let camera = null;
  let carPivot = null;
  let dust = [];
  let frameId = 0;
  let startedAt = 0;
  let runToken = 0;
  let resizeObserver = null;

  async function start({ carConfig }) {
    stop();
    const token = ++runToken;
    overlay.classList.remove("is-result-visible", "is-cinematic-complete", "is-slowmo");
    initializeScene();
    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(overlay);
    startedAt = performance.now();
    frameId = requestAnimationFrame(render);

    const model = await loadCar(carConfig).catch(() => createFallbackCar(carConfig?.accentColor));
    if (token !== runToken || !scene) {
      disposeSceneResources(model);
      return;
    }
    carPivot = model;
    scene.add(carPivot);
  }

  function initializeScene() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .95;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x91a9b4);
    scene.fog = new THREE.Fog(0x91a9b4, 24, 66);
    camera = new THREE.PerspectiveCamera(42, 1, .1, 140);
    camera.position.set(-2, 5.2, 18);

    scene.add(new THREE.HemisphereLight(0xd8edff, 0x5e4633, 2.1));
    const sun = new THREE.DirectionalLight(0xffe1bd, 4.5);
    sun.position.set(-10, 18, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -28;
    sun.shadow.camera.right = 28;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -8;
    scene.add(sun);
    createEnvironment();
  }

  function createEnvironment() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 55),
      new THREE.MeshStandardMaterial({ color: 0x697d5b, roughness: .96 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.05;
    ground.receiveShadow = true;
    scene.add(ground);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x292d30, roughness: .86 });
    const road = new THREE.Mesh(new THREE.BoxGeometry(62, .25, 7), roadMaterial);
    road.position.set(14, .08, 0);
    road.receiveShadow = true;
    scene.add(road);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(10, .25, 7), roadMaterial);
    ramp.position.set(rampCenterX, rampCenterY, 0);
    ramp.rotation.z = rampAngle;
    ramp.receiveShadow = true;
    scene.add(ramp);
    const approach = new THREE.Mesh(new THREE.BoxGeometry(19, .25, 7), roadMaterial);
    approach.position.set(-20.5, .08, 0);
    approach.receiveShadow = true;
    scene.add(approach);

    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e2cf, roughness: .7 });
    for (const z of [-3.25, 3.25]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(70, .08, .16), edgeMaterial);
      edge.position.set(8, .25, z);
      scene.add(edge);
    }
    for (let x = -29; x < 45; x += 4) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2, .03, .13), edgeMaterial);
      stripe.position.set(x, .27, 0);
      scene.add(stripe);
    }

    const mountainMaterial = new THREE.MeshStandardMaterial({ color: 0x60746f, roughness: 1, flatShading: true });
    for (let index = 0; index < 10; index += 1) {
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(7 + index % 3 * 2, 12 + index % 4 * 2, 5), mountainMaterial);
      mountain.position.set(-42 + index * 11, 4, -25 - index % 2 * 6);
      mountain.rotation.y = index * .7;
      scene.add(mountain);
    }
    for (let index = 0; index < 34; index += 1) {
      const height = 2.8 + index % 5 * .45;
      const tree = new THREE.Mesh(
        new THREE.ConeGeometry(.7 + index % 3 * .15, height, 7),
        new THREE.MeshStandardMaterial({ color: index % 2 ? 0x405b45 : 0x50694c, roughness: 1 })
      );
      tree.position.set(-45 + index * 3.2, height / 2, -8 - index % 4 * 2.5);
      scene.add(tree);
    }
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(3.8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffd0a0, fog: false })
    );
    sunDisc.position.set(-25, 13, -34);
    scene.add(sunDisc);

    const dustGeometry = new THREE.IcosahedronGeometry(.12, 0);
    for (let index = 0; index < 22; index += 1) {
      const puff = new THREE.Mesh(
        dustGeometry,
        new THREE.MeshBasicMaterial({ color: 0xd8c8aa, transparent: true, opacity: .55 })
      );
      puff.visible = false;
      scene.add(puff);
      dust.push(puff);
    }
  }

  async function loadCar(carConfig) {
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(dracoDecoderPath);
    loader.setDRACOLoader(dracoLoader);
    try {
      const gltf = await loader.loadAsync(carConfig.modelUrl);
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = carConfig.targetLength / Math.max(size.x, size.z);
      model.scale.setScalar(scale);
      model.rotation.y = THREE.MathUtils.degToRad((carConfig.modelRotationDegrees ?? 0) + 90);
      const scaledBox = new THREE.Box3().setFromObject(model);
      const center = scaledBox.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -scaledBox.min.y, -center.z);
      model.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      const pivot = new THREE.Group();
      pivot.add(model);
      return pivot;
    } finally {
      dracoLoader.dispose();
    }
  }

  function createFallbackCar(accentColor = "#d64545") {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, .75, 1.9),
      new THREE.MeshStandardMaterial({ color: accentColor, metalness: .5, roughness: .25 })
    );
    body.position.y = .7;
    body.castShadow = true;
    group.add(body);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(2, .65, 1.55),
      new THREE.MeshStandardMaterial({ color: 0x18232b, metalness: .3, roughness: .18 })
    );
    cabin.position.set(-.25, 1.35, 0);
    group.add(cabin);
    return group;
  }

  function render(now) {
    if (!renderer || !scene || !camera) return;
    const time = Math.min((now - startedAt) / 1000, 8.4);
    if (carPivot) updateCar(time);
    updateDust(time);
    overlay.classList.toggle("is-slowmo", time >= 1.8 && time < 5.25);
    overlay.classList.toggle("is-result-visible", time >= 2.2);
    overlay.classList.toggle("is-cinematic-complete", time >= 6.9);
    renderer.render(scene, camera);
    if (time < 8.4) frameId = requestAnimationFrame(render);
  }

  function updateCar(time) {
    let x;
    let y;
    let angle;
    if (time < 1.8) {
      const progress = time / 1.8;
      x = -25 + 22.8 * progress;
      const rearSurfaceY = takeoffSurfaceYAt(x - halfWheelbase);
      const frontSurfaceY = takeoffSurfaceYAt(x + halfWheelbase);
      y = (rearSurfaceY + frontSurfaceY) / 2 + tireClearance;
      angle = Math.atan2(frontSurfaceY - rearSurfaceY, halfWheelbase * 2);
    } else if (time < 5.25) {
      const progress = (time - 1.8) / 3.45;
      x = launchX + 13.7 * progress;
      y = launchCarY + 5.2 * 4 * progress * (1 - progress);
      angle = rampAngle - progress * .43;
    } else if (time < 6.4) {
      const progress = (time - 5.25) / 1.15;
      const settle = progress * progress * (3 - 2 * progress);
      x = 11.5 + 4.8 * progress;
      y = groundCarY + (launchCarY - groundCarY) * (1 - progress) * (1 - progress);
      angle = THREE.MathUtils.lerp(rampAngle - .43, 0, settle);
    } else {
      const progress = (time - 6.4) / 2;
      x = 16.3 + 26.4 * progress * progress;
      y = groundCarY;
      angle = 0;
    }
    carPivot.position.set(x, y, .05);
    carPivot.rotation.z = angle;

    const desiredX = time < 1.8
      ? THREE.MathUtils.lerp(-8, -1, time / 1.8)
      : time < 6.4
        ? THREE.MathUtils.lerp(-1, 7.5, (time - 1.8) / 4.6)
        : THREE.MathUtils.lerp(7.5, 18, (time - 6.4) / 2);
    camera.position.x += (desiredX - camera.position.x) * .035;
    const airborne = time >= 1.8 && time < 5.25;
    camera.position.y += ((airborne ? 7.3 : 5.1) - camera.position.y) * .035;
    camera.lookAt(camera.position.x + 1.4, airborne ? 5.25 : 2.15, 0);
  }

  function updateDust(time) {
    const active = time > 6.12 && time < 7.15;
    dust.forEach((puff, index) => {
      puff.visible = active;
      if (!active) return;
      const age = ((time - 6.12) * 1.7 + index * .12) % 1;
      puff.position.set(15.1 + (time - 6.12) * 6.4 - index * .2, groundCarY + age * 1.1, (index % 5 - 2) * .35);
      puff.scale.setScalar(.4 + age * 2.4);
      puff.material.opacity = (1 - age) * .38;
    });
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = Math.max(1, overlay.clientWidth);
    const height = Math.max(1, overlay.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function stop() {
    runToken += 1;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    resizeObserver?.disconnect();
    resizeObserver = null;
    overlay.classList.remove("is-result-visible", "is-cinematic-complete", "is-slowmo");
    carPivot = null;
    dust = [];
    if (scene) disposeSceneResources(scene);
    scene = null;
    camera = null;
    if (renderer) disposeRenderer(renderer);
    renderer = null;
  }

  return { start, stop, destroy: stop };
}
