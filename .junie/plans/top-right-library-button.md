# Library button in the top-right tool cluster

> **Status: implemented.** `tsc --noEmit`, `npm run lint` (one pre-existing unrelated warning in
> `SettingsPanel.tsx:60`) and `npm run build` pass. Manual native-window QA is still pending.

# Context

The Library is a full-window view (`view === 'library'`, `App.tsx:40`) entered via a plain-text
**Library** button at the end of the preset rail (`PresetBar.tsx:197-206`). The top-right corner
already has a fixed tool cluster (`.window-tools`, `App.css:70-116`) holding the Settings gear
(`SettingsIcon`) and Tuner (`TunerIcon`) icon buttons from `App.tsx:343-346`.

Desired change: move the Library entry point into that top-right cluster, next to the Settings
button, rendered as a **folder icon** that matches the existing icon-button pattern. The text
button disappears from the preset rail, freeing horizontal space there.

# Goals / Non-goals

**Goals**
1. Library trigger sits in `.window-tools` beside Settings (and Tuner), using a folder icon with the same
   `.tool-button` styling, hover/active/focus states, and brass palette as its siblings.
2. Accessible name (`aria-label="Library"`), tooltip (`title="Library"`), and keyboard focus restoration
   on returning from the library view are preserved.
3. Only one Library trigger exists — no duplicate entry points or duplicate focus-target attributes.
4. The build stays clean under `noUnusedLocals` / `noUnusedParameters` (`tsconfig.app.json:20-21`).

**Non-goals**
- Changing the library view itself (`AssetLibrary.tsx`), its actions, or its keyboard shortcuts.
- Adding a new keyboard shortcut (`Ctrl/Cmd+L`) or changing Esc/Enter precedence.
- Reordering Settings and Tuner, changing window chrome, or adding a component library / icon package.
- Touching backend/Rust code.

# UX design

```
┌──────────────────────────────────────────────────────────────┐
│  ...top chrome...                        [📁] [⚙] [♩]  ← tools│
├──────────────────────────────────────────────────────────────┤
│  preset rail: banks · 16 slots · Save/Rename/Delete   (no Library text button) │
└──────────────────────────────────────────────────────────────┘
```

- Order in `.window-tools`: **Library, Settings, Tuner** so the new icon sits immediately beside
  the config (gear) button as requested, with existing buttons keeping their relative order.
- Folder glyph: 16×16 inline SVG, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
  `strokeWidth="1.5"`, rounded caps/joins — identical to `SettingsIcon.tsx:13-28` and
  `TunerIcon.tsx:14-23`. No icon dependency is added.
- Hover/focus behaviour is inherited automatically from `.window-tools .tool-button` (`App.css:81-116`);
  no new CSS is required for the button itself.
- On exit from the library view (Back button or Esc), focus returns to the new folder icon instead of
  the deleted rail button.

# Technical design

### New file: `src/components/LibraryIcon.tsx`

Model it directly on `src/components/SettingsIcon.tsx` / `src/components/TunerIcon.tsx`:

```tsx
interface LibraryIconProps {
  onClick: () => void;
}

export default function LibraryIcon({ onClick }: LibraryIconProps) {
  return (
    <button
      className="tool-button"
      onClick={onClick}
      data-preset-library-trigger
      aria-label="Library"
      title="Library"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
```

Keeping `data-preset-library-trigger` on the new button means the focus-restoration selector in
`App.tsx:57` keeps working unchanged. (Optional cleanup: rename the attribute to
`data-library-trigger` and update `App.tsx:57` in the same commit — do not rename in only one place.)

### `src/App.tsx`

- Import `LibraryIcon` alongside the other icon components (top of file).
- In `.window-tools` (`App.tsx:343-346`), insert `<LibraryIcon onClick={openLibrary} />` **before**
  `<SettingsIcon ... />`. `openLibrary` (`App.tsx:53`) already does `setView('library')` — reuse it,
  no new callback.
- Remove `onOpenLibrary={openLibrary}` from `<AmpPanel>` (`App.tsx:439`).
- Leave `backToAmp` (`App.tsx:54-60`) as-is if the trigger attribute is kept; the existing
  `document.querySelector('[data-preset-library-trigger]')?.focus()` now resolves to the new icon
  because the old rail button is deleted. Note this cluster stays mounted in all views (`amp`,
  `library`, `tuner`), so focus restoration works from both the Back button and Esc.

### `src/components/AmpPanel.tsx`

- Remove `onOpenLibrary: () => void;` from `AmpPanelProps` (`:22`).
- Remove `onOpenLibrary` from the destructured props (`:46`).
- Pass only `manager` to `<PresetBar>` in the `.preset-rail` (`:65`).

### `src/components/PresetBar.tsx`

- Remove `onOpenLibrary: () => void;` from `PresetBarProps` (`:26`).
- Remove `onOpenLibrary` from the component signature (`:39`).
- Delete the `.preset-actions` block containing the Library button (`:197-206`) together with the
  `data-preset-library-trigger` attribute — the new icon becomes the single trigger.
- Leave the portaled slot menu/dialogs (`:208+`) untouched.

### `src/components/PresetBar.css`

- Delete the now-dead `.preset-actions` / `.preset-action-btn` rules (`PresetBar.css:172-200`);
  grep confirms no other consumers of those classes.
- `App.css` needs **no changes**: `.window-tools` is already a flex row, and the new icon inherits
  `.window-tools .tool-button`.

### Docs (optional, low priority)

- `README.md:20-25` describes the Library button — update wording to "folder icon in the top-right
  tools" if it names a location.
- Historical plans encode the old layout and can receive a short status note rather than a rewrite:
  `.junie/plans/full-window-library.md:42,98`, `.junie/plans/ui-improvements.md:46,50,69`,
  `.junie/plans/larger-better-tuner.md:132-134`, `.junie/plans/remove-sound-visualization.md:54`.

# Verification

There is no frontend test infrastructure (no `test` script, no vitest/jest/playwright/storybook), so
verification is build + lint + manual QA:

1. `npx tsc --noEmit` — catches leftover `onOpenLibrary` props under `noUnusedLocals/Parameters`.
2. `npm run lint` and `npm run build`.
3. `npm run tauri dev` (or `npm run dev` for the browser shell) and check at 1200×650:
   - Folder icon appears before the gear, visually consistent with Settings/Tuner; tooltip reads "Library".
   - Clicking it opens the library view; **← Back to amp** returns focus to the folder icon (Tab/Esc too).
   - Tuner entry/exit still focuses its own trigger; preset rail no longer has a Library text button.
   - No layout overflow; focus ring visible on keyboard navigation.
4. Optional docs-only edits need no re-run, but re-run lint/build if any `src/` change is made after step 2.

# Delivery steps

- [x] **Step 1 — Add the icon button.** Create `LibraryIcon.tsx` with the folder SVG and
      `data-preset-library-trigger`; import and render it in `App.tsx` inside `.window-tools`.
- [x] **Step 2 — Remove the old trigger.** Delete the Library button from `PresetBar.tsx` and thread
      the `onOpenLibrary` prop out through `PresetBar.tsx` and `AmpPanel.tsx`; drop the dead CSS rules.
- [x] **Step 3 — Verify.** `npx tsc --noEmit`, `npm run lint` (one pre-existing `SettingsPanel.tsx:60`
      warning), `npm run build` all pass. Manual native-window QA is pending.
- [x] **Step 4 — Docs.** Update `README.md` and this plan's status. Historical `.junie/plans/*.md`
      files were intentionally left as-is (they document their own past phases).

# Open decisions

- Trigger attribute: keep `data-preset-library-trigger` (minimal diff, recommended) or rename to
  `data-library-trigger` in both `LibraryIcon.tsx` and `App.tsx:57` for clarity now that the button
  no longer lives in `PresetBar`.
- Icon placement relative to Settings: recommended Library → Settings → Tuner per the request; the
  alternative is Settings → Library → Tuner if Settings should remain the leftmost tool.
- Button name in the tooltip: recommended plain "Library" to match the existing view name and
  `aria-label`; "Model & IR Library" is the alternative but is longer than sibling tooltips.
