/**
 * ARMUS — shared design tokens for the mobile app (design A, the website
 * panels' twin): a champagne ground under white cards, the website's red
 * (Kan kırmızısı) for everything you press, a red band behind the top of
 * the main screens, petrol for a trial / first lesson and champagne for a
 * regular one. Unbounded for headings and Inter for text.
 *
 * The older names (gold*, dark, silver*) stay as aliases of the new
 * colours so every screen picks the palette up: "dark" was the colour of
 * the main action and is now the red, "gold2" was the accent on it and is
 * now cream.
 */

export const colors = {
  // the brand red and what sits on it
  red: '#8c1c24',
  redLight: '#a54e54',
  redDeep: '#6d161c',
  onRed: '#faf5e2',
  redSoft: '#f6e3e4',

  // the warm neutrals
  cream: '#faf5e2',
  champagne: '#f3e5cf',
  champagneDeep: '#e2cba6',
  champagneText: '#6b5330',
  wash: '#fbf5ec',

  // the two quiet colours: navy for money, petrol for a trial / first lesson
  navy: '#2b3a7c',
  petrol: '#1f5f5b',
  petrolSoft: '#e3efee',

  // aliases kept for the screens written against the gold theme
  gold1: '#faf5e2',
  gold2: '#faf5e2',
  gold3: '#6d161c',
  goldText: '#8c1c24',
  onGold: '#faf5e2',
  goldSoft: '#f3e5cf',
  goldPale: '#f6ecdc',
  goldDot: '#b08d57',

  silver1: '#f7f3ec',
  silver2: '#d9ccb6',
  silver3: '#7a6d58',

  bg: '#fbf5ec',
  panel: '#ffffff',
  panel2: '#f3ece1',
  border: '#ece4d6',
  borderSoft: '#f0ebe2',
  dark: '#8c1c24',
  dark2: '#6d161c',

  ink: '#0a0a0a',
  muted: '#6f6455',
  faint: '#8f8370',

  success: '#1f5f5b',
  error: '#b3261e',
};

export const redGradient = [colors.redLight, colors.red, colors.redDeep] as const;
// kept for the few places that asked for the old gold sheen by name
export const goldGradient = redGradient;
export const silverGradient = ['#f7f3ec', '#e2cba6', '#b08d57'] as const;
// A lighter wash for large surfaces (buttons, cards) where a full gradient
// would get too dark for dark-ink text to stay legible.
export const silverGradientLight = ['#fffdf9', '#f6ecdc', '#efe2cc'] as const;

// the red band behind the top of a main screen, fading into the ground; it
// starts on the plain red so a fixed header painted red joins it seamlessly
export const bandGradient = ['#8c1c24', '#8c1c24', '#a54e54', '#d9b0b2', '#fbf5ec'] as const;

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
  shadowColor: '#6d161c',
  shadowOpacity: 0.32,
  shadowRadius: 22,
  shadowOffset: { width: 0, height: 12 },
  elevation: 12,
} as const;

export const spacing = (n: number) => n * 4;
