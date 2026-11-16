/**
 * The camera for the 3D kitchen.
 *
 * - Sizes the microwave (--M, --H, --D) to the viewport and places the world origin.
 * - Follows the pointer (or a phone's tilt) with a gentle orbit, eased every frame.
 * - "Step back" glides out to a three-quarter view of the whole diorama.
 * - Reduced motion: no orbit, view changes are instant.
 */

interface View {
  rx: number;
  ry: number;
  z: number;
}

const HOME: View = { rx: -3, ry: 0, z: 0 };
const BACK: View = { rx: -14, ry: -18, z: 1 }; // z: 0 = home distance, 1 = whole-diorama distance

export function setupCamera(root: HTMLElement) {
  const viewport = root.querySelector<HTMLElement>('.k3-viewport')!;
  const camera = root.querySelector<HTMLElement>('.k3-camera')!;
  const stage = root.querySelector<HTMLElement>('#k-stage')!;
  const toggle = root.querySelector<HTMLButtonElement>('.k3-step');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  let M = 800;
  let H = 440;
  let narrow = false;
  let stepBack = false;
  let pointer = { x: 0, y: 0 }; // -1..1
  const current: View = { ...HOME };
  let frame = 0;

  let homeZ = 0; // px: comfortable distance for using the microwave
  let backZ = 0; // px: whole diorama in view
  let persp = 1700;

  function layout() {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    narrow = vw < 700;

    if (narrow) {
      M = vw - 24;
    } else {
      // Keep the microwave's wide layout (>= 660px laid out); the camera backs off to fit the room.
      M = Math.max(660, Math.min(820, vw * 0.5));
    }
    root.style.setProperty('--M', `${Math.round(M)}px`);
    root.style.setProperty('--D', `${Math.round(M * 0.62)}px`);
    place();
  }

  function place() {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const sceneH = narrow ? Math.max(vh, H + 220) : vh;
    root.style.setProperty('--k3-vh', `${Math.round(sceneH)}px`);
    persp = Math.round(Math.max(1400, M * 2.4));
    root.style.setProperty('--k3-persp', `${persp}px`);

    const centre = narrow ? 120 + H / 2 : vh * 0.54;
    root.style.setProperty('--pivot-y', `${Math.round(centre)}px`);
    root.style.setProperty('--world-y', `${Math.round(centre + H / 2)}px`);
    const zFor = (scale: number) => -persp * (1 / Math.min(1, scale) - 1);
    if (narrow) {
      homeZ = 0;
      backZ = zFor((vw * 0.96) / (3.3 * M));
    } else {
      // Home: microwave ~40% of the width (and never taller than ~62% of the height).
      homeZ = zFor(Math.min((vw * 0.47) / M, (vh * 0.62) / H));
      // Step back: the whole diorama.
      backZ = zFor(Math.min((vw * 0.9) / (3.4 * M), (vh * 0.74) / (2.95 * M)));
    }
    apply(current);
  }

  // The player's height depends on its own responsive layout: measure it.
  // (offsetHeight ignores the 3D transforms.)
  new ResizeObserver(() => {
    const h = stage.offsetHeight;
    if (h > 0 && Math.abs(h - H) > 1) {
      H = h;
      root.style.setProperty('--H', `${Math.round(H)}px`);
      layout();
    }
  }).observe(stage);

  window.addEventListener('resize', layout);
  layout();

  // ---------- motion ----------

  function target(): View {
    const base = stepBack ? BACK : HOME;
    if (reduced.matches) return base;
    const k = stepBack ? 0.5 : 1;
    return {
      rx: base.rx - pointer.y * 4 * k,
      ry: base.ry + pointer.x * 7 * k,
      z: base.z,
    };
  }

  function apply(v: View) {
    camera.style.setProperty('--cam-rx', `${v.rx.toFixed(3)}deg`);
    camera.style.setProperty('--cam-ry', `${v.ry.toFixed(3)}deg`);
    camera.style.setProperty('--cam-z', `${(homeZ + (backZ - homeZ) * v.z).toFixed(1)}px`);
    // Stepping back also lowers the frame so the ceiling line isn't cut.
    camera.style.setProperty('--cam-y', `${(v.z * M * -0.1).toFixed(1)}px`);
  }

  function tick() {
    const t = target();
    const ease = 0.075;
    current.rx += (t.rx - current.rx) * ease;
    current.ry += (t.ry - current.ry) * ease;
    current.z += (t.z - current.z) * ease;
    apply(current);
    const done =
      Math.abs(t.rx - current.rx) < 0.01 && Math.abs(t.ry - current.ry) < 0.01 && Math.abs(t.z - current.z) < 0.0005;
    frame = done ? 0 : requestAnimationFrame(tick);
  }

  function kick() {
    if (reduced.matches) {
      Object.assign(current, target());
      apply(current);
      return;
    }
    if (!frame) frame = requestAnimationFrame(tick);
  }

  apply(current);

  // Pointer orbit (fine pointers only; on touch the phone's tilt drives it).
  viewport.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = viewport.getBoundingClientRect();
    pointer = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 };
    kick();
  });
  viewport.addEventListener('pointerleave', () => {
    pointer = { x: 0, y: 0 };
    kick();
  });

  // Phone tilt, where the browser offers it without a permission prompt.
  let tiltBase: number | null = null;
  window.addEventListener('deviceorientation', (e) => {
    if (e.gamma == null || e.beta == null) return;
    tiltBase ??= e.beta;
    pointer = {
      x: Math.max(-1, Math.min(1, e.gamma / 25)),
      y: Math.max(-1, Math.min(1, (e.beta - tiltBase) / 25)),
    };
    kick();
  });

  toggle?.addEventListener('click', () => {
    stepBack = !stepBack;
    toggle.setAttribute('aria-pressed', String(stepBack));
    root.toggleAttribute('data-step-back', stepBack);
    kick();
  });

  // Using the player brings the camera home.
  stage.addEventListener('pointerdown', () => {
    if (!stepBack) return;
    stepBack = false;
    toggle?.setAttribute('aria-pressed', 'false');
    root.removeAttribute('data-step-back');
    kick();
  });

  reduced.addEventListener('change', kick);
}
