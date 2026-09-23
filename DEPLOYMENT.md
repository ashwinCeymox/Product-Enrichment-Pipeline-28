# Server Deployment Guide

Your application is fully containerized with Docker, meaning deploying it to a production server is very straightforward. The NGINX configuration already handles serving the React frontend and proxying `/api` requests to the FastAPI backend.

Follow these exact steps to deploy to a live server.

## Step 1: Provision a Server
1. Go to a cloud provider like **DigitalOcean**, **AWS**, or **Hetzner**.
2. Create a new virtual machine (VPS / Droplet / EC2).
3. **Recommended Specs**:
   - OS: **Ubuntu 24.04 LTS** (or 22.04 LTS)
   - CPU: **2+ vCPUs**
   - RAM: **4GB+ RAM** (Since you are running Postgres, Redis, Celery, and FastAPI together).

## Step 2: Connect to Your Server
SSH into your new server from your local terminal:
```bash
ssh root@YOUR_SERVER_IP
```

## Step 3: Install Docker and Git
Once inside your server, run the following commands to update the system and install Docker and Git:
```bash
# Update package list
sudo apt-get update && sudo apt-get upgrade -y

# Install Git
sudo apt-get install git -y

# Install Docker & Docker Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

## Step 4: Clone Your Repository
Clone the project you just pushed to GitHub onto the server:
```bash
# If your repo is private, you may need to generate an SSH key on the server 
# and add it to your GitHub account, or use a GitHub Personal Access Token.
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME
```

## Step 5: Configure the Environment
1. Copy the example environment file:
   ```bash
   cp .env.example backend/.env
   ```
2. Open the file to edit the secrets:
   ```bash
   nano backend/.env
   ```
3. **CRITICAL**: Change `SECRET_KEY` to a secure, random string.
   *(You can generate one by running `openssl rand -hex 32`)*
4. Save and exit nano (`Ctrl+O`, `Enter`, `Ctrl+X`).

## Step 6: Start the Application!
Make the start script executable and run it:
```bash
chmod +x start.sh
./start.sh
```
*(Alternatively, you can just run `docker compose up -d --build`)*

Docker will now download the images, build your frontend and backend, and start all 5 containers (Postgres, Redis, API, Celery, Frontend NGINX).

## Step 7: Access Your App
Once the build completes, open your browser and navigate to:
**`http://YOUR_SERVER_IP`**

Your application will be live!

---

### Optional: Setting up a Custom Domain & HTTPS (SSL)
Right now, the app runs on port 80 (HTTP). For production, you should secure it with HTTPS.

1. Point your domain's A-Record (e.g., `app.yourdomain.com`) to your `YOUR_SERVER_IP`.
2. The easiest way to add SSL is to install **Caddy** on the host server as a reverse proxy in front of Docker:
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update
   sudo apt install caddy
   ```
3. Edit the Caddyfile: `sudo nano /etc/caddy/Caddyfile`
   ```caddyfile
   app.yourdomain.com {
       reverse_proxy localhost:80
   }
   ```
4. Restart Caddy: `sudo systemctl restart caddy`
   *(Caddy will automatically provision a free SSL certificate for you via Let's Encrypt!)*
