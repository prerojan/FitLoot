export const theme = {
  colors: {
    primary: {
      500: 'emerald-500',
      600: 'emerald-600',
    },
    secondary: {
      500: 'teal-500',
      600: 'teal-600',
    },
    neutral: {
      50: 'gray-50',
      100: 'gray-100',
      600: 'gray-600',
      900: 'gray-900',
    },
    danger: {
      500: 'red-500',
      600: 'red-600',
    },
  },
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif',
    sizes: {
      xs: 'text-xs',
      sm: 'text-sm',
      base: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl',
      '2xl': 'text-2xl',
      '3xl': 'text-3xl',
    },
    weights: {
      medium: 'font-medium',
      semibold: 'font-semibold',
      bold: 'font-bold',
    },
  },
  spacing: {
    xs: 'p-2',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
    xl: 'p-8',
  },
  radius: {
    sm: 'rounded-lg',
    md: 'rounded-xl',
    lg: 'rounded-2xl',
    full: 'rounded-full',
  },
  shadows: {
    sm: 'shadow-sm',
    md: 'shadow-md',
    lg: 'shadow-lg',
    xl: 'shadow-xl',
  },
} as const;

export type Theme = typeof theme;
