import React from 'react';
import { createRoot } from 'react-dom/client';
import { STYLES } from './lib/styles.js';
import { AuthProvider } from './hooks/useAuth.jsx';
import App from './App.jsx';

// Inject the Gyftr design system once, exactly like the sibling portals do.
const styleTag = document.createElement('style');
styleTag.textContent = STYLES;
document.head.appendChild(styleTag);
document.body.style.margin = '0';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <div className="gx-root">
        <App />
      </div>
    </AuthProvider>
  </React.StrictMode>
);
