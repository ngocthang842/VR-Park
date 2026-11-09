import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/scenes');
fs.mkdirSync(root, { recursive: true });
const MODEL_EXT = ['.ply', '.ksplat', '.splat', '.spz'];
const scenes = [];

for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const folder = path.join(root, dir.name);
  const files = fs.readdirSync(folder);
  const modelFile = files.find((f) => MODEL_EXT.includes(path.extname(f).toLowerCase()));
  if (!modelFile) {
    console.warn(`[scenes] ${dir.name}: không có file model, bỏ qua`);
    continue;
  }
  const jsonPath = path.join(folder, 'scene.json');
  let scene;
  if (fs.existsSync(jsonPath)) {
    scene = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } else {
    scene = { name: dir.name, description: '', cameraUp: [0, -1, 0], eyeHeight: 1, waypoints: [], hotspots: [] };
    fs.writeFileSync(jsonPath, JSON.stringify(scene, null, 2));
    console.log(`[scenes] tạo scene.json mặc định cho ${dir.name}`);
  }
  const thumb = files.find((f) => /^thumbnail\.(jpg|jpeg|png|webp)$/i.test(f));
  scenes.push({
    id: dir.name,
    name: scene.name || dir.name,
    description: scene.description || '',
    thumbnail: thumb ? `/scenes/${dir.name}/${thumb}` : null,
    model: `/scenes/${dir.name}/${modelFile}`,
    config: `/scenes/${dir.name}/scene.json`,
  });
}

fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify(scenes, null, 2));
console.log(`[scenes] ${scenes.length} cảnh`);