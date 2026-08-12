import { useState } from 'react';
import {
  Button,
  FieldError,
  Input,
  Label,
  Modal,
  TextField,
} from '@heroui/react';
import { IconSignature } from '@tabler/icons-react';
import type { EditorSession, SpaceInfo } from '@acip/editor-core';
import {
  classifySelection,
  findSpaceTag,
  isEntityInteractive,
  spaceName,
} from '@acip/editor-core';
import type { EditorUi } from '@/editor/ui-state';

/** the room the current selection IS, or null when it is not a room */
function selectedSpace(session: EditorSession, ui: EditorUi): SpaceInfo | null {
  return classifySelection(
    session.doc,
    session.selection.list(),
    ui.activeLevelId.get(),
  ).space;
}

/**
 * Name the selected room. Rooms are derived from the walls and hold no data of
 * their own, so the name goes to core's SPACE.SETNAME, which parks it on a tag
 * inside the room — clearing the field removes the tag again.
 */
export function RoomName({
  session,
  ui,
}: {
  session: EditorSession;
  ui: EditorUi;
}) {
  const space = selectedSpace(session, ui);
  const [name, setName] = useState(
    () => (space && spaceName(session.doc, space)) || '',
  );
  const [failed, setFailed] = useState(false);

  // A name already written on a locked layer is part of a drawing this user is
  // not editing — core refuses to touch it, so the field says so up front
  // rather than accepting a name and failing on Save.
  const existing = space ? findSpaceTag(session.doc, space) : null;
  const locked = !!existing && !isEntityInteractive(session.doc, existing);

  const apply = (close: () => void) => {
    if (!space) return;
    const levelId = ui.activeLevelId.get();
    const layerId = ui.activeLayerId.get();
    try {
      session.dispatch('SPACE.SETNAME', {
        at: space.labelPoint,
        name,
        ...(levelId ? { levelId } : {}),
        // a name is drawing, and new drawing belongs on the layer being drawn
        // on — write one inside the danger zone and it hides with the zone
        ...(layerId ? { layerId } : {}),
      });
    } catch {
      // the walls moved under us and the loop no longer reads as a room
      setFailed(true);
      return;
    }
    close();
  };

  return (
    <Modal>
      <Button isIconOnly aria-label="Room name" variant="tertiary">
        <IconSignature />
      </Button>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog>
            {({ close }: { close: () => void }) => (
              <>
                <Modal.Header>
                  <Modal.Heading>Room name</Modal.Heading>
                </Modal.Header>
                <Modal.Body>
                  <TextField
                    fullWidth
                    value={name}
                    onChange={(next) => {
                      setName(next);
                      setFailed(false);
                    }}
                    autoFocus
                    isInvalid={failed}
                  >
                    <Label>Name</Label>
                    <Input placeholder="Kitchen" />
                    <FieldError>
                      This is no longer a closed room — check its walls.
                    </FieldError>
                  </TextField>
                  <p className="mt-2 text-xs text-muted">
                    {!space
                      ? 'Select a room first.'
                      : locked
                        ? `${space.netArea.toFixed(1)} m² · this room is named on a locked layer`
                        : `${space.netArea.toFixed(1)} m² · clear the name to remove it`}
                  </p>
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2">
                  <Button variant="ghost" onPress={close}>
                    Cancel
                  </Button>
                  <Button
                    isDisabled={!space || locked}
                    onPress={() => apply(close)}
                  >
                    Save
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
