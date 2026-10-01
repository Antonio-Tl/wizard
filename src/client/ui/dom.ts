type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Mini-Hyperscript zum Erzeugen von DOM-Elementen. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function $(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

/** Entfernt ein Element mit Ausblend-Animation. */
export function fadeRemove(el: Element | null | undefined, ms = 300): void {
  if (!el || !el.parentNode) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), ms);
}

export function toast(text: string, kind: 'info' | 'err' = 'info'): void {
  const root = $('#toasts');
  const el = h('div', { class: `toast panel ${kind === 'err' ? 'err' : ''}` }, text);
  root.appendChild(el);
  while (root.children.length > 3) root.firstElementChild?.remove();
  setTimeout(() => el.remove(), 3300);
}

export function banner(title: string, sub?: string): void {
  document.querySelectorAll('.banner').forEach((b) => b.remove());
  const el = h('div', { class: 'banner' }, h('div', { class: 'b1 gold-text' }, title), sub ? h('div', { class: 'b2' }, sub) : null);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

export interface ModalHandle {
  el: HTMLElement;
  close: () => void;
}

export function modal(content: Child, opts: { wide?: boolean; closable?: boolean; onClose?: () => void; id?: string } = {}): ModalHandle {
  const root = $('#modals');
  if (opts.id) root.querySelector(`[data-id="${opts.id}"]`)?.remove();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    fadeRemove(wrap, 250);
    opts.onClose?.();
  };
  const box = h(
    'div',
    { class: `modal panel ${opts.wide ? 'wide' : ''}` },
    opts.closable !== false ? h('button', { class: 'close', onclick: close, 'aria-label': 'Schließen' }, '✕') : null,
    content,
  );
  const wrap = h('div', { class: 'modal-wrap', 'data-id': opts.id ?? '' }, box);
  if (opts.closable !== false) {
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close();
    });
  }
  root.appendChild(wrap);
  return { el: box, close };
}

export function seg<T extends string | number>(options: [T, string][], value: T, onChange: (v: T) => void, disabled = false): HTMLElement {
  const el = h('div', { class: 'seg', role: 'radiogroup' });
  const render = (v: T) => {
    clear(el);
    for (const [val, label] of options) {
      el.appendChild(
        h(
          'button',
          {
            class: val === v ? 'on' : '',
            disabled,
            role: 'radio',
            'aria-checked': String(val === v),
            onclick: () => {
              render(val);
              onChange(val);
            },
          },
          label,
        ),
      );
    }
  };
  render(value);
  return el;
}
