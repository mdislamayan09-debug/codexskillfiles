// Hand-drawn style line icons (24×24 viewBox, stroke = currentColor).

const svg = (body: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;

export const ICONS = {
  heart: svg('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  food: svg('<path d="M14.5 4.5c3 1.2 4.6 4.6 3.4 7.6-.9 2.3-3.2 3.6-5.5 3.3l-4.3 4.3a1.6 1.6 0 1 1-2.2-2.2l4.3-4.3c-.3-2.3 1-4.6 3.3-5.5"/><path d="M13 7.5c1.5.3 2.8 1.6 3.1 3.1"/>'),
  water: svg('<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z"/><path d="M9 14.5a3 3 0 0 0 3 3"/>'),
  temperature: svg('<path d="M10 4.5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>'),
  cold: svg('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5"/>'),
  hot: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>'),
  wet: svg('<path d="M7 5s3 3.3 3 5.4a3 3 0 0 1-6 0C4 8.3 7 5 7 5zM16.5 9s3.5 3.8 3.5 6.3a3.5 3.5 0 0 1-7 0c0-2.5 3.5-6.3 3.5-6.3z"/>'),
  stamina: svg('<path d="M13 2.5 5.5 13.5H12l-1 8 7.5-11H12z"/>'),
  wood: svg('<rect x="3.5" y="8" width="17" height="8" rx="4"/><circle cx="7.5" cy="12" r="2.2"/><path d="M11.5 10h6M11.5 14h5"/>'),
  stone: svg('<path d="M4 16.5 6.5 9l5-3.5 5.5 1.5 3 6-2.5 4.5-9 1.5z"/><path d="M11.5 5.5 10 11l6.5 2.5"/>'),
  flint: svg('<path d="M12 3 18.5 10 13 21 6 12z"/><path d="M12 3 11 12l2 9M6 12l5 0 7.5-2"/>'),
  fiber: svg('<path d="M6 21c0-7 2-12 6-17M12 21c0-6 .5-10 1-14M18 21c-.5-6-2.5-10-5.5-13"/>'),
  stick: svg('<path d="M4.5 19.5 19.5 4.5M14 9.8l2.6.8M9 14.7l-.7-2.7"/>'),
  berries: svg('<circle cx="9" cy="14" r="3.2"/><circle cx="15" cy="15.5" r="3.2"/><circle cx="12.5" cy="9.5" r="3"/><path d="M12.5 6.5c.3-1.8 1.6-3 3.5-3.3"/>'),
  mushroom: svg('<path d="M3.5 12a8.5 6.5 0 0 1 17 0z"/><path d="M9.5 12v6.5a2.5 2.5 0 0 0 5 0V12"/><circle cx="8" cy="9" r=".8"/><circle cx="14.5" cy="8" r=".8"/>'),
  herb: svg('<path d="M12 21V8M12 12c-3.5 0-6-2.5-6-6 3.5 0 6 2.5 6 6zM12 15c3.5 0 6-2.5 6-6-3.5 0-6 2.5-6 6z"/>'),
  meat: svg('<path d="M15 4.5c3.5 1 5 5.5 3 9s-7 5.8-10 4.4-3.5-5.4-1-8.4S11.5 3.5 15 4.5z"/><circle cx="14" cy="10" r="1.6"/>'),
  axe: svg('<path d="M14 4.5 4.5 19.5"/><path d="M12.5 7c2-2.5 5.3-3 7.5-1.5-.2 3-2.6 5.4-5.6 5.8z"/>'),
  pickaxe: svg('<path d="M12.5 10 5 19.5"/><path d="M4.5 7.5c4.5-3.5 10.5-4 15-1.5-2 .5-4.5 1.8-6 3.5L10 7c-2 0-3.7.2-5.5.5z"/>'),
  torch: svg('<path d="M10.5 21 12 10.5 13.5 21z"/><path d="M12 3c2 2 3 3.6 3 5a3 3 0 0 1-6 0c0-1.4 1-3 3-5z"/>'),
  knife: svg('<path d="M4 20 10 14M10 14l9.5-9.5c.5 3.5-1.5 8-5 10z"/>'),
  spear: svg('<path d="M3.5 20.5 17 7"/><path d="M15 4.5 20 4l-.5 5-3-1.5z"/>'),
  bow: svg('<path d="M6 3.5c7.5 2.5 12 9 14 16.5M6 3.5l14 16.5"/><path d="M13 13.5 3.5 20.5"/>'),
  rope: svg('<path d="M8 4.5c-3 0-4 3-2 5s6 1 8 3 1 6.5-2.5 7M12 4.5c-2 1-2 3 0 4.5"/>'),
  campfire: svg('<path d="M4 20 20 16M4 16l16 4"/><path d="M12 3.5c2.5 2.5 4 4.5 4 7a4 4 0 0 1-8 0c0-1.8 1-3 2-4 .3 1.5 1 2.3 2 2.5-.5-2 0-3.8 0-5.5z"/>'),
  bedroll: svg('<rect x="3" y="11" width="18" height="7" rx="3.5"/><path d="M6.5 11V9.5A2.5 2.5 0 0 1 9 7h6"/>'),
  waterskin: svg('<path d="M9 4.5h6M10 4.5v3c-3 1-5 3.5-5 7a7 7 0 0 0 14 0c0-3.5-2-6-5-7v-3"/>'),
  lantern: svg('<path d="M9 4.5h6M12 2.5v2M8 7h8l-1 11H9z"/><path d="M12 10.5c1 1 1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 .5-2 1.5-3z"/>'),
  compass: svg('<circle cx="12" cy="12" r="8.5"/><path d="m15 9-2 4.5L9 15l2-4.5z"/>'),
  map: svg('<path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2z"/><path d="M9 4.5v13M15 6.5v13"/>'),
  landmark: svg('<path d="M12 3.5c3 0 5.5 2.4 5.5 5.5 0 4-5.5 11.5-5.5 11.5S6.5 13 6.5 9c0-3.1 2.5-5.5 5.5-5.5z"/><circle cx="12" cy="9" r="2"/>'),
  quest: svg('<path d="M12 3 20.5 12 12 21 3.5 12z"/><path d="M12 8v4.5M12 15.5v.5"/>'),
  hand: svg('<path d="M8.5 12V5.5a1.5 1.5 0 0 1 3 0V11M11.5 10V4.5a1.5 1.5 0 0 1 3 0V11M14.5 10.5V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.5 7-6.5 7-3 0-4.5-1.5-6-4l-2-3.5a1.4 1.4 0 0 1 2.3-1.6l1.7 1.8V8a1.5 1.5 0 0 1 3 0"/>'),
  bone: svg('<path d="M7 9.5 14.5 17M6.5 5.2a2 2 0 0 0-1.3 3.7 2 2 0 0 0 3.2 1.3M17.5 18.8a2 2 0 0 0 1.3-3.7 2 2 0 0 0-3.2-1.3"/>'),
  hide: svg('<path d="M6 5.5c2 1 4 1 6 0s4-1 6 0l-1 4 2.5 3-2.5 3 1 4c-2-1-4-1-6 0s-4 1-6 0l1-4-2.5-3 2.5-3z"/>'),
  feather: svg('<path d="M5 19.5 15.5 9M20 4c-6 0-12 3.5-12 11.5h4C17 15.5 20 10 20 4z"/>'),
  resin: svg('<path d="M12 4c2.5 3.5 4.5 6.3 4.5 9a4.5 4.5 0 0 1-9 0C7.5 10.3 9.5 7.5 12 4z"/><path d="M10 13.5a2 2 0 0 0 2 2"/>'),
  clay: svg('<path d="M5 13c0-4 3-7 7-7s7 3 7 7-3 6-7 6-7-2-7-6z"/><path d="M8 12c2-1 5-1 8 0"/>'),
  ore: svg('<path d="M4 16.5 6.5 9l5-3.5 5.5 1.5 3 6-2.5 4.5-9 1.5z"/><circle cx="10" cy="12" r="1.2"/><circle cx="14.5" cy="10.5" r="1"/><circle cx="13" cy="15" r="1.1"/>'),
  shell: svg('<path d="M12 20c-4.5 0-8-3-8-7.5C4 8 7.5 4 12 4s8 4 8 8.5C20 17 16.5 20 12 20z"/><path d="M12 20V6M8.5 19l-1.5-12M15.5 19l1.5-12"/>'),
  fish: svg('<path d="M3.5 12c3-4 7-5.5 11-4.5 2 .5 3.5 2 4.5 4.5-1 2.5-2.5 4-4.5 4.5-4 1-8-.5-11-4.5z"/><path d="M19 12l2-3v6z"/><circle cx="7.5" cy="11" r=".8"/>'),
  bag: svg('<path d="M6 8.5h12l1 11.5H5z"/><path d="M9 8.5V6.5a3 3 0 0 1 6 0v2"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  moon: svg('<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  songstone: svg('<path d="M12 2.5 17 9l-5 12.5L7 9z"/><path d="M7 9h10M12 2.5v19"/>'),
  cloth: svg('<path d="M5 4.5h14v15H5z"/><path d="M5 9.5h14M5 14.5h14M9.5 4.5v15M14.5 4.5v15"/>'),
  ingot: svg('<path d="M4 17 7 9h10l3 8z"/><path d="M7 9l1.5 4h7L17 9M8.5 13 7 17M15.5 13 17 17"/>'),
  seed: svg('<path d="M12 4c4 3 5 8 3 12.5-1 2-2 3-3 3.5-1-.5-2-1.5-3-3.5C7 12 8 7 12 4z"/><path d="M12 8v9"/>'),
  chest: svg('<rect x="3.5" y="8" width="17" height="11" rx="1.5"/><path d="M3.5 12.5h17M5 8c0-2 2-3.5 7-3.5S19 6 19 8M11 11.5h2v2.5h-2z"/>'),
  build: svg('<path d="M3.5 20.5h17M5.5 20.5v-9l6.5-5 6.5 5v9"/><path d="M9.5 20.5v-5h5v5"/>'),
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: string): string {
  return (ICONS as Record<string, string>)[name] ?? ICONS.bag;
}
