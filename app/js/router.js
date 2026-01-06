import { store, setScreen } from './store.js';

let renderer = null;

export function setRenderer(fn) {
  renderer = fn;
}

export function navigate(screen) {
  setScreen(screen);
  renderer && renderer();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function currentScreen() {
  return store.ui.screen;
}
