import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { trackAction } from '../../services/analytics';
import { API_URL } from '../../services/api.client';

import { openExternal } from './dom-types';
// pdf.js (web-only static import; native gets a stub). See pdfjs-loader.web.ts.
import { getPdfjs } from './pdfjs-loader';

// --------------- Types ---------------

export interface ViewerChart {
  type: string;
  name: string;
  url: string;
  source: string;
}

interface Props {
  /** Charts available in the viewer's grouped picker. */
  charts: ViewerChart[];
  /** Index (into `charts`) to open on; the window is shown while this is non-null. */
  openIndex: number | null;
  icao: string;
  onClose: () => void;
}

// --- Minimal DOM shims (the app's tsconfig has no `dom` lib; see dom-types.ts) ---
interface Style {
  cssText: string;
  [prop: string]: string;
}
interface WebEvent {
  key?: string;
  clientX?: number;
  clientY?: number;
  deltaY?: number;
  target?: { tagName?: string } | null;
  stopPropagation(): void;
  preventDefault(): void;
}
interface El {
  style: Style;
  textContent: string;
  title: string;
  value: string;
  label: string;
  disabled: boolean;
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  scrollLeft: number;
  scrollTop: number;
  parentNode: El | null;
  appendChild(child: El): void;
  append(...children: El[]): void;
  removeChild(child: El): void;
  addEventListener(type: string, handler: (e: WebEvent) => void, opts?: { passive?: boolean }): void;
  removeEventListener(type: string, handler: (e: WebEvent) => void): void;
  getContext(id: '2d'): unknown;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  requestFullscreen?(): void;
}
interface WebDoc {
  body: El;
  fullscreenElement: El | null;
  createElement(tag: string): El;
  addEventListener(type: string, handler: (e: WebEvent) => void): void;
  removeEventListener(type: string, handler: (e: WebEvent) => void): void;
  exitFullscreen?(): void;
}
interface ResizeObserverLike {
  observe(el: El): void;
  disconnect(): void;
}

// --------------- Constants ---------------

/** Grouping of chart types for the picker, mirroring how SkyVector splits them. */
const CHART_GROUPS: { labelKey: string; types: string[] }[] = [
  { labelKey: 'vfr.chartGroupAerodrome', types: ['ADC', 'PDC', 'VAC', 'INFO'] },
  { labelKey: 'vfr.chartGroupInstrument', types: ['SID', 'STAR', 'IAC', 'MIN'] },
  { labelKey: 'vfr.chartGroupOther', types: ['OTHER'] },
];

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;

// --------------- Helpers ---------------

function proxyUrl(chartUrl: string): string {
  return `${API_URL}/v1/aerodromes/chart-proxy?url=${encodeURIComponent(chartUrl)}`;
}

/**
 * True for expected pdf.js cancellations — `RenderTask.cancel()` rejects the
 * render promise with a `RenderingCancelledException`, and aborted document
 * loads reject with an `AbortException`. These happen routinely when the user
 * zooms, rotates, switches page or changes chart quickly, and must be ignored
 * rather than surfaced as a real `chartLoadError`.
 */
function isPdfCancellation(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? '';
  const message = (err as { message?: string } | null)?.message ?? '';
  return name === 'RenderingCancelledException' || name === 'AbortException' || /cancell?ed/i.test(message);
}

// --------------- Component ---------------

/**
 * SkyVector-style floating chart window (web only). Renders the selected chart
 * PDF to a <canvas> via pdf.js so it can be rotated and zoomed crisply — the
 * browser's native PDF iframe can't be rotated cleanly. Built imperatively
 * because the app's tsconfig targets React Native JSX (no DOM JSX / lib).
 */
export function ChartViewer({ charts, openIndex, icao, onClose }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (Platform.OS !== 'web' || openIndex == null || !charts[openIndex]) return;
    const doc = (globalThis as { document?: WebDoc }).document;
    if (!doc) return;

    // ---- View state (mutable; lives for the window's lifetime) ----
    const state = {
      index: openIndex,
      page: 1,
      numPages: 1,
      rotation: 0, // 0 | 90 | 180 | 270 (user rotation, added to page's intrinsic)
      zoom: 1, // multiplier on the fit-to-window scale
      fitScale: 1,
      loading: false,
      error: false,
    };

    const docCache = new Map<string, PDFDocumentProxy>();
    let activeRender: RenderTask | null = null;
    let renderToken = 0;
    let disposed = false;

    // ---- DOM scaffold ----
    // Floating, portrait window near the right edge — no dimming backdrop, with
    // margins all around so the map stays visible/usable around it (esp. left).
    // Light, glassy theme; draggable by its header and resizable from the corner.
    const win = doc.createElement('div');
    win.style.cssText =
      'position:fixed;top:8vh;bottom:8vh;right:20px;width:min(640px,52vw);z-index:9999;display:flex;flex-direction:column;background:rgba(248,250,252,0.85);border:1px solid rgba(0,0,0,0.18);border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,0.28),0 2px 10px rgba(0,0,0,0.16);overflow:hidden;';

    // ---- Header / toolbar ----
    const header = doc.createElement('div');
    header.style.cssText =
      'display:flex;flex-direction:column;gap:6px;padding:7px 9px;background:rgba(241,245,249,0.95);border-bottom:1px solid rgba(0,0,0,0.08);cursor:move;user-select:none;';

    const titleIcao = doc.createElement('span');
    titleIcao.textContent = icao.toUpperCase();
    titleIcao.style.cssText = 'color:#1f2937;font-size:13px;font-weight:700;letter-spacing:0.5px;';

    // Chart picker — native <select> with <optgroup> for grouped categories.
    const picker = doc.createElement('select');
    picker.style.cssText =
      'flex:1;min-width:120px;max-width:220px;background:#fff;color:#1f2937;border:1px solid rgba(0,0,0,0.18);border-radius:6px;padding:5px 8px;font-size:12px;cursor:pointer;';
    CHART_GROUPS.forEach((group) => {
      const isOther = group.labelKey === 'vfr.chartGroupOther';
      const items = charts
        .map((c, i) => ({ c, i }))
        .filter(({ c }) =>
          isOther
            ? !CHART_GROUPS.some((g) => g.labelKey !== 'vfr.chartGroupOther' && g.types.includes(c.type))
            : group.types.includes(c.type),
        );
      if (items.length === 0) return;
      const og = doc.createElement('optgroup');
      og.label = t(group.labelKey);
      items.forEach(({ c, i }) => {
        const opt = doc.createElement('option');
        opt.value = String(i);
        opt.textContent = `${c.type} — ${c.name}`;
        og.appendChild(opt);
      });
      picker.appendChild(og);
    });
    picker.value = String(state.index);
    picker.addEventListener('change', () => {
      state.index = parseInt(picker.value, 10);
      state.page = 1;
      state.rotation = 0;
      state.zoom = 1;
      void loadChart();
    });

    const makeBtn = (label: string, title: string, onClick: () => void): El => {
      const b = doc.createElement('button');
      b.textContent = label;
      b.title = title;
      b.style.cssText =
        'background:#fff;border:1px solid rgba(0,0,0,0.16);color:#374151;font-size:14px;line-height:1;cursor:pointer;padding:4px 7px;border-radius:6px;min-width:26px;';
      b.addEventListener('mouseenter', () => (b.style.background = '#eef2f7'));
      b.addEventListener('mouseleave', () => (b.style.background = '#fff'));
      b.addEventListener('click', onClick);
      return b;
    };

    // Page navigation (multi-page charts)
    const pagePrev = makeBtn('‹', t('vfr.chartPrevPage'), () => goPage(-1));
    const pageLabel = doc.createElement('span');
    pageLabel.style.cssText = 'color:#6b7280;font-size:11px;min-width:44px;text-align:center;';
    const pageNext = makeBtn('›', t('vfr.chartNextPage'), () => goPage(1));
    const pageGroup = doc.createElement('div');
    pageGroup.style.cssText = 'display:flex;align-items:center;gap:2px;';
    pageGroup.append(pagePrev, pageLabel, pageNext);

    const rotLeft = makeBtn('↺', t('vfr.chartRotateLeft'), () => rotate(-90));
    const rotRight = makeBtn('↻', t('vfr.chartRotateRight'), () => rotate(90));

    const zoomOut = makeBtn('−', t('vfr.chartZoomOut'), () => applyZoom(state.zoom / ZOOM_STEP));
    const zoomLabel = doc.createElement('span');
    zoomLabel.style.cssText = 'color:#6b7280;font-size:11px;min-width:40px;text-align:center;';
    const zoomIn = makeBtn('+', t('vfr.chartZoomIn'), () => applyZoom(state.zoom * ZOOM_STEP));
    const zoomReset = makeBtn('⊡', t('vfr.chartFit'), () => {
      state.zoom = 1;
      void renderPage(true);
    });

    const fsBtn = makeBtn('⤢', t('vfr.chartFullscreen'), toggleFullscreen);
    const extBtn = makeBtn('↗', t('vfr.chartOpenTab'), () => {
      const c = charts[state.index];
      if (c) openExternal(c.url);
    });
    const closeBtn = makeBtn('✕', t('common.close'), () => onClose());
    closeBtn.style.borderColor = 'rgba(0,0,0,0.28)';
    closeBtn.style.color = '#111827';

    const spacer = (): El => {
      const s = doc.createElement('div');
      s.style.cssText = 'width:1px;height:20px;background:rgba(0,0,0,0.12);margin:0 2px;';
      return s;
    };

    // Row 1 — window identity + window actions (open/fullscreen/close).
    const topRow = doc.createElement('div');
    topRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    topRow.append(titleIcao, picker, fsBtn, extBtn, closeBtn);

    // Row 2 — chart tools (page nav, rotate, zoom), centred.
    const ctrlRow = doc.createElement('div');
    ctrlRow.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:4px;flex-wrap:wrap;';
    ctrlRow.append(pageGroup, spacer(), rotLeft, rotRight, spacer(), zoomOut, zoomLabel, zoomIn, zoomReset);

    header.append(topRow, ctrlRow);

    // ---- Body: scrollable canvas area (scroll = pan). Light, frosted backdrop
    // so the map shows faintly in the area around the (opaque) chart. ----
    const body = doc.createElement('div');
    body.style.cssText =
      'flex:1;position:relative;overflow:auto;background:rgba(233,238,244,0.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;cursor:grab;';

    const canvas = doc.createElement('canvas');
    canvas.style.cssText = 'display:block;margin:auto;background:#fff;border:1px solid rgba(0,0,0,0.12);box-shadow:0 6px 22px rgba(0,0,0,0.18);';

    const status = doc.createElement('div');
    status.style.cssText =
      'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#4b5563;font-size:13px;text-align:center;pointer-events:none;';

    // Resize grip (bottom-right corner).
    const grip = doc.createElement('div');
    grip.style.cssText =
      'position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;z-index:2;background:linear-gradient(135deg,transparent 50%,rgba(0,0,0,0.28) 50%,rgba(0,0,0,0.28) 60%,transparent 60%,transparent 72%,rgba(0,0,0,0.28) 72%,rgba(0,0,0,0.28) 82%,transparent 82%);';

    body.append(canvas, status);
    win.append(header, body, grip);
    doc.body.appendChild(win);

    // ---- Window move (header) + resize (corner grip) + pan (body) ----
    // Switch the window from its right/top/bottom docking to absolute
    // left/top/width/height the first time it's moved or resized.
    let detached = false;
    function detach() {
      if (detached) return;
      const r = win.getBoundingClientRect();
      win.style.left = `${r.left}px`;
      win.style.top = `${r.top}px`;
      win.style.width = `${r.width}px`;
      win.style.height = `${r.height}px`;
      win.style.right = 'auto';
      win.style.bottom = 'auto';
      detached = true;
    }

    let mode: 'none' | 'pan' | 'move' | 'resize' = 'none';
    let sx = 0;
    let sy = 0;
    let scrollStartX = 0;
    let scrollStartY = 0;
    let winStartX = 0;
    let winStartY = 0;
    let winStartW = 0;
    let winStartH = 0;

    body.addEventListener('mousedown', (e) => {
      mode = 'pan';
      sx = e.clientX ?? 0;
      sy = e.clientY ?? 0;
      scrollStartX = body.scrollLeft;
      scrollStartY = body.scrollTop;
      body.style.cursor = 'grabbing';
    });

    // Drag the window by the header (but not when grabbing a control on it).
    header.addEventListener('mousedown', (e) => {
      const tag = (e.target?.tagName ?? '').toLowerCase();
      if (tag === 'select' || tag === 'button' || tag === 'option' || tag === 'input') return;
      e.preventDefault();
      detach();
      mode = 'move';
      sx = e.clientX ?? 0;
      sy = e.clientY ?? 0;
      const r = win.getBoundingClientRect();
      winStartX = r.left;
      winStartY = r.top;
    });

    grip.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      detach();
      mode = 'resize';
      sx = e.clientX ?? 0;
      sy = e.clientY ?? 0;
      const r = win.getBoundingClientRect();
      winStartW = r.width;
      winStartH = r.height;
    });

    const onMove = (e: WebEvent) => {
      const dx = (e.clientX ?? 0) - sx;
      const dy = (e.clientY ?? 0) - sy;
      const g = globalThis as { innerWidth?: number; innerHeight?: number };
      const vw = g.innerWidth || 1280;
      const vh = g.innerHeight || 800;
      if (mode === 'pan') {
        body.scrollLeft = scrollStartX - dx;
        body.scrollTop = scrollStartY - dy;
      } else if (mode === 'move') {
        const w = win.getBoundingClientRect().width;
        const left = Math.min(Math.max(winStartX + dx, 8 - w + 80), vw - 80);
        const top = Math.min(Math.max(winStartY + dy, 8), vh - 48);
        win.style.left = `${left}px`;
        win.style.top = `${top}px`;
      } else if (mode === 'resize') {
        win.style.width = `${Math.min(Math.max(winStartW + dx, 300), vw - 24)}px`;
        win.style.height = `${Math.min(Math.max(winStartH + dy, 260), vh - 24)}px`;
      }
    };
    const onUp = () => {
      mode = 'none';
      body.style.cursor = 'grab';
    };
    doc.addEventListener('mousemove', onMove);
    doc.addEventListener('mouseup', onUp);

    // ---- Wheel to zoom ----
    const onWheel = (e: WebEvent) => {
      e.preventDefault();
      applyZoom((e.deltaY ?? 0) < 0 ? state.zoom * ZOOM_STEP : state.zoom / ZOOM_STEP);
    };
    body.addEventListener('wheel', onWheel, { passive: false });

    // ---- Keyboard ----
    const onKey = (e: WebEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case '+':
        case '=':
          applyZoom(state.zoom * ZOOM_STEP);
          break;
        case '-':
          applyZoom(state.zoom / ZOOM_STEP);
          break;
        case '[':
          rotate(-90);
          break;
        case ']':
          rotate(90);
          break;
        case 'ArrowLeft':
          goPage(-1);
          break;
        case 'ArrowRight':
          goPage(1);
          break;
      }
    };
    doc.addEventListener('keydown', onKey);

    // ---- Behaviour ----
    function setStatus(text: string | null) {
      status.textContent = text ?? '';
      status.style.display = text ? 'block' : 'none';
      canvas.style.visibility = text ? 'hidden' : 'visible';
    }

    function syncToolbar() {
      pageGroup.style.display = state.numPages > 1 ? 'flex' : 'none';
      pageLabel.textContent = `${state.page}/${state.numPages}`;
      pagePrev.disabled = state.page <= 1;
      pageNext.disabled = state.page >= state.numPages;
      pagePrev.style.opacity = pagePrev.disabled ? '0.4' : '1';
      pageNext.style.opacity = pageNext.disabled ? '0.4' : '1';
      zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
    }

    function applyZoom(next: number) {
      const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
      if (clamped === state.zoom) return;
      state.zoom = clamped;
      void renderPage(false);
    }

    function rotate(delta: number) {
      state.rotation = (state.rotation + delta + 360) % 360;
      void renderPage(true);
    }

    function goPage(delta: number) {
      const next = state.page + delta;
      if (next < 1 || next > state.numPages) return;
      state.page = next;
      state.zoom = 1;
      void renderPage(true);
    }

    function toggleFullscreen() {
      if (doc!.fullscreenElement) doc!.exitFullscreen?.();
      else win.requestFullscreen?.();
    }

    async function getPdf(url: string): Promise<PDFDocumentProxy> {
      const cached = docCache.get(url);
      if (cached) return cached;
      const pdfjs = getPdfjs();
      const task = pdfjs.getDocument({ url: proxyUrl(url), withCredentials: false });
      const pdf = await task.promise;
      docCache.set(url, pdf);
      return pdf;
    }

    async function renderPage(recomputeFit: boolean) {
      const token = ++renderToken;
      try {
        activeRender?.cancel();
      } catch {
        /* ignore */
      }
      const chart = charts[state.index];
      if (!chart) return;
      const pdf = await getPdf(chart.url);
      if (disposed || token !== renderToken) return;
      const page = await pdf.getPage(state.page);
      if (disposed || token !== renderToken) return;

      if (recomputeFit) {
        const base = page.getViewport({ scale: 1, rotation: state.rotation });
        const availW = body.clientWidth - 24;
        const availH = body.clientHeight - 24;
        state.fitScale = Math.max(0.1, Math.min(availW / base.width, availH / base.height));
      }

      const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: state.fitScale * state.zoom, rotation: state.rotation });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const task = page.render({
        canvasContext: ctx as never,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      activeRender = task;
      try {
        await task.promise;
      } catch (err) {
        // Superseded by a newer render (cancel), a disposed viewer, or a genuine
        // failure. Only a genuine failure on the current token should surface as
        // an error — explicit pdf.js cancellations (zoom/rotate/page/chart
        // switch) are expected and ignored even on the current token.
        if (disposed || token !== renderToken || isPdfCancellation(err)) return;
        state.error = true;
        setStatus(t('vfr.chartLoadError'));
        return;
      }
      if (disposed || token !== renderToken) return;
      setStatus(null);
      syncToolbar();
    }

    async function loadChart() {
      picker.value = String(state.index);
      const chart = charts[state.index];
      if (!chart) return;
      state.loading = true;
      state.error = false;
      setStatus(t('common.loading'));
      try {
        const pdf = await getPdf(chart.url);
        state.numPages = pdf.numPages;
        state.page = Math.min(state.page, state.numPages);
        await renderPage(true);
        trackAction('chart_viewed', { icao, chart_type: chart.type, source: chart.source });
      } catch (err) {
        if (!disposed && !isPdfCancellation(err)) {
          state.error = true;
          setStatus(t('vfr.chartLoadError'));
        }
      } finally {
        state.loading = false;
      }
    }

    void loadChart();

    // Re-fit when the window resizes.
    const ROCtor = (globalThis as { ResizeObserver?: new (cb: () => void) => ResizeObserverLike }).ResizeObserver;
    const ro = ROCtor
      ? new ROCtor(() => {
          if (!state.loading && !state.error) void renderPage(true);
        })
      : null;
    ro?.observe(body);

    // ---- Cleanup ----
    return () => {
      disposed = true;
      try {
        activeRender?.cancel();
      } catch {
        /* ignore */
      }
      ro?.disconnect();
      doc.removeEventListener('mousemove', onMove);
      doc.removeEventListener('mouseup', onUp);
      doc.removeEventListener('keydown', onKey);
      body.removeEventListener('wheel', onWheel);
      if (doc.fullscreenElement) doc.exitFullscreen?.();
      docCache.forEach((pdf) => pdf.destroy().catch(() => undefined));
      docCache.clear();
      if (win.parentNode) win.parentNode.removeChild(win);
    };
    // openIndex drives open/close; charts identity changes per aerodrome.
  }, [openIndex, charts, icao]);

  return null;
}
