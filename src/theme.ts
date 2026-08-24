// Design tokens for Time Audit — a calm, premium dark system.
// Distinct identity from Mr. Productive (which is violet #6c5cff): here the accent is a
// warm amber #f5a623 — honest, daylight, "face the truth about your time". Every screen
// imports these; a palette change is a one-file edit. Plain constants, zero platform
// assumptions.
import type { TextStyle } from "react-native";

export const colors = {
  // surface stack, darkest -> lightest (layered depth, not one flat plane)
  bg: "#0c0c0f", // app ground
  bgSoft: "#101014", // raised ground / gradient partner
  surface: "#16161b", // cards
  surface2: "#1c1c23", // nested surfaces / inputs
  surface3: "#24242c", // elevated / pressed
  line: "#26262e", // hairline borders
  lineStrong: "#33333d", // dividers / input focus

  fg: "#f6f5f2",
  fg2: "#cbcac4",
  muted: "#8a8a92",
  faint: "#5c5c64",

  // amber accent
  accent: "#f5a623",
  accent2: "#ffbe4d",
  accentDeep: "#d98c0a",
  accentSoft: "rgba(245, 166, 35, 0.13)",
  accentSofter: "rgba(245, 166, 35, 0.07)",
  accentLine: "rgba(245, 166, 35, 0.42)",
  onAccent: "#241800",

  // teal secondary — used for "logged" success + insight bars
  teal: "#38c8b0",
  tealSoft: "rgba(56, 200, 176, 0.13)",
  tealLine: "rgba(56, 200, 176, 0.4)",
  onTeal: "#03211d",

  good: "#38c8b0",
  danger: "#f26d5b",
  dangerSoft: "rgba(242, 109, 91, 0.12)",

  // an "unlogged / gap" tone — deliberately dim, the truth you didn't record
  gap: "#2a2a32",
  gapText: "#6b6b74",
} as const;

export const space = {
  s0: 4,
  s1: 8,
  s2: 16,
  s3: 24,
  s4: 32,
  s5: 48,
  s6: 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.32,
    shadowRadius: 24,
    elevation: 8,
  },
  soft: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  accent: {
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 8,
  },
} as const;

export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: "800", letterSpacing: -0.5 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "800", letterSpacing: -0.3 },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.2 },
  subheading: { fontSize: 17, lineHeight: 23, fontWeight: "700" },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 19, fontWeight: "400" },
  mono: { fontSize: 14, lineHeight: 18, fontWeight: "700", letterSpacing: 0.4 },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
} as const satisfies Record<string, TextStyle>;
