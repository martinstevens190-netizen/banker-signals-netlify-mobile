# Banker Signals — Mobile Simplified Netlify Build

This version is simplified around your actual workflow:
- save prompts
- set one default scan time
- turn banker alerts on or off per prompt
- store shots / shots-on-target banker bands
- receive banker notifications only

## New sections
- Home
- Prompts
- Shots
- Alerts

## Deploy on Netlify
1. Upload this folder to GitHub.
2. Create a Netlify site from the repo.
3. Keep the included `netlify.toml`.
4. Add VAPID environment variables if you want push notifications.

## Notes
- This is still a scaffold. The real sports scanning logic should be connected inside `netlify/functions/_lib/scanEngine.js`.
- The current alert output is a banker-first preview with saved shot bands.
