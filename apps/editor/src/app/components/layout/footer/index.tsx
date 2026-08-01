import { IconArrowBackUp, IconCopy } from '@tabler/icons-react';
import { Insert } from './insert';
import { Button } from '@heroui/react';
const Footer = () => {
  return (
    <div className="absolute bottom-0 w-full flex items-center justify-evenly">
      <Button isIconOnly aria-label="Undo" variant="outline">
        <IconArrowBackUp />
      </Button>
      <Button aria-label="Redo" variant="outline">
        <IconCopy className="rotate-180" />
        Duplicate
      </Button>
      <Insert />
    </div>
  );
};

export default Footer;
