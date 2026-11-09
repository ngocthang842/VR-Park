import * as THREE from 'three';

// Lấy tia (gốc camera + hướng) từ chỗ bấm chuột
export function getRay(viewer, clientX, clientY, rect) {
  const cam = viewer.camera;
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
  cam.updateMatrixWorld();
  const o = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const d = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(cam).sub(o).normalize();
  return { o, d };
}

// Tìm điểm gần tất cả các tia nhất (bình phương tối thiểu)
// Trả về { point, error, angle } hoặc { fail: 'lý do' }
export function triangulate(rays) {
  if (rays.length < 2) return { fail: 'need' };

  // góc lớn nhất giữa các tia (độ). Quá nhỏ = hai góc nhìn quá giống nhau
  let maxAngle = 0;
  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      const c = Math.min(1, Math.max(-1, rays[i].d.dot(rays[j].d)));
      maxAngle = Math.max(maxAngle, THREE.MathUtils.radToDeg(Math.acos(c)));
    }
  }
  if (maxAngle < 3) return { fail: 'parallel' };

  const A = new THREE.Matrix3();
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = new THREE.Vector3();
  for (const { o, d } of rays) {
    const m = [
      1 - d.x * d.x, -d.x * d.y, -d.x * d.z,
      -d.y * d.x, 1 - d.y * d.y, -d.y * d.z,
      -d.z * d.x, -d.z * d.y, 1 - d.z * d.z,
    ];
    for (let i = 0; i < 9; i++) a[i] += m[i];
    b.x += m[0] * o.x + m[1] * o.y + m[2] * o.z;
    b.y += m[3] * o.x + m[4] * o.y + m[5] * o.z;
    b.z += m[6] * o.x + m[7] * o.y + m[8] * o.z;
  }
  A.set(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]);
  if (Math.abs(A.determinant()) < 1e-6) return { fail: 'parallel' };
  const p = b.applyMatrix3(A.clone().invert());

  // điểm phải nằm phía trước camera ở mọi lần bấm
  let err = 0;
  for (const { o, d } of rays) {
    const w = p.clone().sub(o);
    const t = w.dot(d);
    if (t < 0.05) return { fail: 'behind' }; // camera chỉ xoay tại chỗ, chưa dịch chuyển
    err += w.sub(d.clone().multiplyScalar(t)).length();
  }
  return { point: p, error: err / rays.length, angle: maxAngle };
}