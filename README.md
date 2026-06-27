# Megano ✦

> Build the impossible.

Megano is an experimental creative platform — single-file HTML/CSS/JS demos, deployed on GitHub Pages, built collaboratively by humans and AI.

## Pages

- **`index.html`** — Landing page with hero, features, and showcase
- **`demo.html`** — 18,000-particle spiral galaxy (Three.js, WebGL)
- **`playground.html`** — Interactive particle field with mouse physics (Canvas 2D)
- **`about.html`** — Manifesto and stack details
- **`palmid/`** — Reconnaissance biométrique (main + visage) en pur navigateur

## Stack

- Pure HTML5 / CSS3 (custom properties, no framework)
- Vanilla JavaScript (ES2024 modules)
- Three.js (via importmap from unpkg) for the galaxy
- Canvas 2D API for the playground
- GitHub Pages for hosting

No build step. No dependencies. Just files and a browser.

## Local development

```bash
# clone
git clone https://github.com/samueljimmyandria-cmd/megano.git
cd megano

# serve locally (any static server works)
python3 -m http.server 8000
# open http://localhost:8000
```

## Live site

Once deployed: `https://samueljimmyandria-cmd.github.io/megano/`

## License

MIT — do whatever you want, just don't blame us if it sets your GPU on fire.