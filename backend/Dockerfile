FROM python:3.11-slim

WORKDIR /app

# --- Node.js (for running the Steel MCP server as a subprocess) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- Clone + build steel-mcp-server (no npm package exists, must build from source) ---
RUN git clone --depth 1 https://github.com/steel-dev/steel-mcp-server.git /opt/steel-mcp-server \
    && cd /opt/steel-mcp-server \
    && npm install \
    && npm run build

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create .env from .env.example if .env is missing or empty
RUN if [ ! -f .env ] || [ ! -s .env ]; then \
        cp .env.example .env; \
    fi

# Set Python path
ENV PYTHONPATH=/app