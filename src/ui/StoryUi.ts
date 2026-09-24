import type { QuestTracker } from '../story/Quests';
import type { Line } from '../story/StoryData';
import { LANDMARKS } from '../world/WorldLayout';
import { icon } from './icons';

// Conversation box, journal and the on-screen quest tracker.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

export class DialogueBox {
  readonly root: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly text: HTMLElement;
  private lines: Line[] = [];
  private index = 0;
  private shown = 0;
  private onDone: (() => void) | null = null;
  private open = false;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'dialogue', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-live', 'polite');
    this.speaker = el('div', 'dialogue-speaker', this.root);
    this.text = el('div', 'dialogue-text', this.root);
    const hint = el('div', 'dialogue-hint', this.root);
    hint.innerHTML = '<kbd>E</kbd> continue';
    this.root.addEventListener('click', () => this.advance());
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(lines: Line[], onDone?: () => void): void {
    if (lines.length === 0) {
      onDone?.();
      return;
    }
    this.lines = lines;
    this.index = 0;
    this.shown = 0;
    this.onDone = onDone ?? null;
    this.open = true;
    this.root.classList.add('open');
    this.render();
  }

  /** Continue: finish the typewriter, then move to the next line. */
  advance(): void {
    if (!this.open) return;
    const line = this.lines[this.index];
    if (this.shown < line.text.length) {
      this.shown = line.text.length;
      this.render();
      return;
    }
    this.index += 1;
    this.shown = 0;
    if (this.index >= this.lines.length) {
      this.open = false;
      this.root.classList.remove('open');
      const done = this.onDone;
      this.onDone = null;
      done?.();
      return;
    }
    this.render();
  }

  update(dt: number): void {
    if (!this.open) return;
    const line = this.lines[this.index];
    if (this.shown < line.text.length) {
      this.shown = Math.min(line.text.length, this.shown + dt * 55);
      this.render();
    }
  }

  private render(): void {
    const line = this.lines[this.index];
    this.speaker.textContent = line.speaker;
    this.speaker.style.display = line.speaker ? '' : 'none';
    this.text.textContent = line.text.slice(0, Math.floor(this.shown));
  }
}

export class QuestTrackerHud {
  readonly root: HTMLElement;
  private last = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud-quest', parent);
  }

  update(quests: QuestTracker): void {
    const obj = quests.trackedObjective();
    const html = obj ? `<span class="t"></span><span class="o"></span>${obj.hint ? '<span class="h"></span>' : ''}` : '';
    const key = obj ? `${obj.title}|${obj.text}|${obj.hint ?? ''}` : '';
    if (key === this.last) return;
    this.last = key;
    this.root.innerHTML = html;
    this.root.classList.toggle('show', Boolean(obj));
    if (!obj) return;
    (this.root.querySelector('.t') as HTMLElement).textContent = obj.title;
    (this.root.querySelector('.o') as HTMLElement).textContent = obj.text;
    const h = this.root.querySelector('.h') as HTMLElement | null;
    if (h && obj.hint) h.textContent = obj.hint;
  }
}

export class Journal {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs: HTMLElement;
  private tab: 'quests' | 'places' | 'lore' = 'quests';
  private open = false;
  private data: { quests: QuestTracker; discovered: Set<string> } | null = null;

  constructor(parent: HTMLElement, private readonly onClose: () => void) {
    this.root = el('div', 'journal', parent);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Journal');
    const frame = el('div', 'journal-frame', this.root);
    const head = el('div', 'inv-head', frame);
    el('h2', 'inv-title', head, 'Journal');
    const close = el('button', 'inv-close', head);
    close.innerHTML = icon('close');
    close.setAttribute('aria-label', 'Close journal');
    close.addEventListener('click', () => this.onClose());
    this.tabs = el('div', 'inv-tabs', frame);
    this.body = el('div', 'journal-body', frame);
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(quests: QuestTracker, discovered: Set<string>): void {
    this.data = { quests, discovered };
    this.open = true;
    this.root.classList.add('open');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('open');
  }

  private render(): void {
    if (!this.data) return;
    const { quests, discovered } = this.data;
    this.tabs.innerHTML = '';
    for (const [id, label] of [
      ['quests', 'Quests'],
      ['places', 'Places'],
      ['lore', 'Lore'],
    ] as const) {
      const b = el('button', 'inv-tab', this.tabs, label);
      b.classList.toggle('active', this.tab === id);
      b.addEventListener('click', () => {
        this.tab = id;
        this.render();
      });
    }
    this.body.innerHTML = '';
    if (this.tab === 'quests') {
      const active = quests.activeQuests();
      if (active.length === 0) el('p', 'journal-empty', this.body, 'No open quests. The island is quiet, for now.');
      for (const q of active) {
        const card = el('div', `journal-quest${quests.tracked === q.id ? ' tracked' : ''}`, this.body);
        el('div', 'journal-kicker', card, q.main ? 'Main quest' : 'Side quest');
        el('h3', 'journal-title', card, q.title);
        el('p', 'journal-summary', card, q.summary);
        const cur = quests.currentStep(q.id);
        const list = el('ul', 'journal-steps', card);
        q.steps.forEach((s, i) => {
          const li = el('li', cur && i < cur.index ? 'done' : cur && i === cur.index ? 'current' : 'later', list, s.text);
          if (cur && i > cur.index) li.textContent = '…';
        });
        const track = el('button', 'menu-button subtle journal-track', card, quests.tracked === q.id ? 'Tracking' : 'Track');
        track.addEventListener('click', () => {
          quests.tracked = q.id;
          this.render();
        });
      }
      const done = quests.doneQuests();
      if (done.length) {
        el('div', 'inv-label', this.body, 'Completed');
        for (const q of done) el('div', 'journal-done', this.body, q.title);
      }
    } else if (this.tab === 'places') {
      const found = LANDMARKS.filter((l) => discovered.has(l.id));
      el('div', 'inv-label', this.body, `${found.length} of ${LANDMARKS.length} discovered`);
      for (const l of found) {
        const row = el('div', 'journal-place', this.body);
        el('b', '', row, l.name);
        el('p', '', row, l.blurb);
      }
    } else {
      const entries = LORE.filter((e) => discovered.has(e.id));
      if (entries.length === 0) el('p', 'journal-empty', this.body, 'Nothing yet. Listen to the stones.');
      for (const e of entries) {
        const row = el('div', 'journal-place', this.body);
        el('b', '', row, e.title);
        el('p', '', row, e.text);
      }
    }
  }
}

export const LORE: { id: string; title: string; text: string }[] = [
  {
    id: 'lore:undersong',
    title: 'The Undersong',
    text: 'The Veyr believed the land sang: a resonance in stone that governed growth, weather and time. Their standing stones were instruments for listening, and for answering.',
  },
  {
    id: 'lore:stillheart',
    title: 'The Held Note',
    text: 'In the crater lies Hallowmere, the Veyr city, held beneath a wall of light. The whole island is sustaining one note that will not end. Five Bellstones anchor it.',
  },
  {
    id: 'lore:mossback',
    title: 'Mossback',
    text: 'The Warden of Hollowpine was a calf that followed the Choirmaster’s daughter through the young birches. When the note began it lay down beside the first bell. Unable to die, it grew a forest instead.',
  },
  {
    id: 'lore:tidemother',
    title: 'Tidemother',
    text: 'She ferried the harbour-master’s children through the shallows. When the note froze a wave mid-fall, she curled around the Drowned Bell, and the sea forgot how to move.',
  },
  {
    id: 'lore:emberjaw',
    title: 'Emberjaw',
    text: 'The Smith-Mother’s hound slept by the anvils where the Veyr cast their bells. The last bell was poured as the note began; it never cooled, and neither did he.',
  },
  {
    id: 'lore:rimebrow',
    title: 'Rimebrow',
    text: 'The Choirmaster sang the note into Frostglass to keep it safe. The white ram that watched the skaters stood guard on the ice for a thousand winters.',
  },
  {
    id: 'lore:oldcroak',
    title: 'Old Croak',
    text: 'The choir rehearsed in the reeds, bells at their wrists, and an old toad hummed along half a note flat. When the water rose, he held their bells above it.',
  },
];
