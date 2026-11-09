/**
 * ARMUS — shared design tokens for the mobile app ("Akış" design):
 * a white ground with light grey fills and hairline borders, black and gold
 * accents, Unbounded for headings and Inter for text, matching the website.
 */

export const colors = {
  gold1: '#ffdd55',
  gold2: '#f7c331',
  gold3: '#e0a916',
  goldText: '#93690a',
  onGold: '#0a0a0a',

  silver1: '#f7f7f5',
  silver2: '#c9c8c2',
  silver3: '#6d6c66',

  // soft gold fills: rating pills, the picked time, today's lesson
  goldSoft: '#fff6d6',
  goldPale: '#fffbea',
  goldDot: '#e2a91a',

  bg: '#ffffff',
  panel: '#ffffff',
  panel2: '#f3f3f3',
  border: '#ececec',
  borderSoft: '#f1f1f1',
  dark: '#0a0a0a',
  dark2: '#232323',

  ink: '#0a0a0a',
  muted: '#6b6b6b',
  faint: '#8a8a8a',

  success: '#1f7a4d',
  error: '#b3261e',
};

export const goldGradient = [colors.gold1, colors.gold2, colors.gold3] as const;
export const silverGradient = [colors.silver1, colors.silver2, colors.silver3] as const;
// A lighter silver wash for large surfaces (buttons, cards) where the full
// silverGradient would get too dark for dark-ink text to stay legible.
export const silverGradientLight = ['#fbfbfa', '#eeece7', '#e1ddd6'] as const;

export const fonts = {
  display: 'Unbounded_800ExtraBold',
  displayBlack: 'Unbounded_800ExtraBold',
  displayBold: 'Unbounded_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  bodyExtraBold: 'Inter_800ExtraBold',
};

export const radius = {
  sm: 12,
  md: 16,
  lg: 18,
  xl: 22,
  pill: 999,
};

// lift for the few things that float: the tab dock and the bottom action bar
export const floatShadow = {
  shadowColor: '#000',
  shadowOpacity: 0.22,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 12 },
  elevation: 12,
} as const;

export const spacing = (n: number) => n * 4;
