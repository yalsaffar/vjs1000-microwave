import '@fontsource/caveat/600.css';
import '@videojs/html/i18n';
import './room3d.css';
import './camera.css';
import './mw-box.css';
import { createPlayer } from '../frame/player';
import { setupCamera } from './camera';

const root = document.documentElement;

// The microwave on the counter
const stage = document.getElementById('k-stage')!;
const i18n = document.createElement('media-i18n');
i18n.append(createPlayer());
stage.append(i18n);

// Sky in the window follows the visitor's local time
function updateSky() {
  const h = new Date().getHours();
  root.dataset.sky = h >= 7 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night';
}
updateSky();
setInterval(updateSky, 60_000);

// The wall clock tells the real time
function updateClock() {
  const now = new Date();
  const m = now.getMinutes();
  const h = (now.getHours() % 12) + m / 60;
  root.style.setProperty('--k3-clock-h', `${h * 30}deg`);
  root.style.setProperty('--k3-clock-m', `${m * 6}deg`);
}
updateClock();
setInterval(updateClock, 30_000);

// The light switch = light / dark mode
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const button = document.querySelector<HTMLButtonElement>('.k-switch')!;
let audio: AudioContext | undefined;

function click() {
  try {
    audio ??= new AudioContext();
    const at = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.setValueAtTime(2400, at);
    osc.frequency.exponentialRampToValueAtTime(600, at + 0.03);
    gain.gain.setValueAtTime(0.12, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  } catch {
    // no audio
  }
}

function setLights(on: boolean, fromUser = false) {
  root.dataset.lights = on ? 'on' : 'off';
  root.style.colorScheme = on ? 'light' : 'dark';
  button.setAttribute('aria-checked', String(on));
  document.querySelector('.k3-lights')?.setAttribute('aria-pressed', String(on));
  if (fromUser) {
    click();
    try {
      localStorage.setItem('k-lights', on ? 'on' : 'off');
    } catch {
      // storage unavailable
    }
    if (on && !reduced) {
      root.classList.add('k-flicker');
      setTimeout(() => root.classList.remove('k-flicker'), 600);
    }
  }
}

let saved: string | null = null;
try {
  saved = localStorage.getItem('k-lights');
} catch {
  // storage unavailable
}
setLights(saved ? saved === 'on' : !matchMedia('(prefers-color-scheme: dark)').matches);
button.addEventListener('click', () => setLights(root.dataset.lights !== 'on', true));
document.querySelector('.k3-lights')?.addEventListener('click', () => setLights(root.dataset.lights !== 'on', true));

// The picture lights the kitchen: colours come from the skin's <mw-brain>
document.addEventListener('mw-ambient', (event) => {
  const { color, left, right, lit } = (event as CustomEvent).detail as {
    color: string;
    left: string;
    right: string;
    lit: boolean;
  };
  if (color) root.style.setProperty('--amb', color);
  if (left) root.style.setProperty('--amb-l', left);
  if (right) root.style.setProperty('--amb-r', right);
  root.toggleAttribute('data-cooking', lit);
});

// The 3D camera
setupCamera(document.querySelector<HTMLElement>('.k3')!);
