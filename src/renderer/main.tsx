import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { parseRoute } from '../shared/routes';
import { App } from './App';
import { dismissStartupLoader } from './startup/startup-loader';
import '../shared/theme/tokens.css';
import './styles/startup.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/editor.css';
import './styles/stickies.css';
import './styles/reminders.css';
import './styles/widget.css';
import './styles/documents.css';
import './styles/comments.css';
import './styles/graph.css';

// The startup loader belongs to the main window; stickies and the widget drop it before their first render (D-109).
if (parseRoute(window.location.hash).kind !== 'main') dismissStartupLoader({ fade: false });

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
