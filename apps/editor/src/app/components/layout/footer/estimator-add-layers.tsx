import { useState } from 'react';
import { Button, Checkbox, Label, Modal, SearchField } from '@heroui/react';
import type { Material, MaterialId } from '@acip/editor-core';

/**
 * The key a rate table will resolve this material by.
 *
 * `costCode` is optional on a material and the takeoff falls back to the name,
 * so the sheet has to fall back the same way or it would show a code the bill
 * never uses.
 */
export function codeOf(material: Material): string {
  return material.costCode ?? material.name;
}

/**
 * The one line under a material's name — what it is measured in, and what it
 * will be priced as.
 *
 * The unit is not a detail, it is the whole shape of the quantity: the same
 * face comes out as 12 m², as 0.36 m³ or as 138 tiles depending only on this.
 * A `count` material carries the tile size too, because "138 tiles" is a
 * different answer at 0.09 m² each than at 0.36.
 */
export function materialNote(material: Material): string {
  const measure =
    material.unit === 'count'
      ? `per unit${material.coverage ? `, ${material.coverage} m² each` : ''}`
      : material.unit === 'm2'
        ? 'by area (m²)'
        : material.unit === 'm3'
          ? 'by volume (m³)'
          : 'by length (m)';
  return `Priced ${measure} · ${codeOf(material)}`;
}

/**
 * Does a material answer what was typed?
 *
 * Name AND cost code, because the code is what an estimator who has seen the
 * rate table actually knows the thing by — type "wall-tile" and the material
 * that will be priced against it should come back. Case-folded and trimmed,
 * because a phone keyboard capitalises the first letter of a field on its own.
 */
export function matchesQuery(material: Material, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    material.name.toLowerCase().includes(needle) ||
    codeOf(material).toLowerCase().includes(needle)
  );
}

/**
 * The materials on offer, as rows that can be ticked.
 *
 * Ticks and not a single pick: a wall face is render AND skim AND paint, and
 * the sheet exists to add a build-up in one visit rather than to be reopened
 * once per layer.
 *
 * A material ALREADY on this face arrives ticked and disabled rather than
 * hidden. Hiding it would answer "why is plaster not in this list" with
 * silence, and on a second visit the sheet would look like a shorter catalogue
 * every time. Ticked and dead says the true thing: it is on, and this is not
 * where to take it off.
 *
 * Fully controlled: the query, what is ticked and what is already on are all
 * props, so a test can render this at any state with no dialog, no document
 * and no DOM to type into.
 */
export function LayerChoices({
  materials,
  query,
  picked,
  alreadyIn,
  onPick,
}: {
  materials: readonly Material[];
  query: string;
  /** ids ticked during this visit */
  picked: ReadonlySet<string>;
  /** material ids already on the face this sheet is adding to */
  alreadyIn: ReadonlySet<string>;
  onPick: (id: MaterialId, picked: boolean) => void;
}) {
  if (materials.length === 0) {
    // An empty library is a real state, not a bug: a drawing that arrived from
    // a file brings its own materials and a generated plan is seeded, but a
    // document could still have had them all removed.
    return (
      <p className="text-sm text-muted">
        This drawing has no materials yet, so there is nothing to build up from.
      </p>
    );
  }
  const shown = materials.filter((material) => matchesQuery(material, query));
  if (shown.length === 0) {
    return <p className="text-sm text-muted">Nothing matches “{query}”.</p>;
  }
  return (
    <ul className="text-left text-sm">
      {shown.map((material) => {
        const already = alreadyIn.has(material.id);
        return (
          // a hairline between rows: two lines per row makes where one row ends
          // and the next begins the difference between ticking Plaster and Paint
          <li
            key={material.id}
            className="border-b border-separator last:border-0"
          >
            <Checkbox
              isSelected={already || picked.has(material.id)}
              isDisabled={already}
              onChange={(on) => onPick(material.id, on)}
              className="w-full py-3"
            >
              {/* start, not center: the row is two lines tall and a tick beside
                  the middle of it reads as belonging to neither line */}
              <Checkbox.Content className="min-w-0 items-start gap-3">
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Label>{material.name}</Label>
                  <span className="text-xs text-muted">
                    {materialNote(material)}
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
 * The add sheet: what to build this face up from, picked out of the drawing's
 * own material library.
 *
 * The catalogue is the DOCUMENT's, not this app's. That is the whole of phase
 * one in one sentence: a material carries the unit the quantity comes out in
 * and the cost code the rate is looked up by, so picking one here is picking
 * something the bill of quantities already knows how to price. A hand-written
 * list in the app could only ever have been a picture of that.
 *
 * FULL SCREEN, alone among this app's sheets. Every other one is parked over
 * the plan because the plan is what it is describing; this one is a catalogue
 * with two lines per row, opened from a sheet that is already only half the
 * screen.
 *
 * Controlled and trigger-less, like the settings sheet: what opens it is a
 * button inside another dialog's body. Closed, the overlay renders null, so
 * every visit starts with an empty search and nothing ticked.
 */
export function AddLayersSheet({
  materials,
  sideLabel,
  isOpen,
  alreadyIn,
  onOpenChange,
  onSave,
}: {
  materials: readonly Material[];
  /** which side is being added to, or null for a shape with only one */
  sideLabel: string | null;
  isOpen: boolean;
  alreadyIn: ReadonlySet<string>;
  onOpenChange: (open: boolean) => void;
  /** the chosen materials, in catalogue order, to apply to the face */
  onSave: (materialIds: readonly MaterialId[]) => void;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="full">
        <Modal.Dialog>
          <AddLayersBody
            materials={materials}
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
 * The search and the ticks live here for one reason: a visit is a mount. Held
 * one level up they would survive closing, and the sheet would reopen holding
 * last visit's search and last visit's abandoned ticks, which is exactly what
 * pressing Close said not to keep.
 */
function AddLayersBody({
  materials,
  sideLabel,
  alreadyIn,
  close,
  onSave,
}: {
  materials: readonly Material[];
  sideLabel: string | null;
  alreadyIn: ReadonlySet<string>;
  close: () => void;
  onSave: (materialIds: readonly MaterialId[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  // Catalogue order, not tick order: the list this feeds is NUMBERED by the
  // order things went on, so adding four at once in the order the thumb
  // happened to reach them would build the stack in that order.
  const chosen = materials
    .filter((material) => picked.has(material.id))
    .map((material) => material.id);

  return (
    <>
      <Modal.Header>
        <p className="text-xs text-muted">
          {sideLabel ? `Add to ${sideLabel}` : 'Add layers'}
        </p>
        <Modal.Heading>Layers</Modal.Heading>
        {/* The search sits in the HEADER so it stays put while the list
            scrolls under it. A catalogue is exactly the list where the box for
            narrowing it must not be the first thing to scroll away. */}
        <SearchField
          fullWidth
          aria-label="Search materials"
          value={query}
          onChange={setQuery}
          className="pt-2"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Search materials" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </Modal.Header>
      <Modal.Body className="text-left">
        <LayerChoices
          materials={materials}
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
        {/* Close, not Cancel: nothing here has touched the drawing yet, so
            there is nothing to take back — the ticks are a draft until Save */}
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
