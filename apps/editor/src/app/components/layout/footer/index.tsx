import { IconArrowBackUp, IconCopy, IconTrash } from '@tabler/icons-react';
import { Insert } from './insert';
import { Button, ButtonGroup } from '@heroui/react';
const Footer = () => {
  return (
    <div className="absolute bottom-0 w-full flex items-center justify-between py-2 px-4">
      <Button isIconOnly aria-label="Undo" variant="outline">
        <IconArrowBackUp />
      </Button>
      <ButtonGroup>
        <Button aria-label="Duplicate" variant="outline">
          <IconCopy className="rotate-180" />
          Duplicate
        </Button>
        <Button isIconOnly aria-label="Delete" variant="outline">
          <IconTrash className="text-danger" />
        </Button>
      </ButtonGroup>
      <Insert />
    </div>
  );
};

export default Footer;
