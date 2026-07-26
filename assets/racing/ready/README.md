# Racing ready cover assets

Derived from the owner-provided 1448×1086 PNG. The source PNG is not shipped.

| Viewport slot | AVIF | WebP fallback |
| --- | --- | --- |
| ≤720px | `racing-ready-640.avif` (39,080 B) | `racing-ready-640.webp` (35,878 B) |
| 721–1180px | `racing-ready-960.avif` (65,622 B) | `racing-ready-960.webp` (65,810 B) |
| >1180px | `racing-ready-1440.avif` (103,020 B) | `racing-ready-1440.webp` (112,428 B) |

`game.js` requests these only after the racing runtime has reported its real ready boundary. During preparation the cover uses the CSS color/blur placeholder, so image transfer and decode cannot delay `first-drivable-frame`.
