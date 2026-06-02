import * as THREE from "three";
import {
  createObstacleFromPrefab,
  exportRacingMap,
  getObstaclePrefab,
  getDefaultRacingMap,
  importRacingMap,
  loadActiveRacingMap,
  racingObstaclePrefabs,
  racingTrackShapeConfig,
  resetActiveRacingMap,
  saveActiveRacingMap
} from "./racing-map.js";

export function createRacingEditor({ onPlay, onMapChanged } = {}) {
  const canvas = document.getElementById("racingEditorCanvas");
  const ctx = canvas.getContext("2d");
  const mapNameInput = document.getElementById("racingEditorMapName");
  const statusValue = document.getElementById("racingEditorStatusValue");
  const pointsValue = document.getElementById("racingEditorPointsValue");
  const obstaclesValue = document.getElementById("racingEditorObstaclesValue");
  const selectionValue = document.getElementById("racingEditorSelectionValue");
  const modeButtons = Array.from(document.querySelectorAll("[data-editor-mode]"));
  const prefabButtons = Array.from(document.querySelectorAll("[data-obstacle-type]"));
  const deleteButton = document.getElementById("racingEditorDeleteButton");
  const duplicateButton = document.getElementById("racingEditorDuplicateButton");
  const applyButton = document.getElementById("racingEditorApplyButton");
  const resetButton = document.getElementById("racingEditorResetButton");
  const exportButton = document.getElementById("racingEditorExportButton");
  const importButton = document.getElementById("racingEditorImportButton");
  const importInput = document.getElementById("racingEditorImportInput");
  const jsonValue = document.getElementById("racingEditorJsonValue");

  const pointRadius = 8;
  const obstacleHandlePadding = 10;
  const nudgeStep = 0.8;
  const rotationStep = Math.PI / 36;
  const resizeFactor = 1.08;

  let active = false;
  let listening = false;
  let mapData = getDefaultRacingMap();
  let previewSamples = [];
  let viewport = null;
  let editorMode = "track";
  let selectedObstacleType = racingObstaclePrefabs[0].type;
  let selectedPointIndex = 0;
  let selectedObstacleId = null;
  let dragState = null;

  function start() {
    active = true;
    mapData = loadActiveRacingMap();
    previewSamples = buildTrackPreview(mapData);
    selectedPointIndex = 0;
    selectedObstacleId = null;
    dragState = null;
    syncControlsFromMap();
    addListeners();
    resizeCanvas();
    setStatus("拖动控制点或放置障碍。");
  }

  function stop() {
    active = false;
    dragState = null;
    removeListeners();
  }

  function destroy() {
    stop();
  }

  function addListeners() {
    if (listening) {
      return;
    }

    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);
    mapNameInput.addEventListener("change", handleNameCommit);
    deleteButton.addEventListener("click", handleDelete);
    duplicateButton.addEventListener("click", handleDuplicate);
    applyButton.addEventListener("click", handleApply);
    resetButton.addEventListener("click", handleReset);
    exportButton.addEventListener("click", handleExport);
    importButton.addEventListener("click", handleImportClick);
    importInput.addEventListener("change", handleImportFile);

    for (const button of modeButtons) {
      button.addEventListener("click", handleModeClick);
    }

    for (const button of prefabButtons) {
      button.addEventListener("click", handlePrefabClick);
    }

    listening = true;
  }

  function removeListeners() {
    if (!listening) {
      return;
    }

    window.removeEventListener("resize", resizeCanvas);
    window.removeEventListener("keydown", handleKeyDown);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointerleave", handlePointerUp);
    mapNameInput.removeEventListener("change", handleNameCommit);
    deleteButton.removeEventListener("click", handleDelete);
    duplicateButton.removeEventListener("click", handleDuplicate);
    applyButton.removeEventListener("click", handleApply);
    resetButton.removeEventListener("click", handleReset);
    exportButton.removeEventListener("click", handleExport);
    importButton.removeEventListener("click", handleImportClick);
    importInput.removeEventListener("change", handleImportFile);

    for (const button of modeButtons) {
      button.removeEventListener("click", handleModeClick);
    }

    for (const button of prefabButtons) {
      button.removeEventListener("click", handlePrefabClick);
    }

    listening = false;
  }

  function resizeCanvas() {
    if (!active) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const width = Math.max(720, Math.round((rect.width || 960) * dpr));
    const height = Math.max(480, Math.round((rect.height || 680) * dpr));
    canvas.width = width;
    canvas.height = height;
    render();
  }

  function handleNameCommit() {
    mapData.name = mapNameInput.value.trim() || "未命名赛道";
    commitMap("已更新地图名称。");
  }

  function handleModeClick(event) {
    const nextMode = event.currentTarget.dataset.editorMode;
    if (!nextMode) {
      return;
    }

    editorMode = nextMode;
    if (editorMode === "track") {
      selectedObstacleId = null;
    }
    syncUiState();
    render();
  }

  function handlePrefabClick(event) {
    const nextType = event.currentTarget.dataset.obstacleType;
    if (!nextType) {
      return;
    }

    editorMode = "obstacle";
    selectedObstacleType = nextType;
    syncUiState();
  }

  function handleDelete() {
    if (editorMode === "track") {
      deleteSelectedPoint();
    } else {
      deleteSelectedObstacle();
    }
  }

  function handleDuplicate() {
    if (editorMode !== "obstacle") {
      return;
    }

    const obstacle = selectedObstacle();
    if (!obstacle) {
      return;
    }

    const copy = {
      ...obstacle,
      id: createObstacleFromPrefab(obstacle.type).id,
      x: obstacle.x + 3,
      z: obstacle.z + 3
    };
    mapData.obstacles.push(copy);
    selectedObstacleId = copy.id;
    commitMap("已复制障碍。");
  }

  function handleApply() {
    commitMap("已应用到赛车。");
    onPlay?.();
  }

  function handleReset() {
    mapData = resetActiveRacingMap();
    previewSamples = buildTrackPreview(mapData);
    selectedPointIndex = 0;
    selectedObstacleId = null;
    syncControlsFromMap();
    onMapChanged?.();
    setStatus("已恢复默认地图。");
  }

  async function handleExport() {
    const text = exportRacingMap(mapData);
    jsonValue.value = text;

    try {
      await navigator.clipboard.writeText(text);
      setStatus("地图 JSON 已复制到剪贴板。");
    } catch (error) {
      console.warn("Failed to copy map JSON.", error);
      setStatus("地图 JSON 已刷新，可手动复制。");
    }
  }

  function handleImportClick() {
    importInput.click();
  }

  async function handleImportFile(event) {
    const [file] = Array.from(event.target.files || []);
    if (!file) {
      return;
    }

    try {
      const imported = importRacingMap(await file.text());
      mapData = imported;
      previewSamples = buildTrackPreview(mapData);
      selectedPointIndex = 0;
      selectedObstacleId = null;
      syncControlsFromMap();
      commitMap("已导入地图文件。");
    } catch (error) {
      console.error("Failed to import racing map.", error);
      setStatus("导入失败，文件格式不正确。");
    } finally {
      importInput.value = "";
    }
  }

  function handlePointerDown(event) {
    if (!active || !viewport) {
      return;
    }

    event.preventDefault();
    const screen = pointerPosition(event);
    const world = screenToWorld(screen.x, screen.y);
    canvas.setPointerCapture(event.pointerId);

    if (editorMode === "track") {
      const pointIndex = findPointAtScreen(screen.x, screen.y);
      if (pointIndex >= 0) {
        selectedPointIndex = pointIndex;
        dragState = {
          type: "point",
          index: pointIndex
        };
        syncUiState();
        render();
        return;
      }

      if (event.shiftKey) {
        const insertIndex = findInsertionIndex(world);
        mapData.track.controlPoints.splice(insertIndex, 0, [roundValue(world.x), roundValue(world.z)]);
        selectedPointIndex = insertIndex;
        previewSamples = buildTrackPreview(mapData);
        dragState = {
          type: "point",
          index: insertIndex
        };
        commitMap("已插入控制点。");
      }

      return;
    }

    const obstacle = findObstacleAtWorld(world);
    if (obstacle) {
      selectedObstacleId = obstacle.id;
      dragState = {
        type: "obstacle",
        id: obstacle.id,
        offsetX: obstacle.x - world.x,
        offsetZ: obstacle.z - world.z
      };
      syncUiState();
      render();
      return;
    }

    const created = createObstacleFromPrefab(selectedObstacleType, roundValue(world.x), roundValue(world.z));
    mapData.obstacles.push(created);
    selectedObstacleId = created.id;
    dragState = {
      type: "obstacle",
      id: created.id,
      offsetX: 0,
      offsetZ: 0
    };
    commitMap(`已放置${getObstaclePrefab(created.type).label}。`);
  }

  function handlePointerMove(event) {
    if (!active || !viewport || !dragState) {
      return;
    }

    const screen = pointerPosition(event);
    const world = screenToWorld(screen.x, screen.y);

    if (dragState.type === "point") {
      const target = mapData.track.controlPoints[dragState.index];
      if (!target) {
        return;
      }

      target[0] = roundValue(world.x);
      target[1] = roundValue(world.z);
      selectedPointIndex = dragState.index;
      previewSamples = buildTrackPreview(mapData);
      syncUiState(false);
      render();
      return;
    }

    const obstacle = selectedObstacle();
    if (!obstacle) {
      return;
    }

    obstacle.x = roundValue(world.x + dragState.offsetX);
    obstacle.z = roundValue(world.z + dragState.offsetZ);
    render();
    syncUiState(false);
  }

  function handlePointerUp(event) {
    if (!active) {
      return;
    }

    if (dragState) {
      commitMap(dragState.type === "point" ? "已更新路线。" : "已更新障碍位置。");
      dragState = null;
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event) {
    if (!active) {
      return;
    }

    if (event.target === mapNameInput) {
      return;
    }

    const movementKey = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code);
    const actionKey = ["Delete", "Backspace", "KeyQ", "KeyE", "KeyR", "KeyF", "Escape"].includes(event.code);
    if (!movementKey && !actionKey && !(event.ctrlKey && event.code === "KeyD")) {
      return;
    }

    event.preventDefault();

    if (event.code === "Escape") {
      clearSelection();
      return;
    }

    if (event.code === "Delete" || event.code === "Backspace") {
      if (editorMode === "track") {
        deleteSelectedPoint();
      } else {
        deleteSelectedObstacle();
      }
      return;
    }

    if (event.ctrlKey && event.code === "KeyD") {
      handleDuplicate();
      return;
    }

    if (editorMode === "track") {
      nudgeSelectedPoint(event.code, event.shiftKey ? nudgeStep * 3 : nudgeStep);
      return;
    }

    if (event.code === "KeyQ") {
      rotateSelectedObstacle(-rotationStep);
      return;
    }

    if (event.code === "KeyE") {
      rotateSelectedObstacle(rotationStep);
      return;
    }

    if (event.code === "KeyR") {
      scaleSelectedObstacle(resizeFactor);
      return;
    }

    if (event.code === "KeyF") {
      scaleSelectedObstacle(1 / resizeFactor);
      return;
    }

    nudgeSelectedObstacle(event.code, event.shiftKey ? nudgeStep * 3 : nudgeStep);
  }

  function syncControlsFromMap() {
    mapNameInput.value = mapData.name;
    jsonValue.value = exportRacingMap(mapData);
    syncUiState();
    render();
  }

  function syncUiState(updateJson = true) {
    for (const button of modeButtons) {
      button.classList.toggle("is-active", button.dataset.editorMode === editorMode);
    }

    for (const button of prefabButtons) {
      button.classList.toggle("is-active", button.dataset.obstacleType === selectedObstacleType);
    }

    pointsValue.textContent = `${mapData.track.controlPoints.length} 个`;
    obstaclesValue.textContent = `${mapData.obstacles.length} 个`;
    selectionValue.textContent = currentSelectionLabel();

    if (updateJson) {
      jsonValue.value = exportRacingMap(mapData);
    }
  }

  function commitMap(statusMessage) {
    mapData = saveActiveRacingMap(mapData);
    previewSamples = buildTrackPreview(mapData);
    syncUiState();
    render();
    onMapChanged?.();
    setStatus(statusMessage);
  }

  function setStatus(message) {
    statusValue.textContent = message;
  }

  function clearSelection() {
    selectedObstacleId = null;
    selectedPointIndex = 0;
    syncUiState(false);
    render();
  }

  function currentSelectionLabel() {
    if (editorMode === "track") {
      return `控制点 ${selectedPointIndex + 1}`;
    }

    const obstacle = selectedObstacle();
    if (!obstacle) {
      return "未选中";
    }

    return getObstaclePrefab(obstacle.type).label;
  }

  function selectedObstacle() {
    return mapData.obstacles.find((obstacle) => obstacle.id === selectedObstacleId) ?? null;
  }

  function deleteSelectedPoint() {
    if (mapData.track.controlPoints.length <= 4) {
      setStatus("赛道至少需要 4 个控制点。");
      return;
    }

    mapData.track.controlPoints.splice(selectedPointIndex, 1);
    selectedPointIndex = Math.max(0, Math.min(selectedPointIndex, mapData.track.controlPoints.length - 1));
    commitMap("已删除控制点。");
  }

  function deleteSelectedObstacle() {
    if (!selectedObstacleId) {
      setStatus("先选中一个障碍。");
      return;
    }

    mapData.obstacles = mapData.obstacles.filter((obstacle) => obstacle.id !== selectedObstacleId);
    selectedObstacleId = null;
    commitMap("已删除障碍。");
  }

  function nudgeSelectedPoint(code, distance) {
    const point = mapData.track.controlPoints[selectedPointIndex];
    if (!point) {
      return;
    }

    const delta = keyToDelta(code, distance);
    if (!delta) {
      return;
    }

    point[0] = roundValue(point[0] + delta.x);
    point[1] = roundValue(point[1] + delta.z);
    commitMap("已微调控制点。");
  }

  function nudgeSelectedObstacle(code, distance) {
    const obstacle = selectedObstacle();
    if (!obstacle) {
      return;
    }

    const delta = keyToDelta(code, distance);
    if (!delta) {
      return;
    }

    obstacle.x = roundValue(obstacle.x + delta.x);
    obstacle.z = roundValue(obstacle.z + delta.z);
    commitMap("已微调障碍。");
  }

  function rotateSelectedObstacle(delta) {
    const obstacle = selectedObstacle();
    if (!obstacle) {
      return;
    }

    obstacle.rotation = roundValue(obstacle.rotation + delta);
    commitMap("已旋转障碍。");
  }

  function scaleSelectedObstacle(multiplier) {
    const obstacle = selectedObstacle();
    if (!obstacle) {
      return;
    }

    obstacle.width = roundValue(Math.min(Math.max(obstacle.width * multiplier, 0.6), 12));
    obstacle.depth = roundValue(Math.min(Math.max(obstacle.depth * multiplier, 0.6), 12));
    commitMap("已调整障碍尺寸。");
  }

  function keyToDelta(code, distance) {
    switch (code) {
      case "ArrowUp":
      case "KeyW":
        return { x: 0, z: distance };
      case "ArrowDown":
      case "KeyS":
        return { x: 0, z: -distance };
      case "ArrowLeft":
      case "KeyA":
        return { x: -distance, z: 0 };
      case "ArrowRight":
      case "KeyD":
        return { x: distance, z: 0 };
      default:
        return null;
    }
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function findPointAtScreen(screenX, screenY) {
    for (let index = mapData.track.controlPoints.length - 1; index >= 0; index -= 1) {
      const [x, z] = mapData.track.controlPoints[index];
      const point = worldToScreen(x, z);
      if (Math.hypot(point.x - screenX, point.y - screenY) <= pointRadius + 4) {
        return index;
      }
    }

    return -1;
  }

  function findObstacleAtWorld(world) {
    const reversed = [...mapData.obstacles].reverse();
    for (const obstacle of reversed) {
      if (pointInsideObstacle(world, obstacle)) {
        return obstacle;
      }
    }

    return null;
  }

  function pointInsideObstacle(point, obstacle) {
    const cos = Math.cos(-obstacle.rotation);
    const sin = Math.sin(-obstacle.rotation);
    const localX = (point.x - obstacle.x) * cos - (point.z - obstacle.z) * sin;
    const localZ = (point.x - obstacle.x) * sin + (point.z - obstacle.z) * cos;
    return Math.abs(localX) <= obstacle.width / 2 + screenToWorldDistance(obstacleHandlePadding)
      && Math.abs(localZ) <= obstacle.depth / 2 + screenToWorldDistance(obstacleHandlePadding);
  }

  function findInsertionIndex(world) {
    const points = mapData.track.controlPoints;
    let bestIndex = points.length;
    let bestDistanceSq = Infinity;

    for (let index = 0; index < points.length; index += 1) {
      const current = pointVector(points[index]);
      const next = pointVector(points[(index + 1) % points.length]);
      const projected = projectPointOnSegment(world, current, next);
      const distanceSq = projected.distanceToSquared(new THREE.Vector2(world.x, world.z));
      if (distanceSq < bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestIndex = index + 1;
      }
    }

    return bestIndex;
  }

  function render() {
    if (!ctx || !active) {
      return;
    }

    previewSamples = buildTrackPreview(mapData);
    viewport = computeViewport(mapData, previewSamples);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawGrid();
    drawTrack();
    drawObstacles();
    drawControlPolygon();
    drawControlPoints();
  }

  function drawBackground() {
    ctx.fillStyle = "#e8f1de";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawGrid() {
    const spacing = 10;
    ctx.save();
    ctx.strokeStyle = "rgba(16, 32, 43, 0.08)";
    ctx.lineWidth = 1;

    const bounds = viewport.bounds;
    const startX = Math.floor(bounds.minX / spacing) * spacing;
    const endX = Math.ceil(bounds.maxX / spacing) * spacing;
    const startZ = Math.floor(bounds.minZ / spacing) * spacing;
    const endZ = Math.ceil(bounds.maxZ / spacing) * spacing;

    for (let x = startX; x <= endX; x += spacing) {
      const top = worldToScreen(x, bounds.maxZ);
      const bottom = worldToScreen(x, bounds.minZ);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();
    }

    for (let z = startZ; z <= endZ; z += spacing) {
      const left = worldToScreen(bounds.minX, z);
      const right = worldToScreen(bounds.maxX, z);
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawTrack() {
    if (previewSamples.length === 0) {
      return;
    }

    const leftEdge = previewSamples.map((sample) => sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.halfWidth)));
    const rightEdge = previewSamples.map((sample) => sample.center.clone().add(sample.normal.clone().multiplyScalar(-sample.halfWidth)));

    ctx.save();
    ctx.fillStyle = "#1f2024";
    ctx.beginPath();

    leftEdge.forEach((point, index) => {
      const screen = worldToScreen(point.x, point.y);
      if (index === 0) {
        ctx.moveTo(screen.x, screen.y);
      } else {
        ctx.lineTo(screen.x, screen.y);
      }
    });

    rightEdge.slice().reverse().forEach((point) => {
      const screen = worldToScreen(point.x, point.y);
      ctx.lineTo(screen.x, screen.y);
    });

    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#f6f6f6";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = "#d64545";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    previewSamples.forEach((sample, index) => {
      const screen = worldToScreen(sample.center.x, sample.center.y);
      if (index === 0) {
        ctx.moveTo(screen.x, screen.y);
      } else {
        ctx.lineTo(screen.x, screen.y);
      }
    });
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawObstacles() {
    ctx.save();

    for (const obstacle of mapData.obstacles) {
      const screen = worldToScreen(obstacle.x, obstacle.z);
      const width = obstacle.width * viewport.scale;
      const depth = obstacle.depth * viewport.scale;

      ctx.translate(screen.x, screen.y);
      ctx.rotate(-obstacle.rotation);
      ctx.fillStyle = obstacle.color;
      ctx.strokeStyle = obstacle.id === selectedObstacleId ? "#f2b705" : "rgba(16, 32, 43, 0.55)";
      ctx.lineWidth = obstacle.id === selectedObstacleId ? 3 : 1.5;
      ctx.fillRect(-width / 2, -depth / 2, width, depth);
      ctx.strokeRect(-width / 2, -depth / 2, width, depth);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -depth / 2);
      ctx.stroke();

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    ctx.restore();
  }

  function drawControlPolygon() {
    ctx.save();
    ctx.strokeStyle = "rgba(15, 139, 141, 0.4)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();

    mapData.track.controlPoints.forEach(([x, z], index) => {
      const point = worldToScreen(x, z);
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });

    if (mapData.track.controlPoints.length > 0) {
      const first = worldToScreen(mapData.track.controlPoints[0][0], mapData.track.controlPoints[0][1]);
      ctx.lineTo(first.x, first.y);
    }

    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawControlPoints() {
    ctx.save();

    mapData.track.controlPoints.forEach(([x, z], index) => {
      const point = worldToScreen(x, z);
      const selected = editorMode === "track" && index === selectedPointIndex;

      ctx.beginPath();
      ctx.fillStyle = selected ? "#f2b705" : "#0f8b8d";
      ctx.arc(point.x, point.y, pointRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();

      ctx.fillStyle = "#10202b";
      ctx.font = `${Math.max(18, Math.round(canvas.width * 0.015))}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), point.x, point.y + 1);
    });

    ctx.restore();
  }

  function worldToScreen(x, z) {
    const px = viewport.offsetX + (x - viewport.bounds.minX) * viewport.scale;
    const py = canvas.height - (viewport.offsetY + (z - viewport.bounds.minZ) * viewport.scale);
    return { x: px, y: py };
  }

  function screenToWorld(x, y) {
    return {
      x: (x - viewport.offsetX) / viewport.scale + viewport.bounds.minX,
      z: ((canvas.height - y) - viewport.offsetY) / viewport.scale + viewport.bounds.minZ
    };
  }

  function screenToWorldDistance(distance) {
    return distance / viewport.scale;
  }

  return { start, stop, destroy };
}

function buildTrackPreview(mapData) {
  const curve = new THREE.CatmullRomCurve3(
    mapData.track.controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    "centripetal",
    0.45
  );
  const samples = Array.from({ length: mapData.track.samples }, (_, index) => sampleTrack(curve, index / mapData.track.samples));
  const baseHalfWidth = mapData.track.width / 2;
  const minHalfWidth = baseHalfWidth * racingTrackShapeConfig.minHalfWidthScale;
  let halfWidths = samples.map((_, index) => {
    const previous = samples[wrapIndex(index - 1, samples.length)];
    const next = samples[wrapIndex(index + 1, samples.length)];
    const dot = clamp(previous.tangent.dot(next.tangent), -1, 1);
    const turnAngle = Math.acos(dot);
    const span = previous.center.distanceTo(next.center);
    const radiusEstimate = turnAngle < 0.0001 ? Number.POSITIVE_INFINITY : span / turnAngle;
    const widthScale = clamp(
      radiusEstimate / (baseHalfWidth * racingTrackShapeConfig.curvatureRadiusFactor),
      racingTrackShapeConfig.minHalfWidthScale,
      1
    );
    return Math.max(minHalfWidth, baseHalfWidth * widthScale);
  });

  for (let pass = 0; pass < racingTrackShapeConfig.widthSmoothingPasses; pass += 1) {
    halfWidths = halfWidths.map((width, index) => {
      const previous = halfWidths[wrapIndex(index - 1, halfWidths.length)];
      const next = halfWidths[wrapIndex(index + 1, halfWidths.length)];
      return clamp(previous * 0.25 + width * 0.5 + next * 0.25, minHalfWidth, baseHalfWidth);
    });
  }

  return samples.map((sample, index) => ({
    ...sample,
    halfWidth: halfWidths[index]
  }));
}

function sampleTrack(curve, progress) {
  const wrapped = wrapProgress(progress);
  const point = curve.getPointAt(wrapped);
  const tangent3 = curve.getTangentAt(wrapped);
  const center = new THREE.Vector2(point.x, point.z);
  const tangent = new THREE.Vector2(tangent3.x, tangent3.z).normalize();
  const normal = new THREE.Vector2(-tangent.y, tangent.x);

  return {
    center,
    tangent,
    normal
  };
}

function computeViewport(mapData, previewSamples) {
  const coordinates = [
    ...mapData.track.controlPoints.map(([x, z]) => ({ x, z })),
    ...mapData.obstacles.flatMap((obstacle) => {
      const halfWidth = obstacle.width / 2;
      const halfDepth = obstacle.depth / 2;
      return [
        { x: obstacle.x - halfWidth, z: obstacle.z - halfDepth },
        { x: obstacle.x + halfWidth, z: obstacle.z + halfDepth }
      ];
    }),
    ...previewSamples.flatMap((sample) => {
      return [
        { x: sample.center.x + sample.normal.x * sample.halfWidth, z: sample.center.y + sample.normal.y * sample.halfWidth },
        { x: sample.center.x - sample.normal.x * sample.halfWidth, z: sample.center.y - sample.normal.y * sample.halfWidth }
      ];
    })
  ];

  const margin = 20;
  const minX = Math.min(...coordinates.map((item) => item.x)) - margin;
  const maxX = Math.max(...coordinates.map((item) => item.x)) + margin;
  const minZ = Math.min(...coordinates.map((item) => item.z)) - margin;
  const maxZ = Math.max(...coordinates.map((item) => item.z)) + margin;
  const rangeX = Math.max(1, maxX - minX);
  const rangeZ = Math.max(1, maxZ - minZ);
  const padding = 40;
  const previewWidth = document.getElementById("racingEditorCanvas").width;
  const previewHeight = document.getElementById("racingEditorCanvas").height;
  const worldScale = Math.min(
    (previewWidth - padding * 2) / rangeX,
    (previewHeight - padding * 2) / rangeZ
  );

  return {
    bounds: { minX, maxX, minZ, maxZ },
    scale: worldScale,
    offsetX: (previewWidth - rangeX * worldScale) / 2,
    offsetY: (previewHeight - rangeZ * worldScale) / 2
  };
}

function pointVector([x, z]) {
  return new THREE.Vector2(x, z);
}

function projectPointOnSegment(worldPoint, segmentStart, segmentEnd) {
  const point = new THREE.Vector2(worldPoint.x, worldPoint.z);
  const segment = segmentEnd.clone().sub(segmentStart);
  const segmentLengthSq = Math.max(segment.lengthSq(), 0.0001);
  const t = clamp(point.clone().sub(segmentStart).dot(segment) / segmentLengthSq, 0, 1);
  return segmentStart.clone().lerp(segmentEnd, t);
}

function wrapProgress(progress) {
  return ((progress % 1) + 1) % 1;
}

function wrapIndex(index, length) {
  return ((index % length) + length) % length;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundValue(value) {
  return Math.round(value * 100) / 100;
}
