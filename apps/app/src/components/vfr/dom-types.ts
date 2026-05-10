export interface DomDocument {
  createElement(tag: string): DomElement;
  head: DomElement;
  body: DomElement;
  fullscreenElement: DomElement | null;
  exitFullscreen(): void;
  addEventListener(event: string, handler: (e: DomKeyboardEvent) => void): void;
  removeEventListener(event: string, handler: (e: DomKeyboardEvent) => void): void;
}

export interface DomElement {
  rel?: string;
  href?: string;
  src?: string;
  title?: string;
  crossOrigin?: string;
  textContent?: string;
  value?: string;
  innerHTML?: string;
  onclick?: (() => void) | null;
  style: Record<string, string> & { cssText?: string };
  appendChild(child: DomElement): void;
  removeChild(child: DomElement): void;
  requestFullscreen?(): void;
  querySelector?(selector: string): DomElement | null;
  querySelectorAll?(selector: string): DomElement[];
  addEventListener(event: string, handler: (e: DomEvent) => void): void;
  removeEventListener?(event: string, handler: (e: DomEvent) => void): void;
  getAttribute?(attr: string): string | null;
}

export interface DomEvent {
  currentTarget: DomElement | null;
}

export interface DomKeyboardEvent {
  key: string;
}

export function getDoc(): DomDocument | undefined {
  return (globalThis as Record<string, unknown>).document as DomDocument | undefined;
}

export function openExternal(url: string): void {
  const w = (globalThis as Record<string, unknown>).window;
  if (w) (w as { open(u: string, t: string): void }).open(url, '_blank');
}
