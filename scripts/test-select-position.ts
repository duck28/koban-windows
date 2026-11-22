import assert from 'node:assert/strict';
import {
  computeKobanSelectPosition,
  MenuPosition,
} from '../src/components/KobanSelect';

function assertInsideViewport(
  pos: MenuPosition | null,
  vpW: number,
  vpH: number,
  label: string
) {
  assert.ok(pos !== null, `${label}: expected non-null position`);
  assert.ok(pos.left >= 12, `${label}: left ${pos.left} < 12`);
  assert.ok(
    pos.left + pos.width <= vpW - 12,
    `${label}: right ${pos.left + pos.width} > ${vpW - 12}`
  );
  if (pos.top !== undefined) {
    assert.ok(pos.top >= 12, `${label}: top ${pos.top} < 12`);
    assert.ok(
      pos.top + pos.maxHeight <= vpH - 12,
      `${label}: bottom edge ${pos.top + pos.maxHeight} > ${vpH - 12}`
    );
  }
  if (pos.bottom !== undefined) {
    assert.ok(pos.bottom >= 12, `${label}: bottom ${pos.bottom} < 12`);
    assert.ok(
      vpH - pos.bottom - pos.maxHeight >= 12,
      `${label}: top edge ${vpH - pos.bottom - pos.maxHeight} < 12`
    );
  }
}

// 1. Trigger near lower half of modal (like Bank / Statement Format in screenshot)
const lower = computeKobanSelectPosition(
  { top: 430, bottom: 462, left: 600, width: 280 },
  1024,
  720
);
assertInsideViewport(lower, 1024, 720, 'lower trigger');
assert.ok(lower?.bottom !== undefined, 'lower trigger should flip upward');

// 2. Trigger near top of viewport
const upper = computeKobanSelectPosition(
  { top: 40, bottom: 72, left: 200, width: 240 },
  1024,
  720
);
assertInsideViewport(upper, 1024, 720, 'upper trigger');
assert.ok(upper?.top !== undefined, 'upper trigger should open downward');

// 3. Tight 500px viewport with middle trigger (like earlier bug: spaceBelow ~ 210 < 340)
const tight = computeKobanSelectPosition(
  { top: 240, bottom: 272, left: 100, width: 240 },
  800,
  500
);
assertInsideViewport(tight, 800, 500, 'tight viewport');
assert.ok(tight?.bottom !== undefined && tight.maxHeight <= 222);

// 4. Very short 240px viewport (neither above nor below >= 140)
const veryShort = computeKobanSelectPosition(
  { top: 104, bottom: 136, left: 100, width: 240 },
  800,
  240
);
assertInsideViewport(veryShort, 800, 240, 'very short viewport');
assert.equal(veryShort?.top, 12);
assert.equal(veryShort?.maxHeight, 216);

// 5. Right edge horizontal clamping
const rightEdge = computeKobanSelectPosition(
  { top: 40, bottom: 72, left: 950, width: 120 },
  1024,
  720
);
assertInsideViewport(rightEdge, 1024, 720, 'right edge');

// 6. Trigger scrolled completely off-screen
assert.equal(
  computeKobanSelectPosition(
    { top: -80, bottom: -40, left: 100, width: 200 },
    1024,
    720
  ),
  null
);
assert.equal(
  computeKobanSelectPosition(
    { top: 750, bottom: 782, left: 100, width: 200 },
    1024,
    720
  ),
  null
);

console.log('ALL KOBAN SELECT POSITION ASSERTIONS PASSED');
