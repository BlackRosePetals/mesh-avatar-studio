import { createRoot } from 'react-dom/client';
import '../../../src/live/live.css';
import './player.css';
import { PlayerApp } from './PlayerApp';

const language = document.documentElement.lang === 'ja' ? 'ja' : 'en';
createRoot(document.getElementById('root')!).render(<PlayerApp language={language} />);
