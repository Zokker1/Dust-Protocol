// Repairable barricades sealing the outpost's ground doorways. Shared by client
// (meshes + repair prompt) and server (dynamic blocker + zombie attacks + repair).
// Each rect fills a door gap; while a barricade has HP it blocks zombies, when broken
// the doorway is open. Plain data — no THREE/DOM imports.
export const BARRICADE_HP = 200;
export const BARRICADE_RADIUS = 90;   // how close to repair / how close zombies tear it

export const BARRICADES = [
  { id: 1, x1: -130, z1: 600,  x2: 130,  z2: 624,  label: 'N' }, // north entrance
  { id: 2, x1: -130, z1: 1036, x2: 130,  z2: 1060, label: 'S' }, // south back door
  { id: 3, x1: -360, z1: 720,  x2: -336, z2: 960,  label: 'W' }, // west side door
  { id: 4, x1: 336,  z1: 700,  x2: 360,  z2: 840,  label: 'E' }, // east side door
];
