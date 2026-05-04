/**
 * docs/src/main.tsx — React entry point for the dbpeek docs site.
 *
 * Mounts the App component into #root. We deliberately avoid GSAP and
 * smooth-scroll here — docs sites need standard browser scroll behavior
 * for keyboard navigation (Tab, Page Down, Space), screen readers, and
 * in-page anchor links (/#section-id) to all work correctly out of the box.
 *
 * The non-null assertion on getElementById('root') is safe: the element
 * is hardcoded in index.html and will always exist when this script runs.
 */
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
