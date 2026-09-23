#!/bin/sh

# Move to the project root (parent of install/)
cd "$(dirname "$0")/.."

# Create backend/.env if it doesn't exist
if [ ! -f backend/.env ]; then
cat > backend/.env <<EOF
# ── OpenRouter (Image Generation via Gemini 2.5 Flash Image) ──
OPENROUTER_API_KEY=
IMAGE_MODEL=google/gemini-2.5-flash-image

# ── LLM for prompt generation (via litellm → DeepSeek direct) ──
DEEPSEEK_API_KEY=
LLM_MODEL=deepseek/deepseek-chat

# ── Output ──
IMAGE_OUTPUT_DIR=output/images
EOF

echo "Created backend/.env"
fi

docker compose -f docker-compose.celery.yml up --build -d
