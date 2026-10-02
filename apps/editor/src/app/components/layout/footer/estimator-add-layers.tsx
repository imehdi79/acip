import { useState } from 'react';
import {
  Button,
  Checkbox,
  Input,
  Label,
  Modal,
  SearchField,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@heroui/react';
import { IconPlus } from '@tabler/icons-react';
import type { Material, MaterialId, MaterialUnit } from '@acip/editor-core';
import { currentRates, demoCodeFor } from '@/data/rates';
import type { RateTable } from '@acip/estimator';

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
 * A name as a cost code: `Gypsum board 12mm` → `gypsum-board-12mm`.
 *
 * Kebab-case because that is what every code already in the table looks like
 * (`wall-tile`, `concrete-slab`), and a code is not decoration — it is the KEY
 * the rate is looked up by, here and in `assembleBoq`. A code that arrived
 * capitalised on a phone would be a different key from the same word typed on
 * a desktop, and the second one would price as "no rate yet".
 */
export function toCostCode(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The new-layer form as it stands, mid-typing.
 *
 * Every number is a STRING here, deliberately. A half-typed price is not a
 * number — `Number('')` is 0, and 0 is a price this app goes out of its way to
 * distinguish from "nobody has quoted this". Holding the text means an empty
 * box stays empty instead of quietly becoming free.
 */
export interface LayerDraft {
  readonly name: string;
  readonly unit: MaterialUnit;
  /** blank means "follow the name" — see `manualLayerFrom` */
  readonly costCode: string;
  /** m² covered by one unit; only a `count` material uses it */
  readonly coverage: string;
  readonly unitCost: string;
  /** what taking it back off costs, per m². Blank is an answer — see below. */
  readonly demoCost: string;
}

/**
 * m², not m³, for a form opened from a list of FINISHES.
 *
 * The thing being added here is nearly always a coat of something on a face —
 * paint, render, tile — and those are bought by the area they cover. Landing
 * on volume would make the commonest case the one that needs correcting.
 */
export const EMPTY_DRAFT: LayerDraft = {
  name: '',
  unit: 'm2',
  costCode: '',
  coverage: '',
  unitCost: '',
  demoCost: '',
};

/** a material to add, and what it costs — the two halves this sheet writes */
export interface ManualLayer {
  readonly name: string;
  readonly unit: MaterialUnit;
  readonly costCode: string;
  readonly coverage?: number;
  readonly unitCost: number;
  /**
   * What stripping it out costs, per m², or undefined when nobody has said.
   *
   * Always per m², whatever the layer itself is bought by. That is not a
   * simplification, it is the convention the bill already runs on: `boq.ts`
   * prices a demolished finish as "the SAME area, against a `demo-` code — no
   * tile counting, coverage is irrelevant when you are tearing a surface off".
   * A tile bought at 2.40 each comes off at so much the square metre.
   *
   * Optional, unlike the build price. `DEMO_RATES` ships deliberately
   * incomplete — nothing prices `demo-block` or `demo-screed` — on the
   * argument that a missing rate is a real answer the sheet shows as "no rate
   * yet", and inventing one would be putting a figure in a bill nobody quoted.
   * Forcing a strip-out price here would contradict that for every layer added
   * as new build, which is most of them.
   */
  readonly demoCost?: number;
}

/**
 * The draft as something that can be saved, or null while it is not one yet.
 *
 * One function decides this, and the Add button is disabled by the same call
 * that builds what Add sends — so the button cannot be live for a draft that
 * would then be written half-formed.
 *
 * A blank cost code is not a missing answer, it is the DEFAULT one: the code
 * follows the name until somebody types over it, which is what the placeholder
 * under the box is showing all along.
 *
 * Coverage stays optional even for a `count` material. Core already decides
 * what a missing one means (`layerQuantity` falls back to one unit per m²),
 * and refusing the layer over it would block somebody pricing bags of
 * something by the square metre of wall — which is a real way to buy.
 *
 * The strip-out price is optional too, but not LENIENT: blank leaves it
 * unquoted, and anything else has to be a real price or the whole draft is
 * refused. Silently dropping a "-5" somebody typed would add the layer with no
 * strip-out rate while they believed they had set one — the sheet would then
 * show "no rate yet" for a figure they watched themselves enter.
 */
export function manualLayerFrom(draft: LayerDraft): ManualLayer | null {
  const name = draft.name.trim();
  if (!name) return null;
  const costCode = draft.costCode.trim() || toCostCode(name);
  if (!costCode) return null;
  // trimmed first: a blank box parses as NaN and is refused, where `Number('')`
  // would have made it zero
  const unitCost = Number.parseFloat(draft.unitCost.trim());
  if (!Number.isFinite(unitCost) || unitCost < 0) return null;
  let layer: ManualLayer = { name, unit: draft.unit, costCode, unitCost };

  const typedDemo = draft.demoCost.trim();
  if (typedDemo !== '') {
    const demoCost = Number.parseFloat(typedDemo);
    if (!Number.isFinite(demoCost) || demoCost < 0) return null;
    layer = { ...layer, demoCost };
  }

  if (draft.unit !== 'count') return layer;
  const coverage = Number.parseFloat(draft.coverage.trim());
  return Number.isFinite(coverage) && coverage > 0
    ? { ...layer, coverage }
    : layer;
}

/**
 * An existing material and its rates, back as a draft that can be re-typed.
 *
 * The exact inverse of `manualLayerFrom`, and the reason the edit sheet is the
 * add sheet: what a layer IS and what it costs are the same set of answers
 * whether they are being given for the first time or corrected. A second form
 * for editing would be a second place for the cost code to be derived, and the
 * two would drift.
 *
 * Prices come from the live TABLE, not the material, because that is where
 * prices live — core stores a `costCode` and never a figure. A material whose
 * code nobody has quoted opens with empty price boxes, which is the honest
 * showing of "no rate yet" and is directly typeable over.
 *
 * The cost code is written out in full rather than left to follow the name. On
 * an existing material the code is a fact the bill is already using, and
 * leaving it blank to be re-derived would silently re-key a layer the moment
 * somebody fixed a typo in its name.
 */
export function draftFrom(material: Material, table: RateTable): LayerDraft {
  const costCode = codeOf(material);
  const build = table.rates[costCode];
  const demo = table.rates[demoCodeFor(costCode)];
  return {
    name: material.name,
    unit: material.unit,
    costCode,
    coverage: material.coverage === undefined ? '' : String(material.coverage),
    unitCost: build === undefined ? '' : String(build.unitCost),
    demoCost: demo === undefined ? '' : String(demo.unitCost),
  };
}

/** what each unit is called where there is room to say it properly */
const UNIT_OPTIONS: readonly { id: MaterialUnit; label: string }[] = [
  { id: 'm3', label: 'm³' },
  { id: 'm2', label: 'm²' },
  { id: 'm', label: 'm' },
  { id: 'count', label: 'unit' },
];

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
 * The new-layer form, fully controlled.
 *
 * Controlled for the same reason `LayerChoices` is: a test can render it at
 * any state — a blank draft, a half-typed price, a `count` material with its
 * tile size showing — with no dialog, no document and no DOM to type into.
 *
 * The unit sits second, right under the name, because it is the field that
 * changes what every other one MEANS: the same face is 12 m², 0.36 m³ or 138
 * tiles depending only on this, and the price box below it is "per" whatever
 * this says.
 */
export function NewLayerFields({
  draft,
  currency,
  onChange,
}: {
  draft: LayerDraft;
  /** the table's own currency, so the price box says what it is asking for */
  currency: string;
  onChange: (draft: LayerDraft) => void;
}) {
  const unitSuffix = draft.unit === 'count' ? 'unit' : draft.unit;
  return (
    <div className="flex flex-col gap-4 text-left">
      <TextField
        fullWidth
        value={draft.name}
        onChange={(name) => onChange({ ...draft, name })}
        autoFocus
      >
        <Label>Name</Label>
        <Input placeholder="Gypsum board 12mm" />
      </TextField>

      <div className="flex flex-col gap-2">
        <Label id="new-layer-unit">Measured by</Label>
        {/* single-selection and never empty: these are four answers to "how is
            this bought", not four switches. Nothing is a legal answer. */}
        <ToggleButtonGroup
          fullWidth
          size="lg"
          aria-labelledby="new-layer-unit"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[draft.unit]}
          onSelectionChange={(keys) => {
            const picked = UNIT_OPTIONS.find((option) => keys.has(option.id));
            if (picked) onChange({ ...draft, unit: picked.id });
          }}
        >
          {UNIT_OPTIONS.map((option) => (
            <ToggleButton id={option.id} key={option.id}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      {/* only where it does something. Coverage is what turns an area into a
          number of pieces, and on an m²/m³/m material core ignores it — a box
          that is read by nothing is worse than no box. */}
      {draft.unit === 'count' && (
        <TextField
          fullWidth
          value={draft.coverage}
          onChange={(coverage) => onChange({ ...draft, coverage })}
        >
          <Label>Size of one unit</Label>
          <Input inputMode="decimal" placeholder="0.09" />
          <p className="pt-1 text-xs text-muted">
            m² each, so an area can be turned into a count — a 0.3 × 0.3 tile is
            0.09. Left blank, one unit covers one m².
          </p>
        </TextField>
      )}

      <TextField
        fullWidth
        value={draft.unitCost}
        onChange={(unitCost) => onChange({ ...draft, unitCost })}
      >
        <Label>Price</Label>
        <Input inputMode="decimal" placeholder="0.00" />
        <p className="pt-1 text-xs text-muted">
          {currency} per {unitSuffix}.
        </p>
      </TextField>

      {/* Straight after the build price, because the two are read together:
          "what does this cost to put on, and what does it cost to get off".
          Per m² and NOT per `unitSuffix` — a strip-out is priced by the area
          coming off, never by the piece, which is the rule `boq.ts` already
          measures demolition by. */}
      <TextField
        fullWidth
        value={draft.demoCost}
        onChange={(demoCost) => onChange({ ...draft, demoCost })}
      >
        <Label>Strip-out price</Label>
        <Input inputMode="decimal" placeholder="0.00" />
        <p className="pt-1 text-xs text-muted">
          {currency} per m² to take it back off, billed to{' '}
          {/* an empty code already falls through to `demo-finish` inside
              demoCodeFor, so a blank form still names a real line */}
          {demoCodeFor(draft.costCode.trim() || toCostCode(draft.name))}. Leave
          it blank if nobody has quoted the strip-out.
        </p>
      </TextField>

      <TextField
        fullWidth
        value={draft.costCode}
        onChange={(costCode) => onChange({ ...draft, costCode })}
      >
        <Label>Cost code</Label>
        {/* the derived code as the PLACEHOLDER, not as the value: shown, so
            nobody has to guess what the bill will call this, and still
            following the name until somebody deliberately types over it */}
        <Input placeholder={toCostCode(draft.name) || 'gypsum-board-12mm'} />
        <p className="pt-1 text-xs text-muted">
          What the bill looks this price up by. Match a code your rate table
          already uses and the two will price as one line.
        </p>
      </TextField>
    </div>
  );
}

/**
 * The sheet behind the plus: a layer this drawing did not have, and a price
 * for it.
 *
 * It writes to BOTH halves of the seam in one go, which is the whole reason it
 * can exist at all: the material goes into the DOCUMENT (where a finish can
 * reference it and a saved plan keeps it), and the price goes into the app's
 * rate table (which is where core has always insisted prices live — it stores
 * a `costCode` and never a figure). Neither half is any use alone: a material
 * with no rate prices as "no rate yet", and a rate nothing references never
 * reaches a bill.
 *
 * Its own modal over the catalogue rather than a panel inside it, for the
 * reason the catalogue is its own modal over the wizard: a form and a list you
 * are picking from want the whole screen, and stacking them keeps the thing
 * behind unchanged and waiting. Closed, it renders null, so every visit starts
 * on a blank draft.
 */
export function LayerSheet({
  isOpen,
  material,
  currency,
  onOpenChange,
  onCommit,
}: {
  isOpen: boolean;
  /**
   * The material being corrected, or null to describe one that does not exist
   * yet.
   *
   * One prop decides the whole difference between adding and editing: what the
   * draft starts as, what the header says, and what the button is called. There
   * is no `mode` beside it, because a second flag could contradict this one.
   */
  material: Material | null;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onCommit: (layer: ManualLayer) => void;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container size="full">
        <Modal.Dialog>
          <LayerBody
            material={material}
            currency={currency}
            close={() => onOpenChange(false)}
            onCommit={onCommit}
          />
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** the draft lives here so that closing the sheet is what throws it away */
function LayerBody({
  material,
  currency,
  close,
  onCommit,
}: {
  material: Material | null;
  currency: string;
  close: () => void;
  onCommit: (layer: ManualLayer) => void;
}) {
  // seeded ONCE, from the material as it stood when the sheet opened: a draft
  // that re-synced would overwrite what is being typed every time the document
  // announced a change, and this sheet is opened from a list that re-reads the
  // document on every committed transaction
  const [draft, setDraft] = useState<LayerDraft>(() =>
    material ? draftFrom(material, currentRates()) : EMPTY_DRAFT,
  );
  const layer = manualLayerFrom(draft);

  return (
    <>
      <Modal.Header>
        <p className="text-xs text-muted">
          {material ? codeOf(material) : 'Not in this drawing yet'}
        </p>
        <Modal.Heading>{material ? material.name : 'New layer'}</Modal.Heading>
        {/* said once, up front, because it is the one thing about editing that
            is not obvious from the form: a material is the DRAWING's, not this
            face's, and the bill adds every face that uses it into one line */}
        {material && (
          <p className="pt-2 text-xs text-muted">
            Editing the material itself, so every layer in this drawing built
            from it changes with it.
          </p>
        )}
      </Modal.Header>
      <Modal.Body>
        <NewLayerFields draft={draft} currency={currency} onChange={setDraft} />
      </Modal.Body>
      <Modal.Footer className="flex justify-end gap-2">
        <Button variant="ghost" onPress={close}>
          Cancel
        </Button>
        {/* one call decides both: the button is live exactly when there is
            something to send, and what it sends is what made it live */}
        <Button
          isDisabled={layer === null}
          onPress={() => {
            if (!layer) return;
            onCommit(layer);
            close();
          }}
        >
          {material ? 'Save' : 'Add'}
        </Button>
      </Modal.Footer>
    </>
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
  currency,
  onOpenChange,
  onCreate,
  onSave,
}: {
  materials: readonly Material[];
  /** which side is being added to, or null for a shape with only one */
  sideLabel: string | null;
  isOpen: boolean;
  alreadyIn: ReadonlySet<string>;
  /** the live rate table's currency, for the new-layer form's price box */
  currency: string;
  onOpenChange: (open: boolean) => void;
  /**
   * Put a hand-written material and its price into the drawing and the rate
   * table, and hand back the new material's id so the sheet can tick it.
   *
   * Null when the write did not take — the sheet then leaves the catalogue
   * alone rather than ticking an id that does not exist.
   */
  onCreate: (layer: ManualLayer) => MaterialId | null;
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
            currency={currency}
            close={() => onOpenChange(false)}
            onCreate={onCreate}
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
  currency,
  close,
  onCreate,
  onSave,
}: {
  materials: readonly Material[];
  sideLabel: string | null;
  alreadyIn: ReadonlySet<string>;
  currency: string;
  close: () => void;
  onCreate: (layer: ManualLayer) => MaterialId | null;
  onSave: (materialIds: readonly MaterialId[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  /** whether the new-layer form is up over the catalogue */
  const [creating, setCreating] = useState(false);

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
        <div className="flex items-center gap-2 pt-2">
          <SearchField
            fullWidth
            aria-label="Search materials"
            value={query}
            onChange={setQuery}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search materials" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          {/* Next to the search, and that placement is the argument for it:
              searching for something that is not in the catalogue is exactly
              the moment you find out it needs adding, and the answer should be
              where the question was asked rather than back out through Close.
              Icon-only because the row is a phone's width and the search box
              is the thing that must not shrink — so it carries a label for
              anyone who is not looking at it. */}
          <Button
            variant="ghost"
            aria-label="New layer"
            className="shrink-0"
            onPress={() => setCreating(true)}
          >
            <IconPlus />
          </Button>
        </div>
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
        {/* Close, not Cancel: the ticks are a draft until Save, so there is
            nothing here to take back. Not quite "nothing has been written" any
            more — a layer added through the plus is in the drawing the moment
            it is added — but that is an edit of its own, on the undo stack like
            any other, and not one this button ever promised to reverse. */}
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
      {/* Over the catalogue, so what is already ticked is still ticked when it
          closes. A new layer arrives TICKED: adding one is already saying you
          want it on this face, and making the user find it again in a list it
          was just added to would be asking the same question twice. */}
      <LayerSheet
        isOpen={creating}
        material={null}
        currency={currency}
        onOpenChange={setCreating}
        onCommit={(layer) => {
          const id = onCreate(layer);
          if (!id) return;
          setPicked((ids) => new Set(ids).add(id));
        }}
      />
    </>
  );
}
