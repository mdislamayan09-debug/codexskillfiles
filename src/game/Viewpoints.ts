// Named camera viewpoints used by test hooks, photo captures and the title
// screen. Heights are meters above the ground at (x, z).

export interface Viewpoint {
  name: string;
  x: number;
  z: number;
  height: number;
  /** Look target (world x, z) and height above its ground. */
  target: [number, number, number];
  hour: number;
}

export const VIEWPOINTS: readonly Viewpoint[] = [
  { name: 'crash-site', x: 24, z: 660, height: 2.2, target: [10, 250, 60], hour: 8.4 },
  { name: 'meadow-golden', x: -60, z: 760, height: 2.4, target: [-260, 520, 10], hour: 18.9 },
  { name: 'hollowpine', x: -520, z: 180, height: 2.0, target: [-700, 120, 8], hour: 10.5 },
  { name: 'mirror-lake', x: -380, z: 300, height: 4, target: [-520, 260, 0], hour: 16.8 },
  { name: 'coast-cliffs', x: 806, z: -60, height: 3, target: [860, 260, 0], hour: 17.3 },
  { name: 'peaks', x: -250, z: -420, height: 2.2, target: [-420, -760, 120], hour: 13 },
  { name: 'volcano', x: 380, z: -420, height: 3, target: [560, -640, 120], hour: 11.5 },
  { name: 'marsh', x: -470, z: 620, height: 2, target: [-620, 760, 2], hour: 6.9 },
  { name: 'glasswood', x: 340, z: 260, height: 2.5, target: [480, 180, 10], hour: 15 },
  { name: 'rim-night', x: -30, z: 262, height: 2.4, target: [0, 0, 220], hour: 23.2 },
  { name: 'overview', x: 0, z: 1150, height: 520, target: [0, 150, 0], hour: 9.5 },
];

export function viewpointByName(name: string): Viewpoint | undefined {
  return VIEWPOINTS.find((v) => v.name === name);
}
