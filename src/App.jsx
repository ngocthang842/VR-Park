import { useEffect, useState } from 'react';
import Library from './components/Library.jsx';
import SceneView from './components/SceneView.jsx';

const parse = () => {
  const [id, flag] = decodeURIComponent(location.hash.replace('#', '')).split('/');
  return { id, edit: flag === 'edit' };
};

export default function App() {
  const [scenes, setScenes] = useState(null);
  const [route, setRoute] = useState(parse());

  useEffect(() => {
    fetch('/scenes/index.json', { cache: 'no-store' }).then((r) => r.json()).then(setScenes).catch(() => setScenes([]));
    const onHash = () => setRoute(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!scenes) return null;
  const entry = scenes.find((s) => s.id === route.id);
  if (entry) {
    return (
      <SceneView
        key={entry.id + route.edit}
        entry={entry}
        edit={route.edit}
        onBack={() => (location.hash = '')}
        onToggleEdit={() => (location.hash = route.edit ? entry.id : `${entry.id}/edit`)}
      />
    );
  }
  return <Library scenes={scenes} onOpen={(id, edit) => (location.hash = edit ? `${id}/edit` : id)} />;
}