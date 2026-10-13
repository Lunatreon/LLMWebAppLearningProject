import type { Theme } from '../../types/navigation';

interface Props {
  theme: Theme;
  onToggle: () => void;
  className?: string;
}

export default function ThemeToggle({ theme, onToggle, className = 'header-theme-toggle' }: Props) {
  const label = `Use ${theme === 'light' ? 'dark' : 'light'} appearance`;
  return (
    <button
      className={`theme-toggle ${className}`}
      type="button"
      role="switch"
      aria-checked={theme === 'light'}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <span aria-hidden="true">☾</span>
      <span aria-hidden="true">☀</span>
    </button>
  );
}
