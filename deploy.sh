#!/bin/bash
# Script de deploiement vers le VPS
# Usage depuis Windows: bash deploy.sh
# Workflow: git push local → git pull VPS → build → restart

set -e

echo "=== Deploiement serveur-Calcul-Imposition ==="

# 1. Push vers GitHub
echo ">>> Push vers GitHub..."
git push origin main

# 2. Pull + build + restart sur le VPS
echo ">>> Deploiement sur le VPS..."
ssh root@187.124.27.73 "cd /var/www/serveurclaude && git pull && npm install --production && cd client && npm install && npx vite build && pm2 restart serveurclaude"

echo ""
echo "=== Deploiement termine ! ==="
echo "Site: https://app.montageautodtf.fr"
