import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './tailwind.css';
import './styles.css';

if ('__TAURI_INTERNALS__' in window) {
  document.documentElement.classList.add('tauri-runtime');
  const appleMobile =
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  document.documentElement.classList.add(appleMobile ? 'platform-ipados' : 'platform-macos');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
