import './styles/base.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const loading = document.querySelector<HTMLElement>('#loading');
const fill = document.querySelector<HTMLElement>('#loading-fill');
const stage = document.querySelector<HTMLElement>('#loading-stage');

function showFatal(title: string, detail: string): void {
  const el = document.createElement('div');
  el.className = 'fatal-error';
  el.innerHTML = `<div class="box"><h2></h2><p></p><code></code></div>`;
  el.querySelector('h2')!.textContent = title;
  el.querySelector('p')!.textContent =
    'STILLWILD needs a browser with WebGL2 (a recent Chrome, Edge, Firefox or Safari) and hardware acceleration enabled.';
  el.querySelector('code')!.textContent = detail;
  document.body.appendChild(el);
}

async function main(): Promise<void> {
  if (!canvas || !loading || !fill || !stage) throw new Error('Missing root elements');
  const probe = document.createElement('canvas').getContext('webgl2');
  if (!probe) {
    showFatal('WebGL2 unavailable', 'Could not create a WebGL2 context.');
    return;
  }
  // Weights for the loading bar across boot stages.
  const weights: Record<string, [number, number]> = {
    'Unrolling the map': [0, 0.02],
    'Mapping the biomes': [0.02, 0.06],
    'Raising the land': [0.06, 0.32],
    'Carving the valleys': [0.32, 0.55],
    'Weathering stone': [0.55, 0.62],
    'Filling the lakes': [0.62, 0.64],
    'Running the rivers': [0.64, 0.68],
    'Shading the hills': [0.68, 0.76],
    'Surveying the ground': [0.76, 0.8],
    'Mixing pigments': [0.8, 0.86],
    'Lighting the sky': [0.84, 0.86],
    'Growing the forests': [0.86, 0.89],
    'Filling the seas': [0.89, 0.9],
    'Compiling shaders': [0.9, 0.99],
    Ready: [1, 1],
  };
  const game = new Game(canvas);
  await game.boot((name, fraction) => {
    const [a, b] = weights[name] ?? [0, 1];
    fill.style.width = `${Math.round((a + (b - a) * fraction) * 100)}%`;
    stage.textContent = name;
  });
  game.start();
  loading.classList.add('hidden');
  (window as unknown as { game: Game }).game = game;
}

main().catch((error: unknown) => {
  console.error(error);
  showFatal('Something went wrong', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
});
