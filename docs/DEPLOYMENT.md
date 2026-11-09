# Bimoto Deployment Guide

Production deployment on DigitalOcean with Nginx, SSL, and PM2.

## 1. Server Setup

### DigitalOcean Droplet
- Ubuntu 22.04 LTS
- 2GB RAM / 1 vCPU minimum
- Region: Choose closest to Rwanda (e.g., London or Frankfurt)

### Install Dependencies
```bash
# Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm
npm install -g pnpm

# Docker & Docker Compose
sudo apt-get install -y docker.io docker-compose
sudo systemctl enable docker

# Nginx
sudo apt-get install -y nginx

# PM2
npm install -g pm2

# Certbot (SSL)
sudo apt-get install -y certbot python3-certbot-nginx
```

## 2. Application Setup

```bash
# Clone and install
cd /opt
git clone https://github.com/Joschll/bimoto.git
cd bimoto
cp .env.example .env
# Edit .env with production values
pnpm install

# Start PostgreSQL
docker-compose up -d

# Run migrations and seed
pnpm --filter @bimoto/server db:migrate:deploy
pnpm --filter @bimoto/server db:seed

# Build
pnpm -r build
```

## 3. Environment Variables

Edit `/opt/bimoto/.env` with production values:

```env
DATABASE_URL="postgresql://bimoto:STRONG_PASSWORD@localhost:5432/bimoto"
JWT_SECRET="<random-64-char-string>"
JWT_REFRESH_SECRET="<different-random-64-char-string>"
ENCRYPTION_KEY="<64-hex-char-string>"
PORT=3000
CLIENT_URL="https://yourdomain.com"
NODE_ENV="production"
AT_API_KEY="your-africas-talking-api-key"
AT_USERNAME="your-username"
FLW_SECRET_HASH="your-flutterwave-webhook-hash"
FLW_PUBLIC_KEY="your-flutterwave-public-key"
FLW_SECRET_KEY="your-flutterwave-secret-key"
SENTRY_DSN="https://your-sentry-dsn"
```

## 4. PM2 Process Management

```bash
# Start the server
cd /opt/bimoto
pm2 start packages/server/dist/index.js --name bimoto-api

# Save PM2 config
pm2 save
pm2 startup
```

## 5. Nginx Configuration

Create `/etc/nginx/sites-available/bimoto`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Client (static files)
    location / {
        root /opt/bimoto/packages/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Socket.io
    location /socket.io {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
    }

    # Uploaded files
    location /uploads {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/bimoto /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 6. SSL with Let's Encrypt

```bash
sudo certbot --nginx -d yourdomain.com
# Follow prompts, select redirect HTTP to HTTPS
```

## 7. Flutterwave Webhook

In your Flutterwave dashboard, set the webhook URL to:
```
https://yourdomain.com/api/webhooks/flutterwave
```

Set the secret hash to match your `FLW_SECRET_HASH` env variable.

## 8. Monitoring

### Sentry
1. Create a project at https://sentry.io
2. Set the `SENTRY_DSN` environment variable
3. Restart the server: `pm2 restart bimoto-api`

### PM2 Monitoring
```bash
pm2 monit          # Real-time monitoring
pm2 logs bimoto-api  # View logs
pm2 status         # Process status
```

## 9. Updates

```bash
cd /opt/bimoto
git pull origin main
pnpm install
pnpm --filter @bimoto/server db:migrate:deploy
pnpm -r build
pm2 restart bimoto-api
```
