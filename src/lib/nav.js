import * as THREE from 'three';

export const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

export function pickWaypoint(waypoints, curIndex, camPos, dir) {
  let best = -1;
  let bestScore = Infinity;
  waypoints.forEach((wp, i) => {
    if (i === curIndex) return;
    const d = new THREE.Vector3(...wp.pos).sub(camPos);
    const len = d.length();
    if (len < 1e-4) return;
    const cos = d.normalize().dot(dir);
    if (cos < 0.4) return;
    const score = len * (2 - cos);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}