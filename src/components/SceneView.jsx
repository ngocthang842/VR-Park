import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import * as GS from '@mkkellogg/gaussian-splats-3d';
import { ease, pickWaypoint } from '../lib/nav.js';
import { pickPoint } from '../lib/pick.js';
import { getRay, triangulate } from '../lib/triangulate.js';
import './SceneView.css';

const LOOK_R = 0.01;
const HOME_DEFAULT = { pos: [0, -2, -6], look: [0, 0, 0] };
const TOUR_FLY_MS = 2200;   // thời gian bay giữa 2 điểm khi tham quan
const TOUR_DWELL_MS = 1000; // thời gian dừng lại ở mỗi điểm
const r3 = (v) => [v.x, v.y, v.z].map((n) => +n.toFixed(3));
const SAVE_TEXT = { idle: 'Tự động lưu khi thay đổi', saving: 'Đang lưu…', saved: 'Đã lưu ✓', error: 'Lỗi lưu (phải chạy bằng npm run dev)' };
const FAIL_TEXT = {
  parallel: 'Hai góc nhìn quá giống nhau. Hãy dịch camera sang chỗ khác rồi bấm lại.',
  behind: 'Camera mới chỉ xoay tại chỗ. Hãy dịch chuyển vị trí camera (kéo chuột xoay quanh vật hoặc cuộn zoom) rồi bấm lại.',
};

const tourBtn = {
  background: 'transparent', color: '#fff', border: 'none',
  fontSize: 18, cursor: 'pointer', padding: '2px 6px',
};

export default function SceneView({ entry, edit, onBack, onToggleEdit }) {
  const boxRef = useRef(null);
  const viewerRef = useRef(null);
  const cfgRef = useRef(null);
  const st = useRef({ mode: 'orbit', wp: -1, anim: null });
  const dotRefs = useRef({});
  const pickRef = useRef(null);
  const formRef = useRef(null);
  const raysRef = useRef([]);
  const triRef = useRef(null);
  const playRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [mode, setModeState] = useState('orbit');
  const [active, setActive] = useState(null);
  const [form, setForm] = useState(null);
  const [pick, setPickState] = useState(null);
  const [tri, setTri] = useState(null); // { pos, n, error, angle }
  const [playing, setPlayingState] = useState(false);
  const [saveState, setSaveState] = useState('idle');
  const [msg, setMsg] = useState('');
  const [, bump] = useState(0);
  const rerender = () => bump((n) => n + 1);
  formRef.current = form;

  const setPlaying = useCallback((b) => {
    playRef.current = b;
    setPlayingState(b);
  }, []);

  const resetTri = () => {
    raysRef.current = [];
    triRef.current = null;
    setTri(null);
  };
  const setPick = (k) => {
    resetTri();
    pickRef.current = k;
    setPickState(k);
  };

  // ---- đọc scene.json
  useEffect(() => {
    let off = false;
    fetch(entry.config, { cache: 'no-store' })
      .then((r) => r.json())
      .then((c) => {
        if (off) return;
        cfgRef.current = { cameraUp: [0, -1, 0], eyeHeight: 1, waypoints: [], hotspots: [], ...c };
        setReady(true);
      })
      .catch(() => setError('Không đọc được scene.json'));
    return () => { off = true; };
  }, [entry]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3500);
    return () => clearTimeout(t);
  }, [msg]);

  // vào chế độ chỉnh sửa thì dừng tham quan
  useEffect(() => {
    if (edit) setPlaying(false);
  }, [edit, setPlaying]);

  // ---- lưu vào file
  const save = useCallback(async () => {
    setSaveState('saving');
    try {
      const r = await fetch('/api/scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, config: cfgRef.current }),
      });
      const j = await r.json();
      setSaveState(j.ok ? 'saved' : 'error');
    } catch {
      setSaveState('error');
    }
  }, [entry.id]);

  // ---- camera bay mượt
  const flyTo = useCallback((pos, look, walk, ms = 900) => {
    const v = viewerRef.current;
    if (!v?.camera) return;
    const p1 = new THREE.Vector3(...pos);
    let l1 = new THREE.Vector3(...look);
    if (walk) l1 = p1.clone().add(l1.sub(p1).normalize().multiplyScalar(LOOK_R));
    st.current.anim = { t0: performance.now(), ms, p0: v.camera.position.clone(), l0: v.controls.target.clone(), p1, l1 };
  }, []);

  const goWp = useCallback((i, ms = 900) => {
    const wp = cfgRef.current.waypoints[i];
    const v = viewerRef.current;
    if (!wp || !v?.camera) return;
    let look = wp.look;
    if (!look) {
      const d = v.camera.getWorldDirection(new THREE.Vector3());
      look = [wp.pos[0] + d.x, wp.pos[1] + d.y, wp.pos[2] + d.z];
    }
    st.current.wp = i;
    flyTo(wp.pos, look, true, ms);
    bump((n) => n + 1);
  }, [flyTo]);

  const setMode = useCallback((m) => {
    const v = viewerRef.current;
    if (!v?.controls) return;
    const cfg = cfgRef.current;
    const s = st.current;
    s.mode = m;
    setModeState(m);
    setActive(null);
    if (m === 'walk') {
      v.controls.enableZoom = false;
      v.controls.enablePan = false;
      if (cfg.waypoints.length) goWp(s.wp >= 0 ? s.wp : 0);
    } else {
      setPlaying(false);
      v.controls.enableZoom = true;
      v.controls.enablePan = true;
      const home = cfg.camera || HOME_DEFAULT;
      flyTo(home.pos, home.look, false);
    }
  }, [flyTo, goWp, setPlaying]);

  // ---- tham quan tự động
  useEffect(() => {
    if (!playing) return;
    const n = cfgRef.current.waypoints.length;
    if (!n) { setPlaying(false); return; }
    let timer;
    let started = false;
    const step = () => {
      const cur = st.current.wp;
      const next = started ? (cur + 1) % n : (cur >= 0 ? cur : 0);
      started = true;
      goWp(next, TOUR_FLY_MS);
      timer = setTimeout(step, TOUR_FLY_MS + TOUR_DWELL_MS);
    };
    step();
    return () => clearTimeout(timer);
  }, [playing, goWp, setPlaying]);

  const toggleTour = () => {
    if (playing) { setPlaying(false); return; }
    if (!cfgRef.current.waypoints.length) {
      setMsg('Chưa có điểm đi nào. Bấm ✎ Chỉnh sửa để thêm điểm đi trước.');
      return;
    }
    setActive(null);
    if (st.current.mode !== 'walk') setMode('walk');
    setPlaying(true);
  };

  const stepTour = (dir) => {
    const n = cfgRef.current.waypoints.length;
    if (!n) return;
    setPlaying(false);
    const cur = st.current.wp < 0 ? 0 : st.current.wp;
    goWp((cur + dir + n) % n);
  };

  // ---- viewer + vòng lặp
  useEffect(() => {
    if (!ready) return;
    const cfg = cfgRef.current;
    const home = cfg.camera || HOME_DEFAULT;
    const viewer = new GS.Viewer({
      rootElement: boxRef.current,
      cameraUp: cfg.cameraUp,
      initialCameraPosition: home.pos,
      initialCameraLookAt: home.look,
      sharedMemoryForWorkers: false,
    });
    viewerRef.current = viewer;
    let raf = 0;
    let dead = false;
    const tmp = new THREE.Vector3();
    const up = new THREE.Vector3(...cfg.cameraUp).normalize();

    viewer
      .addSplatScene(entry.model, {
        splatAlphaRemovalThreshold: 5,
        showLoadingUI: false,
        onProgress: (p) => setProgress(Math.round(p)),
      })
      .then(() => { if (!dead) { viewer.start(); setProgress(100); } })
      .catch((e) => { if (!dead) setError('Không tải được model: ' + e.message); });

    const place = (key, pos, lift) => {
      const el = dotRefs.current[key];
      const cam = viewer.camera;
      if (!el || !cam) return;
      // đang tham quan: ẩn các vòng tròn điểm đi cho cảnh gọn
      if (key[0] === 'w' && playRef.current) { el.style.visibility = 'hidden'; return; }
      tmp.set(pos[0], pos[1], pos[2]);
      if (lift) tmp.addScaledVector(up, -lift);
      tmp.project(cam);
      const w = boxRef.current.clientWidth;
      const h = boxRef.current.clientHeight;
      const ok = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
      el.style.visibility = ok ? 'visible' : 'hidden';
      el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cam = viewer.camera;
      const ctl = viewer.controls;
      if (!cam || !ctl) return;
      const s = st.current;
      if (s.anim) {
        const a = s.anim;
        const k = Math.min(1, (performance.now() - a.t0) / a.ms);
        const e = ease(k);
        cam.position.lerpVectors(a.p0, a.p1, e);
        ctl.target.lerpVectors(a.l0, a.l1, e);
        ctl.update();
        if (k >= 1) s.anim = null;
      }
      const c = cfgRef.current;
      c.waypoints.forEach((w, i) => place(`w${i}`, w.pos, c.eyeHeight));
      c.hotspots.forEach((h) => place(`h${h.id}`, h.pos, 0));
      const f = formRef.current;
      if (f && !f.id) place('hdraft', f.pos, 0);
      const t = triRef.current;
      if (t) place('tri', t.pos, 0);
    };
    loop();

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      try { Promise.resolve(viewer.dispose()).catch(() => {}); } catch { /* bỏ qua */ }
      viewerRef.current = null;
    };
  }, [ready, entry]);

  // ---- phím W A S D
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      const s = st.current;
      const v = viewerRef.current;
      if (s.mode !== 'walk' || !v?.camera) return;
      const map = { w: 1, arrowup: 1, s: -1, arrowdown: -1, d: 2, arrowright: 2, a: -2, arrowleft: -2 };
      const m = map[e.key.toLowerCase()];
      if (!m) return;
      const cam = v.camera;
      const f = cam.getWorldDirection(new THREE.Vector3());
      f.addScaledVector(cam.up, -f.dot(cam.up)).normalize();
      const right = new THREE.Vector3().crossVectors(f, cam.up).normalize();
      const dir = (Math.abs(m) === 1 ? f : right).clone().multiplyScalar(Math.sign(m));
      const i = pickWaypoint(cfgRef.current.waypoints, s.wp, cam.position, dir);
      if (i >= 0) { setPlaying(false); goWp(i); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goWp, setPlaying]);

  // ---- bấm vào cảnh để đặt điểm
  const handlePick = useCallback((cx, cy) => {
    const v = viewerRef.current;
    const cfg = cfgRef.current;
    const kind = pickRef.current;
    if (!v?.camera || !kind) return;
    const rect = boxRef.current.getBoundingClientRect();

    // Hotspot: tam giác hóa từ nhiều góc nhìn
    if (kind === 'hotspot' || kind === 'move') {
      raysRef.current.push(getRay(v, cx, cy, rect));
      const n = raysRef.current.length;
      if (n < 2) {
        setTri({ pos: null, n, error: 0, angle: 0 });
        setMsg('Đã ghi góc 1. Dịch camera sang góc khác rồi bấm lại vào đúng vật đó.');
        return;
      }
      const res = triangulate(raysRef.current);
      if (res.fail) {
        raysRef.current.pop();
        setMsg(FAIL_TEXT[res.fail] || 'Không tính được, thử lại.');
        return;
      }
      const pos = r3(res.point);
      triRef.current = { pos };
      setTri({ pos, n, error: res.error, angle: res.angle });
      return;
    }

    // Điểm đi: bấm mặt đất (dùng bắt điểm splat)
    if (kind === 'ground') {
      const p = pickPoint(v, cx, cy, rect);
      if (!p) { setMsg('Không bắt được điểm ở chỗ này. Thử bấm vào chỗ có vật thể rõ hơn.'); return; }
      const up = new THREE.Vector3(...cfg.cameraUp).normalize();
      const pos = p.clone().addScaledVector(up, cfg.eyeHeight);
      const fw = v.camera.getWorldDirection(new THREE.Vector3());
      fw.addScaledVector(up, -fw.dot(up));
      if (fw.lengthSq() < 1e-6) fw.set(1, 0, 0);
      const look = pos.clone().add(fw.normalize());
      cfg.waypoints.push({ id: 'w' + Date.now().toString(36), pos: r3(pos), look: r3(look) });
      rerender();
      save();
    }
  }, [save]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let down = null;
    const onDown = (e) => { down = [e.clientX, e.clientY]; };
    const onUp = (e) => {
      if (!down || !pickRef.current) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved < 5) handlePick(e.clientX, e.clientY);
    };
    box.addEventListener('pointerdown', onDown);
    box.addEventListener('pointerup', onUp);
    return () => {
      box.removeEventListener('pointerdown', onDown);
      box.removeEventListener('pointerup', onUp);
    };
  }, [handlePick]);

  // ---- xác nhận điểm tam giác hóa
  const confirmTri = () => {
    const t = triRef.current;
    const kind = pickRef.current;
    if (!t?.pos) return;
    const cfg = cfgRef.current;
    if (kind === 'hotspot') {
      setForm({ id: null, pos: t.pos, title: '', text: '', image: '' });
    } else if (kind === 'move') {
      const f = formRef.current;
      const h = cfg.hotspots.find((x) => x.id === f?.id);
      if (h) h.pos = t.pos;
      setForm({ ...f, pos: t.pos });
      save();
    }
    setPick(null);
    rerender();
  };
  const undoRay = () => {
    raysRef.current.pop();
    const n = raysRef.current.length;
    if (n < 2) {
      triRef.current = null;
      setTri(n ? { pos: null, n, error: 0, angle: 0 } : null);
      return;
    }
    const res = triangulate(raysRef.current);
    if (res.fail) { triRef.current = null; setTri({ pos: null, n, error: 0, angle: 0 }); return; }
    const pos = r3(res.point);
    triRef.current = { pos };
    setTri({ pos, n, error: res.error, angle: res.angle });
  };

  // ---- thao tác chỉnh sửa
  const addWpHere = () => {
    const v = viewerRef.current;
    const c = cfgRef.current;
    c.waypoints.push({ id: 'w' + Date.now().toString(36), pos: r3(v.camera.position), look: r3(v.controls.target) });
    rerender();
    save();
  };
  const delWp = (i) => {
    const c = cfgRef.current;
    c.waypoints.splice(i, 1);
    st.current.wp = -1;
    rerender();
    save();
  };
  const previewWp = (w) => flyTo(w.pos, w.look || (cfgRef.current.camera || HOME_DEFAULT).look, false);
  const saveHome = () => {
    const v = viewerRef.current;
    cfgRef.current.camera = { pos: r3(v.camera.position), look: r3(v.controls.target) };
    setMsg('Đã đặt góc nhìn ban đầu');
    save();
  };
  const openForm = (h) => setForm({ id: h.id, pos: h.pos, title: h.title, text: h.text || '', image: h.image || '' });
  const delHs = (id) => {
    const c = cfgRef.current;
    c.hotspots = c.hotspots.filter((h) => h.id !== id);
    setForm(null);
    rerender();
    save();
  };
  const submitForm = () => {
    if (!form.title.trim()) { setMsg('Nhập tên điểm thông tin trước đã'); return; }
    const c = cfgRef.current;
    const data = { title: form.title.trim(), text: form.text, image: form.image.trim() || undefined };
    if (form.id) {
      Object.assign(c.hotspots.find((x) => x.id === form.id), data);
    } else {
      c.hotspots.push({ id: 'h' + Date.now().toString(36), pos: form.pos, ...data });
    }
    setForm(null);
    rerender();
    save();
  };

  const cfg = cfgRef.current;
  const pickHint = {
    hotspot: 'Bấm vào vật cần giới thiệu (góc 1), rồi dịch camera sang góc khác và bấm lại đúng vật đó',
    ground: 'Bấm vào mặt đất để đặt điểm đi. Bấm lại nút để tắt.',
    move: 'Bấm vào vị trí mới từ góc 1, rồi dịch camera và bấm lại từ góc 2',
  }[pick];

  const panelStyle = {
    position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(20,22,30,.92)', color: '#fff', padding: '10px 14px',
    borderRadius: 10, zIndex: 30, display: 'flex', gap: 8, alignItems: 'center',
    flexWrap: 'wrap', maxWidth: '90%', fontSize: 14,
  };

  const tourStyle = {
    position: 'absolute', bottom: 110, left: '50%', transform: 'translateX(-50%)',
    width: 'min(640px, 90%)', background: 'rgba(20,22,30,.85)', color: '#fff',
    padding: '8px 14px', borderRadius: 12, zIndex: 30, display: 'flex',
    gap: 8, alignItems: 'center', fontSize: 14,
  };

  const wpCount = cfg ? cfg.waypoints.length : 0;
  const curWp = st.current.wp;

  return (
    <div className="sv">
      <div ref={boxRef} className={`sv-canvas${pick ? ' picking' : ''}`} />
      <div className="sv-top">
        <button onClick={onBack}>← Thư viện</button>
        <button className={edit ? 'on' : ''} onClick={onToggleEdit}>{edit ? '✓ Xong chỉnh sửa' : '✎ Chỉnh sửa'}</button>
      </div>
      <div className="sv-title">{entry.name}</div>

      {progress < 100 && !error && (
        <div className="sv-loading"><div style={{ width: progress + '%' }} /><span>Đang tải {progress}%</span></div>
      )}
      {error && <div className="sv-error">{error}</div>}
      {msg && <div className="sv-toast">{msg}</div>}

      {cfg && (
        <>
          <div className={`sv-layer mode-${mode}${edit ? ' editing' : ''}`}>
            {cfg.waypoints.map((w, i) => (
              <button key={w.id || i} ref={(el) => { dotRefs.current[`w${i}`] = el; }}
                className={`sv-ring${i === st.current.wp ? ' cur' : ''}`}
                onClick={() => {
                  if (edit && mode === 'orbit') previewWp(w);
                  else { setPlaying(false); goWp(i); }
                }} />
            ))}
            {cfg.hotspots.map((h) => (
              <button key={h.id} ref={(el) => { dotRefs.current[`h${h.id}`] = el; }}
                className="sv-dot" onClick={() => (edit ? openForm(h) : setActive(h))}>
                <span className="sv-tip">{h.title}</span>
              </button>
            ))}
            {form && !form.id && (
              <div ref={(el) => { dotRefs.current.hdraft = el; }} className="sv-dot draft" />
            )}
            {tri?.pos && (
              <div ref={(el) => { dotRefs.current.tri = el; }} className="sv-dot draft" />
            )}
          </div>

          <div className="sv-modes">
            <button className={playing ? 'on' : ''} onClick={toggleTour}>{playing ? '⏸ Dừng tham quan' : '▶ Tham quan'}</button>
            <button className={mode === 'walk' && !playing ? 'on' : ''} onClick={() => { setPlaying(false); setMode('walk'); }}>Đi theo điểm</button>
            <button className={mode === 'orbit' ? 'on' : ''} onClick={() => setMode('orbit')}>Xoay tự do</button>
            <button disabled>Nhìn từ trên </button>
            <button disabled>Toàn cảnh </button>
          </div>

          {/* thanh điều khiển tham quan */}
          {!edit && wpCount > 0 && mode === 'walk' && (
            <div style={tourStyle}>
              <button style={tourBtn} onClick={toggleTour} title={playing ? 'Tạm dừng' : 'Phát'}>{playing ? '⏸' : '▶'}</button>
              <button style={tourBtn} onClick={() => stepTour(-1)} title="Điểm trước">⏮</button>
              <button style={tourBtn} onClick={() => stepTour(1)} title="Điểm sau">⏭</button>
              <div style={{ display: 'flex', gap: 3, flex: 1 }}>
                {cfg.waypoints.map((w, i) => (
                  <button key={w.id || i}
                    onClick={() => { setPlaying(false); goWp(i); }}
                    style={{
                      flex: 1, height: 8, padding: 0, border: 0, borderRadius: 4, cursor: 'pointer',
                      background: i <= curWp ? '#ff3b5c' : 'rgba(255,255,255,.3)',
                    }} />
                ))}
              </div>
              <span style={{ minWidth: 44, textAlign: 'right' }}>{Math.max(curWp + 1, 0)}/{wpCount}</span>
            </div>
          )}

          {pickHint && <div className="sv-hint">{pickHint}</div>}
          {!pickHint && mode === 'walk' && !playing && (
            <div className="sv-hint">
              {cfg.waypoints.length ? 'Bấm vòng tròn hoặc phím W A S D để đi · kéo chuột để nhìn quanh' : 'Cảnh này chưa có điểm đi. Bấm ✎ Chỉnh sửa để thêm.'}
            </div>
          )}

          {edit && tri && (pick === 'hotspot' || pick === 'move') && (
            <div style={panelStyle}>
              <span>
                Đã bấm <b>{tri.n}</b> góc
                {tri.pos && <> · sai số {tri.error.toFixed(2)} · lệch góc {tri.angle.toFixed(0)}°</>}
              </span>
              <button disabled={!tri.pos} onClick={confirmTri}>✓ Dùng điểm này</button>
              <button onClick={undoRay}>↶ Bỏ lần bấm cuối</button>
              <button onClick={() => { resetTri(); }}>Làm lại</button>
            </div>
          )}

          {!edit && active && (
            <div className="sv-card">
              <button className="sv-x" onClick={() => setActive(null)}>×</button>
              <h3>{active.title}</h3>
              <p>{active.text}</p>
              {active.image && <img src={`/scenes/${entry.id}/${active.image}`} alt={active.title} />}
            </div>
          )}

          {edit && (
            <div className="sv-edit">
              <b>Chỉnh sửa</b>
              <div className={`sv-save ${saveState}`}>{SAVE_TEXT[saveState]}</div>
              <button onClick={saveHome}>Đặt góc nhìn ban đầu</button>
              <button onClick={addWpHere}>+ Điểm đi tại camera</button>
              <button className={pick === 'ground' ? 'on' : ''} onClick={() => setPick(pick === 'ground' ? null : 'ground')}>+ Điểm đi: bấm mặt đất</button>
              <button className={pick === 'hotspot' ? 'on' : ''} onClick={() => setPick(pick === 'hotspot' ? null : 'hotspot')}>+ Hotspot: bấm vào vật</button>
              <label className="sv-eye">Độ cao mắt
                <input type="number" step="0.1" value={cfg.eyeHeight}
                  onChange={(e) => { cfg.eyeHeight = parseFloat(e.target.value) || 1; rerender(); }}
                  onBlur={save} />
              </label>
              <button onClick={save}>Lưu ngay</button>
              <div className="sv-list">
                <small>Điểm đi ({cfg.waypoints.length})</small>
                {cfg.waypoints.map((w, i) => (
                  <div className="row" key={w.id || i}>
                    <span>Điểm {i + 1}</span>
                    <button onClick={() => previewWp(w)}>Xem</button>
                    <button onClick={() => delWp(i)}>✕</button>
                  </div>
                ))}
                <small>Hotspot ({cfg.hotspots.length})</small>
                {cfg.hotspots.map((h) => (
                  <div className="row" key={h.id}>
                    <span>{h.title}</span>
                    <button onClick={() => openForm(h)}>Sửa</button>
                    <button onClick={() => delHs(h.id)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {edit && form && (
            <div className="sv-form">
              <b>{form.id ? 'Sửa điểm thông tin' : 'Điểm thông tin mới'}</b>
              <input placeholder="Tên (vd: Tượng Quan Âm)" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <textarea rows={4} placeholder="Mô tả" value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })} />
              <input placeholder="Tên file ảnh (không bắt buộc)" value={form.image}
                onChange={(e) => setForm({ ...form, image: e.target.value })} />
              <div className="row">
                <button className="ok" onClick={submitForm}>Lưu</button>
                {form.id && <button onClick={() => setPick('move')}>Đặt lại vị trí</button>}
                {form.id && <button onClick={() => delHs(form.id)}>Xóa</button>}
                <button onClick={() => { setForm(null); setPick(null); }}>Hủy</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}