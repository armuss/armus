/**
 * ARMUS — shared design tokens for the mobile app.
 * Mirrors the web's theme.css palette (gold/black/white, EnglishMaster-matched)
 * so the app and the site read as the same product.
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

  bg: '#ffffff',
  panel: '#ffffff',
  panel2: '#f5f5f5',
  border: '#e2e2e2',
  borderSoft: '#ececec',

  ink: '#0a0a0a',
  muted: '#5f5f5f',
  faint: '#8f8f8f',

  success: '#1f7a4d',
  error: '#b3261e',
};

export const goldGradient = [colors.gold1, colors.gold2, colors.gold3] as const;

export const fonts = {
  display: 'PlayfairDisplay_800ExtraBold',
  displayBlack: 'PlayfairDisplay_900Black',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  bodyExtraBold: 'Inter_800ExtraBold',
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
};

export const spacing = (n: number) => n * 4;
