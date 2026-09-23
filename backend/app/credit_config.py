"""
Credit-check configuration — single source of truth.
All credit comparisons and UI-facing numbers must read from here.
"""

# Cost per image generation via OpenRouter (Nano Banana / Gemini Flash)
# Pull from OpenRouter's real per-model pricing if/when available;
# this is the fallback constant.
PER_IMAGE_COST_USD = 0.0389

# Threshold at initial JSON approval — if remaining credits AFTER
# deducting job cost fall below this, show a WARNING to the user.
INITIAL_APPROVAL_THRESHOLD_USD = 5

# Threshold during generation / variant requests — if remaining credits
# fall below this, BLOCK and show "Insufficient Credits" modal.
MID_TASK_THRESHOLD_USD = 2

# All comparisons happen in USD, matching OpenRouter's /credits response.
CURRENCY_FOR_LOGIC = "USD"

# How often to resync with real /credits API during generation.
# 1 = after every image (safest). Increase if rate-limited.
CREDITS_RESYNC_INTERVAL = 1

# ── Deepseek (LLM) thresholds ───────────────────────────────
# Estimated cost per URL for scraping + LLM extraction.
DEEPSEEK_COST_PER_URL_USD = 0.0004

# If Deepseek balance drops below this at job creation, show a WARNING.
DEEPSEEK_WARN_THRESHOLD_USD = 2.0

# If Deepseek balance drops below this, BLOCK the job entirely.
DEEPSEEK_BLOCK_THRESHOLD_USD = 0.7

# During Celery processing, re-check Deepseek balance every N URLs.
DEEPSEEK_LIVE_CHECK_INTERVAL = 17

# TODO: Per-image cost source — currently a flat constant.
# If different jobs use different image models/resolutions later,
# this should become a lookup instead of a constant.
