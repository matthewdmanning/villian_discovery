# libby-shelf UI wireframe

Design only. No UI implemented. Spec: [`libby-ui.wireframe.json`](libby-ui.wireframe.json). Sketches below = default options.

## Configure

| Key                     | Values                                                     | Effect                                                                 |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `options.layout`        | `desktop` \| `mobile`                                      | sidebar + panes vs stacked screens                                     |
| `options.density`       | `comfortable` \| `compact`                                 | row height / spacing                                                   |
| `options.navigation`    | `sidebar` \| `tabs` \| `wizard`                            | wizard = screens in array order                                        |
| `options.defaultScreen` | screen `id`                                                | first screen shown                                                     |
| `options.showAdvanced`  | bool                                                       | show items marked `advanced`                                           |
| `screens[].enabled`     | bool                                                       | drop a screen                                                          |
| `screens[]` order       | —                                                          | nav / wizard order                                                     |
| component `binds`       | libby-shelf config path (e.g. `hold.placement`) or `cards` | field ↔ config key; choices, defaults, ranges come from `ConfigSchema` |
| component `action`      | CLI subcommand                                             | what the button runs                                                   |

Rules (checked by `test/wireframe.test.ts`):

- Every `binds` is a real `ConfigSchema` path (or `cards`).
- Screen ids are unique; `defaultScreen` is an enabled screen.
- Results columns ⊆ `BookResult` fields.

Each screen maps 1:1 to a CLI command (`cli`), so a UI is a thin shell over the library API.

## Screens

### connect — `login`

```
┌ Connect Libby ─────────────────────────────┐
│ [i] Not connected | Connected (token file) │
│ Setup code   [________]                    │
│              Libby → Menu → Copy To ...    │
│ Token file*  [~/.config/libby-shelf/...]   │
│                               [ Connect ]  │
└────────────────────────────────────────────┘   * advanced
```

### cards — `cards`

```
┌ Library cards ─────────────────────────────────────┐
│ use │ card      │ library key │ loans  │ holds     │
│ [x] │ Main      │ lib1        │ 3 / 10 │ 7 / 10    │
│ [ ] │ Branch    │ lib2        │ 0 / 5  │ 5 / 5 (!) │
│ Library priority:  ≡ lib1   ≡ lib2   (drag)         │
└────────────────────────────────────────────────────┘
```

### books — `run <input>`

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

### settings — `config`

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
│ [Project Hail Mary by Andy Weir                       ] │
│ card │ title │ creator │ type │ t/a score │ avail │ copies │ holds │ wait │
│ Main │ PHM   │ Weir    │ ebook│ 1.00/0.92 │ no    │ 0/4    │ 12    │ 21d  │
└─────────────────────────────────────────────────────────┘
```

### results — `run` / `run --dry-run`

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
