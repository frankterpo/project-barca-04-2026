# Lobster IC — design tokens (v0)

Dark shell optimized for dense financial tables and committee review.

## Colors (CSS variables)


| Token              | Value     | Usage                  |
| ------------------ | --------- | ---------------------- |
| `--bg-app`         | `#0B0D10` | Page background        |
| `--bg-elevated`    | `#12151A` | Cards, header          |
| `--bg-muted`       | `#1A1F27` | Table stripes, inputs  |
| `--border-subtle`  | `#2A3140` | Borders                |
| `--text-primary`   | `#E8EAEF` | Primary copy           |
| `--text-secondary` | `#9AA3B2` | Secondary copy         |
| `--text-muted`     | `#6B7280` | Meta labels            |
| `--accent`         | `#E85D4C` | Links, active states   |
| `--accent-muted`   | `#C24A3D` | Hover / pressed        |
| `--positive`       | `#34D399` | Band A / positive      |
| `--warning`        | `#FBBF24` | Band B                 |
| `--negative`       | `#F87171` | Band C / risk emphasis |


## Typography

- **Sans:** IBM Plex Sans (`@fontsource/ibm-plex-sans` 400/600)
- **Mono:** IBM Plex Mono (`@fontsource/ibm-plex-mono` 400) for tickers, run ids, scores

## Conviction bands

Discrete **A / B / C** badges derived from chair confidence:

- **A:** score ≥ 70  
- **B:** 45–69  
- **C:** < 45

## Touch / a11y

- Preset buttons **min-height 44px**
- Judge answer panel `**aria-live="polite"`**
- Preset toggles use `**aria-pressed**`

## Layout

- **Portfolio:** run strip + sortable holdings table  
- **Holding:** horizontal committee strip + **tabs** (Bull / Skeptic / Risk)  
- **Judge Mode:** 3 columns desktop → single column mobile (company → questions → answer)