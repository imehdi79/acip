import type {
  DrawingDocument,
  EntityId,
  Geometry,
  RenderItem,
  RegionShape,
  SpaceInfo,
  TextShape,
  ViewDefinition,
  WallAssemblyStrips,
} from '@acip/editor-core';
import {
  HostedOpeningEntity,
  WallEntity,
  buildDisplayList,
  detectSpaces,
  hasGrips,
  wallAssemblyStrips,
} from '@acip/editor-core';
import type { Viewport2D } from './viewport2d';
import type { MeasureMode, OverlayState, UnderlayState } from '../ui-state';
import { formatLength } from '../units';
import { visibleSpaceName } from '../spaces';
import { planDimensions } from './wall-dimensions';
import { shapeColor, shapeFill } from '../shape-colors';

const COLORS = {
  background: '#ffffff',
  gridMinor: '#eceef1',
  gridMajor: '#dde1e6',
  selected: '#1f7ae0',
  snap: '#e0a500',
  rubber: '#8a94a0',
  regionFill: 'rgba(120, 140, 165, 0.14)',
  regionFillSelected: 'rgba(31, 122, 224, 0.20)',
  grip: '#1f7ae0',
  gripBorder: '#ffffff',
  spaceFill: 'rgba(60, 150, 130, 0.08)',
  spaceLabel: '#3c7a68',
  measure: '#a67c00',
  measureOpening: '#5f8f7a',
  finish: '#b5702a',
  demolition: '#d84a24',
  ghost: '#4da3ff',
  boxWindow: 'rgba(31, 122, 224, 0.10)',
  boxWindowBorder: '#1f7ae0',
  boxCrossing: 'rgba(60, 160, 70, 0.10)',
  boxCrossingBorder: '#3ca046',
  assemblyTint: 'rgba(0, 0, 0, 0.04)',
  assemblySeparator: 'rgba(40, 44, 52, 0.40)',
  assemblyHatch: 'rgba(40, 44, 52, 0.25)',
  mark: '#2f5f8f',
  markHalo: '#ffffff',
  ink: '#1596a8',
  angleLock: '#2fa060',
  angleArc: '#a67c00',
  angleRight: '#2fa060',
  guide: '#5f7fc0',
};

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

/** provisional-wall band: fixed screen width, pulsed between these alphas */
const PENDING_WIDTH_PX = 10;
const PENDING_ALPHA_MIN = 0.3;
const PENDING_ALPHA_SWING = 0.5;
/** one full pulse per this many ms */
const PENDING_BLINK_MS = 900;
/** a measured band's label: its stand-off, and the shortest band worth labelling */
const PENDING_LABEL_PX = 14;
const PENDING_LABEL_MIN_PX = 24;

/** 0..1 triangle-free pulse, read from the clock so any redraw is in phase */
function blinkPhase(): number {
  return (
    0.5 + 0.5 * Math.sin((performance.now() / PENDING_BLINK_MS) * Math.PI * 2)
  );
}

/** true while the overlay wants a repainting animation (the pending wall) */
export function overlayAnimates(overlay: OverlayState): boolean {
  return overlay.pending !== null;
}

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
  // no axis lines: the world origin is not a feature of a floor plan, and two
  // coloured full-width rules read as walls on a phone screen
}

/**
 * The display list, with doors and windows painted LAST.
 *
 * `buildDisplayList` hands entities back in document order, which is creation
 * order and makes no claim to be a painting order. That was harmless while a
 * plan held only linework. It stopped being harmless when the estimator began
 * writing finishes: a finish is created long after the wall it sits on and the
 * openings cut through it, so it arrives later in the list and its dashed band
 * paints straight over the door — hiding the one thing on that wall a reader
 * navigates by, and hiding it only on the walls that had been priced, which
 * reads as the estimator having damaged the drawing.
 *
 * A STABLE partition rather than a sort by rank: everything keeps the relative
 * order it already had, and only the openings move, so this cannot quietly
 * reshuffle anything else that happens to paint over its neighbour today.
 *
 * Done here rather than in core's `buildDisplayList`, which is shared with the
 * desktop editor: what belongs on top is a decision about this plan view, not
 * a fact about the document, and core deliberately does not have one.
 */
export function inPaintOrder(
  doc: DrawingDocument,
  view: ViewDefinition,
): RenderItem[] {
  const openings: RenderItem[] = [];
  const rest: RenderItem[] = [];
  for (const item of buildDisplayList(doc, view)) {
    const entity = doc.get(item.entityId as EntityId);
    // by base class, so a future kind of opening rises with the doors it is
    // one of, rather than being remembered here later
    if (entity instanceof HostedOpeningEntity) openings.push(item);
    else rest.push(item);
  }
  return [...rest, ...openings];
}

export function drawScene(
  canvas: HTMLCanvasElement,
  viewport: Viewport2D,
  doc: DrawingDocument,
  view: ViewDefinition,
  selection: ReadonlySet<string>,
  showMarks = false,
  underlay: UnderlayState | null = null,
  showDemolition = false,
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

  // detected rooms (derived on read): soft net-boundary fill under the walls.
  // A view shades what it draws, so hidden walls take no part — a room the
  // user cannot see the sides of is not a room on this drawing, and one that
  // an invisible partition used to divide is a single room again.
  const spaces: SpaceInfo[] =
    view.kind === 'plan'
      ? detectSpaces(doc, view.levelId, { visibleOnly: true })
      : [];
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
  for (const item of inPaintOrder(doc, view)) {
    const isSelected = selection.has(item.entityId);
    // solid regions (wall spans) get a light fill under the stroke
    const regions: RegionShape[] = [];
    collectRegions(item.geometry, regions);
    if (regions.length > 0) {
      // by kind, so a wall span reads as masonry and a slab as concrete
      // without a legend — the same table the 3D model is built from
      ctx.fillStyle = isSelected
        ? COLORS.regionFillSelected
        : shapeFill(doc.get(item.entityId as EntityId)?.type ?? 'line');
      ctx.beginPath();
      for (const region of regions) pathGeometry(ctx, region);
      ctx.fill('evenodd');
    }
    const entity = doc.get(item.entityId as EntityId);
    // demolition (tear-out) phase: a finish to strip or an opening to remove.
    // Finishes marked for demolition are a separate overlay — hidden until the
    // Demolition button reveals them, so the build plan stays uncluttered.
    const isDemolition =
      (entity as { phase?: string } | undefined)?.phase === 'demolish';
    const isFinish = entity?.type === 'finish';
    if (isDemolition && isFinish && !showDemolition) continue;
    // typed walls expose their assembly build-up once zoomed in enough to read
    if (
      entity instanceof WallEntity &&
      entity.getThickness() * viewport.scale >= MIN_ASSEMBLY_PX
    ) {
      const assembly = wallAssemblyStrips(doc, entity);
      if (assembly) drawAssemblyStrips(ctx, doc, assembly, viewport.scale);
    }
    // finishes render as a dashed band hugging the wall face, so they read
    // apart from wall linework; demolition items burn through in a warning red
    const drawDemolition = isDemolition && showDemolition;
    const color = isSelected
      ? COLORS.selected
      : drawDemolition
        ? COLORS.demolition
        : isFinish
          ? COLORS.finish
          : // the layer's own colour still wins where somebody has set one;
            // otherwise the KIND decides, so a plan is legible the moment it
            // is drawn rather than only once layers have been organised
            (item.style.stroke ?? shapeColor(entity?.type ?? 'line'));
    ctx.strokeStyle = color;
    // divide by scale so line weights stay zoom-independent
    ctx.lineWidth =
      ((item.style.width ?? 1) *
        (isSelected ? 2.5 : drawDemolition ? 2.5 : isFinish ? 2 : 1.5)) /
      viewport.scale;
    if (isFinish || drawDemolition) ctx.setLineDash([0.15, 0.1]);
    ctx.beginPath();
    pathGeometry(ctx, item.geometry);
    ctx.stroke();
    if (isFinish || drawDemolition) ctx.setLineDash([]);
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

  // grips for selected entities — fixed pixel size, drawn in screen space
  for (const id of selection) {
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

  // room labels — name over area, fixed screen size, hidden once a room
  // shrinks below roughly a label's worth of pixels
  if (spaces.length > 0) {
    ctx.fillStyle = COLORS.spaceLabel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const space of spaces) {
      if (space.netArea * viewport.scale * viewport.scale < 40 * 40) continue;
      const at = viewport.toScreen(space.labelPoint);
      // named rooms read as a name first: the area drops to a caption under it
      const name = visibleSpaceName(doc, space);
      const area = `${space.netArea.toFixed(1)} m²`;
      if (name) {
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.fillText(name, at.x, at.y - 8);
      }
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(area, at.x, name ? at.y + 8 : at.y);
    }
  }
}

/** dimension line stand-off from the wall, and the minimum length worth labelling */
const DIM_OFFSET_PX = 18;
const DIM_MIN_PX = 44;
/** gap between lanes — a line plus its label has to fit in here */
const DIM_LANE_PX = 22;

/**
 * Automatic length labels on every wall, and width labels on the openings cut
 * into them. This is a render pass, not document entities: nothing is created,
 * so there is nothing to undo, keep in sync, or strip before export — the
 * labels simply follow whatever the plan is.
 *
 * Drawn entirely in screen space, so line weights and glyphs stay a fixed size
 * at any zoom and text is never Y-mirrored by the world transform.
 *
 * `mode` is passed straight through to the layout: outer overall extents or
 * inner clear widths. Nothing here changes with it — the anchors already are
 * whatever was measured, so the pass below draws the inner span exactly the way
 * it draws the outer one.
 */
export function drawPlanDimensions(
  canvas: HTMLCanvasElement,
  viewport: Viewport2D,
  doc: DrawingDocument,
  view: ViewDefinition,
  selection: ReadonlySet<string> = new Set(),
  mode: MeasureMode = 'outside',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dims = planDimensions(doc, view, selection, mode);
  if (dims.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const dim of dims) {
    // the anchors ARE the measured points: the only thing applied below is a
    // perpendicular stand-off, so the line can never span a different length
    // than the label states
    const sa = viewport.toScreen(dim.a);
    const sb = viewport.toScreen(dim.b);
    const dx = sb.x - sa.x;
    const dy = sb.y - sa.y;
    const px = Math.hypot(dx, dy);
    // too short on screen to carry a label without colliding with its neighbours
    if (px < DIM_MIN_PX) continue;

    // side and lane are decided by the layout pass over the real segments;
    // here they are only converted to screen space. World +y is up and screen
    // +y is down, so the normal's y flips on the way in.
    const nx = dim.side.x;
    const ny = -dim.side.y;
    const standOff = DIM_OFFSET_PX + dim.lane * DIM_LANE_PX;

    const da = { x: sa.x + nx * standOff, y: sa.y + ny * standOff };
    const db = { x: sb.x + nx * standOff, y: sb.y + ny * standOff };

    // a selected entity's dimension reads in the selection colour, so the
    // number being edited is obvious at a glance. Otherwise the hue says what
    // kind of thing is measured: an opening's width is not a stretch of wall.
    const colour = dim.selected
      ? COLORS.selected
      : dim.kind === 'opening'
        ? COLORS.measureOpening
        : COLORS.measure;
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = dim.selected ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(da.x, da.y);
    ctx.lineTo(db.x, db.y);
    // Witness lines run from the measured points out to the dimension line and
    // stop THERE — the three lines close a bracket. Letting them overshoot put
    // the connecting line short of their tips, which reads as a dimension
    // hovering below its own extension lines.
    ctx.moveTo(sa.x + nx * 4, sa.y + ny * 4);
    ctx.lineTo(da.x, da.y);
    ctx.moveTo(sb.x + nx * 4, sb.y + ny * 4);
    ctx.lineTo(db.x, db.y);
    ctx.stroke();

    // keep the label upright: past vertical, flip it rather than read it upside down
    let angle = Math.atan2(db.y - da.y, db.x - da.x);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;

    const label = formatLength(dim.length);
    ctx.save();
    ctx.translate((da.x + db.x) / 2 + nx * 9, (da.y + db.y) / 2 + ny * 9);
    ctx.rotate(angle);
    // halo first so the text stays readable over walls and hatching
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.background;
    ctx.strokeText(label, 0, 0);
    ctx.fillText(label, 0, 0);
    ctx.restore();
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

  if (overlay.guides) {
    // object-snap tracking lines: dashed, drawn under everything else, with a
    // small tick at the corner they track from
    ctx.strokeStyle = COLORS.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (const g of overlay.guides) {
      const a = viewport.toScreen(g.a);
      const b = viewport.toScreen(g.b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const g of overlay.guides) {
      const a = viewport.toScreen(g.a);
      ctx.strokeRect(a.x - 3, a.y - 3, 6, 6);
    }
  }

  if (overlay.pending) {
    // provisional wall under the finger. Drawn in screen space at a fixed
    // band width so it reads as a wall at any zoom, and pulsed so a touch
    // that has landed is unmistakable before the drag moves anywhere.
    const a = viewport.toScreen(overlay.pending.a);
    const b = viewport.toScreen(overlay.pending.b);
    ctx.save();
    ctx.globalAlpha = PENDING_ALPHA_MIN + PENDING_ALPHA_SWING * blinkPhase();
    ctx.strokeStyle = COLORS.ghost;
    ctx.lineWidth = PENDING_WIDTH_PX;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    // a touch that has not moved yet is a dot, not a zero-length line
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();

    // A band that SIZES something says how big it is, in the same voice the
    // rubber band uses while a wall is drawn. Taken from the band's own two
    // points, so the number and the span being dragged cannot disagree, and
    // drawn outside the pulse — a blinking number is unreadable.
    if (overlay.pending.measured) {
      const world = Math.hypot(
        overlay.pending.b.x - overlay.pending.a.x,
        overlay.pending.b.y - overlay.pending.a.y,
      );
      const screen = Math.hypot(b.x - a.x, b.y - a.y);
      if (world > 1e-6 && screen > PENDING_LABEL_MIN_PX) {
        const nx = -(b.y - a.y) / screen;
        const ny = (b.x - a.x) / screen;
        const cx = (a.x + b.x) / 2 + nx * PENDING_LABEL_PX;
        const cy = (a.y + b.y) / 2 + ny * PENDING_LABEL_PX;
        const label = formatLength(world);
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // halo first: the band is dragged along a wall, across its linework
        ctx.lineWidth = 3;
        ctx.strokeStyle = COLORS.background;
        ctx.fillStyle = COLORS.measure;
        ctx.strokeText(label, cx, cy);
        ctx.fillText(label, cx, cy);
      }
    }
  }

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
      for (let i = 1; i < stroke.length; i++)
        ctx.lineTo(stroke[i].x, stroke[i].y);
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
    const locked = overlay.rubber.angleLocked === true;
    ctx.strokeStyle = locked ? COLORS.angleLock : COLORS.rubber;
    ctx.lineWidth = locked ? 1.5 : 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // live length + bearing readout while drawing — world meters, lifted off
    // the line; the angle turns green while it's snapped to a clean bearing
    const worldLen = Math.hypot(
      overlay.rubber.b.x - overlay.rubber.a.x,
      overlay.rubber.b.y - overlay.rubber.a.y,
    );
    const screenLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (worldLen > 1e-6 && screenLen > 24) {
      const nx = -(b.y - a.y) / screenLen;
      const ny = (b.x - a.x) / screenLen;
      const cx = (a.x + b.x) / 2 + nx * 12;
      const cy = (a.y + b.y) / 2 + ny * 12;
      let deg =
        (Math.atan2(
          overlay.rubber.b.y - overlay.rubber.a.y,
          overlay.rubber.b.x - overlay.rubber.a.x,
        ) *
          180) /
        Math.PI;
      deg = ((deg % 360) + 360) % 360;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.measure;
      ctx.fillText(formatLength(worldLen), cx, cy);
      ctx.fillStyle = locked ? COLORS.angleLock : COLORS.rubber;
      ctx.fillText(`${deg.toFixed(0)}°`, cx, cy + 14);
    }
  }

  if (overlay.angles) {
    // live corner-angle arcs while a corner is dragged — a clean right angle
    // reads green so 90° is obvious
    ctx.lineWidth = 1.25;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const R = 20;
    for (const mark of overlay.angles) {
      const c = viewport.toScreen(mark.at);
      const right = Math.abs(mark.deg - 90) < 0.75;
      const color = right ? COLORS.angleRight : COLORS.angleArc;
      ctx.strokeStyle = color;
      // world bearings are CCW; screen y is flipped, so negate to draw
      ctx.beginPath();
      ctx.arc(c.x, c.y, R, -mark.from, -mark.to, true);
      ctx.stroke();
      const mid = (mark.from + mark.to) / 2;
      ctx.fillStyle = color;
      ctx.fillText(
        `${mark.deg.toFixed(0)}°`,
        c.x + (R + 12) * Math.cos(mid),
        c.y - (R + 12) * Math.sin(mid),
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
