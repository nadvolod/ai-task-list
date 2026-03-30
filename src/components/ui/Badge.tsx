import type { ReactNode } from 'react';

type BadgeVariant = 'danger' | 'warning' | 'info' | 'success' | 'muted' | 'purple' | 'cyan' | 'teal' | 'amber' | 'blue' | 'indigo' | 'yellow';

const variantStyles: Record<BadgeVariant, string> = {
  danger: 'text-red-600 bg-red-50',
  warning: 'text-orange-600 bg-orange-50',
  info: 'text-blue-700 bg-blue-50',
  success: 'text-green-700 bg-green-50',
  muted: 'text-gray-500 bg-gray-100',
  purple: 'text-purple-700 bg-purple-50',
  cyan: 'text-cyan-700 bg-cyan-50',
  teal: 'text-teal-700 bg-teal-50',
  amber: 'text-amber-700 bg-amber-50',
  blue: 'text-blue-700 bg-blue-50',
  indigo: 'text-indigo-700 bg-indigo-50',
  yellow: 'text-yellow-700 bg-yellow-50',
};

interface BadgeProps {
  variant: BadgeVariant;
  icon?: ReactNode;
  children: ReactNode;
  bold?: boolean;
}

export default function Badge({ variant, icon, children, bold = true }: BadgeProps) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${bold ? 'font-semibold' : 'font-medium'} ${variantStyles[variant]} inline-flex items-center gap-1`}>
      {icon}
      {children}
    </span>
  );
}
