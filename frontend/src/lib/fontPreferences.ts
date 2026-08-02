// ── Selectable typography ────────────────────────────────────────────────
// Two independent knobs — Chinese body font and English body font — each
// just a CSS custom property (--font-zh / --font-en, defined in index.css).
// Because Tailwind's `font-sans` and the global `body` rule both read
// `var(--font-en), var(--font-zh), sans-serif`, flipping either variable
// re-themes the whole app instantly: no per-component font-family needed.
//
// Persistence: localStorage for now (works for guests). If/when this needs
// to follow a logged-in user across devices, mirror these two values into
// the user's `preferences` JSONB column and call applyFontPreferences()
// with the loaded values after fetching the profile, instead of reading
// from localStorage.

export interface FontOption {
  id: string;
  label: string;
  /** CSS font-family value, quotes included where the family name has spaces */
  value: string;
}

export const ZH_FONT_OPTIONS: FontOption[] = [
  { id: "noto-sans-sc", label: "思源黑体 · 现代清晰", value: '"Noto Sans SC", sans-serif' },
  { id: "noto-serif-sc", label: "思源宋体 · 典雅衬线", value: '"Noto Serif SC", serif' },
  { id: "zcool-xiaowei", label: "站酷小薇 · 书卷气宋体", value: '"ZCOOL XiaoWei", serif' },
];

export const EN_FONT_OPTIONS: FontOption[] = [
  { id: "ibm-plex-sans", label: "IBM Plex Sans", value: '"IBM Plex Sans", sans-serif' },
  { id: "inter", label: "Inter", value: '"Inter", sans-serif' },
  { id: "space-grotesk", label: "Space Grotesk", value: '"Space Grotesk", sans-serif' },
];

const STORAGE_KEY: Record<"zh" | "en", string> = {
  zh: "logiverse:font-zh",
  en: "logiverse:font-en",
};

/** Call once on app start (e.g. in main.tsx, before ReactDOM.render/createRoot)
 *  so a returning visitor's saved font shows up with no flash of the default. */
export function applyFontPreferences() {
  (["zh", "en"] as const).forEach((kind) => {
    const saved = localStorage.getItem(STORAGE_KEY[kind]);
    if (saved) document.documentElement.style.setProperty(`--font-${kind}`, saved);
  });
}

/** Call from the Settings picker when the user selects a font. */
export function setFontPreference(kind: "zh" | "en", value: string) {
  document.documentElement.style.setProperty(`--font-${kind}`, value);
  localStorage.setItem(STORAGE_KEY[kind], value);
}

/** Which option is currently active, for pre-selecting the picker UI. */
export function getCurrentFontPreference(kind: "zh" | "en", options: FontOption[]): string {
  const saved = localStorage.getItem(STORAGE_KEY[kind]);
  return options.find((o) => o.value === saved)?.id ?? options[0].id;
}

export function resetFontPreferences() {
  (["zh", "en"] as const).forEach((kind) => {
    localStorage.removeItem(STORAGE_KEY[kind]);
    document.documentElement.style.removeProperty(`--font-${kind}`);
  });
}
