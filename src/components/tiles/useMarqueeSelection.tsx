'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { boxBetween, hasTravelled, idsInBox, marqueeSelection, type Box, type Point } from '@/lib/app';

export const SELECT_ID_ATTRIBUTE = 'data-select-id';

const NOT_BACKGROUND = `[${SELECT_ID_ATTRIBUTE}], button, a, input, select, textarea, label, [role="checkbox"], [draggable="true"], [contenteditable="true"]`;

export interface MarqueeSelection {
  containerProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  };
  overlay: ReactNode;
}

interface Gesture {
  from: Point;
  container: HTMLElement;
  before: string[];
  additive: boolean;
  active: boolean;
}

function selectableBoxes(container: HTMLElement): { id: string; box: Box }[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[${SELECT_ID_ATTRIBUTE}]`)).flatMap((element) => {
    const id = element.getAttribute(SELECT_ID_ATTRIBUTE);
    if (id === null || id === '') {
      return [];
    }
    const rect = element.getBoundingClientRect();
    return [{ id, box: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } }];
  });
}

export function useMarqueeSelection({
  selected,
  onSelect,
  onToggle,
  onExit,
}: {
  selected: readonly string[];
  onSelect: (ids: string[]) => void;
  onToggle: (id: string) => void;
  onExit: () => void;
}): MarqueeSelection {
  const [box, setBox] = useState<Box>();
  const gesture = useRef<Gesture>(undefined);
  const selectedNow = useRef(selected);
  const select = useRef(onSelect);
  const exit = useRef(onExit);

  useEffect(() => {
    selectedNow.current = selected;
    select.current = onSelect;
    exit.current = onExit;
  }, [selected, onSelect, onExit]);

  const finish = useRef<() => void>(() => undefined);

  useEffect(() => () => finish.current(), []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.pointerType !== 'mouse') {
      return;
    }
    if (!(event.target instanceof Element) || event.target.closest(NOT_BACKGROUND) !== null) {
      return;
    }

    gesture.current = {
      from: { x: event.clientX, y: event.clientY },
      container: event.currentTarget,
      before: [...selectedNow.current],
      additive: event.ctrlKey || event.metaKey || event.shiftKey,
      active: false,
    };

    const onMove = (move: PointerEvent) => {
      const current = gesture.current;
      if (current === undefined) {
        return;
      }
      const to = { x: move.clientX, y: move.clientY };
      if (!current.active) {
        if (!hasTravelled(current.from, to)) {
          return;
        }
        current.active = true;
        document.body.style.userSelect = 'none';
        window.getSelection()?.removeAllRanges();
      }
      const marquee = boxBetween(current.from, to);
      setBox(marquee);
      select.current(marqueeSelection(current.before, idsInBox(selectableBoxes(current.container), marquee), current.additive));
    };

    const onUp = () => {
      const current = gesture.current;
      if (current !== undefined && !current.active && !current.additive) {
        exit.current();
      }
      finish.current();
    };

    finish.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (gesture.current?.active === true) {
        document.body.style.userSelect = '';
      }
      gesture.current = undefined;
      setBox(undefined);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const onClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!(event.ctrlKey || event.metaKey) || !(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest('[role="checkbox"]') !== null) {
        return;
      }
      const id = event.target.closest(`[${SELECT_ID_ATTRIBUTE}]`)?.getAttribute(SELECT_ID_ATTRIBUTE);
      if (id === null || id === undefined || id === '') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onToggle(id);
    },
    [onToggle],
  );

  const overlay =
    box === undefined || typeof document === 'undefined'
      ? null
      : createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-40 rounded-sm border border-brand-400 bg-brand-500/10"
            style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }}
          />,
          document.body,
        );

  return { containerProps: { onPointerDown, onClickCapture }, overlay };
}
