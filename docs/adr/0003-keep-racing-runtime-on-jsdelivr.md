# Keep Racing Runtime Dependencies On jsDelivr

The racing game will continue loading Three.js, Rapier, DRACO, and related browser modules from pinned jsDelivr URLs instead of copying them into the Cloudflare Pages artifact. We accept that a jsDelivr outage can make racing unavailable because keeping the Pages deployment smaller and simpler is preferred; the game-hub lifecycle must isolate that failure so the home screen and other games remain usable and racing can present retry and return-home actions.
