import { IconArrowBackUp, IconCopy, IconTrash } from '@tabler/icons-react';
import { Insert } from './insert';
import { Button, ButtonGroup } from '@heroui/react';
import { useCan } from '@/app/stores/global/settings.store';

const Footer = () => {
  const canUndo = useCan('footer.undo');
  const canDuplicate = useCan('footer.duplicate');
  const canDelete = useCan('footer.delete');

  return (
    <div className="absolute bottom-0 h-14 w-full flex items-center justify-between px-4">
      {canUndo && (
        <Button isIconOnly aria-label="Undo" variant="tertiary">
          <IconArrowBackUp />
        </Button>
      )}
      {(canDuplicate || canDelete) && (
        <ButtonGroup>
          {canDuplicate && (
            <Button aria-label="Duplicate" variant="tertiary">
              <IconCopy className="rotate-180" />
              Duplicate
            </Button>
          )}
          {canDelete && (
            <Button isIconOnly aria-label="Delete" variant="tertiary">
              <IconTrash className="text-danger" />
            </Button>
          )}
        </ButtonGroup>
      )}
      {/* ml-auto keeps insert on the right when the other buttons are hidden */}
      <div className="justify-self-end">
        <Insert />
      </div>
    </div>
  );
};

export default Footer;
