const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Servir les fichiers statiques du dossier uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
const uploadRoute = require('./routes/upload');
app.use('/api/upload', uploadRoute);

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur DTF démarré sur http://localhost:${PORT}`);
});

module.exports = app;
