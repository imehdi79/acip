import type {
  DrawingDocument,
  EntityId,
  Geometry,
  RegionShape,
  SpaceInfo,
  TextShape,
  ViewDefinition,
} from '@acip/editor-core';
import { buildDisplayList, detectSpaces, hasGrips } from '@acip/editor-core';
import type { Viewport2D } from './viewport2d';
import type { OverlayState } from '../ui-state';

const COLORS = {
  background: '#1b1e23',
  gridMinor: '#23272e',
  gridMajor: '#2c313a',
  axisX: '#5a3d3d',
  axisY: '#3d5a3d',
  selected: '#4da3ff',
  snap: '#ffd24d',
  rubber: '#9aa4b0',
  regionFill: 'rgba(143, 163, 184, 0.16)',
  regionFillSelected: 'rgba(77, 163, 255, 0.28)',
  grip: '#4da3ff',
  gripBorder: '#0e1116',
  spaceFill: 'rgba(102, 187, 170, 0.08)',
  spaceLabel: '#6fa898',
  measure: '#d9c069',
  finish: '#c78f4a',
  ghost: '#8fd0ff',
  boxWindow: 'rgba(77, 163, 255, 0.12)',
  boxWindowBorder: '#4da3ff',
  boxCrossing: 'rgba(102, 187, 106, 0.12)',
  boxCrossingBorder: '#66bb6a',
};

export const GRIP_PIXELS = 4;

function collectRegions(g: Geometry, out: RegionShape[]): void {
  if (g.kind === 'region') out.push(g);
  else if (g.kind === 'group') for (const child of g.children) collectRegions(child, out);
}

function collectTexts(g: Geometry, out: TextShape[]): void {
  if (g.kind === 'text') out.push(g);
  else if (g.kind === 'group') for (const child of g.children) collectTexts(child, out);
}

function pathGeometry(ctx: CanvasRenderingContext2D, g: Geometry): void {
  switch (g.kind) {
    case 'segment':
      ctx.moveTo(g.a.x, g.a.y);
      ctx.lineTo(g.b.x, g.b.y);
      break;
    case 'polyline': {
      if (g.points.length === 0) break;
      ctx.moveTo(g.points[0].x, g.points[0].y);
      for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i].x, g.points[i].y);
      if (g.closed) ctx.closePath();
      break;
    }
    case 'circle':
      ctx.moveTo(g.center.x + g.radius, g.center.y);
      ctx.arc(g.center.x, g.center.y, g.radius, 0, Math.PI * 2);
      break;
    case 'arc':
      ctx.arc(g.center.x, g.center.y, g.radius, g.startAngle, g.endAngle);
      break;
    case 'region': {
      pathGeometry(ctx, { kind: 'polyline', points: g.boundary, closed: true });
      for (const hole of g.holes) {
        pathGeometry(ctx, { kind: 'polyline', points: hole, closed: true });
      }
      break;
    }
    case 'text':
      break; // not a path — drawn screen-space after the display list
    case 'group':
      for (const child of g.children) pathGeometry(ctx, child);
      break;
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport2D,
  width: number,
  height: number,
): void {
  const worldMin = viewport.toWorld(0, height);
  const worldMax = viewport.toWorld(width, 0);
  // pick a step that keeps grid lines at least ~14px apart
  let step = 1;
  while (step * viewport.scale < 14) step *= 10;
  const drawLines = (spacing: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(worldMin.x / spacing) * spacing; x <= worldMax.x; x += spacing) {
      const s = viewport.toScreen({ x, y: 0 });
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x, height);
    }
    for (let y = Math.ceil(worldMin.y / spacing) * spacing; y <= worldMax.y; y += spacing) {
      const s = viewport.toScreen({ x: 0, y });
      ctx.moveTo(0, s.y);
      ctx.lineTo(width, s.y);
    }
    ctx.stroke();
  };
  drawLines(step, COLORS.gridMinor);
  drawLines(step * 10, COLORS.gridMajor);

  const origin = viewport.toScreen({ x: 0, y: 0 });
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.axisX;
  ctx.beginPath();
  ctx.moveTo(0, origin.y);
  ctx.lineTo(width, origin.y);
  ctx.stroke();
  ctx.strokeStyle = COLORS.axisY;
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, height);
  ctx.stroke();
}

export function drawScene(
  canvas: HTMLCanvasElement,
  viewport: Viewport2D,
  doc: DrawingDocument,
  view: ViewDefinition,
  selection: ReadonlySet<string>,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, viewport, width, height);

  // one world→screen transform for the whole display list (Y flipped)
  ctx.setTransform(
    dpr * viewport.scale,
    0,
    0,
    -dpr * viewport.scale,
    dpr * viewport.offsetX,
    dpr * viewport.offsetY,
  );
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // detected rooms (derived on read): soft net-boundary fill under the walls
  const spaces: SpaceInfo[] = view.kind === 'plan' ? detectSpaces(doc, view.levelId) : [];
  if (spaces.length > 0) {
    ctx.fillStyle = COLORS.spaceFill;
    ctx.beginPath();
    for (const space of spaces) {
      pathGeometry(ctx, { kind: 'polyline', points: space.boundary, closed: true });
      for (const hole of space.holes) {
        pathGeometry(ctx, { kind: 'polyline', points: hole, closed: true });
      }
    }
    ctx.fill('evenodd');
  }

  const texts: { shape: TextShape; color: string }[] = [];
  for (const item of buildDisplayList(doc, view)) {
    const isSelected = selection.has(item.entityId);
    // solid regions (wall spans) get a light fill under the stroke
    const regions: RegionShape[] = [];
    collectRegions(item.geometry, regions);
    if (regions.length > 0) {
      ctx.fillStyle = isSelected ? COLORS.regionFillSelected : COLORS.regionFill;
      ctx.beginPath();
      for (const region of regions) pathGeometry(ctx, region);
      ctx.fill('evenodd');
    }
    // finishes render as a dashed band hugging the wall face, so they read
    // apart from wall linework
    const isFinish = doc.get(item.entityId as EntityId)?.type === 'finish';
    const color = isSelected
      ? COLORS.selected
      : isFinish
        ? COLORS.finish
        : (item.style.stroke ?? '#e0e0e0');
    ctx.strokeStyle = color;
    // divide by scale so line weights stay zoom-independent
    ctx.lineWidth = ((item.style.width ?? 1) * (isSelected ? 2.5 : isFinish ? 2 : 1.5)) / viewport.scale;
    if (isFinish) ctx.setLineDash([0.15, 0.1]);
    ctx.beginPath();
    pathGeometry(ctx, item.geometry);
    ctx.stroke();
    if (isFinish) ctx.setLineDash([]);
    const found: TextShape[] = [];
    collectTexts(item.geometry, found);
    for (const shape of found) texts.push({ shape, color });
  }

  // text shapes (dimension values) — screen space so glyphs are never
  // Y-mirrored; world-fixed height, hidden when unreadably small
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const { shape, color } of texts) {
    const px = shape.height * viewport.scale;
    if (px < 4) continue;
    const at = viewport.toScreen(shape.anchor);
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(-shape.rotation); // screen y points down
    ctx.fillStyle = color;
    ctx.font = `${px}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shape.text, 0, 0);
    ctx.restore();
  }

  // grips for selected entities — fixed pixel size, drawn in screen space
  for (const id of selection) {
    const entity = doc.get(id as EntityId);
    if (!entity || !hasGrips(entity)) continue;
    for (const grip of entity.getGrips()) {
      const s = viewport.toScreen(grip.point);
      ctx.fillStyle = COLORS.grip;
      ctx.strokeStyle = COLORS.gripBorder;
      ctx.lineWidth = 1;
      ctx.fillRect(s.x - GRIP_PIXELS, s.y - GRIP_PIXELS, GRIP_PIXELS * 2, GRIP_PIXELS * 2);
      ctx.strokeRect(s.x - GRIP_PIXELS, s.y - GRIP_PIXELS, GRIP_PIXELS * 2, GRIP_PIXELS * 2);
    }
  }

  // room area labels — fixed screen size, hidden once a room shrinks below
  // roughly a label's worth of pixels
  if (spaces.length > 0) {
    ctx.fillStyle = COLORS.spaceLabel;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const space of spaces) {
      if (space.netArea * viewport.scale * viewport.scale < 40 * 40) continue;
      const at = viewport.toScreen(space.labelPoint);
      ctx.fillText(`${space.netArea.toFixed(1)} m²`, at.x, at.y);
    }
  }
}

export function drawOverlay(
  canvas: HTMLCanvasElement,
  viewport: Viewport2D,
  overlay: OverlayState,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

  if (overlay.ghost) {
    // dashed preview of geometry being drag-moved, in world space
    ctx.setTransform(
      dpr * viewport.scale,
      0,
      0,
      -dpr * viewport.scale,
      dpr * viewport.offsetX,
      dpr * viewport.offsetY,
    );
    ctx.strokeStyle = COLORS.ghost;
    ctx.lineWidth = 1.5 / viewport.scale;
    ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
    ctx.beginPath();
    for (const g of overlay.ghost) pathGeometry(ctx, g);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  if (overlay.box) {
    const a = viewport.toScreen(overlay.box.a);
    const b = viewport.toScreen(overlay.box.b);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.fillStyle = overlay.box.crossing ? COLORS.boxCrossing : COLORS.boxWindow;
    ctx.strokeStyle = overlay.box.crossing ? COLORS.boxCrossingBorder : COLORS.boxWindowBorder;
    ctx.lineWidth = 1;
    if (overlay.box.crossing) ctx.setLineDash([5, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  if (overlay.rubber) {
    const a = viewport.toScreen(overlay.rubber.a);
    const b = viewport.toScreen(overlay.rubber.b);
    ctx.strokeStyle = COLORS.rubber;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // live length readout while drawing — world meters, lifted off the line
    const worldLen = Math.hypot(
      overlay.rubber.b.x - overlay.rubber.a.x,
      overlay.rubber.b.y - overlay.rubber.a.y,
    );
    const screenLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (worldLen > 1e-6 && screenLen > 24) {
      const nx = -(b.y - a.y) / screenLen;
      const ny = (b.x - a.x) / screenLen;
      ctx.fillStyle = COLORS.measure;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(worldLen.toFixed(2), (a.x + b.x) / 2 + nx * 12, (a.y + b.y) / 2 + ny * 12);
    }
  }

  if (overlay.snap) {
    const s = viewport.toScreen(overlay.snap.point);
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
  }
}
