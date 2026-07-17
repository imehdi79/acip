import { describe, expect, test } from 'bun:test';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId, MaterialId, TypeId } from '@acip/editor-core';
import {
  Estimator,
  assembleBoq,
  computeRoofTakeoff,
  computeSlabTakeoff,
  computeWallTakeoff,
  smallOpeningRule,
  wasteFactorRule,
} from '../src/index.js';
import type { RateTable } from '../src/index.js';

const RATES: RateTable = {
  currency: 'EUR',
  rates: {
    block: { unit: 'm3', unitCost: 120 },
    plaster: { unit: 'm3', unitCost: 300 },
  },
};

/** 10m × 3m wall, 0.25m assembly (0.2 block + 0.05 plaster), one 2×1.2 window */
function buildDoc() {
  const session = new EditorSession();
  const block = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Concrete block',
    costCode: 'block',
  });
  const plaster = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Plaster',
    costCode: 'plaster',
  });
  const typeId = session.dispatch<TypeId>('TYPE.ADD', {
    targetType: 'wall',
    name: 'B250',
    layers: [
      { materialId: block, thickness: 0.2 },
      { materialId: plaster, thickness: 0.05 },
    ],
  });
  const wallId = session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(10, 0),
    typeId,
  });
  session.dispatch('WINDOW.ADD', { wallId, t: 0.5, width: 2, height: 1.2, sill: 0.9 });
  return { session, wallId };
}

describe('takeoff facts', () => {
  test('gross volume, deductions, and resolved assembly', () => {
    const { session } = buildDoc();
    const [wall] = computeWallTakeoff(session.doc);
    expect(wall.grossVolume).toBeCloseTo(10 * 3 * 0.25);
    expect(wall.deductions).toHaveLength(1);
    expect(wall.deductions[0].area).toBeCloseTo(2 * 1.2);
    expect(wall.deductions[0].volume).toBeCloseTo(2 * 1.2 * 0.25);
    expect(wall.layers.map((l) => l.costCode)).toEqual(['block', 'plaster']);
  });
});

describe('assembleBoq — facts through policy to money', () => {
  test('no rules: all openings deduct, layers split proportionally', () => {
    const { session } = buildDoc();
    const boq = assembleBoq(session.doc, { rates: RATES });
    const net = 7.5 - 0.6; // gross − window volume
    const block = boq.lines.find((l) => l.costCode === 'block')!;
    const plaster = boq.lines.find((l) => l.costCode === 'plaster')!;
    expect(block.quantity).toBeCloseTo(net * (0.2 / 0.25));
    expect(plaster.quantity).toBeCloseTo(net * (0.05 / 0.25));
    expect(boq.total).toBeCloseTo(block.quantity * 120 + plaster.quantity * 300);
    expect(boq.currency).toBe('EUR');
    expect(boq.missingRates).toEqual([]);
  });

  test('mixed-unit assembly: m² by area, count by coverage, priced per unit', () => {
    const session = new EditorSession();
    const membrane = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Membrane',
      unit: 'm2',
      costCode: 'membrane',
    });
    const tile = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Tile',
      unit: 'count',
      costCode: 'tile',
      coverage: 0.09,
    });
    const typeId = session.dispatch<TypeId>('TYPE.ADD', {
      targetType: 'wall',
      name: 'Finish wall',
      layers: [
        { materialId: membrane, thickness: 0.002 },
        { materialId: tile, thickness: 0.01 },
      ],
    });
    session.dispatch('WALL.ADD', { a: point(0, 0), b: point(10, 0), typeId }); // 10×3 face

    const rates: RateTable = {
      currency: 'EUR',
      rates: { membrane: { unit: 'm2', unitCost: 12 }, tile: { unit: 'count', unitCost: 3 } },
    };
    const boq = assembleBoq(session.doc, { rates });
    const membraneLine = boq.lines.find((l) => l.costCode === 'membrane')!;
    const tileLine = boq.lines.find((l) => l.costCode === 'tile')!;
    expect(membraneLine.unit).toBe('m2');
    expect(membraneLine.quantity).toBeCloseTo(30, 6); // face area, not volume
    expect(tileLine.unit).toBe('count');
    expect(tileLine.quantity).toBeCloseTo(30 / 0.09, 6); // area ÷ tile size
    expect(boq.total).toBeCloseTo(30 * 12 + (30 / 0.09) * 3, 4);
  });

  test('small-opening rule keeps sub-threshold openings undeducted', () => {
    const { session, wallId } = buildDoc();
    // add a tiny 0.4 m² window that a 0.5 m² threshold ignores
    session.dispatch('WINDOW.ADD', { wallId, t: 0.2, width: 0.5, height: 0.8, sill: 1.0 });

    const strict = assembleBoq(session.doc); // deducts both
    const ruled = assembleBoq(session.doc, { rules: [smallOpeningRule(0.5)] });
    const strictTotal = strict.lines.reduce((s, l) => s + l.quantity, 0);
    const ruledTotal = ruled.lines.reduce((s, l) => s + l.quantity, 0);
    expect(ruledTotal).toBeCloseTo(strictTotal + 0.5 * 0.8 * 0.25); // small volume added back
  });

  test('waste factor multiplies quantities; missing rates are flagged', () => {
    const { session } = buildDoc();
    const plain = assembleBoq(session.doc);
    const wasted = assembleBoq(session.doc, { rules: [wasteFactorRule(10)] });
    expect(wasted.lines[0].quantity).toBeCloseTo(plain.lines[0].quantity * 1.1);
    // no rates at all: everything flagged, total 0
    expect(plain.missingRates.sort()).toEqual(['block', 'plaster']);
    expect(plain.total).toBe(0);
  });

  test('walls without assembly fall back to a generic volume line', () => {
    const session = new EditorSession();
    session.dispatch('WALL.ADD', { a: point(0, 0), b: point(4, 0) }); // 0.3 default, no type
    const boq = assembleBoq(session.doc);
    expect(boq.lines).toHaveLength(1);
    expect(boq.lines[0].costCode).toBe('wall-volume');
    expect(boq.lines[0].quantity).toBeCloseTo(4 * 3 * 0.3);
  });
});

describe('slabs — the second trade in the BOQ', () => {
  test('typed slabs split across the assembly; untyped fall back to slab-volume', () => {
    const session = new EditorSession();
    const concrete = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Concrete slab',
      costCode: 'concrete-slab',
    });
    const screed = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Screed',
      costCode: 'screed',
    });
    const typeId = session.dispatch<TypeId>('TYPE.ADD', {
      targetType: 'slab',
      name: 'S200',
      layers: [
        { materialId: concrete, thickness: 0.15 },
        { materialId: screed, thickness: 0.05 },
      ],
    });
    session.dispatch('SLAB.ADD', {
      points: [point(0, 0), point(5, 0), point(5, 4), point(0, 4)],
      typeId,
    });
    session.dispatch('SLAB.ADD', {
      points: [point(10, 0), point(12, 0), point(12, 2), point(10, 2)],
      thickness: 0.1,
    });

    const [typed, untyped] = computeSlabTakeoff(session.doc);
    expect(typed.volume).toBeCloseTo(20 * 0.2); // 5×4 at the 0.2 assembly
    expect(untyped.volume).toBeCloseTo(4 * 0.1);
    expect(typed.layers.map((l) => l.costCode)).toEqual(['concrete-slab', 'screed']);

    const boq = assembleBoq(session.doc);
    const byCode = new Map(boq.lines.map((l) => [l.costCode, l]));
    expect(byCode.get('concrete-slab')!.quantity).toBeCloseTo(4 * (0.15 / 0.2));
    expect(byCode.get('screed')!.quantity).toBeCloseTo(4 * (0.05 / 0.2));
    expect(byCode.get('slab-volume')!.quantity).toBeCloseTo(0.4);
  });
});

describe('roofs — the third trade in the BOQ', () => {
  test('typed roofs split across the assembly; untyped fall back to roof-volume', () => {
    const session = new EditorSession();
    const structure = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Roof structure',
      costCode: 'roof-structure',
    });
    const typeId = session.dispatch<TypeId>('TYPE.ADD', {
      targetType: 'roof',
      name: 'R250',
      layers: [{ materialId: structure, thickness: 0.25 }],
    });
    session.dispatch('ROOF.ADD', {
      points: [point(0, 0), point(5, 0), point(5, 4), point(0, 4)],
      slope: 30,
      typeId,
    });
    session.dispatch('ROOF.ADD', {
      points: [point(10, 0), point(12, 0), point(12, 2), point(10, 2)],
      thickness: 0.2,
    });

    const [typed, untyped] = computeRoofTakeoff(session.doc);
    expect(typed.planArea).toBeCloseTo(20);
    expect(typed.slopeArea).toBeCloseTo(20 / Math.cos(Math.PI / 6));
    expect(typed.volume).toBeCloseTo(20 * 0.25);
    expect(untyped.volume).toBeCloseTo(4 * 0.2);

    const boq = assembleBoq(session.doc);
    const byCode = new Map(boq.lines.map((l) => [l.costCode, l]));
    expect(byCode.get('roof-structure')!.quantity).toBeCloseTo(5);
    expect(byCode.get('roof-volume')!.quantity).toBeCloseTo(0.8);
  });
});

describe('catalog editing — the estimate follows the catalog', () => {
  test('TYPE.UPDATE, ENTITY.SETTYPE, and MATERIAL.UPDATE all re-price live', () => {
    const { session, wallId } = buildDoc();
    const estimator = new Estimator(session.doc, { rates: RATES });
    const before = estimator.getBoq().total;

    // thicker block layer (plaster kept) → more volume → higher total
    const typeId = session.doc.types.list('wall')[0].id;
    const blockId = session.doc.materials.list().find((m) => m.costCode === 'block')!.id;
    const plasterId = session.doc.materials.list().find((m) => m.costCode === 'plaster')!.id;
    session.dispatch('TYPE.UPDATE', {
      id: typeId,
      layers: [
        { materialId: blockId, thickness: 0.3 },
        { materialId: plasterId, thickness: 0.05 },
      ],
    });
    expect(estimator.getBoq().total).toBeGreaterThan(before);
    session.undo();
    expect(estimator.getBoq().total).toBeCloseTo(before);

    // clearing the wall's type drops it to the unpriced generic line
    session.dispatch('ENTITY.SETTYPE', { ids: [wallId] });
    expect(estimator.getBoq().missingRates).toContain('wall-volume');
    session.undo();

    // re-coding a material moves its line to the new cost code
    session.dispatch('MATERIAL.UPDATE', { id: blockId, costCode: 'aac' });
    const codes = estimator.getBoq().lines.map((l) => l.costCode);
    expect(codes).toContain('aac');
    expect(codes).not.toContain('block');
    estimator.dispose();
  });
});

describe('Estimator — live recompute per commit', () => {
  test('price ticks on change and rolls back on undo', () => {
    const { session } = buildDoc();
    const estimator = new Estimator(session.doc, { rates: RATES });
    const totals: number[] = [];
    estimator.onUpdate((boq) => totals.push(boq.total));

    const before = estimator.getBoq().total;
    expect(before).toBeGreaterThan(0);

    session.dispatch('WALL.ADD', { a: point(0, 0), b: point(0, 6) }); // unpriced generic line
    const afterAdd = estimator.getBoq().total;
    expect(estimator.getBoq().missingRates).toContain('wall-volume');

    session.undo();
    expect(estimator.getBoq().total).toBeCloseTo(before);
    expect(totals.length).toBe(2); // one per commit/undo
    expect(afterAdd).toBeCloseTo(before); // generic line had no rate — total unchanged

    estimator.dispose();
    session.dispatch('WALL.ADD', { a: point(1, 1), b: point(2, 2) });
    expect(totals.length).toBe(2); // disposed — no further updates
  });
});
