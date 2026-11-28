# libby-shelf UI wireframe

Spec: [`libby-ui.wireframe.json`](libby-ui.wireframe.json). Sketches below = default options. Implemented in [`ui/`](../../ui) (reads `options` and `screens` at build time).

## Configure

| Key                     | Values                                                     | Effect                                                                 |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `options.layout`        | `desktop` \| `mobile`                                      | sidebar + panes vs stacked screens                                     |
| `options.density`       | `comfortable` \| `compact`                                 | row height / spacing                                                   |
| `options.navigation`    | `sidebar` \| `tabs` \| `wizard`                            | wizard = screens in array order                                        |
| `options.defaultScreen` | screen `id`                                                | first screen shown                                                     |
| `options.showAdvanced`  | bool                                                       | show items marked `advanced`                                           |
| `screens[].enabled`     | bool                                                       | drop a screen                                                          |
| `screens[].deprecated`  | bool                                                       | retired screen; hidden even when `enabled`                             |
| `screens[]` order       | —                                                          | nav / wizard order                                                     |
| component `binds`       | libby-shelf config path (e.g. `hold.placement`) or `cards` | field ↔ config key; choices, defaults, ranges come from `ConfigSchema` |
| component `action`      | CLI subcommand                                             | what the button runs                                                   |

Rules (checked by `test/wireframe.test.ts`):

- Every `binds` is a real `ConfigSchema` path (or `cards`).
- Screen ids are unique; `defaultScreen` is an enabled screen.
- No screen is both `deprecated` and `enabled`.
- Results columns ⊆ `BookResult` fields.

Command screens map to a CLI command (`cli`). Sync is a browser-only reconciliation preview and has no CLI command. Player is a browser-only audiobook control panel (demo title) and has no CLI command.

## Screens

Visible: Sync, Shelf, Search, Audiobook player. Sign in to Libby with `libby-shelf login`; the app has no sign-in screen.

### sync › Settings tab › Library cards (`cards` region)

```
┌ Library cards ─────────────────────────────────────┐
│ use │ card      │ priority    │ loans  │ holds     │
│ [x] │ Main      │ 2  ↑ ↓      │ 3 / 10 │ 7 / 10    │
│ [x] │ Branch    │ 1  ↑ ↓      │ 0 / 5  │ 5 / 5 (!) │
│ Highest priority first; unchecked cards last/fixed │
└────────────────────────────────────────────────────┘
```

### books — `run <input>` (disabled)

```
┌ Book list ─────────────────────────────────────────┐
│ ┌────────────────────────────────┐ ┌ drop file ┐   │
│ │ Piranesi by Susanna Clarke     │ │ .txt .csv │   │
│ │ isbn:9780593135204             │ └───────────┘   │
│ └────────────────────────────────┘ Format [auto ▾] │
│ title    │ author  │ isbn │ format▾ │ action▾ │ libs▾ │
│ Piranesi │ Clarke  │      │ —       │ —       │ —     │
│                        [x] Dry run      [ Plan ]   │
└────────────────────────────────────────────────────┘
```

### settings — `config` (deprecated)

```
┌ Rules ──────────────────────────────────────────────┐
│ Action      ( auto | borrow | hold )                │
│ Media       ≡ ebook  ≡ audiobook  + magazine        │
│ [x] Skip titles on shelf   [x] Respect card limits  │
│ ─ Borrow ─ period [preference ▾] [x] Lucky Day  max [__] │
│ ─ Hold ─── placement ( best | first | all )         │
│            max wait [__]d  max queue [__]  later [0 ▾] │
│            email [______]  max/run [__]             │
│ ▸ Matching (advanced)   ▸ Network (advanced)        │
└─────────────────────────────────────────────────────┘
```

### search — `search <query>`

```
┌ Search preview ─────────────────────────────── [Search] ┐
│ [The Woman in White by Wilkie Collins                 ] │
│ Sort      Availability      Format      Library        │
│ ▾ The Woman in White · Wilkie Collins                  │
│   Audiobook · Main · Narrated by Ian Holm              │
└─────────────────────────────────────────────────────────┘
```

### results — `run` / `run --dry-run` (disabled; reached only from Book list)

```
┌ Plan & results ─────────────────────────────────────┐
│ borrowed 2 · held 3 · would-* 0 · skipped 1 · error 0 │
│ (all) (borrowed) (held) (skipped) (error)           │
│ status │ title │ author │ type │ library │ card │ days │ wait │ queue │ message │
│ held   │ Dune  │ Herbert│ ebook│ lib1    │ Main │      │ 30d  │ 14    │         │
│                   [ Export report ]  [ Run for real ]│
└─────────────────────────────────────────────────────┘   Run for real asks to confirm
```

Mobile layout: same screens stacked; tables collapse to cards (title + status + one detail line).

### player — no CLI

```
┌ Audiobook player ───────────────────────────────┐
│ [♫] The Lighthouse Ledger            (demo)     │
│     Chapter 1: The Keeper                       │
│ ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│ 1:16        Chapter 0:31 / 37:15     −4:10:43   │
│        |◁   ◁◁   [ ▶ / ❚❚ ]   ▷▷   ▷|           │
│              (−)   1.05×   (+)                  │
├ Bookmarks ─────────────────── [ Add bookmark ] ─┤
│ (All) (favorite) (Music)          ← tag filter  │
│ Chapter 1: The Keeper                    1:15   │
│ [Note…                                       ]  │
│ [Music ×] [favorite ×] [🏷 Add tag ▾]            │
│                        ┌──────────────┐ ← tag   │
│                        │ ✓ favorite   │   menu  │
│                        │ ✓ Music      │ scrolls │
│                        │   quote      │         │
│                        ├──────────────┤         │
│                        │ + New Tag    │ pinned  │
│                        └──────────────┘         │
└─────────────────────────────────────────────────┘
```

Layout (desktop, `lg`+): player and bookmarks side by side when the content area is ≥48rem (container query, sidebar-aware), each twice the player's natural height; stacked below.

Phone (below `lg`): bookmarks hidden. The bookmark icon (with count) opens them full screen:

```
┌ ← Bookmarks ──────── [ Add bookmark ] ┐
│ Opening Credits                 0:00  │
│ [Note…                             ]  │
│ [Music ×] [🏷 Add tag ▾]               │
│                                       │
├───────────────────────────────────────┤
│             [   Save   ]              │
└───────────────────────────────────────┘
```

Edits are a draft until Save. ← or the system back gesture asks "Discard changes? Unsaved notes and tags will be lost." (Keep editing / Discard). Save and Discard return to the player.

|◁ chapter start (previous chapter if <3 s in) · ◁◁/▷▷ 30 s · ▷| chapter end · ± 5% speed · bookmark row seeks · tag menu: click toggles a tag; **New Tag** (pinned last) is the only way to create one. Tags take emoji; length counts characters as shown (≤ 32), so one emoji = 1. Bookmark tags are separate from book tags.
