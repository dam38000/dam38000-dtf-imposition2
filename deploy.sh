#!/bin/bash
# Script de deploiement serveurclaude sur VPS Hostinger
# Usage: ssh root@187.124.27.73 'bash -s' < deploy.sh

set -e

echo "=== Deploiement serveurclaude ==="

# 1. Mise a jour systeme
echo ">>> Mise a jour systeme..."
apt update && apt upgrade -y

# 2. Installer Node.js 20 si pas present
if ! command -v node &> /dev/null; then
    echo ">>> Installation Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"

# 3. Installer Nginx si pas present
if ! command -v nginx &> /dev/null; then
    echo ">>> Installation Nginx..."
    apt install -y nginx
fi

# 4. Installer PM2 globalement
if ! command -v pm2 &> /dev/null; then
    echo ">>> Installation PM2..."
    npm install -g pm2
fi

# 5. Verifier ImageMagick
if ! command -v magick &> /dev/null && ! command -v convert &> /dev/null; then
    echo ">>> Installation ImageMagick..."
    apt install -y imagemagick
fi

# 6. Creer les repertoires
echo ">>> Creation des repertoires..."
mkdir -p /var/www/serveurclaude
mkdir -p /var/log/serveurclaude

# 7. Copier la config Nginx
echo ">>> Configuration Nginx..."
cp /var/www/serveurclaude/nginx/serveurclaude.conf /etc/nginx/sites-available/serveurclaude
ln -sf /etc/nginx/sites-available/serveurclaude /etc/nginx/sites-enabled/serveurclaude
rm -f /etc/nginx/sites-enabled/default

# Tester et recharger Nginx
nginx -t && systemctl reload nginx

# 8. Installer les dependances
echo ">>> Installation des dependances serveur..."
cd /var/www/serveurclaude
npm install --production

echo ">>> Build du client React..."
cd client
npm install
npx vite build
cd ..

# 9. Lancer avec PM2
echo ">>> Demarrage avec PM2..."
pm2 delete serveurclaude 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "=== Deploiement termine ! ==="
echo "Site accessible sur: http://app.montageautodtf.fr"
echo ""
echo "Prochaine etape: installer SSL avec:"
echo "  apt install certbot python3-certbot-nginx"
echo "  certbot --nginx -d app.montageautodtf.fr"
echo ""
echo "Commandes utiles:"
echo "  pm2 status          - voir l'etat du serveur"
echo "  pm2 logs             - voir les logs"
echo "  pm2 restart all      - redemarrer"
