import { createRoot } from 'react-dom/client';

function App() {
  return <main>Local Windows AI Copilot</main>;
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Renderer root is missing.');
}

createRoot(root).render(<App />);
