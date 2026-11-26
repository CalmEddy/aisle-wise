import { ICONS } from './iconData';

export type IconName = keyof typeof ICONS;

/**
 * A Lucide line icon (see iconData.ts). Draws in the surrounding text colour and
 * scales with the font size, so it matches the theme in light and dark mode.
 * Decorative by default: put the accessible name on the button that contains it.
 */
export function Icon({ name, size = '1.15em', filled, className, title }: {
  name: IconName;
  /** CSS size (square). */
  size?: string | number;
  /** Fill the shape with the current colour (e.g. a pinned location). */
  filled?: boolean;
  className?: string;
  /** Only when the icon stands alone with no text or label next to it. */
  title?: string;
}) {
  return (
    <svg
      className={`icon-svg${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/** The arrow icon for a direction (map editing: move, extend, step). */
export const ARROW_ICON: Record<'up' | 'down' | 'left' | 'right', IconName> = {
  up: 'arrow-up', down: 'arrow-down', left: 'arrow-left', right: 'arrow-right',
};
