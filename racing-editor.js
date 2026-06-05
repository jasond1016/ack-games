import * as THREE from "three";
import { racingCarConfig } from "./racing-car-config.js";
import {
  cloneRacingMap,
  createLoopStartPosition,
  exportRacingMap,
  getDefaultRacingMap,
  importRacingMap,
  loadActiveRacingMap,
  resetActiveRacingMap,
  saveActiveRacingMap
} from "./racing-map.js";
import {
  buildTrackModel,
  findTrackInsertionTarget,
  getOpenFinishProgress,
  getTrackMinControlPoints,
  getTrackModeLabel,
  getTrackShapeLabel,
  isLoopTrackShape,
  projectPointOntoTrack,
  roundCoordinate,
  sampleTrackModel,
  validateRacingMap
} from "./racing-track.js";

const pointRadius = 8;
const nudgeStep = 0.8;
const startLineHitPadding = 2.6;
const trackWidthOverride = racingCarConfig.trackWidthOverride ?? null;

function buildEditorPreviewModel(track) {
  return buildTrackModel({
    ...track,
    width: trackWidthOverride ?? track.width
  });
}

export function createRacingEditor({ onPlay, onMapChanged } = {}) {
  const canvas = document.getElementById("racingEditorCanvas");
  const ctx = canvas.getContext("2d");
  const mapNameInput = document.getElementById("racingEditorMapName");
  const statusValue = document.getElementById("racingEditorStatusValue");
  const pointsValue = document.getElementById("racingEditorPointsValue");
  const shapeValue = document.getElementById("racingEditorShapeValue");
  const raceModeValue = document.getElementById("racingEditorRaceModeValue");
  const shapeValueMirror = document.getElementById("racingEditorShapeValueMirror");
  const raceModeValueMirror = document.getElementById("racingEditorRaceModeValueMirror");
  const selectionValue = document.getElementById("racingEditorSelectionValue");
  const shapeButtons = Array.from(document.querySelectorAll("[data-track-shape]"));
  const reverseButton = document.getElementById("racingEditorReverseButton");
  const deleteButton = document.getElementById("racingEditorDeleteButton");
  const applyButton = document.getElementById("racingEditorApplyButton");
  const resetButton = document.getElementById("racingEditorResetButton");
  const exportButton = document.getElementById("racingEditorExportButton");
  const importButton = document.getElementById("racingEditorImportButton");
  const importInput = document.getElementById("racingEditorImportInput");
  const jsonValue = document.getElementById("racingEditorJsonValue");

  let active = false;
  let listening = false;
  let mapData = getDefaultRacingMap();
  let lastValidMap = cloneRacingMap(mapData);
  let previewModel = buildEditorPreviewModel(mapData.track);
  let viewport = null;
  let selectedPointIndex = 0;
  let startLineSelected = false;
  let dragState = null;

  function start() {
    active = true;
    mapData = loadActiveRacingMap();
    lastValidMap = cloneRacingMap(mapData);
    previewModel = buildEditorPreviewModel(mapData.track);
    selectedPointIndex = 0;
    startLineSelected = false;
    dragState = null;
    syncControlsFromMap();
    addListeners();
    resizeCanvas();
    setStatus(defaultStatusMessage());
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
    reverseButton.addEventListener("click", handleReverseDirection);
    deleteButton.addEventListener("click", handleDelete);
    applyButton.addEventListener("click", handleApply);
    resetButton.addEventListener("click", handleReset);
    exportButton.addEventListener("click", handleExport);
    importButton.addEventListener("click", handleImportClick);
    importInput.addEventListener("change", handleImportFile);

    for (const button of shapeButtons) {
      button.addEventListener("click", handleShapeClick);
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
    reverseButton.removeEventListener("click", handleReverseDirection);
    deleteButton.removeEventListener("click", handleDelete);
    applyButton.removeEventListener("click", handleApply);
    resetButton.removeEventListener("click", handleReset);
    exportButton.removeEventListener("click", handleExport);
    importButton.removeEventListener("click", handleImportClick);
    importInput.removeEventListener("change", handleImportFile);

    for (const button of shapeButtons) {
      button.removeEventListener("click", handleShapeClick);
    }

    listening = false;
  }

  function resizeCanvas() {
    if (!active) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const width = Math.max(720, Math.round((rect.width || 1120) * dpr));
    const height = Math.max(520, Math.round((rect.height || 720) * dpr));
    canvas.width = width;
    canvas.height = height;
    render();
  }

  function handleNameCommit() {
    const candidate = cloneRacingMap(mapData);
    candidate.name = mapNameInput.value.trim() || "未命名赛道";
    commitCandidate(candidate, "已更新地图名称。");
  }

  function handleShapeClick(event) {
    const nextShape = event.currentTarget.dataset.trackShape;
    if (!nextShape || nextShape === mapData.track.shape) {
      return;
    }

    const minimumPoints = getTrackMinControlPoints(nextShape);
    if (mapData.track.controlPoints.length < minimumPoints) {
      setStatus(`${getTrackShapeLabel(nextShape)}至少需要 ${minimumPoints} 个控制点。`);
      return;
    }

    const candidate = cloneRacingMap(mapData);
    candidate.track.shape = nextShape;

    if (isLoopTrackShape(nextShape)) {
      candidate.track.startPosition = createLoopStartPosition(0);
    } else {
      delete candidate.track.startPosition;
      startLineSelected = false;
    }

    commitCandidate(
      candidate,
      `已切换为${getTrackShapeLabel(nextShape)}。`
    );
  }

  function handleReverseDirection() {
    if (isLoopTrackShape(mapData.track.shape)) {
      setStatus("只有开放赛道可以反转方向。");
      return;
    }

    const candidate = cloneRacingMap(mapData);
    candidate.track.controlPoints.reverse();
    selectedPointIndex = mapData.track.controlPoints.length - 1 - selectedPointIndex;
    commitCandidate(candidate, "已反转赛道方向。");
  }

  function handleDelete() {
    if (startLineSelected) {
      setStatus("闭环起跑位置不能删除，只能沿赛道调整。");
      return;
    }

    deleteSelectedPoint();
  }

  function handleApply() {
    const validation = validateRacingMap(mapData);
    if (!validation.valid) {
      setStatus(`赛道校验失败：${validation.errors[0]}`);
      return;
    }

    commitCandidate(mapData, "已应用到赛车。");
    onPlay?.();
  }

  function handleReset() {
    mapData = resetActiveRacingMap();
    lastValidMap = cloneRacingMap(mapData);
    previewModel = buildEditorPreviewModel(mapData.track);
    selectedPointIndex = 0;
    startLineSelected = false;
    dragState = null;
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
      mapData = saveActiveRacingMap(imported);
      lastValidMap = cloneRacingMap(mapData);
      previewModel = buildEditorPreviewModel(mapData.track);
      selectedPointIndex = 0;
      startLineSelected = false;
      dragState = null;
      syncControlsFromMap();
      onMapChanged?.();
      setStatus("已导入地图文件。");
    } catch (error) {
      console.error("Failed to import racing map.", error);
      restoreLastValidMap();
      setStatus(`导入失败：${error.message}`);
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

    const pointIndex = findPointAtScreen(screen.x, screen.y);
    if (pointIndex >= 0) {
      selectedPointIndex = pointIndex;
      startLineSelected = false;
      dragState = {
        type: "point",
        index: pointIndex,
        commitMessage: "已更新路线。"
      };
      syncUiState(false);
      render();
      return;
    }

    if (isLoopTrackShape(mapData.track.shape) && startLineHitTest(world)) {
      startLineSelected = true;
      dragState = {
        type: "start-line"
      };
      syncUiState(false);
      render();
      return;
    }

    if (event.shiftKey) {
      const insertion = findTrackInsertionTarget(previewModel, world);
      mapData.track.controlPoints.splice(
        insertion.index,
        0,
        [roundCoordinate(world.x), roundCoordinate(world.z)]
      );
      previewModel = buildEditorPreviewModel(mapData.track);
      selectedPointIndex = insertion.index;
      startLineSelected = false;
      dragState = {
        type: "point",
        index: insertion.index,
        commitMessage: insertion.action === "insert" ? "已插入控制点。" : "已接长赛道。"
      };
      syncUiState(false);
      render();
      return;
    }

    startLineSelected = false;
    syncUiState(false);
    render();
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

      target[0] = roundCoordinate(world.x);
      target[1] = roundCoordinate(world.z);
      selectedPointIndex = dragState.index;
      previewModel = buildEditorPreviewModel(mapData.track);
      startLineSelected = false;
      syncUiState(false);
      render();
      return;
    }

    const projection = projectPointOntoTrack(previewModel, world);
    mapData.track.startPosition.progress = projection.progress;
    startLineSelected = true;
    syncUiState(false);
    render();
  }

  function handlePointerUp(event) {
    if (!active) {
      return;
    }

    if (dragState) {
      if (dragState.type === "point") {
        commitCandidate(mapData, dragState.commitMessage, "路线改动未通过校验，已回退到上一个有效地图。");
      } else {
        commitCandidate(mapData, "已调整闭环起跑位置。", "起跑位置调整失败，已回退到上一个有效地图。");
      }
      dragState = null;
    }

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event) {
    if (!active || event.target === mapNameInput) {
      return;
    }

    const movementKey = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code);
    const actionKey = ["Delete", "Backspace", "Escape"].includes(event.code);
    if (!movementKey && !actionKey) {
      return;
    }

    event.preventDefault();

    if (event.code === "Escape") {
      clearSelection();
      return;
    }

    if (event.code === "Delete" || event.code === "Backspace") {
      handleDelete();
      return;
    }

    if (startLineSelected) {
      nudgeLoopStartPosition(event.code);
      return;
    }

    nudgeSelectedPoint(event.code, event.shiftKey ? nudgeStep * 3 : nudgeStep);
  }

  function syncControlsFromMap() {
    mapNameInput.value = mapData.name;
    jsonValue.value = exportRacingMap(mapData);
    syncUiState();
    render();
  }

  function syncUiState(updateJson = true) {
    for (const button of shapeButtons) {
      button.classList.toggle("is-active", button.dataset.trackShape === mapData.track.shape);
    }

    pointsValue.textContent = `${mapData.track.controlPoints.length} 个`;
    shapeValue.textContent = getTrackShapeLabel(mapData.track.shape);
    raceModeValue.textContent = getTrackModeLabel(mapData.track.shape);
    shapeValueMirror.textContent = shapeValue.textContent;
    raceModeValueMirror.textContent = raceModeValue.textContent;
    selectionValue.textContent = currentSelectionLabel();
    reverseButton.disabled = isLoopTrackShape(mapData.track.shape);

    if (updateJson) {
      jsonValue.value = exportRacingMap(mapData);
    }
  }

  function commitCandidate(candidateMap, successMessage, invalidMessage = "") {
    try {
      const saved = saveActiveRacingMap(candidateMap);
      mapData = saved;
      lastValidMap = cloneRacingMap(saved);
      previewModel = buildEditorPreviewModel(saved.track);
      selectedPointIndex = clampPointSelection(selectedPointIndex);
      syncUiState();
      render();
      onMapChanged?.();
      setStatus(successMessage);
      return true;
    } catch (error) {
      console.warn("Failed to commit map candidate.", error);
      restoreLastValidMap();
      setStatus(invalidMessage || `赛道校验失败：${error.message}`);
      return false;
    }
  }

  function restoreLastValidMap() {
    mapData = cloneRacingMap(lastValidMap);
    previewModel = buildEditorPreviewModel(mapData.track);
    selectedPointIndex = clampPointSelection(selectedPointIndex);
    dragState = null;
    syncUiState();
    render();
  }

  function clampPointSelection(index) {
    return Math.max(0, Math.min(index, mapData.track.controlPoints.length - 1));
  }

  function setStatus(message) {
    statusValue.textContent = message;
  }

  function clearSelection() {
    startLineSelected = false;
    selectedPointIndex = clampPointSelection(selectedPointIndex);
    syncUiState(false);
    render();
  }

  function currentSelectionLabel() {
    if (startLineSelected) {
      return "起跑位置";
    }

    return mapData.track.controlPoints[selectedPointIndex]
      ? `控制点 ${selectedPointIndex + 1}`
      : "未选中";
  }

  function deleteSelectedPoint() {
    const minimumPoints = getTrackMinControlPoints(mapData.track.shape);
    if (mapData.track.controlPoints.length <= minimumPoints) {
      setStatus(`${getTrackShapeLabel(mapData.track.shape)}至少需要 ${minimumPoints} 个控制点。`);
      return;
    }

    const candidate = cloneRacingMap(mapData);
    candidate.track.controlPoints.splice(selectedPointIndex, 1);
    selectedPointIndex = Math.max(0, Math.min(selectedPointIndex, candidate.track.controlPoints.length - 1));
    commitCandidate(candidate, "已删除控制点。");
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

    const candidate = cloneRacingMap(mapData);
    candidate.track.controlPoints[selectedPointIndex][0] = roundCoordinate(point[0] + delta.x);
    candidate.track.controlPoints[selectedPointIndex][1] = roundCoordinate(point[1] + delta.z);
    commitCandidate(candidate, "已微调控制点。");
  }

  function nudgeLoopStartPosition(code) {
    if (!isLoopTrackShape(mapData.track.shape)) {
      return;
    }

    const delta = keyToDelta(code, 1);
    if (!delta) {
      return;
    }

    const progressStep = 1 / mapData.track.samples;
    const sign = Math.abs(delta.x) > 0 ? Math.sign(delta.x) : Math.sign(delta.z);
    const candidate = cloneRacingMap(mapData);
    candidate.track.startPosition.progress = ((candidate.track.startPosition.progress + sign * progressStep) % 1 + 1) % 1;
    commitCandidate(candidate, "已微调闭环起跑位置。");
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

  function startLineHitTest(world) {
    const line = startLineGeometry();
    return distanceToSegment(world, line.start, line.end) <= startLineHitPadding;
  }

  function startLineGeometry() {
    const progress = isLoopTrackShape(mapData.track.shape)
      ? mapData.track.startPosition.progress
      : 0;
    const sample = projectTrackLine(progress);
    return {
      center: sample.center,
      start: sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.halfWidth * 0.98)),
      end: sample.center.clone().add(sample.normal.clone().multiplyScalar(-sample.halfWidth * 0.98))
    };
  }

  function finishLineGeometry() {
    const progress = getOpenFinishProgress(previewModel);
    const sample = projectTrackLine(progress);
    return {
      center: sample.center,
      start: sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.halfWidth * 0.98)),
      end: sample.center.clone().add(sample.normal.clone().multiplyScalar(-sample.halfWidth * 0.98))
    };
  }

  function projectTrackLine(progress) {
    return sampleTrackModel(previewModel, progress);
  }

  function render() {
    if (!ctx || !active) {
      return;
    }

    previewModel = buildEditorPreviewModel(mapData.track);
    viewport = computeViewport(previewModel);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();
    drawGrid();
    drawTrack();
    drawControlPolygon();
    drawTrackOverlays();
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
    if (previewModel.samples.length === 0) {
      return;
    }

    const leftEdge = previewModel.samples.map((sample) => sample.center.clone().add(sample.normal.clone().multiplyScalar(sample.halfWidth)));
    const rightEdge = previewModel.samples.map((sample) => sample.center.clone().add(sample.normal.clone().multiplyScalar(-sample.halfWidth)));

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
    previewModel.samples.forEach((sample, index) => {
      const screen = worldToScreen(sample.center.x, sample.center.y);
      if (index === 0) {
        ctx.moveTo(screen.x, screen.y);
      } else {
        ctx.lineTo(screen.x, screen.y);
      }
    });

    if (previewModel.closed) {
      ctx.closePath();
    }

    ctx.stroke();
    ctx.setLineDash([]);
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

    if (previewModel.closed && mapData.track.controlPoints.length > 0) {
      const first = worldToScreen(mapData.track.controlPoints[0][0], mapData.track.controlPoints[0][1]);
      ctx.lineTo(first.x, first.y);
    }

    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawTrackOverlays() {
    drawLineOverlay(startLineGeometry(), startLineSelected || dragState?.type === "start-line" ? "#f2b705" : "#27ae60", "起点");

    if (previewModel.closed) {
      return;
    }

    drawLineOverlay(finishLineGeometry(), "#d64545", "终点");
    drawDirectionCue();
  }

  function drawLineOverlay(line, color, label) {
    const start = worldToScreen(line.start.x, line.start.y);
    const end = worldToScreen(line.end.x, line.end.y);
    const center = worldToScreen(line.center.x, line.center.y);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = `${Math.max(14, Math.round(canvas.width * 0.013))}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, center.x, center.y - 10);
    ctx.restore();
  }

  function drawDirectionCue() {
    const cueSample = previewModel.samples[Math.min(previewModel.samples.length - 1, Math.round(previewModel.samples.length * 0.12))];
    const origin = cueSample.center.clone().sub(cueSample.tangent.clone().multiplyScalar(8));
    const tip = cueSample.center.clone().add(cueSample.tangent.clone().multiplyScalar(8));
    const leftWing = tip.clone()
      .sub(cueSample.tangent.clone().multiplyScalar(2.8))
      .add(cueSample.normal.clone().multiplyScalar(2.2));
    const rightWing = tip.clone()
      .sub(cueSample.tangent.clone().multiplyScalar(2.8))
      .add(cueSample.normal.clone().multiplyScalar(-2.2));

    const start = worldToScreen(origin.x, origin.y);
    const end = worldToScreen(tip.x, tip.y);
    const left = worldToScreen(leftWing.x, leftWing.y);
    const right = worldToScreen(rightWing.x, rightWing.y);

    ctx.save();
    ctx.strokeStyle = "rgba(15, 139, 141, 0.84)";
    ctx.fillStyle = "rgba(15, 139, 141, 0.84)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawControlPoints() {
    ctx.save();

    mapData.track.controlPoints.forEach(([x, z], index) => {
      const point = worldToScreen(x, z);
      const selected = !startLineSelected && index === selectedPointIndex;

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

  function defaultStatusMessage() {
    return previewModel.closed
      ? "拖动控制点，Shift+点击可插入控制点，黄色起跑线可拖动。"
      : "拖动控制点，Shift+点击可插点或从两端接长。";
  }

  return { start, stop, destroy };
}

function computeViewport(trackModel) {
  const coordinates = [
    ...trackModel.samples.flatMap((sample) => ([
      { x: sample.center.x + sample.normal.x * sample.railOffset, z: sample.center.y + sample.normal.y * sample.railOffset },
      { x: sample.center.x - sample.normal.x * sample.railOffset, z: sample.center.y - sample.normal.y * sample.railOffset }
    ])),
    ...trackModel.controlPoints.map((point) => ({ x: point.x, z: point.z }))
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

function distanceToSegment(point, start, end) {
  const pointVector = new THREE.Vector2(point.x, point.z);
  const segment = end.clone().sub(start);
  const segmentLengthSq = Math.max(segment.lengthSq(), 0.0001);
  const t = Math.min(Math.max(pointVector.clone().sub(start).dot(segment) / segmentLengthSq, 0), 1);
  return pointVector.distanceTo(start.clone().add(segment.multiplyScalar(t)));
}
