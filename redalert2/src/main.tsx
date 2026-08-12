import React from 'react';
import { createRoot } from 'react-dom/client';
import './setupThreeGlobal';
import App from './App.tsx';
import { registerBuiltInBot } from './game/ai/thirdpartbot/builtIn/BuiltInBotAdapter';

// Register built-in third-party bots
registerBuiltInBot();

createRoot(document.getElementById('root')!).render(<React.StrictMode>
    <App />
  </React.StrictMode>);
