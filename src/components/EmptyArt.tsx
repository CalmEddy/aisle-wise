import { Icon, type IconName } from './Icon';

/** A small friendly picture for an empty screen: a soft disc with the subject in it. */
export function EmptyArt({ name }: { name: IconName }) {
  return (
    <div className="empty-art" aria-hidden="true">
      <svg viewBox="0 0 120 96" width="120" height="96" focusable="false">
        <circle cx="60" cy="52" r="38" className="ea-disc" />
        <circle cx="18" cy="26" r="4" className="ea-dot" />
        <circle cx="104" cy="18" r="3" className="ea-dot" />
        <circle cx="100" cy="78" r="5" className="ea-dot" />
        <path d="M12 74h16M92 40h16" className="ea-dash" />
      </svg>
      <Icon name={name} size="2.4rem" className="ea-icon" />
    </div>
  );
}
