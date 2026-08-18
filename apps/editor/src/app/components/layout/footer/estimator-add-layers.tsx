import { useEffect, useState } from 'react';
import { Button, Checkbox, Label, Modal, SearchField } from '@heroui/react';
import { loadLayers, type LayerOption } from '@/data/layers';

/**
 * Does a layer answer what was typed?
 *
 * Label AND description, because half of what separates two layers lives in
 * the description — type "face" and the plaster that says "to this face" is a
 * better answer than anything with the word in its name. Case-folded and
 * trimmed, because a phone keyboard capitalises the first letter of a field on
 * its own and nobody meant to search for `Paint` and not `paint`.
 *
 * A free function over one layer, so the filter is testable without a DOM, a
 * fetch or a dialog — the same reason the lists below are controlled.
 */
export function matchesQuery(layer: LayerOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    layer.label.toLowerCase().includes(needle) ||
    layer.description.toLowerCase().includes(needle)
  );
}

/**
 * The layers on offer, as rows that can be ticked.
 *
 * Ticks and not a single pick: a wall face is render AND skim AND paint, and
 * the sheet exists to add a build-up in one visit rather than to be reopened
 * once per layer.
 *
 * A layer ALREADY in the list arrives ticked and disabled rather than hidden.
 * Hiding it would answer "why is plaster not in this list" with silence, and
 * on a second visit — which is the whole point of an add button that stays —
 * the sheet would look like a different, shorter catalogue every time. Ticked
 * and dead says the true thing: it is in, and this is not where to take it out.
 *
 * Fully controlled: the query, what is ticked and what is already in are all
 * props. That is what lets a node test render this at any state at all with no
 * dialog, no fetch and no DOM to type into.
 */
export function LayerChoices({
  layers,
  query,
  picked,
  alreadyIn,
  onPick,
}: {
  /** the catalogue for this kind; null while it is still coming */
  layers: readonly LayerOption[] | null;
  query: string;
  /** ids ticked during this visit */
  picked: ReadonlySet<string>;
  /** ids already on the list this sheet is adding to */
  alreadyIn: ReadonlySet<string>;
  onPick: (id: string, picked: boolean) => void;
}) {
  if (!layers) return <p className="text-sm text-muted">Loading layers…</p>;
  if (layers.length === 0) {
    // the walk covers shapes nobody has described yet; having no layers for
    // one is an answer, not a blank sheet to stare at
    return <p className="text-sm text-muted">No layers for this yet.</p>;
  }
  const shown = layers.filter((layer) => matchesQuery(layer, query));
  if (shown.length === 0) {
    return <p className="text-sm text-muted">Nothing matches “{query}”.</p>;
  }
  return (
    <ul className="text-left text-sm">
      {shown.map((layer) => {
        const already = alreadyIn.has(layer.id);
        return (
          // a hairline between rows: two lines of prose per row makes where one
          // row ends and the next begins the difference between ticking Skim
          // and ticking Paint
          <li
            key={layer.id}
            className="border-b border-separator last:border-0"
          >
            <Checkbox
              isSelected={already || picked.has(layer.id)}
              isDisabled={already}
              onChange={(on) => onPick(layer.id, on)}
              className="w-full py-3"
            >
              {/* start, not center: the row is two lines tall and a tick
                  floating beside the middle of a wrapped sentence reads as
                  belonging to neither line */}
              <Checkbox.Content className="min-w-0 items-start gap-3">
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Label>{layer.label}</Label>
                  <span className="text-xs text-muted">
                    {layer.description}
                  </span>
                  {already && (
                    <span className="text-xs text-muted">
                      Already on this side.
                    </span>
                  )}
                </span>
              </Checkbox.Content>
            </Checkbox>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The add sheet: what to build this side up from, picked out of the catalogue
 * for the kind of shape being priced.
 *
 * FULL SCREEN, alone among this app's sheets. Every other one is parked over
 * the plan because the plan is what it is describing; this one is not about the
 * drawing at all — it is a catalogue with two lines of prose per row, and the
 * bottom sheet it opens from is already only half the screen. Given a third of
 * a phone it would show three rows and make choosing a build-up an exercise in
 * scrolling.
 *
 * Controlled and trigger-less, like the settings sheet: what opens it is a
 * button inside another dialog's body, and wrapping that in a <Modal> root
 * would leave the root holding a press responder for a button that already has
 * one. Closed, the overlay renders null — so the fetch below does not happen,
 * and every visit starts with an empty search and nothing ticked because the
 * body is genuinely new each time.
 */
export function AddLayersSheet({
  kind,
  sideLabel,
  isOpen,
  alreadyIn,
  onOpenChange,
  onSave,
}: {
  /** the `EstimatorStep.kind` whose catalogue to offer — `wall`, `room`… */
  kind: string;
  /** which side is being added to, or null for a shape with only one */
  sideLabel: string | null;
  isOpen: boolean;
  alreadyIn: ReadonlySet<string>;
  onOpenChange: (open: boolean) => void;
  /** the chosen layers, in catalogue order, to append to the list */
  onSave: (layers: readonly LayerOption[]) => void;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="full">
        <Modal.Dialog>
          <AddLayersBody
            kind={kind}
            sideLabel={sideLabel}
            alreadyIn={alreadyIn}
            close={() => onOpenChange(false)}
            onSave={onSave}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/**
 * Everything inside the add sheet — split out so that it MOUNTS with the sheet.
 *
 * The fetch, the search and the ticks all live here for one reason: a visit is
 * a mount. Held one level up they would survive closing, and the sheet would
 * reopen holding last visit's search and last visit's abandoned ticks, which is
 * exactly what pressing Close said not to keep.
 */
function AddLayersBody({
  kind,
  sideLabel,
  alreadyIn,
  close,
  onSave,
}: {
  kind: string;
  sideLabel: string | null;
  alreadyIn: ReadonlySet<string>;
  close: () => void;
  onSave: (layers: readonly LayerOption[]) => void;
}) {
  /** the catalogue, once it arrives; null while it is still coming */
  const [layers, setLayers] = useState<readonly LayerOption[] | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  // One request per opening, for one kind. The flag is not ceremony — this
  // sheet can be closed before a promise settles, and setting state on a body
  // that is gone is a warning at best.
  useEffect(() => {
    let live = true;
    void loadLayers(kind).then((book) => {
      if (live) setLayers(book);
    });
    return () => {
      live = false;
    };
  }, [kind]);

  // Catalogue order, not tick order: the list this feeds is NUMBERED, and the
  // numbers are the order the layers go on. Adding four at once in the order
  // the thumb happened to reach them would number a wall paint, render, skim —
  // a build-up that cannot be built.
  const chosen = (layers ?? []).filter((layer) => picked.has(layer.id));

  return (
    <>
      <Modal.Header>
        <p className="text-xs text-muted">
          {sideLabel ? `Add to ${sideLabel}` : 'Add layers'}
        </p>
        <Modal.Heading>Layers</Modal.Heading>
        {/* The search sits in the HEADER, not at the top of the body, so it
            stays put while the list scrolls under it. A catalogue is exactly
            the list where the box for narrowing it must not be the first thing
            to scroll away. */}
        <SearchField
          fullWidth
          aria-label="Search layers"
          value={query}
          onChange={setQuery}
          className="pt-2"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search layers" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </Modal.Header>
      <Modal.Body className="text-left">
        <LayerChoices
          layers={layers}
          query={query}
          picked={picked}
          alreadyIn={alreadyIn}
          onPick={(id, on) =>
            setPicked((ids) => {
              const next = new Set(ids);
              if (on) next.add(id);
              else next.delete(id);
              return next;
            })
          }
        />
      </Modal.Body>
      <Modal.Footer className="flex justify-end gap-2">
        {/* Close, not Cancel: nothing here has taken effect yet, so there is
            nothing to take back — the ticks are a draft until Save */}
        <Button variant="ghost" onPress={close}>
          Close
        </Button>
        {/* dead until something is ticked: a Save that adds nothing is a tap
            that looks like it worked and did not */}
        <Button
          isDisabled={chosen.length === 0}
          onPress={() => {
            onSave(chosen);
            close();
          }}
        >
          Save
        </Button>
      </Modal.Footer>
    </>
  );
}
