import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { type ChecklistEntry, getChecklistsForAircraft } from '../../data/checklistCatalog';

interface Props {
  icaoType: string | null;
}

function getDoc(): Document | undefined {
  return (globalThis as Record<string, unknown>).document as Document | undefined;
}

function openExternal(url: string): void {
  const w = (globalThis as Record<string, unknown>).window as { open?: (url: string, target: string) => void } | undefined;
  w?.open(url, '_blank');
}

const VIEWER_HEIGHT = 500;

export function ChecklistPanel({ icaoType }: Props) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [maximized, setMaximized] = useState(false);
  const iframeRef = useRef<View>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const checklists = useMemo(
    () => (icaoType ? getChecklistsForAircraft(icaoType) : []),
    [icaoType],
  );

  useEffect(() => {
    setSelectedIdx(checklists.length > 0 ? 0 : null);
  }, [checklists]);

  const selected = selectedIdx !== null ? checklists[selectedIdx] : undefined;

  useEffect(() => {
    if (Platform.OS !== 'web' || !iframeRef.current || !selected) return;
    const doc = getDoc();
    if (!doc) return;
    const el = iframeRef.current as unknown as HTMLDivElement;
    el.innerHTML = '';
    const iframe = doc.createElement('iframe');
    iframe.src = selected.pdfUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.title = selected.label;
    el.appendChild(iframe);
  }, [selected]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = getDoc();
    if (!doc) return;

    if (!maximized || !selected) {
      if (overlayRef.current) {
        doc.body.removeChild(overlayRef.current);
        overlayRef.current = null;
      }
      return;
    }

    const overlay = doc.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;';

    const header = doc.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.1);';

    if (checklists.length > 1) {
      const chipsWrap = doc.createElement('div');
      chipsWrap.style.cssText = 'display:flex;gap:6px;flex:1;overflow-x:auto;';
      checklists.forEach((cl: ChecklistEntry, idx: number) => {
        const chip = doc.createElement('button');
        const active = idx === selectedIdx;
        chip.style.cssText =
          'padding:4px 10px;border-radius:4px;cursor:pointer;white-space:nowrap;font-size:11px;font-weight:600;' +
          `border:1px solid ${active ? 'rgba(96,165,250,0.6)' : 'rgba(255,255,255,0.2)'};` +
          `background:${active ? 'rgba(96,165,250,0.15)' : 'transparent'};` +
          `color:${active ? '#93c5fd' : 'rgba(255,255,255,0.7)'};`;
        chip.textContent = cl.label;
        chip.onclick = () => setSelectedIdx(idx);
        chipsWrap.appendChild(chip);
      });
      header.appendChild(chipsWrap);
    } else {
      const title = doc.createElement('span');
      title.style.cssText = 'color:#fff;font-size:13px;font-weight:600;flex:1;';
      title.textContent = selected.label;
      header.appendChild(title);
    }

    const extBtn = doc.createElement('button');
    extBtn.style.cssText =
      'background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.7);font-size:12px;cursor:pointer;padding:4px 10px;border-radius:4px;flex-shrink:0;';
    extBtn.textContent = '↗';
    extBtn.title = 'Open in new tab';
    extBtn.onclick = () => openExternal(selected!.pdfUrl);
    header.appendChild(extBtn);

    const closeBtn = doc.createElement('button');
    closeBtn.style.cssText =
      'background:none;border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:16px;cursor:pointer;padding:4px 12px;border-radius:4px;flex-shrink:0;';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => setMaximized(false);
    header.appendChild(closeBtn);

    const body = doc.createElement('div');
    body.style.cssText = 'flex:1;';
    const iframe = doc.createElement('iframe');
    iframe.src = selected.pdfUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.title = selected.label;
    body.appendChild(iframe);

    overlay.appendChild(header);
    overlay.appendChild(body);
    doc.body.appendChild(overlay);
    overlayRef.current = overlay;

    return () => {
      if (overlayRef.current) {
        doc.body.removeChild(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [maximized, selected, checklists, selectedIdx]);

  if (!icaoType || checklists.length === 0) return null;

  return (
    <View>
      <View className="mb-2 flex-row flex-wrap gap-1.5">
        {checklists.map((cl, idx) => (
          <Pressable
            key={cl.id}
            onPress={() => setSelectedIdx(idx)}
            className={`rounded-md border px-2.5 py-1.5 ${
              idx === selectedIdx ? 'border-primary bg-primary/10' : 'border-border bg-surface-muted'
            }`}
          >
            <Text className={`text-xs font-medium ${idx === selectedIdx ? 'text-primary' : 'text-foreground'}`}>
              {cl.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {selected ? (
        <View className="overflow-hidden rounded-md border border-border">
          <View className="flex-row items-center justify-between border-b border-border bg-surface-muted px-2 py-1">
            <Text className="text-[10px] font-medium text-muted-foreground" numberOfLines={1}>
              {selected.label}
            </Text>
            <View className="flex-row gap-1.5">
              <Pressable onPress={() => setMaximized(true)}>
                <Text className="text-xs text-primary">⛶</Text>
              </Pressable>
              <Pressable onPress={() => openExternal(selected.pdfUrl)}>
                <Text className="text-xs text-primary">↗</Text>
              </Pressable>
            </View>
          </View>
          <View ref={iframeRef} style={{ height: VIEWER_HEIGHT }} />
        </View>
      ) : null}
    </View>
  );
}
