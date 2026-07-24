import type {
  DrawingDocument,
  EntityId,
  Geometry,
  RegionShape,
  SpaceInfo,
  TextShape,
  ViewDefinition,
  WallAssemblyStrips,
} from '@acip/editor-core';
import {
  WallEntity,
  buildDisplayList,
  detectSpaces,
  hasGrips,
  wallAssemblyStrips,
} from '@acip/editor-core';
import type { Viewport2D } from './viewport2d';
import type { OverlayState, UnderlayState } from '../ui-state';
import { formatLength } from '../units';
import { detectRectRoom, rectRoomCorners } from '../rooms';

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
  assemblyTint: 'rgba(255, 255, 255, 0.05)',
  assemblySeparator: 'rgba(224, 224, 224, 0.45)',
  assemblyHatch: 'rgba(224, 224, 224, 0.28)',
  mark: '#8fb4d8',
  markHalo: '#16181d',
  roomHandle: '#8fd0a8',
  roomHandleBorder: '#0e1116',
  ink: '#6fd0e0',
};

/** room resize handle half-size in px (bigger than grips — a touch target) */
export const ROOM_HANDLE_PIXELS = 6;

/**
 * Mark label prefixes — architectural entities only, so drafting geometry
 * (lines, dimensions) never clutters the plan. "W3" on screen is what "wall 3"
 * means in the agent conversation.
 */
const MARK_PREFIX: Record<string, string> = {
  wall: 'W',
  door: 'D',
  window: 'WN',
  slab: 'SL',
  roof: 'RF',
  stair: 'ST',
  finish: 'FN',
};

export const GRIP_PIXELS = 4;

/** assembly build-up only shows once the wall is thick enough on screen to read */
const MIN_ASSEMBLY_PX = 6;

function collectRegions(g: Geometry, out: RegionShape[]): void {
  if (g.kind === 'region') out.push(g);
  else if (g.kind === 'group')
    for (const child of g.children) collectRegions(child, out);
}

function collectTexts(g: Geometry, out: TextShape[]): void {
  if (g.kind === 'text') out.push(g);
  else if (g.kind === 'group')
    for (const child of g.children) collectTexts(child, out);
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
      for (let i = 1; i < g.points.length; i++)
        ctx.lineTo(g.points[i].x, g.points[i].y);
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

/** 45° hatch line family: dir=1 draws y=x+c, dir=-1 draws y=-x+c, clipped by caller */
function hatchLines(
  ctx: CanvasRenderingContext2D,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  dir: 1 | -1,
  spacing: number,
): void {
  const step = spacing * Math.SQRT2;
  const c0 = dir === 1 ? minY - maxX : minY + minX;
  const c1 = dir === 1 ? maxY - minX : maxY + maxX;
  for (let c = Math.ceil(c0 / step) * step; c <= c1; c += step) {
    ctx.moveTo(minX, dir * minX + c);
    ctx.lineTo(maxX, dir * maxX + c);
  }
}

function hatchRegions(
  ctx: CanvasRenderingContext2D,
  regions: readonly RegionShape[],
  pattern: string,
  scale: number,
): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const region of regions) {
    for (const p of region.boundary) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX > maxX) return;
  const spacing = 5 / scale;
  ctx.save();
  ctx.beginPath();
  for (const region of regions) pathGeometry(ctx, region);
  ctx.clip('evenodd');
  if (pattern === 'dots') {
    const r = 0.75 / scale;
    ctx.fillStyle = COLORS.assemblyHatch;
    ctx.beginPath();
    for (let x = minX; x <= maxX; x += spacing) {
      for (let y = minY; y <= maxY; y += spacing) {
        ctx.rect(x, y, r, r);
      }
    }
    ctx.fill();
  } else {
    // any named pattern gets a diagonal set; cross adds the opposite family
    ctx.strokeStyle = COLORS.assemblyHatch;
    ctx.lineWidth = 0.5 / scale;
    ctx.beginPath();
    hatchLines(ctx, minX, minY, maxX, maxY, 1, spacing);
    if (pattern === 'cross')
      hatchLines(ctx, minX, minY, maxX, maxY, -1, spacing);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAssemblyStrips(
  ctx: CanvasRenderingContext2D,
  doc: DrawingDocument,
  assembly: WallAssemblyStrips,
  scale: number,
): void {
  assembly.strips.forEach((strip, i) => {
    // alternating tint keeps the build-up readable with no hatch configured
    if (i % 2 === 1) {
      ctx.fillStyle = COLORS.assemblyTint;
      ctx.beginPath();
      for (const region of strip.regions) pathGeometry(ctx, region);
      ctx.fill('evenodd');
    }
    const hatch = doc.materials.get(strip.materialId)?.hatch;
    if (hatch) hatchRegions(ctx, strip.regions, hatch, scale);
  });
  ctx.strokeStyle = COLORS.assemblySeparator;
  ctx.lineWidth = 0.75 / scale;
  ctx.beginPath();
  for (const s of assembly.separators) {
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
  }
  ctx.stroke();
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
    for (
      let x = Math.ceil(worldMin.x / spacing) * spacing;
      x <= worldMax.x;
      x += spacing
    ) {
      const s = viewport.toScreen({ x, y: 0 });
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x, height);
    }
    for (
      let y = Math.ceil(worldMin.y / spacing) * spacing;
      y <= worldMax.y;
      y += spacing
    ) {
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
  showMarks = false,
  underlay: UnderlayState | null = null,
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

  // plan underlay: the raster reference under everything drawn. scale(s, -s)
  // undoes the world Y-flip so the image reads upright, top-left at anchor.
  if (underlay) {
    ctx.save();
    ctx.globalAlpha = underlay.opacity;
    ctx.translate(underlay.anchor.x, underlay.anchor.y);
    ctx.scale(underlay.scale, -underlay.scale);
    ctx.drawImage(underlay.image, 0, 0);
    ctx.restore();
  }

  // detected rooms (derived on read): soft net-boundary fill under the walls
  const spaces: SpaceInfo[] =
    view.kind === 'plan' ? detectSpaces(doc, view.levelId) : [];
  if (spaces.length > 0) {
    ctx.fillStyle = COLORS.spaceFill;
    ctx.beginPath();
    for (const space of spaces) {
      pathGeometry(ctx, {
        kind: 'polyline',
        points: space.boundary,
        closed: true,
      });
      for (const hole of space.holes) {
        pathGeometry(ctx, { kind: 'polyline', points: hole, closed: true });
      }
    }
    ctx.fill('evenodd');
  }

  const texts: { shape: TextShape; color: string }[] = [];
  const marks: { text: string; x: number; y: number }[] = [];
  for (const item of buildDisplayList(doc, view)) {
    const isSelected = selection.has(item.entityId);
    // solid regions (wall spans) get a light fill under the stroke
    const regions: RegionShape[] = [];
    collectRegions(item.geometry, regions);
    if (regions.length > 0) {
      ctx.fillStyle = isSelected
        ? COLORS.regionFillSelected
        : COLORS.regionFill;
      ctx.beginPath();
      for (const region of regions) pathGeometry(ctx, region);
      ctx.fill('evenodd');
    }
    const entity = doc.get(item.entityId as EntityId);
    // typed walls expose their assembly build-up once zoomed in enough to read
    if (
      entity instanceof WallEntity &&
      entity.getThickness() * viewport.scale >= MIN_ASSEMBLY_PX
    ) {
      const assembly = wallAssemblyStrips(doc, entity);
      if (assembly) drawAssemblyStrips(ctx, doc, assembly, viewport.scale);
    }
    // finishes render as a dashed band hugging the wall face, so they read
    // apart from wall linework
    const isFinish = entity?.type === 'finish';
    const color = isSelected
      ? COLORS.selected
      : isFinish
        ? COLORS.finish
        : (item.style.stroke ?? '#e0e0e0');
    ctx.strokeStyle = color;
    // divide by scale so line weights stay zoom-independent
    ctx.lineWidth =
      ((item.style.width ?? 1) * (isSelected ? 2.5 : isFinish ? 2 : 1.5)) /
      viewport.scale;
    if (isFinish) ctx.setLineDash([0.15, 0.1]);
    ctx.beginPath();
    pathGeometry(ctx, item.geometry);
    ctx.stroke();
    if (isFinish) ctx.setLineDash([]);
    const found: TextShape[] = [];
    collectTexts(item.geometry, found);
    for (const shape of found) texts.push({ shape, color });

    // mark labels ("W3") at the entity's center — only entities big enough
    // on screen to carry a label without clutter
    if (showMarks && entity && entity.mark !== undefined) {
      const prefix = MARK_PREFIX[entity.type];
      if (prefix) {
        const b = entity.getBounds();
        const diagPx =
          Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * viewport.scale;
        if (diagPx >= 28) {
          const at = viewport.toScreen({
            x: (b.minX + b.maxX) / 2,
            y: (b.minY + b.maxY) / 2,
          });
          marks.push({ text: `${prefix}${entity.mark}`, x: at.x, y: at.y });
        }
      }
    }
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

  // mark labels — screen space, fixed size, dark halo for readability
  if (marks.length > 0) {
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.markHalo;
    ctx.fillStyle = COLORS.mark;
    for (const m of marks) {
      ctx.strokeText(m.text, m.x, m.y);
      ctx.fillText(m.text, m.x, m.y);
    }
  }

  // a selected rectangular room shows corner resize handles instead of the
  // four individual wall grips — drag a corner to resize the whole room
  const room = detectRectRoom(doc, [...selection] as EntityId[]);
  if (room) {
    for (const corner of rectRoomCorners(room)) {
      const s = viewport.toScreen(corner);
      ctx.fillStyle = COLORS.roomHandle;
      ctx.strokeStyle = COLORS.roomHandleBorder;
      ctx.lineWidth = 1;
      ctx.fillRect(
        s.x - ROOM_HANDLE_PIXELS,
        s.y - ROOM_HANDLE_PIXELS,
        ROOM_HANDLE_PIXELS * 2,
        ROOM_HANDLE_PIXELS * 2,
      );
      ctx.strokeRect(
        s.x - ROOM_HANDLE_PIXELS,
        s.y - ROOM_HANDLE_PIXELS,
        ROOM_HANDLE_PIXELS * 2,
        ROOM_HANDLE_PIXELS * 2,
      );
    }
  }

  // grips for selected entities — fixed pixel size, drawn in screen space
  // (skip when a room is selected: its corner handles replace the wall grips)
  for (const id of room ? [] : selection) {
    const entity = doc.get(id as EntityId);
    if (!entity || !hasGrips(entity)) continue;
    for (const grip of entity.getGrips()) {
      const s = viewport.toScreen(grip.point);
      ctx.fillStyle = COLORS.grip;
      ctx.strokeStyle = COLORS.gripBorder;
      ctx.lineWidth = 1;
      ctx.fillRect(
        s.x - GRIP_PIXELS,
        s.y - GRIP_PIXELS,
        GRIP_PIXELS * 2,
        GRIP_PIXELS * 2,
      );
      ctx.strokeRect(
        s.x - GRIP_PIXELS,
        s.y - GRIP_PIXELS,
        GRIP_PIXELS * 2,
        GRIP_PIXELS * 2,
      );
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

  if (overlay.ink) {
    // freehand pen strokes, world space, in the pen accent — a live trace of
    // what the drafter has drawn before it's recognized into walls
    ctx.setTransform(
      dpr * viewport.scale,
      0,
      0,
      -dpr * viewport.scale,
      dpr * viewport.offsetX,
      dpr * viewport.offsetY,
    );
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2 / viewport.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (const stroke of overlay.ink) {
      if (stroke.length === 0) continue;
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  if (overlay.box) {
    const a = viewport.toScreen(overlay.box.a);
    const b = viewport.toScreen(overlay.box.b);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.fillStyle = overlay.box.crossing
      ? COLORS.boxCrossing
      : COLORS.boxWindow;
    ctx.strokeStyle = overlay.box.crossing
      ? COLORS.boxCrossingBorder
      : COLORS.boxWindowBorder;
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
      ctx.fillText(
        formatLength(worldLen),
        (a.x + b.x) / 2 + nx * 12,
        (a.y + b.y) / 2 + ny * 12,
      );
    }
  }

  if (overlay.snap) {
    const s = viewport.toScreen(overlay.snap.point);
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(s.x - 5, s.y - 5, 10, 10);
  }
}
