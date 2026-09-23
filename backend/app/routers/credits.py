"""
Credits API router — exposes credit status, refresh, and per-provider balances.
"""

from fastapi import APIRouter, Depends
from app.dependencies import require_superadmin
from app.services import credit_service
from app.credit_config import (
    PER_IMAGE_COST_USD,
    INITIAL_APPROVAL_THRESHOLD_USD,
    MID_TASK_THRESHOLD_USD,
)

router = APIRouter(
    prefix="/credits",
    tags=["Credits"],
    dependencies=[Depends(require_superadmin)],
)


@router.get("/status", summary="Get current credit status")
async def get_credit_status():
    """Returns cached credit state for the REMAINING CREDITS badge."""
    actual = credit_service.get_actual_remaining()
    expected = credit_service.get_expected_remaining()
    return {
        "actual_remaining": round(actual, 4) if actual is not None else None,
        "expected_remaining": round(expected, 4) if expected is not None else None,
        "per_image_cost": PER_IMAGE_COST_USD,
        "initial_threshold": INITIAL_APPROVAL_THRESHOLD_USD,
        "mid_task_threshold": MID_TASK_THRESHOLD_USD,
        "bootstrapped": credit_service.is_bootstrapped(),
    }


@router.post("/refresh", summary="Force refresh credits from OpenRouter")
async def refresh_credits():
    """Forces a real /credits API call to refresh the cached balance."""
    await credit_service.refresh_actual()
    actual = credit_service.get_actual_remaining()
    return {
        "status": "success",
        "actual_remaining": round(actual, 4) if actual is not None else None,
    }


@router.get("/all-providers", summary="Get credits for all AI providers")
async def get_all_provider_credits():
    """Dashboard: returns credits for Nano Banana, Deepseek, and Serper."""
    from app.config_loader import get_dynamic_env
    
    # Nano Banana (OpenRouter) — use cached value only if key exists
    if get_dynamic_env("OPENROUTER_API_KEY"):
        openrouter_credits = credit_service.get_actual_remaining()
    else:
        openrouter_credits = None

    # Serper — real API call
    serper_credits = await credit_service.fetch_serper_credits()

    return {
        "openrouter": {
            "credits": round(openrouter_credits, 4)
            if openrouter_credits is not None
            else None,
            "currency": "USD",
            "insufficient": openrouter_credits is not None
            and openrouter_credits < INITIAL_APPROVAL_THRESHOLD_USD,
            "valid": bool(get_dynamic_env("OPENROUTER_API_KEY")),
        },
        "serper": {
            "credits": serper_credits.get("credits"),
            "valid": serper_credits.get("valid", False),
            "currency": "credits",
        },
    }
