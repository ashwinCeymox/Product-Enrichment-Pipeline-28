"""
Credit Service — manages OpenRouter credit state via Redis.

Shared across FastAPI (web) and Celery (worker) processes.
Uses Redis (same instance as Celery broker) for atomic cross-process state.

Two cached numbers:
  actual_remaining_price   — set only by a real OpenRouter /credits call
  expected_remaining_price — derived: actual minus modeled cost of work not yet confirmed

One distributed lock:
  credit_lock — ensures atomic read-modify-write across processes
"""

import os
import time
import redis
import aiohttp
import ssl
import certifi
from app.config_loader import get_dynamic_env
from app.credit_config import (
    PER_IMAGE_COST_USD,
    INITIAL_APPROVAL_THRESHOLD_USD,
    MID_TASK_THRESHOLD_USD,
    DEEPSEEK_COST_PER_URL_USD,
    DEEPSEEK_WARN_THRESHOLD_USD,
    DEEPSEEK_BLOCK_THRESHOLD_USD,
    DEEPSEEK_LIVE_CHECK_INTERVAL,
)

# ── Redis connection (same Redis as Celery broker) ───────────
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
_redis = redis.Redis.from_url(REDIS_URL, decode_responses=True)

# ── Redis key names ──────────────────────────────────────────
KEY_ACTUAL = "credits:actual_remaining"
KEY_EXPECTED = "credits:expected_remaining"
KEY_LAST_REFRESH = "credits:last_refresh"
KEY_LOCK = "credits:lock"
KEY_BOOTSTRAPPED = "credits:bootstrapped"

# Deepseek Redis keys
KEY_DS_CACHED_BALANCE = "credits:deepseek:cached_balance"
KEY_DS_PROCESSED_COUNT = "credits:deepseek:processed_count"


# ── Lock helpers ─────────────────────────────────────────────

def _acquire_lock(timeout=10, lock_ttl=30):
    """Acquire distributed lock via Redis SETNX. Returns True if acquired."""
    end = time.time() + timeout
    while time.time() < end:
        if _redis.set(KEY_LOCK, "1", nx=True, px=lock_ttl * 1000):
            return True
        time.sleep(0.1)
    return False


def _release_lock():
    _redis.delete(KEY_LOCK)


# ── Redis value helpers ──────────────────────────────────────

def _get_float(key, default=None):
    val = _redis.get(key)
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _set_float(key, value):
    _redis.set(key, str(round(value, 6)))


# ── Public getters ───────────────────────────────────────────

def get_actual_remaining():
    """Read actual_remaining_price from Redis cache."""
    return _get_float(KEY_ACTUAL)


def get_expected_remaining():
    """Read expected_remaining_price from Redis cache."""
    return _get_float(KEY_EXPECTED)


def is_bootstrapped():
    """Check if credits have been seeded on startup."""
    return _redis.get(KEY_BOOTSTRAPPED) == "1"


# ── OpenRouter API call ─────────────────────────────────────

async def fetch_openrouter_credits():
    """Real API call to OpenRouter to get remaining credits in USD.
    Reuses the same endpoint as the 'Verify & Check Credits' button
    on the Nano Banana credentials card.
    """
    key = get_dynamic_env("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")

    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    conn = aiohttp.TCPConnector(ssl=ssl_ctx)
    async with aiohttp.ClientSession(connector=conn) as session:
        headers = {"Authorization": f"Bearer {key}"}
        async with session.get(
            "https://openrouter.ai/api/v1/credits", headers=headers
        ) as resp:
            if resp.status != 200:
                raise RuntimeError(
                    f"OpenRouter /credits call failed: HTTP {resp.status}"
                )
            data = await resp.json()
            data_dict = data.get("data", {})
            total_credits = data_dict.get("total_credits", 0)
            total_usage = data_dict.get("total_usage", 0)
            return round(total_credits - total_usage, 6)


def fetch_openrouter_credits_sync():
    """Synchronous wrapper for use in Celery tasks and startup."""
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(
                lambda: asyncio.run(fetch_openrouter_credits())
            ).result(timeout=30)
    else:
        return asyncio.run(fetch_openrouter_credits())


# ── Bootstrap ────────────────────────────────────────────────

def bootstrap_credits():
    """Seed actual_remaining_price on startup.
    Must succeed or fail loudly — no code path should read
    actual_remaining_price while it's still None.
    """
    try:
        actual = fetch_openrouter_credits_sync()
        _set_float(KEY_ACTUAL, actual)
        _set_float(KEY_EXPECTED, actual)
        _redis.set(KEY_LAST_REFRESH, str(time.time()))
        _redis.set(KEY_BOOTSTRAPPED, "1")
        print(f"[credits] Bootstrapped: actual_remaining=${actual:.4f}")
    except Exception as e:
        print(f"[credits] ⚠️ Bootstrap FAILED: {e}")
        print(
            "[credits] Credit checks will fail until OpenRouter credentials "
            "are verified in Settings."
        )
        # Do NOT set bootstrapped flag — approval checks will fail loudly


# ── Refresh ──────────────────────────────────────────────────

async def refresh_actual():
    """Call real /credits API and resync expected_remaining."""
    if not _acquire_lock(timeout=5):
        print("[credits] Could not acquire lock for refresh")
        return
    try:
        actual = await fetch_openrouter_credits()
        _set_float(KEY_ACTUAL, actual)
        _set_float(KEY_EXPECTED, actual)
        _redis.set(KEY_LAST_REFRESH, str(time.time()))
        print(f"[credits] Refreshed: actual_remaining=${actual:.4f}")
    finally:
        _release_lock()


def refresh_actual_sync():
    """Synchronous wrapper for refresh_actual (Celery tasks)."""
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures

        with concurrent.futures.ThreadPoolExecutor() as pool:
            pool.submit(
                lambda: asyncio.run(refresh_actual())
            ).result(timeout=30)
    else:
        asyncio.run(refresh_actual())


# ── Deductions ───────────────────────────────────────────────

def deduct_expected(cost):
    """Atomically deduct cost from expected_remaining.
    Uses Redis INCRBYFLOAT with negative value for atomic operation.
    """
    try:
        new_val = _redis.incrbyfloat(KEY_EXPECTED, -cost)
        return float(new_val)
    except Exception as e:
        print(f"[credits] deduct_expected failed: {e}")
        return get_expected_remaining()


# ── Check functions ──────────────────────────────────────────

def check_initial_approval(total_images):
    """Flow A: Check if credits are sufficient to start a job.

    Returns dict with status: 'ok', 'warn', or 'block'.

    Threshold behavior (confirmed by product owner):
      $5 threshold = WARNING (user can proceed but is alerted)
      $2 threshold = BLOCK  (Insufficient Credits modal, job cannot start)
    """
    actual = get_actual_remaining()
    if actual is None:
        return {
            "status": "block",
            "reason": (
                "Credit balance not available. "
                "Please verify OpenRouter credentials in Settings."
            ),
            "actual_remaining": None,
            "job_cost": 0,
            "total_images": total_images,
        }

    job_cost = total_images * PER_IMAGE_COST_USD
    expected_after = actual - job_cost

    if expected_after < MID_TASK_THRESHOLD_USD:
        return {
            "status": "block",
            "reason": "Insufficient credits to complete this job.",
            "actual_remaining": round(actual, 4),
            "expected_remaining": round(expected_after, 4),
            "job_cost": round(job_cost, 4),
            "total_images": total_images,
            "per_image_cost": PER_IMAGE_COST_USD,
        }
    elif expected_after < INITIAL_APPROVAL_THRESHOLD_USD:
        return {
            "status": "warn",
            "reason": "Credits are running low. Job will proceed but monitor your balance.",
            "actual_remaining": round(actual, 4),
            "expected_remaining": round(expected_after, 4),
            "job_cost": round(job_cost, 4),
            "total_images": total_images,
            "per_image_cost": PER_IMAGE_COST_USD,
        }
    else:
        return {
            "status": "ok",
            "actual_remaining": round(actual, 4),
            "expected_remaining": round(expected_after, 4),
            "job_cost": round(job_cost, 4),
            "total_images": total_images,
            "per_image_cost": PER_IMAGE_COST_USD,
        }


def check_mid_task():
    """Flow B: Check during generation if credits are still sufficient.
    Returns dict with status: 'ok', 'warn', or 'block'.
    """
    expected = get_expected_remaining()
    if expected is None:
        return {"status": "block", "reason": "Credit balance not available."}

    if expected < MID_TASK_THRESHOLD_USD:
        return {
            "status": "block",
            "expected_remaining": round(expected, 4),
            "threshold": MID_TASK_THRESHOLD_USD,
        }
    elif expected < INITIAL_APPROVAL_THRESHOLD_USD:
        return {
            "status": "warn",
            "expected_remaining": round(expected, 4),
            "threshold": INITIAL_APPROVAL_THRESHOLD_USD,
        }
    else:
        return {"status": "ok", "expected_remaining": round(expected, 4)}


def check_variant(count=1):
    """Flow C: Pre-check before generating a variant.
    Check BEFORE calling the generation API — do not generate first.

    NOTE (drift): A user idling on the review screen between variants
    runs on stale expected_remaining_price until they act. The real
    API call on the next spend catches true shortfalls. This is
    accepted risk — do not silently treat it as fully solved.
    """
    expected = get_expected_remaining()
    if expected is None:
        return {"status": "block", "reason": "Credit balance not available."}

    variant_cost = count * PER_IMAGE_COST_USD
    projected = expected - variant_cost

    if projected < MID_TASK_THRESHOLD_USD:
        return {
            "status": "block",
            "reason": "Insufficient credits for variant generation.",
            "expected_remaining": round(expected, 4),
            "variant_cost": round(variant_cost, 4),
            "projected_remaining": round(projected, 4),
        }
    elif projected < INITIAL_APPROVAL_THRESHOLD_USD:
        return {
            "status": "warn",
            "reason": "Credits running low.",
            "expected_remaining": round(expected, 4),
            "variant_cost": round(variant_cost, 4),
            "projected_remaining": round(projected, 4),
        }
    else:
        return {
            "status": "ok",
            "expected_remaining": round(expected, 4),
            "variant_cost": round(variant_cost, 4),
            "projected_remaining": round(projected, 4),
        }


# ── Third-party credit fetchers (for Dashboard) ─────────────

async def fetch_deepseek_credits():
    """Fetch Deepseek balance in USD."""
    key = get_dynamic_env("DEEPSEEK_API_KEY")
    if not key:
        return {"credits": None, "valid": False}
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    conn = aiohttp.TCPConnector(ssl=ssl_ctx)
    async with aiohttp.ClientSession(connector=conn) as session:
        headers = {
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        }
        async with session.get(
            "https://api.deepseek.com/user/balance", headers=headers
        ) as resp:
            if resp.status != 200:
                return {"credits": None, "valid": False}
            data = await resp.json()
            for info in data.get("balance_infos", []):
                if info.get("currency") == "USD":
                    return {"credits": round(float(info.get("total_balance", 0)), 4), "valid": True}
            # If no USD entry, try CNY and convert roughly
            for info in data.get("balance_infos", []):
                if info.get("currency") == "CNY":
                    return {"credits": round(float(info.get("total_balance", 0)) / 7.25, 4), "valid": True}
            return {"credits": None, "valid": True}


async def fetch_serper_credits():
    """Fetch Serper account credits."""
    key = get_dynamic_env("SERPER_API_KEY")
    if not key:
        return {"credits": None, "valid": False}
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    conn = aiohttp.TCPConnector(ssl=ssl_ctx)
    async with aiohttp.ClientSession(connector=conn) as session:
        headers = {"X-API-KEY": key}
        async with session.get(
            "https://google.serper.dev/account", headers=headers
        ) as resp:
            if resp.status != 200:
                return {"credits": None, "valid": False}
            data = await resp.json()
            return {"credits": data.get("credits", None), "valid": True}


# ── Deepseek credit gating ───────────────────────────────────

def _fetch_deepseek_balance_sync():
    """Synchronous fetch of Deepseek balance in USD. Returns float or None."""
    import requests as sync_requests
    key = get_dynamic_env("DEEPSEEK_API_KEY")
    if not key:
        return None
    try:
        resp = sync_requests.get(
            "https://api.deepseek.com/user/balance",
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
            timeout=10,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        for info in data.get("balance_infos", []):
            if info.get("currency") == "USD":
                return round(float(info.get("total_balance", 0)), 4)
        for info in data.get("balance_infos", []):
            if info.get("currency") == "CNY":
                return round(float(info.get("total_balance", 0)) / 7.25, 4)
        return None
    except Exception as e:
        print(f"[credit_service] Deepseek balance fetch error: {e}")
        return None


def check_deepseek_initial(total_urls: int) -> dict:
    """
    Flow A for Deepseek: called at job creation (create_job / upload_csv).
    Fetches live balance and checks against thresholds.
    Returns {"status": "block"|"warn"|"ok", ...}
    """
    balance = _fetch_deepseek_balance_sync()
    if balance is None:
        # Can't determine balance — let it pass but warn
        return {
            "status": "warn",
            "reason": "Could not verify Deepseek balance. Proceeding with caution.",
            "balance": None,
        }

    job_cost = total_urls * DEEPSEEK_COST_PER_URL_USD
    projected = balance - job_cost

    # Cache balance in Redis for workers
    _redis.set(KEY_DS_CACHED_BALANCE, str(balance))
    _redis.set(KEY_DS_PROCESSED_COUNT, "0")

    if balance < DEEPSEEK_BLOCK_THRESHOLD_USD:
        return {
            "status": "block",
            "reason": f"Deepseek balance ${balance:.4f} is below the minimum ${DEEPSEEK_BLOCK_THRESHOLD_USD:.2f} required.",
            "balance": round(balance, 4),
            "job_cost": round(job_cost, 4),
            "projected_remaining": round(projected, 4),
            "block_threshold": DEEPSEEK_BLOCK_THRESHOLD_USD,
        }
    elif balance < DEEPSEEK_WARN_THRESHOLD_USD:
        return {
            "status": "warn",
            "reason": f"Deepseek credits running low (${balance:.4f}). Consider topping up.",
            "balance": round(balance, 4),
            "job_cost": round(job_cost, 4),
            "projected_remaining": round(projected, 4),
            "warn_threshold": DEEPSEEK_WARN_THRESHOLD_USD,
        }
    else:
        return {
            "status": "ok",
            "balance": round(balance, 4),
            "job_cost": round(job_cost, 4),
            "projected_remaining": round(projected, 4),
        }


def deepseek_worker_check() -> dict:
    """
    Flow B for Deepseek: called by the Celery scraper after processing a URL.
    Increments a Redis counter and every DEEPSEEK_LIVE_CHECK_INTERVAL URLs,
    performs a live balance check.
    Returns {"status": "block"|"ok", ...}
    """
    count = _redis.incr(KEY_DS_PROCESSED_COUNT)

    if count % DEEPSEEK_LIVE_CHECK_INTERVAL != 0:
        # Not time for a live check yet — use cached
        cached = _redis.get(KEY_DS_CACHED_BALANCE)
        if cached is not None:
            cached_val = float(cached)
            if cached_val < DEEPSEEK_BLOCK_THRESHOLD_USD:
                return {
                    "status": "block",
                    "reason": f"Deepseek cached balance ${cached_val:.4f} below block threshold.",
                    "balance": cached_val,
                }
        return {"status": "ok"}

    # Time for a live check
    balance = _fetch_deepseek_balance_sync()
    if balance is not None:
        _redis.set(KEY_DS_CACHED_BALANCE, str(balance))
        if balance < DEEPSEEK_BLOCK_THRESHOLD_USD:
            return {
                "status": "block",
                "reason": f"Deepseek balance ${balance:.4f} is below ${DEEPSEEK_BLOCK_THRESHOLD_USD:.2f}. Aborting.",
                "balance": balance,
            }
    return {"status": "ok"}
