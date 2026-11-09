import * as THREE from 'three';

export function pickPoint(viewer, clientX, clientY, rect, pixelRadius = 6) {
  const cam = viewer.camera;
  const mesh = viewer.splatMesh;
  const total = mesh.getSplatCount();
  if (!total) return null;

  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
  cam.updateMatrixWorld();
  const o = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const d = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(cam).sub(o).normalize();
  const tanTol = (pixelRadius * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / rect.height;

  const stride = Math.max(1, Math.floor(total / 400000));
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  const col = new THREE.Vector4();
  const ts = [];

  for (let i = 0; i < total; i += stride) {
    mesh.getSplatCenter(i, c, true);
    v.copy(c).sub(o);
    const t = v.dot(d);
    if (t < 0.05) continue;
    const perp2 = v.lengthSq() - t * t;
    const tol = t * tanTol;
    if (perp2 > tol * tol) continue;
    mesh.getSplatColor(i, col);
    if (col.w < 140) continue;
    ts.push(t);
  }
  if (ts.length === 0) return null;

  // gom các điểm theo độ sâu (mỗi nhóm rộng ~3%), chọn nhóm đông điểm nhất
  const bins = new Map();
  const logStep = Math.log(1.03);
  for (const t of ts) {
    const key = Math.round(Math.log(t) / logStep);
    bins.set(key, (bins.get(key) || 0) + 1);
  }
  let bestKey = 0, bestScore = -1;
  for (const [k, c] of bins) {
    const score = c + (bins.get(k - 1) || 0) + (bins.get(k + 1) || 0);
    if (score > bestScore) { bestScore = score; bestKey = k; }
  }
  const group = ts
    .filter((t) => Math.abs(Math.round(Math.log(t) / logStep) - bestKey) <= 1)
    .sort((a, b) => a - b);
  const best = group[Math.floor(group.length / 2)];
  return o.clone().addScaledVector(d, best);
}