#!/usr/bin/env bash
# Run on Oracle VM (Ubuntu) as ubuntu user — installs Node 20, swap, nginx, systemd service.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/newsfacts}"
APP_PORT="${APP_PORT:-3002}"
PUBLIC_URL="${PUBLIC_URL:-http://$(curl -s -4 ifconfig.me)}"

echo "==> System packages"
sudo apt-get update -qq
sudo apt-get install -y -qq curl git nginx rsync build-essential

echo "==> 2GB swap (helps 1GB E2.Micro with npm + embeddings)"
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "==> Node.js 20"
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
node -v
npm -v

echo "==> Host firewall (Oracle images often block everything except SSH)"
if command -v iptables >/dev/null; then
  sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 4 -p tcp --dport 80 -j ACCEPT
  sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
  if command -v netfilter-persistent >/dev/null; then
    sudo netfilter-persistent save
  elif [[ -d /etc/iptables ]]; then
    sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
  fi
fi

echo "==> Nginx reverse proxy"
sudo tee /etc/nginx/sites-available/newsfacts >/dev/null <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/newsfacts /etc/nginx/sites-enabled/newsfacts
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

echo "==> systemd service"
sudo tee /etc/systemd/system/newsfacts.service >/dev/null <<UNIT
[Unit]
Description=NewsFacts Hedera x402 API
After=network.target nginx.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=NODE_OPTIONS=--max-old-space-size=768
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=8

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable newsfacts

echo "==> App install (skip if rsync not done yet)"
if [[ -f "${APP_DIR}/package.json" ]]; then
  cd "${APP_DIR}"
  npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
  # xenova/transformers needs sharp native bindings (skipped by --ignore-scripts)
  npm rebuild sharp
  # Production URL for x402 callbacks
  if grep -q '^SERVER_URL=' .env; then
    sed -i "s|^SERVER_URL=.*|SERVER_URL=${PUBLIC_URL}|" .env
  else
    echo "SERVER_URL=${PUBLIC_URL}" >> .env
  fi
  grep -q '^HOST=' .env || echo 'HOST=0.0.0.0' >> .env
  sed -i 's/^ALLOW_RESET=.*/ALLOW_RESET=0/' .env 2>/dev/null || echo 'ALLOW_RESET=0' >> .env
  sudo systemctl restart newsfacts
fi

echo "==> Done. Public URL: ${PUBLIC_URL}"
echo "    Health: curl ${PUBLIC_URL}/health"
