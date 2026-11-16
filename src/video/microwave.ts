/**
 * Microwave controls: the parts of the skin Video.js doesn't ship.
 *
 * - <mw-brain>    reflects player state onto the container, owns keypad entry and display messages, beeps.
 * - <mw-display>  a 7-segment VFD: clock when idle, cook time counting down, flashes like a real oven.
 * - <mw-keypad>   type a time (2-3-0 = 2:30), press START to jump there.
 * - <mw-presets>  DEFROST / REHEAT / POPCORN = playback speed.
 * - <mw-start>    START plays (or jumps to the typed time); while cooking it adds 30 seconds, like the real thing.
 * - <mw-stop>     STOP pauses; pressed again it clears; clears a half-typed time first.
 */
import {
  createPlayer,
  selectPlayback,
  selectPlaybackRate,
  selectTime,
  selectVolume,
  UIElement,
  type PropertyValues,
} from '@videojs/html';
import { videoFeatures } from '@videojs/html/video';

const { PlayerController } = createPlayer({ features: videoFeatures });

/* ------------------------------------------------------------------ *
 * Shared state per microwave
 * ------------------------------------------------------------------ */

class Brain extends EventTarget {
  /** Digits typed on the keypad, at most four (MMSS). */
  entry = '';
  /** A short message the display shows instead of the time, such as `P-7` or `End`. */
  flash: string | null = null;
  showElapsed = false;
  /** Volume 0–1, for scaling beeps; 0 when muted. */
  loudness = 0.5;
  /** Like a real oven, opening the door pauses cooking. */
  doorOpen = false;
  /** Set by <mw-brain>: jump to a percentage of the video. */
  jumpTo: ((percent: number) => void) | null = null;
  #flashTimer = 0;

  setDoor(open: boolean) {
    if (this.doorOpen === open) return;
    this.doorOpen = open;
    clunk(this.loudness, open);
    this.changed();
  }

  press(digit: string) {
    this.entry = (this.entry + digit).replace(/^0+/, '').slice(-4);
    this.flash = null;
    beep(this.loudness);
    this.changed();
  }

  backspace() {
    this.entry = this.entry.slice(0, -1);
    this.changed();
  }

  clearEntry() {
    this.entry = '';
    this.changed();
  }

  /** Entered time in seconds. Like a real microwave, 90 means 90 seconds. */
  get entrySeconds(): number {
    const padded = this.entry.padStart(4, '0');
    return Number(padded.slice(0, 2)) * 60 + Number(padded.slice(2));
  }

  say(text: string, ms = 1200) {
    this.flash = text;
    clearTimeout(this.#flashTimer);
    this.#flashTimer = window.setTimeout(() => {
      this.flash = null;
      this.changed();
    }, ms);
    this.changed();
  }

  changed() {
    this.dispatchEvent(new Event('change'));
  }
}

const brains = new WeakMap<Element, Brain>();

function brainFor(element: Element): Brain {
  const root = element.closest('media-container') ?? element;
  let brain = brains.get(root);
  if (!brain) {
    brain = new Brain();
    brains.set(root, brain);
  }
  return brain;
}

/* ------------------------------------------------------------------ *
 * Beeps (generated, no audio files)
 * ------------------------------------------------------------------ */

let audio: AudioContext | undefined;

function beep(loudness: number, times = 1, freq = 2100) {
  if (loudness <= 0) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime + 0.01;
    for (let i = 0; i < times; i++) {
      const at = start + i * 0.32;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const peak = 0.035 * Math.min(1, loudness * 1.4);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + 0.005);
      gain.gain.setValueAtTime(peak, at + (times > 1 ? 0.2 : 0.07));
      gain.gain.linearRampToValueAtTime(0, at + (times > 1 ? 0.21 : 0.08));
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.25);
    }
  } catch {
    // No Web Audio: stay silent.
  }
}

/** The bell of a 70s countertop oven: two inharmonic partials ringing out. */
function ding(loudness: number) {
  if (loudness <= 0) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const at = audio.currentTime + 0.02;
    const level = 0.09 * Math.min(1, loudness * 1.3);
    for (const [freq, share, decay] of [[1568, 1, 2.2], [3920, 0.35, 0.9], [5480, 0.15, 0.5]] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level * share, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + decay + 0.05);
    }
  } catch {
    // No Web Audio.
  }
}

/** The door latch: a short low thump, a little brighter when it opens. */
function clunk(loudness: number, open: boolean) {
  if (loudness <= 0) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const at = audio.currentTime + 0.01;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(open ? 190 : 140, at);
    osc.frequency.exponentialRampToValueAtTime(55, at + 0.12);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.32 * Math.min(1, loudness * 1.3), at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.2);
    if (open) window.setTimeout(() => pop(loudness * 0.6), 40);
  } catch {
    // No Web Audio.
  }
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ------------------------------------------------------------------ *
 * Ambient light: the oven glows in the colours of the picture
 * ------------------------------------------------------------------ */

export interface MicrowaveAmbient {
  /** Average colour of the frame, as `r g b`. */
  color: string;
  left: string;
  right: string;
  /** 0–1 average brightness. */
  luma: number;
  lit: boolean;
}

class AmbientSampler {
  #canvas = document.createElement('canvas');
  #ctx = this.#canvas.getContext('2d', { willReadFrequently: true });
  #broken = false;

  constructor() {
    this.#canvas.width = 12;
    this.#canvas.height = 6;
  }

  sample(container: Element): Omit<MicrowaveAmbient, 'lit'> | null {
    if (this.#broken || !this.#ctx) return null;
    const video = findVideo(container);
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    try {
      this.#ctx.drawImage(video, 0, 0, 12, 6);
      const { data } = this.#ctx.getImageData(0, 0, 12, 6);
      const avg = (x0: number, x1: number) => {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < 6; y++)
          for (let x = x0; x < x1; x++) {
            const i = (y * 12 + x) * 4;
            r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; n++;
          }
        return [r / n, g / n, b / n] as const;
      };
      const all = avg(0, 12);
      // Lift dark frames a little and saturate, so the glow reads as light rather than mud.
      const boost = ([r, g, b]: readonly [number, number, number]) => {
        const max = Math.max(r, g, b, 1);
        const k = Math.min(2.2, 210 / max);
        const mean = (r + g + b) / 3;
        const sat = (c: number) => Math.round(Math.min(255, (mean + (c - mean) * 1.35) * k));
        return `${sat(r)} ${sat(g)} ${sat(b)}`;
      };
      return {
        color: boost(all),
        left: boost(avg(0, 4)),
        right: boost(avg(8, 12)),
        luma: (0.2126 * all[0] + 0.7152 * all[1] + 0.0722 * all[2]) / 255,
      };
    } catch {
      // A cross-origin frame taints the canvas: keep the warm lamp colour instead.
      this.#broken = true;
      return null;
    }
  }
}

function findVideo(container: Element): HTMLVideoElement | null {
  const direct = container.querySelector('video');
  if (direct) return direct;
  for (const el of container.querySelectorAll('*')) {
    if (!el.localName.includes('-') || el.localName.startsWith('media-') || el.localName.startsWith('mw-')) continue;
    const host = el as HTMLElement & { nativeEl?: HTMLVideoElement; media?: HTMLVideoElement };
    const inner = host.nativeEl ?? host.media ?? host.shadowRoot?.querySelector('video');
    if (inner instanceof HTMLVideoElement) return inner;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Make a light-DOM child behave as a button: Enter on keydown, Space on keyup. */
function onActivate(target: HTMLElement, handler: () => void, signal: AbortSignal) {
  target.addEventListener('click', handler, { signal });
}

abstract class MicrowavePart extends UIElement {
  protected brain!: Brain;
  protected disconnect: AbortController | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.disconnect?.abort();
    this.disconnect = new AbortController();
    this.brain = brainFor(this);
    this.brain.addEventListener('change', () => this.requestUpdate(), { signal: this.disconnect.signal });
    this.setup(this.disconnect.signal);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.disconnect?.abort();
    this.disconnect = null;
  }

  protected setup(_signal: AbortSignal) {}
}

/* ------------------------------------------------------------------ *
 * <mw-brain>: state on the container, keyboard digits, end-of-cook beeps
 * ------------------------------------------------------------------ */

class MicrowaveBrainElement extends MicrowavePart {
  readonly #playback = new PlayerController(this, selectPlayback);
  readonly #time = new PlayerController(this, selectTime);
  readonly #volume = new PlayerController(this, selectVolume);
  readonly #rate = new PlayerController(this, selectPlaybackRate);
  #wasEnded = false;
  #lastVolume: number | null = null;
  #sampler = new AmbientSampler();
  #ambientTimer = 0;
  #popTimer = 0;
  #cooking = false;
  #popping = false;
  #heldKey: string | null = null;
  #entryBefore = '';

  protected override setup(signal: AbortSignal) {
    const container = this.closest('media-container');
    if (!container) return;

    this.brain.jumpTo = (percent) => {
      const time = this.#time.value;
      if (!time || !time.duration) return;
      const target = Math.min(time.duration - 0.5, (time.duration * percent) / 100);
      void time.seek(Math.max(0, target));
      beep(this.brain.loudness, 1, 2600);
      this.brain.say(formatClock(target).replace(':', '').padStart(4, ' '), 800);
    };

    // Sample the picture a few times a second for the ambient glow; only while something is on screen.
    this.#ambientTimer = window.setInterval(() => this.#sampleAmbient(container), 220);
    signal.addEventListener('abort', () => {
      clearInterval(this.#ambientTimer);
      clearTimeout(this.#popTimer);
    });

    // Digits typed anywhere in the microwave go to the keypad, like the oven's own buttons.
    container.addEventListener(
      'keydown',
      (event) => {
        const e = event as KeyboardEvent;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, [contenteditable]')) return;

        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          if (!e.repeat) {
            this.#entryBefore = this.brain.entry;
            this.#heldKey = null;
            this.brain.press(e.key);
          } else if (this.#heldKey !== e.key) {
            // Held down: undo the typed digit and jump to that tenth instead.
            this.#heldKey = e.key;
            this.brain.entry = this.#entryBefore;
            this.brain.jumpTo?.(Number(e.key) * 10);
          }
        } else if (e.key === 'Backspace' && this.brain.entry) {
          e.preventDefault();
          this.brain.backspace();
        } else if (e.key === 'Escape' && this.brain.entry) {
          e.preventDefault();
          this.brain.clearEntry();
        } else if (e.key === 'Enter' && this.brain.entry && !target.closest('button, [role="button"], [role="slider"]')) {
          e.preventDefault();
          container.querySelector<HTMLButtonElement>('.mw-big-start')?.click();
        }
      },
      { signal }
    );

    // SERVE: a slow camera dolly between the oven on the counter and fullscreen (FLIP animation).
    const body = container.querySelector<HTMLElement>('.mw-body');
    let lastRect: DOMRect | null = null;
    const remember = () => {
      if (body) lastRect = body.getBoundingClientRect();
    };
    container.addEventListener('pointerdown', remember, { capture: true, signal });
    container.addEventListener('keydown', remember, { capture: true, signal });
    document.addEventListener(
      'fullscreenchange',
      () => {
        if (!body || !lastRect || prefersReducedMotion()) return;
        const entering = document.fullscreenElement === container;
        if (!entering && !container.contains(document.fullscreenElement) && document.fullscreenElement) return;
        const from = lastRect;
        requestAnimationFrame(() => {
          const to = body.getBoundingClientRect();
          if (!to.width || !from.width) return;
          const sx = from.width / to.width;
          const sy = from.height / to.height;
          const dx = from.left - to.left;
          const dy = from.top - to.top;
          body.animate(
            [
              { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
              { transformOrigin: '0 0', transform: 'none' },
            ],
            { duration: entering ? 1600 : 900, easing: entering ? 'cubic-bezier(0.22, 0.61, 0.12, 1)' : 'cubic-bezier(0.3, 0.7, 0.2, 1)' }
          );
          if (entering) beep(this.brain.loudness * 0.6, 1, 1500);
        });
        lastRect = null;
      },
      { signal }
    );

    // The window takes the shape of the picture: no dark bands above or below.
    const fitWindow = () => {
      const video = findVideo(container);
      if (video?.videoWidth && video.videoHeight)
        (container as HTMLElement).style.setProperty('--mw-ratio', `${video.videoWidth} / ${video.videoHeight}`);
    };
    container.addEventListener('loadedmetadata', fitWindow, { capture: true, signal });
    container.addEventListener('resize', fitWindow, { capture: true, signal });
    const ratioTimer = window.setInterval(fitWindow, 1000);
    signal.addEventListener('abort', () => clearInterval(ratioTimer));

    // Clicking the window toggles playback (mouse or touch), like most players.
    const glass = container.querySelector('.mw-window');
    glass?.addEventListener(
      'click',
      (event) => {
        if ((event.target as HTMLElement).closest('media-error-dialog, button, [role="button"]')) return;
        const playback = this.#playback.value;
        if (!playback) return;
        if (playback.paused) void playback.play();
        else playback.pause();
      },
      { signal }
    );
  }

  protected override update(changed: PropertyValues) {
    super.update(changed);
    const container = this.closest('media-container');
    const playback = this.#playback.value;
    const time = this.#time.value;
    const volume = this.#volume.value;
    if (!container || !playback || !time) return;

    let state = 'idle';
    if (playback.ended) state = 'ended';
    else if (!playback.started && playback.paused) state = 'idle';
    else if (playback.waiting && !playback.paused) state = 'waiting';
    else if (playback.paused) state = 'paused';
    else state = 'cooking';
    container.setAttribute('data-mw-state', state);
    // Cooking progress for the heat line inside the window.
    (container as HTMLElement).style.setProperty(
      '--mw-progress',
      time.duration > 0 ? Math.min(1, time.currentTime / time.duration).toFixed(4) : '0'
    );
    // Something started playback (Space, a click on the picture…) with the door open: shut it.
    if (!playback.paused && this.brain.doorOpen) this.brain.setDoor(false);
    container.setAttribute('data-mw-door', this.brain.doorOpen ? 'open' : 'closed');

    if (volume) {
      const loud = volume.muted ? 0 : volume.volume;
      this.brain.loudness = loud;
      container.toggleAttribute('data-mw-muted', volume.muted || volume.volume === 0);

      // Changing the power level shows it on the display, as `P-7`.
      if (this.#lastVolume !== null && Math.abs(this.#lastVolume - loud) > 0.004 && !volume.muted) {
        const level = Math.round(loud * 10);
        this.brain.say(level >= 10 ? 'PHI' : `P-${level}`, 1000);
      }
      if (this.#lastVolume !== null && this.#lastVolume > 0 && loud === 0) this.brain.say('OFF', 900);
      this.#lastVolume = loud;
    }

    if (volume) {
      const level = volume.muted ? 0 : volume.volume;
      (container as HTMLElement).style.setProperty('--mw-vol', level.toFixed(3));
    }

    const rate = this.#rate.value?.playbackRate ?? 1;
    container.setAttribute('data-mw-rate', rate < 1 ? 'defrost' : rate > 1 ? 'popcorn' : 'reheat');

    this.#cooking = state === 'cooking';
    const shouldPop = this.#cooking && rate > 1 && !prefersReducedMotion();
    if (shouldPop && !this.#popping) this.#schedulePop(container);
    this.#popping = shouldPop;

    if (playback.ended && !this.#wasEnded) {
      this.brain.flash = null;
      const loud = Math.max(this.brain.loudness, 0.35);
      ding(loud);
      window.setTimeout(() => beep(loud, 3), 900);
    }
    this.#wasEnded = playback.ended;
  }

  #sampleAmbient(container: Element) {
    const state = container.getAttribute('data-mw-state');
    const lit = state === 'cooking' || state === 'waiting' || state === 'paused';
    const sample = lit ? this.#sampler.sample(container) : null;
    const el = container as HTMLElement;
    if (sample) {
      el.style.setProperty('--mw-amb', sample.color);
      el.style.setProperty('--mw-amb-l', sample.left);
      el.style.setProperty('--mw-amb-r', sample.right);
      el.style.setProperty('--mw-amb-luma', sample.luma.toFixed(3));
    }
    const detail: MicrowaveAmbient = {
      color: sample?.color ?? el.style.getPropertyValue('--mw-amb') ?? '',
      left: sample?.left ?? '',
      right: sample?.right ?? '',
      luma: sample?.luma ?? 0,
      lit: state === 'cooking' || state === 'waiting',
    };
    container.dispatchEvent(new CustomEvent('mw-ambient', { detail, bubbles: true, composed: true }));
  }

  /** POPCORN mode: a kernel pops somewhere along the bottom of the window every so often. */
  #schedulePop(container: Element) {
    clearTimeout(this.#popTimer);
    this.#popTimer = window.setTimeout(() => {
      if (!this.#popping) return;
      const layer = container.querySelector('.mw-popcorn');
      if (layer) {
        const kernel = document.createElement('i');
        kernel.style.setProperty('--x', `${6 + Math.random() * 88}%`);
        kernel.style.setProperty('--h', `${30 + Math.random() * 55}%`);
        kernel.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
        kernel.style.setProperty('--s', `${0.7 + Math.random() * 0.6}`);
        kernel.style.setProperty('--d', `${Math.round(Math.random() * 40 - 20)}px`);
        layer.append(kernel);
        window.setTimeout(() => kernel.remove(), 1600);
        if (this.brain.loudness > 0 && Math.random() < 0.55) pop(this.brain.loudness);
      }
      this.#schedulePop(container);
    }, 280 + Math.random() * 900);
  }
}

/** A tiny popcorn pop: a burst of filtered noise. */
function pop(loudness: number) {
  try {
    audio ??= new AudioContext();
    const length = Math.floor(audio.sampleRate * 0.03);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 900 + Math.random() * 1400;
    gain.gain.value = 0.18 * loudness;
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start();
  } catch {
    // No Web Audio.
  }
}

/* ------------------------------------------------------------------ *
 * <mw-display>: 7-segment vacuum fluorescent display
 * ------------------------------------------------------------------ */

const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc',
  '8': 'abcdefg', '9': 'abcdfg', A: 'abcefg', b: 'cdefg', C: 'adef', c: 'deg', d: 'bcdeg', E: 'adefg', F: 'aefg',
  H: 'bcefg', I: 'bc', L: 'def', n: 'ceg', o: 'cdeg', O: 'abcdef', P: 'abefg', r: 'eg', S: 'acdfg', t: 'defg',
  U: 'bcdef', u: 'cde', y: 'bcdfg', '-': 'g', '_': 'd', ' ': '',
};

const hex = (x1: number, x2: number, y: number) =>
  `${x1},${y} ${x1 + 5},${y - 5} ${x2 - 5},${y - 5} ${x2},${y} ${x2 - 5},${y + 5} ${x1 + 5},${y + 5}`;
const vex = (x: number, y1: number, y2: number) =>
  `${x},${y1} ${x + 5},${y1 + 5} ${x + 5},${y2 - 5} ${x},${y2} ${x - 5},${y2 - 5} ${x - 5},${y1 + 5}`;
const SEGMENT_SHAPES: Record<string, string> = {
  a: hex(9, 51, 6), b: vex(54, 9, 48), c: vex(54, 52, 91), d: hex(9, 51, 94),
  e: vex(6, 52, 91), f: vex(6, 9, 48), g: hex(9, 51, 50),
};

function digitSvg(x: number): string {
  return `<g class="mw-digit" transform="translate(${x} 0)">${Object.entries(SEGMENT_SHAPES)
    .map(([name, points]) => `<polygon data-seg="${name}" points="${points}"/>`)
    .join('')}</g>`;
}

const INDICATORS = ['clock', 'cook', 'pause', 'end', 'speed', 'quiet', 'elapsed'] as const;
type Indicator = (typeof INDICATORS)[number];
const INDICATOR_TEXT: Record<Indicator, string> = {
  clock: 'CLOCK', cook: 'COOK', pause: 'PAUSE', end: 'END', speed: '×1', quiet: 'MUTE', elapsed: 'UP',
};

class MicrowaveDisplayElement extends MicrowavePart {
  readonly #playback = new PlayerController(this, selectPlayback);
  readonly #time = new PlayerController(this, selectTime);
  readonly #volume = new PlayerController(this, selectVolume);
  readonly #rate = new PlayerController(this, selectPlaybackRate);
  #digits: SVGGElement[] = [];
  #colon: SVGGElement | null = null;
  #lamps = new Map<Indicator, HTMLElement>();
  #sr: HTMLElement | null = null;
  #clockTimer = 0;

  protected override setup(signal: AbortSignal) {
    if (!this.#digits.length) {
      this.innerHTML = `
        <svg class="mw-segments" viewBox="0 0 290 100" aria-hidden="true" focusable="false">
          ${digitSvg(0)}${digitSvg(66)}
          <g class="mw-colon"><circle cx="145" cy="30" r="6"/><circle cx="141" cy="70" r="6"/></g>
          ${digitSvg(164)}${digitSvg(230)}
        </svg>
        <div class="mw-lamps" aria-hidden="true">${INDICATORS.map(
          (name) => `<span class="mw-lamp" data-lamp="${name}">${INDICATOR_TEXT[name]}</span>`
        ).join('')}</div>
        <span class="mw-sr-only" data-sr></span>`;
      this.#digits = [...this.querySelectorAll<SVGGElement>('.mw-digit')];
      this.#colon = this.querySelector('.mw-colon');
      for (const lamp of this.querySelectorAll<HTMLElement>('[data-lamp]'))
        this.#lamps.set(lamp.dataset.lamp as Indicator, lamp);
      this.#sr = this.querySelector('[data-sr]');
    }

    this.setAttribute('role', 'button');
    this.setAttribute('tabindex', '0');
    this.setAttribute('aria-roledescription', 'display');

    const toggle = () => {
      this.brain.showElapsed = !this.brain.showElapsed;
      this.brain.say(this.brain.showElapsed ? 'UP' : 'dn', 600);
    };
    this.addEventListener('click', toggle, { signal });
    this.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          toggle();
        } else if (e.key === ' ') e.preventDefault();
      },
      { signal }
    );
    this.addEventListener('keyup', (e) => e.key === ' ' && toggle(), { signal });

    // The idle clock ticks on its own.
    this.#clockTimer = window.setInterval(() => this.requestUpdate(), 1000);
    signal.addEventListener('abort', () => clearInterval(this.#clockTimer));
  }

  #show(text: string, colon: boolean) {
    const chars = text.padStart(4, ' ').slice(-4).split('');
    chars.forEach((char, i) => {
      const lit = SEGMENTS[char] ?? '';
      for (const seg of this.#digits[i]?.children ?? [])
        seg.classList.toggle('on', lit.includes((seg as SVGElement).dataset.seg ?? '#'));
    });
    this.#colon?.classList.toggle('on', colon);
  }

  protected override update(changed: PropertyValues) {
    super.update(changed);
    const playback = this.#playback.value;
    const time = this.#time.value;
    const volume = this.#volume.value;
    const rate = this.#rate.value;
    if (!playback || !time) return;

    const brain = this.brain;
    const lamps = new Set<Indicator>();
    let mode = 'time';
    let label = '';

    if (brain.entry) {
      // Typed time, right-aligned like a microwave: 2 → 0:02, 23 → 0:23, 230 → 2:30.
      const padded = brain.entry.padStart(4, ' ');
      this.#show(`${padded.slice(0, 2)}${padded.slice(2).replace(' ', '0')}`, true);
      mode = 'entry';
      label = `Typed ${formatClock(brain.entrySeconds)}. Press Start to jump there.`;
    } else if (brain.doorOpen && !brain.flash) {
      this.#show('door', false);
      mode = 'door';
      label = 'Door open. Press Start to close it and carry on.';
    } else if (brain.flash) {
      this.#show(brain.flash, false);
      mode = 'flash';
    } else if (playback.ended) {
      this.#show('End', false);
      lamps.add('end');
      mode = 'end';
      label = 'Finished';
    } else if (!playback.started && playback.paused) {
      const now = new Date();
      const h = now.getHours() % 12 || 12;
      this.#show(`${h}${String(now.getMinutes()).padStart(2, '0')}`, now.getSeconds() % 2 === 0);
      lamps.add('clock');
      mode = 'clock';
      label = `Ready. ${formatClock(time.duration)} to cook.`;
    } else if (playback.waiting && !playback.paused) {
      this.#show('----', false);
      mode = 'wait';
      label = 'Loading';
    } else {
      const seconds = brain.showElapsed ? time.currentTime : Math.max(0, time.duration - time.currentTime);
      const s = Math.floor(seconds);
      const m = Math.floor(s / 60);
      // MM:SS up to 99 minutes, then H:MM.
      if (m >= 100) this.#show(`${String(Math.floor(m / 60)).padStart(2, ' ')}${String(m % 60).padStart(2, '0')}`, true);
      else this.#show(`${String(m).padStart(2, ' ')}${String(s % 60).padStart(2, '0')}`, true);
      lamps.add(playback.paused ? 'pause' : 'cook');
      if (brain.showElapsed) lamps.add('elapsed');
      mode = playback.paused ? 'paused' : 'cooking';
      label = `${formatClock(time.currentTime)} of ${formatClock(time.duration)}`;
    }

    if (volume && (volume.muted || volume.volume === 0)) lamps.add('quiet');
    if (rate && rate.playbackRate !== 1) {
      lamps.add('speed');
      const speedLamp = this.#lamps.get('speed');
      if (speedLamp) speedLamp.textContent = `×${rate.playbackRate}`;
    }
    for (const [name, el] of this.#lamps) el.classList.toggle('on', lamps.has(name));

    this.setAttribute('data-mode', mode);
    const tail = brain.showElapsed ? 'showing elapsed time' : 'showing time left';
    this.setAttribute('aria-label', `Display, ${tail}. Activate to switch.`);
    if (this.#sr && label && this.#sr.textContent !== label && mode !== 'cooking') this.#sr.textContent = label;
  }
}

/* ------------------------------------------------------------------ *
 * <mw-keypad>
 * ------------------------------------------------------------------ */

class MicrowaveKeypadElement extends MicrowavePart {
  #holdTimer = 0;
  #held = false;

  protected override setup(signal: AbortSignal) {
    // Tap a number to type a time; hold it to jump to that tenth of the video.
    this.addEventListener(
      'pointerdown',
      (event) => {
        const key = (event.target as HTMLElement).closest<HTMLElement>('[data-digit]');
        if (!key?.dataset.digit || event.button !== 0) return;
        this.#held = false;
        clearTimeout(this.#holdTimer);
        key.setAttribute('data-holding', '');
        this.#holdTimer = window.setTimeout(() => {
          this.#held = true;
          key.removeAttribute('data-holding');
          key.setAttribute('data-jumped', '');
          window.setTimeout(() => key.removeAttribute('data-jumped'), 500);
          this.brain.jumpTo?.(Number(key.dataset.digit) * 10);
        }, 550);
      },
      { signal }
    );
    const cancel = () => {
      clearTimeout(this.#holdTimer);
      for (const key of this.querySelectorAll('[data-holding]')) key.removeAttribute('data-holding');
    };
    this.addEventListener('pointerup', cancel, { signal });
    this.addEventListener('pointerleave', cancel, { signal });
    this.addEventListener('pointercancel', cancel, { signal });
    this.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });

    this.addEventListener(
      'click',
      (event) => {
        const key = (event.target as HTMLElement).closest<HTMLElement>('[data-digit]');
        if (key?.dataset.digit) {
          if (this.#held) {
            this.#held = false;
            return;
          }
          this.brain.press(key.dataset.digit);
          key.setAttribute('data-typed', '');
          window.setTimeout(() => key.removeAttribute('data-typed'), 260);
        } else if ((event.target as HTMLElement).closest('media-seek-button')) beep(this.brain.loudness);
      },
      { signal }
    );
  }
}

/* ------------------------------------------------------------------ *
 * <mw-door-toggle>: the handle and the PUSH·DOOR release bar
 * ------------------------------------------------------------------ */

class MicrowaveDoorToggleElement extends MicrowavePart {
  readonly #playback = new PlayerController(this, selectPlayback);

  protected override setup(signal: AbortSignal) {
    const button = this.querySelector('button');
    button?.addEventListener(
      'click',
      () => {
        const open = !this.brain.doorOpen;
        if (open) this.#playback.value?.pause();
        this.brain.setDoor(open);
      },
      { signal }
    );
  }

  protected override update(changed: PropertyValues) {
    super.update(changed);
    const button = this.querySelector('button');
    if (!button) return;
    button.setAttribute('aria-pressed', String(this.brain.doorOpen));
    button.setAttribute('aria-label', this.brain.doorOpen ? 'Close the door' : 'Open the door (pauses)');
  }
}

/* ------------------------------------------------------------------ *
 * <mw-presets>: cooking modes = playback speed
 * ------------------------------------------------------------------ */

const PRESET_WORD: Record<string, string> = { '0.5': 'dEF', '1': 'HEAt', '2': 'POP' };

class MicrowavePresetsElement extends MicrowavePart {
  readonly #rate = new PlayerController(this, selectPlaybackRate);

  protected override setup(signal: AbortSignal) {
    this.addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-rate]');
        const rate = this.#rate.value;
        if (!button || !rate) return;
        const value = Number(button.dataset.rate);
        rate.setPlaybackRate(value);
        beep(this.brain.loudness);
        this.brain.say(PRESET_WORD[button.dataset.rate ?? ''] ?? '', 900);
      },
      { signal }
    );
  }

  protected override update(changed: PropertyValues) {
    super.update(changed);
    const rate = this.#rate.value;
    const supported = rate && rate.playbackRateAvailability !== 'unsupported';
    this.toggleAttribute('hidden', !supported);
    if (!rate) return;
    for (const button of this.querySelectorAll<HTMLElement>('[data-rate]'))
      button.setAttribute('aria-pressed', String(Number(button.dataset.rate) === rate.playbackRate));
  }
}

/* ------------------------------------------------------------------ *
 * <mw-start> and <mw-stop>
 * ------------------------------------------------------------------ */

class MicrowaveStartElement extends MicrowavePart {
  readonly #playback = new PlayerController(this, selectPlayback);
  readonly #time = new PlayerController(this, selectTime);

  protected override setup(signal: AbortSignal) {
    const button = this.querySelector('button');
    if (!button) return;
    onActivate(button, () => this.#start(), signal);
  }

  #start() {
    const playback = this.#playback.value;
    const time = this.#time.value;
    if (!playback || !time) return;
    const brain = this.brain;
    beep(brain.loudness);
    if (brain.doorOpen) brain.setDoor(false);

    if (brain.entry) {
      const target = Math.min(brain.entrySeconds, Math.max(0, time.duration - 0.5));
      brain.clearEntry();
      void time.seek(target).then(() => playback.play());
      brain.say(formatClock(target).replace(':', '').padStart(4, ' '), 700);
      return;
    }

    if (playback.paused || playback.ended) {
      void playback.play();
      return;
    }

    // Already cooking: START adds 30 seconds, the oldest microwave shortcut there is.
    void time.seek(Math.min(time.currentTime + 30, time.duration));
    brain.say('+30', 700);
  }

  protected override update(changed: PropertyValues) {
    super.update(changed);
    const button = this.querySelector('button');
    const playback = this.#playback.value;
    if (!button || !playback) return;
    const brain = this.brain;
    let label = 'Start (play)';
    if (brain.entry) label = `Start at ${formatClock(brain.entrySeconds)}`;
    else if (!playback.paused && !playback.ended) label = 'Add 30 seconds (skip ahead)';
    button.setAttribute('aria-label', label);
    button.toggleAttribute('data-armed', Boolean(brain.entry) || playback.paused || playback.ended);
  }
}

class MicrowaveStopElement extends MicrowavePart {
  readonly #playback = new PlayerController(this, selectPlayback);
  readonly #time = new PlayerController(this, selectTime);

  protected override setup(signal: AbortSignal) {
    const button = this.querySelector('button');
    if (!button) return;
    onActivate(button, () => this.#stop(), signal);
  }

  #stop() {
    const playback = this.#playback.value;
    const time = this.#time.value;
    if (!playback || !time) return;
    const brain = this.brain;
    beep(brain.loudness);

    if (brain.entry) {
      brain.clearEntry();
      return;
    }
    if (!playback.paused) {
      playback.pause();
      return;
    }
    // Pressed again while paused: clear the program and go back to the start.
    if (time.currentTime > 0) {
      void time.seek(0);
      brain.say('CLr', 800);
    }
  }

  protected override update(changed: PropertyValues) {
    super.update(changed);
    const button = this.querySelector('button');
    const playback = this.#playback.value;
    const time = this.#time.value;
    if (!button || !playback || !time) return;
    let label = 'Stop (pause)';
    if (this.brain.entry) label = 'Clear typed time';
    else if (playback.paused && time.currentTime > 0) label = 'Clear: back to the beginning';
    button.setAttribute('aria-label', label);
  }
}

customElements.define('mw-brain', MicrowaveBrainElement);
customElements.define('mw-display', MicrowaveDisplayElement);
customElements.define('mw-keypad', MicrowaveKeypadElement);
customElements.define('mw-door-toggle', MicrowaveDoorToggleElement);
customElements.define('mw-presets', MicrowavePresetsElement);
customElements.define('mw-start', MicrowaveStartElement);
customElements.define('mw-stop', MicrowaveStopElement);
