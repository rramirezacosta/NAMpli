import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Bank } from '../types/preset';
import { BANKS, SLOTS, slotLabel } from '../types/preset';
import type { PresetManager } from '../hooks/usePresetManager';
import { useDialogFocus } from '../hooks/useDialogFocus';
import PresetEditor from './PresetEditor';
import './PresetBar.css';

type Dialog =
  | { mode: 'new'; name: string; bank: Bank; slot: number }
  | { mode: 'rename'; source: string; name: string }
  | { mode: 'edit'; source: string };

interface SlotMenu {
  bank: Bank;
  slot: number;
  x: number;
  y: number;
}

interface PresetBarProps {
  manager: PresetManager;
}

/**
 * Preset overlays must escape the faceplate's stacking contexts, but portaling
 * all the way to `document.body` would put them outside `.app`'s isolated
 * stacking context and therefore above every in-app dialog regardless of
 * z-index. Portal into `.app` instead so the shared z-index scale applies.
 */
function PresetOverlay({ children }: { children: ReactNode }) {
  return createPortal(children, document.querySelector('.app') ?? document.body);
}

export default function PresetBar({ manager }: PresetBarProps) {
  const [menu, setMenu] = useState<SlotMenu | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  // Move focus into the name dialog, trap Tab and restore focus on close.
  useDialogFocus(
    dialog?.mode === 'rename' || dialog?.mode === 'new',
    () => setDialog(null),
    dialogRef,
  );

  useEffect(() => {
    if (!menu && !dialog) return;
    const dismiss = () => {
      setMenu(null);
      setDialog(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('click', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, dialog]);

  // A role="menu" needs keyboard parity with the pointer interaction: focus the
  // first item on open and support arrows / Home / End between items.
  useEffect(() => {
    if (!menu) return;
    const items = () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []);
    items()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const list = items();
      if (list.length === 0) return;
      event.preventDefault();
      const current = list.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? list.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      list[next].focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu]);

  const openMenuAt = (bank: Bank, slot: number, x: number, y: number) => {
    setDialog(null);
    setMenu({
      bank,
      slot,
      x: Math.min(x, window.innerWidth - 170),
      y: Math.min(y, window.innerHeight - 270),
    });
  };

  const openMenu = (event: React.MouseEvent, bank: Bank, slot: number) => {
    event.preventDefault();
    event.stopPropagation();
    openMenuAt(bank, slot, event.clientX, event.clientY);
  };

  const openMenuFromKeyboard = (event: React.KeyboardEvent, bank: Bank, slot: number) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openMenuAt(bank, slot, rect.left, rect.bottom);
  };

  const submitDialog = (event: React.FormEvent) => {
    event.preventDefault();
    if (!dialog || dialog.mode === 'edit') return;
    const name = dialog.name.trim();
    if (!name) return;
    if (dialog.mode === 'new') {
      void manager.save(name, dialog.bank, dialog.slot);
    } else {
      void manager.rename(dialog.source, name);
    }
    setDialog(null);
  };

  const menuMeta = menu ? manager.metaAt(menu.bank, menu.slot) : undefined;

  return (
    <div className="preset-bar">
      <div className="preset-bank-toggle" role="group" aria-label="Preset bank">
        {BANKS.map((b) => (
          <button
            key={b}
            className={`preset-bank-btn ${manager.bank === b ? 'active' : ''}`}
            onClick={() => manager.setBank(b)}
            type="button"
            aria-label={`Bank ${b}`}
            title={`Bank ${b} — switch bank`}
          >
            {b}
          </button>
        ))}
      </div>

      <div className="preset-slots">
        {SLOTS.map((number) => {
          const meta = manager.metaAt(manager.bank, number);
          const active = !!meta && manager.activeName === meta.name;
          const selected = manager.slot === number;
          const showDirty = manager.dirty && (active || (!meta && selected));
          const menuOpen = menu?.bank === manager.bank && menu.slot === number;
          return (
            <div className="preset-slot-wrap" key={number}>
              <button
                type="button"
                className={`preset-slot ${selected ? 'selected' : ''} ${active ? 'active' : ''} ${meta ? '' : 'empty'}`}
                onClick={() => {
                  if (meta) void manager.recallAt(manager.bank, number);
                  else manager.selectAt(manager.bank, number);
                }}
                onContextMenu={(event) => openMenu(event, manager.bank, number)}
                onKeyDown={(event) => openMenuFromKeyboard(event, manager.bank, number)}
                title={
                  meta
                    ? `Recall ${meta.name}${selected ? ' · selected slot' : ''}`
                    : selected
                      ? 'Empty slot — selected (bypass preview), or use ⋯ → New preset…'
                      : 'Empty slot — click to preview bypass, or use ⋯ → New preset…'
                }
                aria-pressed={selected}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={manager.busy}
              >
                <span className="preset-slot-number">{number}</span>
                <span className="preset-slot-name">{meta?.name ?? 'Empty'}</span>
                <span className="preset-slot-model">{meta?.modelName ?? 'no model'}</span>
                {showDirty && (
                  <span className="preset-dirty" role="status" aria-label="Unsaved changes" title="Unsaved changes">
                    •
                  </span>
                )}
              </button>
              <button
                type="button"
                className="preset-slot-menu-trigger"
                onClick={(event) => openMenu(event, manager.bank, number)}
                onContextMenu={(event) => openMenu(event, manager.bank, number)}
                onKeyDown={(event) => openMenuFromKeyboard(event, manager.bank, number)}
                aria-label={`Actions for slot ${number}${meta ? ` (${meta.name})` : ''}`}
                title={meta ? 'Slot actions' : 'New preset…'}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={manager.busy}
              >
                ⋯
              </button>
            </div>
          );
        })}
      </div>

      <PresetOverlay>
        {menu && (
          <div
            ref={menuRef}
            className="preset-menu card"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="preset-menu-title">
              {slotLabel(menu.bank, menu.slot)} · {menuMeta?.name ?? 'Empty'}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setDialog({
                  mode: 'new',
                  name: `Preset ${slotLabel(menu.bank, menu.slot)}`,
                  bank: menu.bank,
                  slot: menu.slot,
                });
                setMenu(null);
              }}
            >
              New preset…
            </button>
            {menuMeta && (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDialog({ mode: 'edit', source: menuMeta.name });
                    setMenu(null);
                  }}
                >
                  Edit…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setDialog({ mode: 'rename', source: menuMeta.name, name: menuMeta.name });
                    setMenu(null);
                  }}
                >
                  Rename…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => { void manager.remove(menuMeta.name); setMenu(null); }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}

        {dialog?.mode === 'edit' && (
          <PresetEditor
            key={dialog.source}
            sourceName={dialog.source}
            manager={manager}
            onClose={() => setDialog(null)}
          />
        )}

        {dialog && dialog.mode !== 'edit' && (
          <div className="preset-dialog-overlay overlay" onClick={() => setDialog(null)}>
            <form
              ref={dialogRef}
              className="preset-dialog card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="preset-dialog-title"
              onClick={(event) => event.stopPropagation()}
              onSubmit={submitDialog}
            >
              <h3 id="preset-dialog-title">{dialog.mode === 'new' ? 'New preset' : 'Rename preset'}</h3>
              <label htmlFor="preset-name-input">Name</label>
              <input
                id="preset-name-input"
                data-autofocus
                autoFocus
                value={dialog.name}
                onChange={(event) => setDialog({ ...dialog, name: event.target.value })}
              />
              <div className="preset-dialog-buttons">
                <button type="button" className="btn" onClick={() => setDialog(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{dialog.mode === 'new' ? 'Create' : 'Rename'}</button>
              </div>
            </form>
          </div>
        )}
      </PresetOverlay>
    </div>
  );
}
