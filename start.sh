#!/bin/bash
set -e

echo "============================================="
echo "   Product Enrichment Pipeline Initializer   "
echo "============================================="
echo ""

# ── 1. Find free ports automatically ──
function get_free_port() {
    local port=$1
    # Check if port is in use. If so, increment and try again.
    while nc -z localhost $port >/dev/null 2>&1; do
        port=$((port+1))
    done
    echo $port
}

WEB_PORT=8083
API_PORT=$(get_free_port 8000)
DB_PORT=$(get_free_port 5433)
REDIS_PORT=$(get_free_port 6379)
PGWEB_PORT=$(get_free_port 8081)
STEEL_PORT=$(get_free_port 3000)
STEEL_DEBUG_PORT=$(get_free_port 9223)

echo "[✔] Ports verified:"
echo "    - Frontend Web : $WEB_PORT"
echo "    - Backend API  : $API_PORT"
echo "    - PostgreSQL   : $DB_PORT"
echo "    - Redis        : $REDIS_PORT"
echo "    - PGWeb        : $PGWEB_PORT"
echo "    - Steel API    : $STEEL_PORT"
echo "    - Steel Debug  : $STEEL_DEBUG_PORT"
echo ""

# ── 2. Configure the .env file ──
ENV_FILE="backend/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "[!] No .env file found. Generating a fresh one..."
    
    # Generate a random 32-character secret key
    SECRET_KEY=$(openssl rand -hex 32)
    
    cat <<EOF > $ENV_FILE
# ── Server Port Configuration ──
HOST_WEB_PORT=$WEB_PORT
HOST_API_PORT=$API_PORT
HOST_DB_PORT=$DB_PORT
HOST_REDIS_PORT=$REDIS_PORT
HOST_PGWEB_PORT=$PGWEB_PORT
HOST_STEEL_PORT=$STEEL_PORT
HOST_STEEL_DEBUG_PORT=$STEEL_DEBUG_PORT

# ── Internal Docker Networking ──
DATABASE_URL=postgresql+psycopg2://pgweb:pgweb@postgres:5432/pgweb
REDIS_URL=redis://redis:6379/0
SECRET_KEY=$SECRET_KEY

# ── Settings ──
IMAGE_MODEL=google/gemini-2.5-flash-image
LLM_MODEL=deepseek/deepseek-chat
IMAGE_OUTPUT_DIR=output/images

# ── AI Keys (To be filled in the UI) ──
DEEPSEEK_API_KEY=
SERPER_API_KEY=
OPENROUTER_API_KEY=
EOF
    echo "[✔] Successfully generated backend/.env"
else
    echo "[✔] .env file already exists."
    # Source the existing .env to get the WEB_PORT if it was defined
    source $ENV_FILE
    if [ ! -z "$HOST_WEB_PORT" ]; then
        WEB_PORT=$HOST_WEB_PORT
    fi
fi
echo ""

# ── 3. Start Docker Containers ──
echo "[~] Building and starting Docker containers. This might take a minute..."
docker compose --env-file backend/.env -f docker-compose.yml up --build -d

echo ""
echo "============================================="
echo "  🚀 ALL SYSTEMS ONLINE! 🚀"
echo "============================================="
echo ""
echo "Your application is now running in production mode."
echo ""
echo "👉 Access the UI here: http://localhost:$WEB_PORT"
echo ""
echo "IMPORTANT: Open the UI, click on 'Settings' in the left menu,"
echo "and input your AI API keys to start generating."
echo "============================================="
