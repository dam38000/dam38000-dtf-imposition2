# CLAUDE.md - Serveur DTF Imposition

## Projet
Serveur d'imposition DTF (Direct-to-Film) pour le site commercial **montageautodtf.fr**.
Le site commercial fera des appels API vers ce serveur VPS.

## Architecture

### Stack
- **Serveur** (port 3000) : Express 5 + Sharp + ImageMagick 7 + jsPDF
- **Client** (port 5173) : React 19 + Vite 7 + Tailwind CSS 4
- **Fichier entree serveur** : `index.js` (PAS server.js)
- **Type** : CommonJS (`"type": "commonjs"`)

### Structure
```
serveurclaude/
  index.js              # Point d'entree serveur Express
  correction-helper.html # Fonctions correction Puppeteer (finesses/reserves)
  montage.html           # Fichier de reference original (152KB) - NE PAS MODIFIER
  profiles/              # Profils ICC (sRGB, eciRGB_v2, CoatedFOGRA39...)
  routes/
    upload.js            # POST /api/upload - Upload + conversion ICC
    analyze.js           # POST /api/analyze/* - Detection/correction finesses et reserves
    export.js            # POST /api/export/* - Export PNG/PDF 300 DPI
  client/
    src/
      App.jsx            # Composant principal React
      components/        # Sidebar, MainArea, SheetView, FileList, etc.
      lib/               # imposition.js, packers.js, bitmapUtils.js
    vite.config.js       # Proxy /api et /uploads vers localhost:3000
```

### Proxy Vite
Le client proxy `/api` et `/uploads` vers `http://localhost:3000`.

## Fonctionnalites actuelles (commit fed8434)
1. **Upload** : PNG, PDF, TIFF (max 200MB) avec conversion ICC vers eciRGB v2
2. **Imposition** : Bin-packing automatique sur planches (575x420mm par defaut)
3. **Modes** : Standard, Massicot, Manuel
4. **Export** : Dessin PNG 300 DPI, coupe PDF, composite PDF
5. **Fix TIFF CMYK** : Inversion alpha corrigee

## Fonctionnalites en developpement (non actives dans fed8434)
- **Detection finesses** : Morphologie Open (Erode+Dilate) via ImageMagick
- **Detection reserves** : Morphologie Close (Dilate+Erode) via ImageMagick
- **Correction finesses** : Puppeteer headless executant le code Canvas original de montage.html
- **Correction reserves** : Idem Puppeteer
- **Loupe x10** : Zoom avec graduations concentriques (fonctionne au commit 291804d)

## Formules cles

### Conversion mm vers pixels
```javascript
mmToPx(mm) = Math.round(mm * 300 / 25.4)  // 300 DPI
```

### Finesse (correction)
```javascript
const calculatedFinesse = (finesse / 0.08) * 0.75;  // finesse=0.3 → 2.8125
const radius = Math.ceil(calculatedFinesse / 2);      // → 2
const sigma = Math.max(1.2, calculatedFinesse * 0.5);
```
Source de reference : `D:\Fichier Montage Pur\montage.html`

## Profils ICC utilises
- `sRGB.icc` - Espace couleur standard
- `eciRGB_v2.icc` - Espace de travail cible (European Color Initiative)
- `CoatedFOGRA39.icc` - Profil CMYK papier couche

## Regles de travail
1. **Toujours reformuler** avant de coder, attendre approbation
2. **Aucune initiative** : ne jamais ajouter, modifier ou corriger quoi que ce soit qui n'a pas ete explicitement demande. Si tu veux prendre une initiative (fix, amelioration, refactoring...), tu dois d'abord demander l'accord express de l'utilisateur, qui examinera et dira quoi faire.
3. **Ne jamais modifier** `montage.html` (fichier de reference original)
4. **ImageMagick 7** : utiliser `magick` (pas `convert`)
5. **index.js** : fichier d'entree serveur (attention aux routes montees)
6. **Fichier uploads** : organises par UUID dans `uploads/{uuid}/`

## Commandes utiles
```bash
# Serveur
cd C:\Users\dt380\Documents\serveurclaude
node index.js

# Client
cd C:\Users\dt380\Documents\serveurclaude\client
npm run dev
```

## Historique des commits
```
fed8434 Export buttons + fix TIFF CMYK alpha inversion        ← VERSION ACTUELLE
151adc5 Client React : interface + bin-packing (etapes 4a+4b)
27a82d2 Ajout routes export (dessin PNG, coupe PDF, composite PDF)
8aa2c24 Upload + conversion ICC (PNG, PDF, TIFF) vers eciRGB v2
```
Commits plus recents (non restaures, disponibles dans git) :
```
e9c4b5f recodage finesses (Puppeteer)
b3031f2 finesse presque fini
d710c18 Correction finesses : Dilate cumulatif 1px par clic
291804d Loupe amelioree (zoom x10, graduations) + correction fixe
3b95481 Ajout loupe zoom 3x
c5787d8 Etape 5b : Correction finesses/reserves + optimisation demi-res
41c9777 Etape 5 : Detection finesses et reserves (morphologie ImageMagick)
```

## Problemes connus
- **Correction finesses** : n'a jamais fonctionne correctement. Causes identifiees :
  1. `index.js` ne montait pas la route `/api/analyze` (corrige mais pas commite)
  2. Timeout Puppeteer 30s trop court (corrige en 5min mais pas commite)
  3. Algorithme trop subtil (+2px) → reecrit en multi-passes (+6px, pas commite)
  Ces 3 fixes n'ont jamais ete testes ensemble.

## Fichier de reference
Le fichier original est a `D:\Fichier Montage Pur\montage.html`.
Il contient les fonctions `correctImageFinesse` et `correctImageReserves` qui font reference.
