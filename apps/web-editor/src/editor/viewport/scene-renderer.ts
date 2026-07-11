import type { DrawingDocument, Geometry, RegionShape, ViewDefinition } from '@acip/editor-core';
import { buildDisplayList } from '@acip/editor-core';
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
};

function collectRegions(g: Geometry, out: RegionShape[]): void {
  if (g.kind === 'region') out.push(g);
  else if (g.kind === 'group') for (const child of g.children) collectRegions(child, out);
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
    ctx.strokeStyle = isSelected ? COLORS.selected : (item.style.stroke ?? '#e0e0e0');
    // divide by scale so line weights stay zoom-independent
    ctx.lineWidth = ((item.style.width ?? 1) * (isSelected ? 2.5 : 1.5)) / viewport.scale;
    ctx.beginPath();
    pathGeometry(ctx, item.geometry);
    ctx.stroke();
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
  }

  if (overlay.snap) {
    const s = viewport.toScreen(overlay.snap.point);
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
  }
}
