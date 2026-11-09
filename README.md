# VR-Park: xem cảnh Gaussian Splat 3D trên trình duyệt

Ứng dụng web cho phép xem một cảnh quay 3D (Gaussian Splat, quay bằng flycam) ngay trong trình duyệt, kèm:

- **Điểm đi** (vòng tròn): bấm vào để camera bay tới đó, giống Matterport.
- **Hotspot** (chấm trắng): gắn thông tin (tên, mô tả, ảnh) lên một vật trong cảnh, ví dụ tượng Quan Âm.
- **Tham quan tự động** (▶): camera tự bay qua lần lượt các điểm đi.
- **Chế độ chỉnh sửa**: tự đặt điểm đi, hotspot, góc nhìn ban đầu; tự lưu vào file.

> Lưu ý: tài liệu này viết dựa trên code của `SceneView.jsx`, `pick.js`, `triangulate.js` (đã xem đầy đủ).
> Các file `nav.js`, `App.jsx`, `Library.jsx`, `vite.config.js`, `build-index.mjs`, `*.css` và `scene.json`
> được mô tả **suy ra từ cách code gọi tới chúng**, chưa xem nội dung. Phần đó được đánh dấu *(suy ra)*.

---

## 1. Công nghệ

| Thành phần | Vai trò |
|---|---|
| **React** | Dựng giao diện (nút, form, thanh điều khiển). |
| **Vite** | Chạy server phát triển (`npm run dev`), tự tải lại trang khi lưu file, và (trong `vite.config.js`) có API để ghi file `scene.json`. |
| **three** (Three.js) | Thư viện 3D: tính toán vector, ma trận, chiếu điểm 3D lên màn hình. |
| **@mkkellogg/gaussian-splats-3d** | Đọc và vẽ file splat (`.ply`/`.splat`/`.ksplat`) lên canvas, kèm camera và điều khiển chuột. |

---

## 2. Cấu trúc thư mục

```
vr-park/
├─ index.html                 Trang HTML gốc, nạp src/main.jsx
├─ package.json               Danh sách thư viện và lệnh npm (dev, build, scenes)
├─ vite.config.js             Cấu hình Vite + API lưu scene.json (suy ra)
├─ scripts/
│  └─ build-index.mjs         Quét public/scenes, tạo public/scenes/index.json (suy ra)
├─ public/
│  └─ scenes/
│     ├─ index.json           Danh sách cảnh cho thư viện (tự sinh, không sửa tay)
│     ├─ tuong-phat/          Một cảnh: file model splat + scene.json (+ ảnh nếu có)
│     └─ landmark/            Một cảnh khác
└─ src/
   ├─ main.jsx                Điểm vào, gắn <App/> vào trang
   ├─ App.jsx                 Chuyển giữa Thư viện và Xem cảnh, giữ trạng thái "chỉnh sửa" (suy ra)
   ├─ components/
   │  ├─ Library.jsx/.css     Màn hình danh sách cảnh (suy ra)
   │  └─ SceneView.jsx/.css   Màn hình xem cảnh (file chính, mô tả chi tiết ở mục 5)
   └─ lib/
      ├─ nav.js               ease() làm mượt chuyển động, pickWaypoint() chọn điểm đi kế tiếp khi nhấn WASD (suy ra)
      ├─ pick.js              Bắt điểm trên bề mặt splat (dùng cho "điểm đi: bấm mặt đất")
      └─ triangulate.js       Tính vị trí 3D của hotspot từ nhiều lần bấm ở nhiều góc nhìn
```

---

## 3. Quy trình hoạt động tổng thể

```
npm run dev
   │ (chạy build-index.mjs: quét public/scenes → index.json)
   ▼
Library.jsx đọc index.json → hiện danh sách cảnh
   │ bấm vào một cảnh (entry = {id, name, model, config})
   ▼
SceneView.jsx
   1. fetch entry.config (scene.json) → cfgRef
   2. tạo GS.Viewer, nạp file model (entry.model), vẽ lên canvas
   3. vòng lặp mỗi khung hình: chạy animation camera + đặt vị trí các chấm/vòng tròn lên màn hình
   4. người dùng tương tác (xoay, bấm điểm, chạy tour)
   5. ở chế độ chỉnh sửa: mọi thay đổi ghi vào cfgRef rồi POST /api/scene → ghi lại scene.json
```

Điểm mấu chốt: **dữ liệu cảnh (điểm đi, hotspot) không nằm trong code mà nằm trong `scene.json`**. Muốn mang cảnh sang máy khác thì chép cả thư mục cảnh.

### Cấu trúc `scene.json`

```json
{
  "cameraUp": [0, -1, 0],          // hướng "lên" của cảnh (ở đây trục Y đảo ngược)
  "eyeHeight": 1,                  // độ cao mắt khi đi bộ (đơn vị của cảnh)
  "camera": { "pos": [x,y,z], "look": [x,y,z] },   // góc nhìn ban đầu
  "waypoints": [ { "id": "w...", "pos": [x,y,z], "look": [x,y,z] } ],   // điểm đi, THỨ TỰ = thứ tự tour
  "hotspots":  [ { "id": "h...", "pos": [x,y,z], "title": "", "text": "", "image": "" } ]
}
```

---

## 4. Giải thích các file `lib`

### 4.1 `triangulate.js` (tính vị trí hotspot)

**Vấn đề:** một lần bấm chuột chỉ cho biết vật nằm theo *hướng* nào (một tia từ camera), không cho biết nó *xa bao nhiêu*. Đoán độ xa từ đám splat dễ sai vì cảnh có sương và điểm lạc.

**Giải pháp:** bấm vào cùng một vật từ vài góc khác nhau, mỗi lần được một tia. Giao điểm các tia là vị trí thật.

| Hàm | Làm gì |
|---|---|
| `getRay(viewer, clientX, clientY, rect)` | Đổi tọa độ chuột sang tọa độ chuẩn hóa (-1..1), rồi dùng `unproject` để tìm hướng tia đi qua điểm bấm. Trả về `{o: gốc tia (vị trí camera), d: hướng đã chuẩn hóa}`. |
| `triangulate(rays)` | Tìm điểm gần tất cả các tia nhất bằng bình phương tối thiểu. |

Các bước trong `triangulate`:

1. **Cần ≥ 2 tia**, nếu không trả `fail: 'need'`.
2. **Kiểm tra góc giữa các tia**: nhỏ hơn 3° nghĩa là hai góc nhìn quá giống nhau → `fail: 'parallel'`.
3. **Dựng hệ phương trình**: mỗi tia đóng góp ma trận `I - d·dᵀ` (khoảng cách vuông góc tới tia) vào ma trận `A` và vế phải `b`. Nghiệm `p = A⁻¹·b` là điểm tối thiểu hóa tổng bình phương khoảng cách tới mọi tia.
4. **Kiểm tra định thức** `A`: gần 0 nghĩa là các tia gần song song → `fail: 'parallel'`.
5. **Kiểm tra điểm nằm phía trước camera** (`t ≥ 0.05` với mọi tia). Nếu camera chỉ xoay tại chỗ (cùng gốc), nghiệm trùng vị trí camera → `fail: 'behind'`.
6. **Tính sai số**: khoảng cách trung bình từ điểm tìm được tới các tia. Số nhỏ = các lần bấm khớp nhau.

Trả về `{ point, error, angle }`.

### 4.2 `pick.js` (bắt điểm trên bề mặt splat)

Hàm `pickPoint(viewer, clientX, clientY, rect, pixelRadius = 6)`. Hiện **chỉ còn dùng cho "điểm đi: bấm mặt đất"**, vì hotspot đã chuyển sang `triangulate.js`.

1. Tính tia từ chỗ bấm (giống `getRay`).
2. Duyệt các điểm splat (bỏ bớt bằng `stride` nếu quá 400 000 điểm cho nhẹ).
3. Giữ điểm nằm trong vòng `pixelRadius` pixel quanh tia, ở phía trước camera, và đủ đục (`col.w >= 140`, bỏ sương/mây).
4. Gom độ sâu của các điểm đó vào các "ngăn" rộng ~3% (theo thang log), chọn cụm đông điểm nhất (bề mặt thật thường dày điểm hơn sương), lấy độ sâu trung vị của cụm.
5. Trả về điểm = gốc tia + hướng × độ sâu.

Cách này đủ tốt cho mặt đất (bề mặt rộng, nhiều điểm) nhưng không đủ tin cậy cho vật nhỏ ở xa, nên hotspot dùng tam giác hóa.

### 4.3 `nav.js` *(suy ra)*

- `ease(k)`: hàm làm mượt, nhận 0..1 và trả 0..1 theo đường cong chậm-nhanh-chậm, dùng cho animation camera.
- `pickWaypoint(waypoints, curIndex, camPos, dir)`: khi nhấn W/A/S/D, chọn điểm đi nằm gần nhất theo hướng `dir`.

---

## 5. `SceneView.jsx` giải thích theo khối

### 5.1 Hằng số đầu file

| Dòng | Tác dụng |
|---|---|
| `LOOK_R = 0.01` | Khi "đi bộ", điểm nhìn được đặt rất gần camera (0.01) để xoay chuột giống xoay đầu tại chỗ, không xoay quanh vật. |
| `HOME_DEFAULT` | Góc nhìn mặc định nếu `scene.json` chưa có `camera`. |
| `TOUR_FLY_MS`, `TOUR_DWELL_MS` | Thời gian bay giữa 2 điểm và thời gian dừng ở mỗi điểm khi tham quan (mili giây). |
| `r3(v)` | Làm tròn vector 3D còn 3 chữ số thập phân thành mảng `[x,y,z]` để lưu vào JSON gọn. |
| `SAVE_TEXT` | Chữ hiển thị theo trạng thái lưu. |
| `FAIL_TEXT` | Thông báo khi tam giác hóa thất bại (`parallel`, `behind`). |
| `tourBtn` | Style cho nút trong thanh tham quan. |

### 5.2 Các `ref` và `state`

**`useRef`** (giữ giá trị giữa các lần vẽ lại, đổi giá trị **không** làm vẽ lại giao diện, và vòng lặp animation đọc được giá trị mới nhất):

| Biến | Giữ gì |
|---|---|
| `boxRef` | Thẻ div chứa canvas. |
| `viewerRef` | Đối tượng `GS.Viewer`. |
| `cfgRef` | Nội dung `scene.json` đang chỉnh. |
| `st` | `{mode, wp, anim}`: chế độ hiện tại, chỉ số điểm đi hiện tại, animation camera đang chạy. |
| `dotRefs` | Các thẻ DOM của chấm/vòng tròn, để vòng lặp cập nhật vị trí. |
| `pickRef` | Đang ở chế độ đặt gì (`'hotspot'`, `'ground'`, `'move'` hoặc `null`). |
| `formRef` | Bản sao của `form` để vòng lặp đọc được. |
| `raysRef` | Danh sách tia đã bấm khi đặt hotspot. |
| `triRef` | Điểm tam giác hóa tạm thời (để vòng lặp vẽ chấm nháp). |
| `playRef` | Đang tham quan hay không (để vòng lặp ẩn vòng tròn). |

**`useState`** (đổi giá trị thì giao diện vẽ lại): `ready`, `progress`, `error`, `mode`, `active` (hotspot đang mở thẻ thông tin), `form`, `pick`, `tri`, `playing`, `saveState`, `msg`, và `bump` (ép vẽ lại khi dữ liệu trong `cfgRef` đổi, vì ref không tự kích hoạt vẽ lại; hàm `rerender()` gọi `bump`).

Vì sao có cả ref lẫn state cho cùng một thứ (`pick`/`pickRef`, `playing`/`playRef`, `tri`/`triRef`)? State cho giao diện, ref cho vòng lặp và sự kiện chuột vốn chỉ "nhớ" giá trị cũ nếu đọc state.

### 5.3 Các hook và hàm theo thứ tự

1. **Đọc `scene.json`** (`useEffect` theo `entry`): `fetch` với `cache: 'no-store'` để luôn lấy bản mới, gộp với giá trị mặc định (`cameraUp`, `eyeHeight`, `waypoints: []`, `hotspots: []`), rồi `setReady(true)`.
2. **Tự tắt thông báo** sau 3,5 giây.
3. **Vào chế độ chỉnh sửa thì dừng tham quan.**
4. **`save()`**: POST `{id, config}` tới `/api/scene` (API do `vite.config.js` cung cấp). Chỉ hoạt động khi chạy `npm run dev`, vì sau khi build không còn server để ghi file.
5. **`flyTo(pos, look, walk, ms)`**: đặt một animation `{t0, ms, p0, l0, p1, l1}` (vị trí và điểm nhìn đầu/cuối). Nếu `walk` thì điểm nhìn đích bị kéo sát camera (`LOOK_R`). Vòng lặp sẽ nội suy.
6. **`goWp(i, ms)`**: bay tới điểm đi thứ `i`. Nếu điểm không có `look` thì giữ hướng camera hiện tại.
7. **`setMode(m)`**: `'walk'` tắt zoom và pan, bay tới điểm đi; `'orbit'` bật lại zoom/pan, dừng tour, bay về góc nhìn ban đầu.
8. **Tham quan tự động** (`useEffect` theo `playing`): mỗi `FLY + DWELL` ms gọi `goWp(điểm kế % số điểm)` bằng `setTimeout`, lặp vòng; dọn timer khi dừng.
9. **`toggleTour`, `stepTour`**: bật/tắt tour; chuyển điểm trước/sau (và dừng tour).
10. **Khởi tạo viewer và vòng lặp** (`useEffect` theo `ready`):
    - Tạo `GS.Viewer` với `cameraUp`, vị trí và hướng nhìn ban đầu.
    - `addSplatScene(entry.model, ...)` nạp model; `onProgress` cập nhật thanh tải; xong thì `viewer.start()`.
    - `place(key, pos, lift)`: chiếu một điểm 3D lên màn hình bằng `project(camera)`, rồi đặt thẻ DOM tại đúng pixel bằng `transform: translate`. Ẩn nếu điểm ra ngoài màn hình hoặc phía sau camera. Với điểm đi có `lift` = `eyeHeight` để vòng tròn nằm ở chân thay vì ở mắt.
    - `loop()` chạy mỗi khung hình bằng `requestAnimationFrame`: (a) nếu có animation thì nội suy vị trí camera và `controls.target`; (b) gọi `place` cho mọi điểm đi, hotspot, chấm nháp.
    - Hàm dọn: hủy vòng lặp, `viewer.dispose()`.
11. **Phím W A S D / mũi tên** (chỉ ở chế độ `walk`): tính hướng tiến và hướng phải trên mặt phẳng ngang, nhờ `pickWaypoint` chọn điểm đi kế tiếp theo hướng đó.
12. **`handlePick(cx, cy)`** (xử lý bấm vào cảnh khi đang đặt điểm):
    - `hotspot`/`move`: thêm một tia vào `raysRef`; từ tia thứ 2 gọi `triangulate`; thành công thì lưu điểm vào `triRef` và `tri` để hiện chấm nháp; thất bại thì bỏ tia vừa thêm và báo lý do.
    - `ground`: dùng `pickPoint`, cộng thêm `eyeHeight` theo hướng lên để thành vị trí mắt, hướng nhìn lấy theo hướng camera hiện tại (bỏ thành phần dọc), rồi thêm điểm đi và lưu.
13. **Phân biệt bấm và kéo** (`useEffect` gắn `pointerdown`/`pointerup`): chỉ tính là "bấm" nếu chuột dịch dưới 5 pixel, để kéo xoay camera không bị tính là đặt điểm.
14. **`confirmTri`, `undoRay`**: xác nhận điểm tam giác hóa (mở form tạo hotspot hoặc cập nhật vị trí hotspot cũ); bỏ lần bấm cuối rồi tính lại.
15. **Thao tác chỉnh sửa**: `addWpHere` (thêm điểm đi tại camera), `delWp`, `previewWp` (bay xem thử), `saveHome` (đặt góc nhìn ban đầu), `openForm`, `delHs`, `submitForm` (thêm/sửa hotspot).

### 5.4 Phần giao diện (JSX)

| Khối | Hiển thị khi | Nội dung |
|---|---|---|
| Canvas `sv-canvas` | luôn | Nơi vẽ cảnh. |
| `sv-top` | luôn | Nút "← Thư viện" và "✎ Chỉnh sửa". |
| `sv-title`, `sv-loading`, `sv-error`, `sv-toast` | tùy trạng thái | Tên cảnh, thanh tải, lỗi, thông báo ngắn. |
| `sv-layer` | khi có cấu hình | Lớp chứa vòng tròn điểm đi, chấm hotspot, chấm nháp (`hdraft`, `tri`). |
| `sv-modes` | luôn | Nút Tham quan, Đi theo điểm, Xoay tự do, và 2 nút "(sắp có)" chưa dùng được. |
| Thanh tham quan | không chỉnh sửa, ở chế độ `walk`, có điểm đi | ▶/⏸, ⏮, ⏭, thanh tiến độ chia theo điểm, bộ đếm `n/tổng`. |
| `sv-hint` | đang đặt điểm hoặc đang đi bộ | Dòng hướng dẫn. |
| Panel tam giác hóa | chỉnh sửa, đang đặt hotspot | Số góc đã bấm, sai số, nút Dùng/Bỏ/Làm lại. |
| `sv-card` | không chỉnh sửa, bấm vào hotspot | Thẻ thông tin (tên, mô tả, ảnh). |
| `sv-edit` | chỉnh sửa | Bảng công cụ và danh sách điểm đi, hotspot. |
| `sv-form` | chỉnh sửa, đang tạo/sửa hotspot | Form nhập tên, mô tả, tên file ảnh. |

---

## 6. Hướng dẫn sử dụng nhanh

1. `npm install` (lần đầu), rồi `npm run dev`, mở `http://localhost:5173`.
2. Chọn cảnh trong thư viện.
3. **✎ Chỉnh sửa**:
   - **Điểm đi**: dùng "+ Điểm đi tại camera" (đặt tại chỗ camera đang đứng, theo hướng đang nhìn) hoặc "+ Điểm đi: bấm mặt đất". Thứ tự trong danh sách = thứ tự tour.
   - **Hotspot**: "+ Hotspot", bấm vào vật, **dịch camera sang góc khác**, bấm lại đúng vật, kiểm tra chấm, bấm "Dùng điểm này", nhập thông tin, Lưu.
   - **Góc nhìn ban đầu**: xoay camera tới góc đẹp rồi bấm "Đặt góc nhìn ban đầu".
4. Thoát chỉnh sửa, bấm **▶ Tham quan** để xem như khách.

Thêm cảnh mới: tạo thư mục trong `public/scenes/<tên>/` chứa file model, chạy `npm run scenes`, tải lại trang.

---

## 7. Phân tích: cái gì có thể xóa

### 7.1 Chắc chắn không được xóa

`node_modules` (chỉ không đưa lên Git), `package.json`, `package-lock.json`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/components/*`, `src/lib/nav.js`, `src/lib/pick.js`, `src/lib/triangulate.js`, `vite.config.js`, `scripts/build-index.mjs`, `public/scenes/*`.

### 7.2 Nhiều khả năng xóa được (rác của mẫu Vite)

Các file này thường do mẫu dự án Vite tạo sẵn. **Chưa kiểm tra bằng cách tìm trong code**, nên làm theo cách an toàn bên dưới.

| File/thư mục | Vì sao nghi là thừa | Cách kiểm tra |
|---|---|---|
| `public/icons.svg` | Mẫu Vite, thường dùng cho trang demo mặc định. | Ctrl+Shift+F tìm `icons.svg` trong dự án; không có kết quả thì xóa. |
| `src/assets/` | Chứa logo mẫu (react.svg...). | Tìm `assets/` trong `src`; không ai import thì xóa. |
| `README.md` cũ của mẫu Vite | Nội dung mặc định, nên thay bằng file README này. | Thay thế luôn. |
| `.oxlintrc.json` | Cấu hình công cụ kiểm tra lỗi code (linter), **không ảnh hưởng chạy**. | Xóa được; nhưng nếu `package.json` có lệnh `lint` thì xóa lệnh đó luôn. |
| `public/favicon.svg` | Biểu tượng tab trình duyệt. Xóa được nhưng tab sẽ mất icon. | Giữ nếu `index.html` còn dòng `<link rel="icon" ...>`; hoặc thay bằng icon riêng. |
| `src/index.css`, CSS mặc định trong `App.css` (nếu có) | Mẫu Vite thường có CSS demo (căn giữa, nền tối...). | Mở file; phần nào không liên quan tới `sv-*`, `lib-*` thì bỏ. Cẩn thận vì có thể có `body { margin: 0 }` cần giữ. |

**Cách xóa an toàn:** commit Git trước, xóa từng thứ, chạy `npm run dev`, nếu lỗi hoặc giao diện hỏng thì `git checkout -- <file>` khôi phục.

### 7.3 Trong code đang dùng, có thể bỏ nếu không cần

| Thành phần | Có thể bỏ không |
|---|---|
| Hai nút "Nhìn từ trên (sắp có)", "Toàn cảnh (sắp có)" | Bỏ được nếu chưa định làm; chỉ cần xóa 2 dòng `<button disabled>`. |
| `+ Điểm đi: bấm mặt đất` và `pick.js` | Bỏ được cả hai nếu chỉ dùng "+ Điểm đi tại camera". Khi đó xóa: nhánh `kind === 'ground'` trong `handlePick`, nút tương ứng, dòng `import { pickPoint }`, file `pick.js`, và dòng `ground` trong `pickHint`. Nhưng **mình khuyên giữ**: bấm mặt đất tiện hơn nhiều khi đặt hàng chục điểm. |
| `+ Điểm đi tại camera` | Ngược lại, nếu giữ "bấm mặt đất" thì nút này vẫn hữu ích khi cần đặt điểm ở độ cao tùy ý (flycam). Nên giữ cả hai. |
| Nút "Đặt lại vị trí" (`move`) | Bỏ được nếu bạn thà xóa hotspot tạo lại; ít dùng nhưng không gây hại. |
| `saveHome` / `cfg.camera` | Giữ: không có thì cảnh luôn mở ở `HOME_DEFAULT` (có thể nhìn lệch). |
| `eyeHeight` và ô "Độ cao mắt" | Giữ nếu dùng "bấm mặt đất". Bỏ được nếu chỉ dùng điểm đi tại camera. |

### 7.4 Không nên xóa dù trông thừa

- `bump`/`rerender`, các `ref` song song với `state`: là cố ý (xem mục 5.2), xóa sẽ làm giao diện không cập nhật hoặc vòng lặp đọc giá trị cũ.
- `LOOK_R`, `HOME_DEFAULT`, `FAIL_TEXT`: được dùng trực tiếp.
- `cache: 'no-store'` trong `fetch`: để thấy ngay thay đổi `scene.json`.

### 7.5 Khi đưa lên Git

Không đưa: `node_modules`, `dist`. File model nặng: xem hướng dẫn Git LFS hoặc chép riêng. Kiểm tra `.gitignore` có `node_modules` và `dist`.

---

## 8. Hạn chế đã biết

- Nút tự lưu chỉ chạy với `npm run dev`; bản build tĩnh chỉ xem, không chỉnh sửa.
- Hotspot cần bấm từ ≥ 2 góc có dịch chuyển camera; nếu chỉ xoay tại chỗ sẽ báo lỗi.
- Tour dùng hướng camera lúc đặt điểm đi, nên cần xoay camera nhìn đúng vật trước khi đặt.
- Chưa có ảnh thu nhỏ cho từng điểm như Matterport.
