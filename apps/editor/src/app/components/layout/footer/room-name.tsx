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
import { classifySelection, spaceName } from '@acip/editor-core';
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

  const apply = (close: () => void) => {
    if (!space) return;
    const levelId = ui.activeLevelId.get();
    try {
      session.dispatch('SPACE.SETNAME', {
        at: space.labelPoint,
        name,
        ...(levelId ? { levelId } : {}),
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
                    {space
                      ? `${space.netArea.toFixed(1)} m² · clear the name to remove it`
                      : 'Select a room first.'}
                  </p>
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2">
                  <Button variant="ghost" onPress={close}>
                    Cancel
                  </Button>
                  <Button isDisabled={!space} onPress={() => apply(close)}>
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
