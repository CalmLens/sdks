/**
 * The components' colours and corner radius. The stylesheet uses them as its `--calmlens-*`
 * defaults, and the React Native components take them as `theme`.
 */
export interface CalmLensTheme {
  accent: string;
  /** Text on the accent colour. */
  accentText: string;
  /** Corner radius of the drop zone, file rows and media, in pixels. */
  radius: number;
  /** Body text. The stylesheet inherits it from the page instead. */
  text: string;
  /** Secondary text, such as a file's size. Defaults to `text` at 72%. */
  muted: string;
  /** Borders and the progress track. Defaults to `text` at 18%. */
  border: string;
  /** The drop zone's and file rows' fill. Defaults to `text` at 4%. */
  surface: string;
  success: string;
  warning: string;
  danger: string;
}

export const CALMLENS_THEME = {
  accent: "#635bff",
  accentText: "#fff",
  radius: 12,
  text: "#1f2328",
  success: "#12a26f",
  warning: "#e8a317",
  danger: "#e5484d",
} as const;

/** `color` at `alpha` as `rgba()`, for a hex colour; other colours are returned as they are. */
const withAlpha = (color: string, alpha: number) => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const [red, green, blue] = [0, 2, 4].map((start) =>
    Number.parseInt(full.slice(start, start + 2), 16),
  );
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

/**
 * The full theme from your overrides, mixing the muted, border and surface colours from `text`
 * as the stylesheet mixes them from the page's text colour.
 */
export const resolveTheme = (overrides: Partial<CalmLensTheme> = {}): CalmLensTheme => {
  const text = overrides.text ?? CALMLENS_THEME.text;
  return {
    ...CALMLENS_THEME,
    muted: withAlpha(text, 0.72),
    border: withAlpha(text, 0.18),
    surface: withAlpha(text, 0.04),
    ...overrides,
    text,
  };
};
