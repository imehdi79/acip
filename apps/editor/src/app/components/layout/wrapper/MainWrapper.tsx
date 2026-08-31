import type { ReactNode } from 'react';

interface MainWrapperProps {
  children: ReactNode;
}

/**
 * The app shell, and the one place its height is decided.
 *
 * The height comes from `.app-shell` in app.css rather than from a utility,
 * because it needs a `vh` declaration underneath a `dvh` one and Tailwind
 * cannot express that: class-attribute order changes nothing, and its emit
 * order puts `.min-h-screen` after `.min-h-dvh`, so writing both handed every
 * modern browser the `vh` that ignores Safari's toolbar. See app.css.
 *
 * The inner panel used to ask for `min-h-full`. A percentage min-height
 * resolves against the parent's HEIGHT, and the parent has only a min-height —
 * so it resolved against auto, collapsed to its content, and took the
 * absolutely positioned header and footer down with it: `bottom-0` of a box
 * that is as tall as its contents is not the bottom of the screen. It is a
 * flex child now and stretches on the cross axis for free, which needs no
 * percentage and no parent height to resolve against.
 */
const MainWrapper = ({ children }: MainWrapperProps) => {
  return (
    <div className="app-shell flex justify-center">
      <div className="relative flex w-full max-w-md flex-col bg-background">
        {children}
      </div>
    </div>
  );
};

export default MainWrapper;
