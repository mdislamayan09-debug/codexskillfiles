import type { Difficulty } from '../core/Settings';
import type { SaveMeta } from '../game/SaveSystem';

// Title over the living world: continue, new game (with difficulty), and
// settings. The world keeps rendering behind it with a slow camera drift.

export interface TitleHooks {
  continueMeta(): SaveMeta | null;
  onContinue(): void;
  /** Called as the opening narration starts: the game sets up behind it. */
  onNewGame(difficulty: Difficulty): void;
  /** The narration ended (or was skipped): hand control to the player. */
  onBegin(): void;
  onSettings(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

const INTRO = [
  'The airship Meridian was nine days out when the shimmer rose on the horizon: a wall of light standing on the sea.',
  'The instruments swore there was an island inside it. The captain held her course.',
  'You remember the envelope tearing, and the birches rushing up to meet you.',
  'You remember a sound beneath everything. A single note, held.',
];

export class TitleScreen {
  readonly root: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly difficulty: HTMLElement;
  private readonly intro: HTMLElement;
  private open = false;
  private introOpen = false;
  private finishIntro: (() => void) | null = null;
  private nextLine: (() => void) | null = null;

  constructor(parent: HTMLElement, private readonly hooks: TitleHooks) {
    this.root = el('div', 'title', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'STILLWILD');
    const inner = el('div', 'title-inner', this.root);
    el('div', 'title-crest', inner).innerHTML =
      '<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="44"/><circle cx="60" cy="60" r="30"/><circle cx="60" cy="60" r="6"/><path d="M60 8 L60 30 M60 90 L60 112 M8 60 L30 60 M90 60 L112 60 M23 23 L38 38 M82 82 L97 97 M97 23 L82 38 M23 97 L38 82"/></svg>';
    el('h1', 'title-name', inner, 'STILLWILD');
    el('p', 'title-tag', inner, 'A land that forgot how to end.');
    this.menu = el('div', 'title-menu', inner);
    this.difficulty = el('div', 'title-difficulty', inner);
    // The narration sits outside the title root so it survives hiding it.
    this.intro = el('div', 'title-intro', parent);
  }

  get isOpen(): boolean {
    return this.open;
  }

  get isIntroPlaying(): boolean {
    return this.introOpen;
  }

  show(): void {
    this.open = true;
    this.root.classList.add('open');
    this.difficulty.classList.remove('open');
    this.menu.style.display = '';
    this.renderMenu();
    (this.menu.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('open');
  }

  private renderMenu(): void {
    this.menu.innerHTML = '';
    const meta = this.hooks.continueMeta();
    if (meta) {
      const b = el('button', 'title-button primary', this.menu);
      b.innerHTML = '<span>Continue</span><small></small>';
      const hours = Math.floor(meta.playtime / 3600);
      const minutes = Math.floor((meta.playtime % 3600) / 60);
      (b.querySelector('small') as HTMLElement).textContent = `Day ${meta.day} · ${meta.location} · ${hours ? `${hours} h ` : ''}${minutes} min played`;
      b.addEventListener('click', () => this.hooks.onContinue());
    }
    const n = el('button', `title-button${meta ? '' : ' primary'}`, this.menu);
    n.innerHTML = '<span>New Journey</span>';
    n.addEventListener('click', () => this.showDifficulty(meta));
    const s = el('button', 'title-button', this.menu);
    s.innerHTML = '<span>Settings</span>';
    s.addEventListener('click', () => this.hooks.onSettings());
    el('p', 'title-foot', this.menu, 'Headphones recommended · Controller supported · Esc pauses');
  }

  private showDifficulty(existing: SaveMeta | null): void {
    this.menu.style.display = 'none';
    this.difficulty.innerHTML = '';
    this.difficulty.classList.add('open');
    el('h2', 'title-sub', this.difficulty, 'How hard should the island be?');
    const options: [Difficulty, string, string][] = [
      ['explorer', 'Explorer', 'Gentle hunger, cold and wounds. Wake with everything you carried. For the story and the sights.'],
      ['survivor', 'Survivor', 'The intended balance. When you fall, your pack stays where you fell: go back for it.'],
      ['harsh', 'Harsh', 'Hungry nights and hard hits. Whatever you carry is lost with you.'],
    ];
    for (const [id, name, text] of options) {
      const b = el('button', `title-choice${id === 'survivor' ? ' recommended' : ''}`, this.difficulty);
      b.innerHTML = '<b></b><span></span>';
      (b.querySelector('b') as HTMLElement).textContent = name;
      (b.querySelector('span') as HTMLElement).textContent = text;
      b.addEventListener('click', () => this.playIntro(id));
    }
    if (existing) el('p', 'title-warning', this.difficulty, `Your current journey (day ${existing.day}) will be replaced once the new one is saved.`);
    const back = el('button', 'title-back', this.difficulty, 'Back');
    back.addEventListener('click', () => {
      this.difficulty.classList.remove('open');
      this.menu.style.display = '';
    });
    (this.difficulty.querySelector('.recommended') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  private playIntro(difficulty: Difficulty): void {
    this.hide();
    this.introOpen = true;
    this.intro.innerHTML = '';
    this.intro.classList.add('open');
    const text = el('p', 'title-intro-text', this.intro);
    const skip = el('button', 'title-back title-skip', this.intro, 'Skip');
    this.hooks.onNewGame(difficulty);
    let i = 0;
    let timer = 0;
    let swap = 0;
    const finish = () => {
      if (!this.introOpen) return;
      this.introOpen = false;
      window.clearTimeout(timer);
      window.clearTimeout(swap);
      this.intro.classList.remove('open');
      this.hooks.onBegin();
    };
    const next = () => {
      window.clearTimeout(timer);
      if (i >= INTRO.length) {
        finish();
        return;
      }
      text.classList.remove('show');
      const line = INTRO[i];
      i += 1;
      swap = window.setTimeout(() => {
        text.textContent = line;
        text.classList.add('show');
      }, 500);
      timer = window.setTimeout(next, 5200);
    };
    skip.addEventListener('click', (e) => {
      e.stopPropagation();
      finish();
    });
    this.intro.onclick = () => next();
    this.finishIntro = finish;
    this.nextLine = next;
    next();
  }

  /** Keyboard/controller: next line of the narration. */
  skipIntroLine(): void {
    if (this.introOpen) this.nextLine?.();
  }

  /** Keyboard/controller: skip the whole narration. */
  skipIntro(): void {
    if (this.introOpen) this.finishIntro?.();
  }
}
