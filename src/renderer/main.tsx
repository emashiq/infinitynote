import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../shared/theme/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/editor.css';
import './styles/stickies.css';
import './styles/reminders.css';
import './styles/widget.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
