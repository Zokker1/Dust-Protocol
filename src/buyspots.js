// Zombie Co-op buy stations placed inside the south-plaza outpost. Shared by the
// client (proximity prompt + markers) and the server (purchase validation), so the
// coordinates and prices stay in one place. Plain data — no THREE/DOM imports.
// Weapon stations also have a cheaper `refill` price: if you already own that gun,
// using the station tops up its ammo instead of re-buying it.
export const BUY_RADIUS = 115;        // how close (x/z) you must stand to use a station
export const BUY_Y_TOLERANCE = 110;   // and roughly on the same floor

export const BUY_SPOTS = [
  { id: 'm4',     item: 'm4',     price: 2500, refill: 875,  x: 240,  y: 0,   z: 648,  label: 'M4A4', kind: 'wall' },
  { id: 'mp9',    item: 'mp9',    price: 1250, refill: 440,  x: -300, y: 0,   z: 770,  label: 'MP9', kind: 'wall' },
  { id: 'armor',  item: 'armor',  price: 900,  x: -300, y: 0,   z: 648,  label: 'Kevlar + Helmet', kind: 'armor' },
  { id: 'nova',   item: 'nova',   price: 1000, refill: 350,  x: -300, y: 0,   z: 1000, label: 'Nova', kind: 'wall' },
  { id: 'deagle', item: 'deagle', price: 700,  refill: 250,  x: 300,  y: 0,   z: 980,  label: 'Desert Eagle', kind: 'wall' },
  { id: 'awp',    item: 'awp',    price: 4000, refill: 1400, x: -250, y: 200, z: 648,  label: 'AWP', kind: 'wall' },
  { id: 'm249',   item: 'm249',   price: 5200, refill: 1820, x: -150, y: 200, z: 700,  label: 'M249', kind: 'wall' },
  { id: 'box',    item: 'box',    price: 1200, x: 0,    y: 0,   z: 985,  label: 'Mystery Box', kind: 'box' },
];

export const BOX_POOL = ['ak', 'm4', 'awp', 'nova', 'deagle', 'mp9', 'm249'];
