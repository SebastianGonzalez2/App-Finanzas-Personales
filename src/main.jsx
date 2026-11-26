import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.jsx';
import './styles.css';
import './features/finance.css';
import './features/history/history.css';
import './features/stats/stats.css';
import './features/budgets/budgets.css';
import './features/recurring/recurring.css';

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>,
);
