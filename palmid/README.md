# PalmID · Reconnaissance palmaire & faciale 🔐✋👤

Une démo de **biométrie multimodale** (main + visage) 100% côté client. Pas de serveur, pas de base de données distante : tout reste dans `localStorage` du navigateur.

## ✨ Fonctionnalités

- **Géométrie palmaire** : 21 points MediaPipe Hands, normalisation par rotation/échelle, distance euclidienne pour la similarité
- **Reconnaissance faciale** : FaceAPI.js avec descripteur 128-dim, modèles TinyFace + SSD MobileNet
- **Fusion multimodale** : score combiné main + visage avec seuil adaptatif
- **PIN de secours** : si le score est ambigu ou trop bas
- **100% local** : aucune image ne quitte le navigateur
- **Design moderne** : dark mode, glassmorphism, animations fluides, mobile-first

## 🐛 Bug corrigé

L'erreur originale :
```
RuntimeError: Aborted(Module.arguments has been replaced with plain arguments_)
```

Était causée par la **recréation multiple de l'instance MediaPipe Hands** entre les changements de vue, ce qui corrompt le module WASM.

**Fix appliqué** :
1. Une **seule instance Hands globale** créée au premier usage et réutilisée
2. Les caméras sont recréées mais **pas l'instance Hands**
3. Promesse d'initialisation unique (`mediaPipeReadyPromise`) pour éviter les races
4. `hands.close()` appelé sur `beforeunload`
5. Garde-fou `activeVideo` pour ne pas envoyer d'image au mauvais moment

## 🚀 Lancer en local

```bash
# Aucune build : c'est du statique pur !
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

Ou simplement ouvrir `index.html` directement (certains navigateurs peuvent bloquer la caméra en `file://`, préfère le serveur local).

## 🧪 Tester

1. Va sur **Accueil** → **Nouvel utilisateur**
2. Entre un nom → capture 3 fois ta main (avec angles légèrement différents)
3. (Optionnel) capture ton visage
4. **Enregistrer**
5. Va sur **Connexion** → choisis un mode (5 s ou 1 s)
6. Présente ta main/visage

## 📁 Structure

```
hand-face-id/
├── index.html      # structure + DOM
├── styles.css      # design system complet (dark mode)
├── app.js          # logique biométrique (singleton MediaPipe)
└── README.md
```

## ⚠️ Limites honnêtes

- Démo éducative — **pas pour production**
- Les modèles se téléchargent depuis CDN à la première visite (~10 Mo)
- La précision dépend beaucoup de la lumière et de la caméra
- Pas de protection contre le *replay attack* sur le visage

## 📜 Crédits

- [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands.html) (Google)
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) (Vincent Mühler)
- Icônes : [Material Symbols](https://fonts.google.com/icons)
