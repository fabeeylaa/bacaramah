import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(console.log);
  }, []);

  return <h1 className="p-8 text-2xl font-semibold">Baca Ramah</h1>;
}