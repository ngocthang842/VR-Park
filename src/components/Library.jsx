import './Library.css';

export default function Library({ scenes, onOpen }) {
  return (
    <div className="lib-page">
      <div className="lib">
        <h1>VR Park</h1>
        <p className="lib-sub">Chọn một bản đồ để vào tham quan</p>
        {scenes.length === 0 && <p>Chưa có cảnh. Thả thư mục chứa file .ply vào public/scenes rồi chạy npm run scenes.</p>}
        <div className="lib-grid">
          {scenes.map((s) => (
            <div key={s.id} className="lib-card">
              <button className="lib-open" onClick={() => onOpen(s.id, false)}>
                <div className="lib-thumb" style={s.thumbnail ? { backgroundImage: `url(${s.thumbnail})` } : {}} />
                <div className="lib-name">{s.name}</div>
                <div className="lib-desc">{s.description}</div>
              </button>
              <button className="lib-edit" onClick={() => onOpen(s.id, true)}>✎ Chỉnh sửa</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}