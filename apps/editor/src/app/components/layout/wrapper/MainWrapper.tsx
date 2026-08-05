import type { ReactNode } from 'react';

interface MainWrapperProps {
  children: ReactNode;
}

const MainWrapper = ({ children }: MainWrapperProps) => {
  return (
    <div className="flex min-h-dvh justify-center">
      <div className="flex min-h-full w-full max-w-md flex-col bg-background relative">
        {children}
      </div>
    </div>
  );
};

export default MainWrapper;
