import { Button, Modal } from '@heroui/react';
import type { DrawingDocument } from '@acip/editor-core';
import type { EstimatorStep } from './estimator-steps';
import {
  finishTargetFor,
  finishesAt,
  spotsFor,
  type FinishRow,
} from './estimator-finishes';
import { formatQuantity, layerTotal, sidesFor } from './estimator-layers';
import { currentRates, formatMoney } from '@/data/rates';

/** one surface of one shape, and what ended up on it */
export interface ReviewSurface {
  /** what the tab called it — "Side A", "Ceiling" */
  readonly label: string;
  readonly rows: readonly FinishRow[];
}

/** one shape of the walk, read back */
export interface ReviewStep {
  readonly id: string;
  readonly name: string;
  readonly surfaces: readonly ReviewSurface[];
  /** how many layers the whole shape carries, across both surfaces */
  readonly layers: number;
  /** what the shape comes to — build and strip-out together */
  readonly amount: number;
  /** cost codes on this shape that nobody has quoted */
  readonly unquoted: number;
}

/**
 * The whole walk, read back out of the drawing.
 *
 * Every shape, including the ones nobody put anything on — those are the point.
 * A review that listed only what was priced would be a list of things the user
 * already knows they did; the value of reading it back at the end is seeing the
 * wall you walked past without noticing, which only shows up as a row saying
 * nothing is on it.
 *
 * Read through `spotsFor`, the half of the table that cannot change the
 * drawing, so opening the summary can never lay a slab under a room the user
 * never priced.
 *
 * A free function over the document, so the summary for a given drawing can be
 * asserted without React — the same reason `estimatorSteps` is one.
 */
export function reviewSteps(
  doc: DrawingDocument,
  steps: readonly EstimatorStep[],
): ReviewStep[] {
  return steps.map((step) => {
    const target = finishTargetFor(doc, step);
    const spots = spotsFor(target);
    const surfaces = sidesFor(step.kind).map((side) => {
      const spot = spots[side.id];
      return {
        label: side.label,
        rows: spot ? finishesAt(doc, spot) : [],
      };
    });
    // Through `layerTotal`, the same function the row itself adds up with.
    // These two used to do the arithmetic separately, which is exactly how a
    // list and the invoice at the end of it start disagreeing about the same
    // wall — and the invoice is the one nobody can check against anything.
    let amount = 0;
    let unquoted = 0;
    for (const surface of surfaces) {
      for (const row of surface.rows) {
        const total = layerTotal(row);
        amount += total.amount;
        if (total.unquoted) unquoted += 1;
      }
    }
    return {
      id: step.id,
      name: step.name,
      surfaces,
      layers: surfaces.reduce((n, surface) => n + surface.rows.length, 0),
      amount,
      unquoted,
    };
  });
}

/**
 * The end of the walk: everything that was priced, in one screen.
 *
 * FULL SCREEN, like the add sheet and unlike the wizard. The wizard is parked
 * over the plan because it is describing one shape on it; this is describing
 * all of them, and there is no longer a shape to keep in view — so the reason
 * to give up half the screen is gone, and a summary squeezed into half a phone
 * would be a summary nobody reads.
 *
 * Every shape appears, priced or not, and the empty ones are the reason to
 * look: a wall that says "nothing on it" is the one thing this screen can tell
 * you that walking forwards could not.
 *
 * Controlled and trigger-less, so a test can render it at any state, and so
 * the wizard decides when the walk has ended rather than this having an
 * opinion about it.
 */
export function ReviewSheet({
  steps,
  isOpen,
  onOpenChange,
  onBack,
  onSubmit,
}: {
  steps: readonly ReviewStep[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** back into the walk, at the step it was left on */
  onBack: () => void;
  onSubmit: () => void;
}) {
  const priced = steps.filter((step) => step.layers > 0).length;
  const layers = steps.reduce((n, step) => n + step.layers, 0);
  const total = steps.reduce((sum, step) => sum + step.amount, 0);
  const unquoted = steps.reduce((n, step) => n + step.unquoted, 0);

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="full">
        <Modal.Dialog>
          <Modal.Header>
            {/* the count first, because it is the one line that says whether
                the walk is finished in the sense the user cares about: not
                "did I reach the end" but "did I leave anything bare" */}
            <p className="text-xs text-muted">
              Invoice · {priced} of {steps.length} priced · {layers}{' '}
              {layers === 1 ? 'layer' : 'layers'}
            </p>
            <Modal.Heading>
              {formatMoney(total, currentRates().currency)}
            </Modal.Heading>
            {/* what the total does NOT include, said next to it. A total with
                unquoted work silently left out of it is the most expensive
                kind of wrong an estimate can be. */}
            {unquoted > 0 && (
              <p className="text-xs text-muted">
                {unquoted} {unquoted === 1 ? 'line has' : 'lines have'} no rate
                yet and {unquoted === 1 ? 'is' : 'are'} not in that figure.
              </p>
            )}
          </Modal.Header>
          <Modal.Body className="text-left">
            {steps.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing to price on this level yet.
              </p>
            ) : (
              <ul className="text-sm">
                {steps.map((step) => (
                  <li
                    key={step.id}
                    className="border-b border-separator py-2 last:border-0"
                  >
                    <div className="flex justify-between gap-2">
                      <p className="min-w-0 truncate font-medium">
                        {step.name}
                      </p>
                      {step.amount > 0 && (
                        <p className="shrink-0 tabular-nums">
                          {formatMoney(step.amount, currentRates().currency)}
                        </p>
                      )}
                    </div>
                    {step.layers === 0 ? (
                      // the row worth reading the list for
                      <p className="text-xs text-muted">Nothing on this one.</p>
                    ) : (
                      step.surfaces
                        // a surface nobody touched is noise HERE, where the
                        // shape above it has already said it carries something
                        .filter((surface) => surface.rows.length > 0)
                        .map((surface) => (
                          <div key={surface.label} className="pt-1">
                            <p className="text-xs text-muted">
                              {surface.label}
                            </p>
                            <ul className="pl-3 text-xs">
                              {surface.rows.map((row) => (
                                <li key={row.id}>
                                  <span className="flex justify-between gap-2 py-0.5">
                                    <span className="min-w-0 truncate">
                                      {row.name}
                                    </span>
                                    <span className="shrink-0 text-muted tabular-nums">
                                      {formatQuantity(row.quantity, row.unit)}
                                      {row.priced
                                        ? ` · ${formatMoney(row.priced.amount, currentRates().currency)}`
                                        : ' · no rate'}
                                    </span>
                                  </span>
                                  {/* the strip-out is its own line on the
                                      invoice, not a note on the build one: it
                                      is separate work at a separate rate, and
                                      a bill that folded it into the layer
                                      above could not be reconciled against
                                      the BOQ's own demo- lines */}
                                  {row.demolition.on && (
                                    <span className="flex justify-between gap-2 py-0.5 pl-3">
                                      <span className="min-w-0 truncate text-muted">
                                        Take out {row.name}
                                      </span>
                                      <span className="shrink-0 text-muted tabular-nums">
                                        {row.demolition.quantity.toFixed(2)} m²
                                        {row.demolition.priced
                                          ? ` · ${formatMoney(row.demolition.priced.amount, currentRates().currency)}`
                                          : ' · no rate'}
                                      </span>
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Modal.Body>
          <Modal.Footer className="flex justify-between gap-2">
            {/* Back, not Close: this opened by walking off the end of the
                list, so the way out of it is the way back in */}
            <Button variant="ghost" onPress={onBack}>
              Back
            </Button>
            <Button onPress={onSubmit}>Submit</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
