import '../../../packages/element/src/index';
import '../style.css';
import './style.css';
import { setupPlayground } from './playground.js';

setupPlayground(document.querySelector('#embed-playground')!, {
  sampleURL: `${import.meta.env.BASE_URL}miko.mavatar`,
});
