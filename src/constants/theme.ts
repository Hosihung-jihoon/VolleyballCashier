/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

export const DuoTheme = {
  colors: {
    // Brand Primary (Royal Blue)
    primary: '#2563EB',
    primaryDark: '#1D4ED8',
    primaryLight: '#EFF6FF',

    // Status Colors (Sports-Fintech Palette)
    green: '#16A34A',
    greenDark: '#15803D',
    greenLight: '#DCFCE7',
    blue: '#2563EB',
    blueDark: '#1D4ED8',
    blueLight: '#EFF6FF',
    orange: '#EA580C',
    orangeDark: '#C2410C',
    orangeLight: '#FFEDD5',
    red: '#DC2626',
    redDark: '#B91C1C',
    redLight: '#FEE2E2',
    yellow: '#D97706',
    yellowDark: '#B45309',
    yellowLight: '#FEF3C7',
    purple: '#7C3AED',
    purpleDark: '#6D28D9',
    purpleLight: '#FAF5FF',

    // Team-Specific Color Schemes
    teamA: {
      primary: '#2563EB',
      bg: '#EFF6FF',
      border: '#BFDBFE',
      text: '#1D4ED8',
      badge: '#DBEAFE',
    },
    teamB: {
      primary: '#E11D48',
      bg: '#FFF1F2',
      border: '#FECDD3',
      text: '#BE123C',
      badge: '#FFE4E6',
    },
    teamC: {
      primary: '#059669',
      bg: '#F0FDF4',
      border: '#BBF7D0',
      text: '#047857',
      badge: '#DCFCE7',
    },
    teamD: {
      primary: '#7C3AED',
      bg: '#FAF5FF',
      border: '#E9D5FF',
      text: '#6D28D9',
      badge: '#F3E8FF',
    },
    teamResting: {
      primary: '#64748B',
      bg: '#F8FAFC',
      border: '#E2E8F0',
      text: '#64748B',
      badge: '#F1F5F9',
    },

    // Neutrals & Surfaces (Slate Palette)
    grayDark: '#0F172A',
    grayText: '#475569',
    grayMuted: '#94A3B8',
    border: '#E2E8F0',
    borderDark: '#CBD5E1',
    card: '#FFFFFF',
    background: '#F8FAFC',
  },
  borderRadius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    full: 9999,
  },
  shadows: {
    card: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 3,
      elevation: 2,
    },
    button: {
      shadowColor: '#2563EB',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 3,
    },
  },
} as const;
