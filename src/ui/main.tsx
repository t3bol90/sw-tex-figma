import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Could not find the UI root element.');

createRoot(root).render(<App />);
