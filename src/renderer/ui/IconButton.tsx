import type { ButtonHTMLAttributes, ComponentType, Ref } from 'react';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>;
  size?: number;
  buttonRef?: Ref<HTMLButtonElement>;
}

/** Icon-only button; the label is both the accessible name and the tooltip. */
export function IconButton({ label, icon: Icon, size = 16, buttonRef, className, type = 'button', title, ...rest }: IconButtonProps) {
  return (
    <button ref={buttonRef} type={type} aria-label={label} title={title ?? label} className={`icon-btn ${className ?? ''}`.trim()} {...rest}>
      <Icon size={size} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
