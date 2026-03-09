const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware JSON
app.use(express.json({ limit: '50mb' }));

// Servir les fichiers statiques du dossier uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
const uploadRoute = require('./routes/upload');
app.use('/api/upload', uploadRoute);

const exportRoute = require('./routes/export');
app.use('/api/export', exportRoute);

const analyzeRoute = require('./routes/analyze');
app.use('/api/analyze', analyzeRoute);

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur DTF démarré sur http://localhost:${PORT}`);
});

module.exports = app;
