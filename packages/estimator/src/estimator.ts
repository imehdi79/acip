import type { DrawingDocument } from '@acip/editor-core';
import type { Boq, BoqOptions } from './boq.js';
import { assembleBoq } from './boq.js';
import type { RateTable } from './rates.js';

/**
 * Live estimation: subscribes to the document's batched change events (one
 * per committed transaction) and recomputes the BOQ — the price ticks while
 * the user drags a wall. Read-only consumer through the SDK, exactly like an
 * agent; core does not know this class exists.
 */
export class Estimator {
  private options: BoqOptions;
  private current: Boq;
  private listeners = new Set<(boq: Boq) => void>();
  private unsubscribe: () => void;

  constructor(
    private readonly doc: DrawingDocument,
    options: BoqOptions = {},
  ) {
    this.options = options;
    this.current = assembleBoq(doc, options);
    this.unsubscribe = doc.events.on('change', () => this.recompute());
  }

  getBoq(): Boq {
    return this.current;
  }

  onUpdate(listener: (boq: Boq) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setRates(rates: RateTable | null): void {
    this.options = { ...this.options, rates };
    this.recompute();
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private recompute(): void {
    this.current = assembleBoq(this.doc, this.options);
    for (const listener of this.listeners) listener(this.current);
  }
}
