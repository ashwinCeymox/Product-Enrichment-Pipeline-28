# src/tools/img_prompt.py
"""
Image Prompt Agent
Receives the final product JSON (ProductOutput schema) and generates:
  1. Lifestyle prompts  — person using the product (3 angles)
  2. Feature prompts    — one per key_feature entry

Input:  ProductOutput dict (the exact schema from main.py output)
Output: { "lifestyle": [...], "features": [...] }
        ready to pass directly to image_generator.py
"""

import json
import os
from litellm import acompletion
from app.config_loader import get_dynamic_env

LLM_MODEL = get_dynamic_env("SCRAPING_MODEL", "deepseek/deepseek-chat")
LIFESTYLE_IMAGE_COUNT = int(os.getenv("LIFESTYLE_IMAGE_COUNT", "3"))


# ─────────────────────────────────────────────────────────────
# Schema field extractors
# Pull exactly the fields needed from ProductOutput dict
# ─────────────────────────────────────────────────────────────

def extract_image_inputs(product: dict) -> dict:
    identity = product.get("product_identity", {})

    # ── read from updated images structure ────────────────────
    images_block  = product.get("images", {})
    if isinstance(images_block, dict):
        scraped_images = images_block.get("scraped_images", [])
    elif isinstance(images_block, list):
        scraped_images = images_block
    else:
        scraped_images = []
        
    # Normalize: if it's a list of strings, convert to dict format
    normalized_scraped = []
    for item in scraped_images:
        if isinstance(item, str):
            normalized_scraped.append({"url": item})
        elif isinstance(item, dict):
            # Normalize 'media' key to 'url' for consistency
            if "url" not in item and "media" in item:
                item = {**item, "url": item["media"]}
            normalized_scraped.append(item)
    scraped_images = normalized_scraped

    return {
        "brand":        identity.get("brand", ""),
        "product_name": identity.get("product_name", ""),
        "category":     identity.get("product_category", ""),
        "long_description": product.get("long_description", ""),
        "key_features": product.get("Product Highlights", product.get("key_features", [])),

        # reference image url — first valid scraped image, skipping logos
        "hero_image_url": next((
            (img.get("url") or img.get("src") or img.get("link") or "") if isinstance(img, dict) else str(img)
            for img in scraped_images
            if not any(bad in (img.get("url", "") if isinstance(img, dict) else str(img)).lower() for bad in ["logo", "icon", "tabby"])
        ), "") if scraped_images else "",
    }


# ─────────────────────────────────────────────────────────────
# Environment Detection
# Uses category + product_name from schema
# ─────────────────────────────────────────────────────────────

OUTDOOR_KEYWORDS = [
    "pickleball", "paddle", "tennis racket", "golf club", "outdoor bike",
    "surfboard", "skateboard", "badminton", "squash racket", "cricket bat",
    "baseball bat", "soccer ball", "football", "basketball"
]

INDOOR_KEYWORDS = [
    "treadmill", "rowing machine", "stationary bike", "weight bench",
    "dumbbell", "barbell", "resistance band", "yoga mat", "gym machine",
    "table tennis", "boxing bag", "elliptical", "spin bike",
    "exercise bike", "indoor cycle", "power rack", "smith machine"
]

BOTH_KEYWORDS = [
    "running shoe", "jump rope", "kettlebell", "water bottle",
    "sports apparel", "sports bag", "fitness tracker", "sports eyewear",
    "court shoe", "training shoe"
]

LARGE_KEYWORDS = [
    "treadmill", "elliptical", "exercise bike", "stationary bike",
    "rowing machine", "weight bench", "power rack", "smith machine",
    "table tennis table", "gym machine", "trampoline"
]

MEDIUM_KEYWORDS = [
    "paddle", "racket", "racquet", "dumbbell", "kettlebell",
    "yoga mat", "boxing glove", "bat", "sports bag"
]

SMALL_KEYWORDS = [
    "water bottle", "resistance band", "jump rope", "fitness tracker",
    "sports eyewear", "wristband", "grip tape", "ball", "shuttlecock"
]


def _detect_environment(category: str, product_name: str) -> str:
    text = f"{category} {product_name}".lower()
    for kw in OUTDOOR_KEYWORDS:
        if kw in text:
            return "OUTDOOR"
    for kw in INDOOR_KEYWORDS:
        if kw in text:
            return "INDOOR"
    for kw in BOTH_KEYWORDS:
        if kw in text:
            return "BOTH"
    return "INDOOR"


def _detect_product_size(category: str, product_name: str) -> str:
    text = f"{category} {product_name}".lower()
    for kw in LARGE_KEYWORDS:
        if kw in text:
            return "LARGE"
    for kw in MEDIUM_KEYWORDS:
        if kw in text:
            return "MEDIUM"
    for kw in SMALL_KEYWORDS:
        if kw in text:
            return "SMALL"
    return "MEDIUM"


# ─────────────────────────────────────────────────────────────
# Viewing Angle Strategies
# ─────────────────────────────────────────────────────────────

ANGLE_STRATEGIES = [
    {
        "name": "wide_action",
        "instruction": (
            "Wide shot showing the full body of a person actively using the product. "
            "Camera at a 3/4 angle, capturing the environment and person mid-action. "
            "Dynamic pose, aspirational feel. Product clearly visible."
        ),
    },
    {
        "name": "medium_side",
        "instruction": (
            "Medium shot from a side angle, waist-up view of a person using the product. "
            "Focus split between the person's engagement and the product. "
            "Shallow depth of field with background slightly blurred."
        ),
    },
    {
        "name": "close_detail",
        "instruction": (
            "Close-up action detail shot focusing on the moment of product interaction. "
            "Tight crop on hands, contact point, or the product in active use. "
            "Cinematic depth of field, frozen action moment."
        ),
    },
]


# ─────────────────────────────────────────────────────────────
# System Prompts
# ─────────────────────────────────────────────────────────────

LIFESTYLE_SYSTEM_PROMPT = """You are an expert visual marketing prompt engineer for sports and fitness products.

Your job: generate ONE detailed photorealistic lifestyle image prompt.

RULES:
1. Respond ONLY with valid JSON: {"PROMPT": "your prompt here"}
2. DO NOT wrap your response in markdown code fences (like ```json). Just start with { and end with }.
3. Inside the prompt — single quotes only, no double quotes, no backslashes, no line breaks.
4. One continuous sentence.
4. NEVER describe product appearance — the reference image handles that.
5. Focus ONLY on: scene, environment, person action, camera angle, lighting, mood.
6. Person must be NATURALLY using the product, not posing.
7. Match framing to product size — small items need close framing, large equipment needs wide.
8. On failure return: {"PROMPT": "GENERATION FAILED"}
9. NO text outside the JSON."""

FEATURE_SYSTEM_PROMPT = """You are an expert visual marketing prompt engineer for sports and fitness products.

Your job: generate ONE detailed photorealistic feature-highlight image prompt.

RULES:
1. Respond ONLY with valid JSON: {"PROMPT": "your prompt here"}
2. DO NOT wrap your response in markdown code fences (like ```json). Just start with { and end with }.
3. Inside the prompt — single quotes only, no double quotes, no backslashes, no line breaks.
4. One continuous sentence.
4. NEVER describe product appearance — the reference image handles that.
5. Visually DEMONSTRATE the feature benefit in a real-world context.
6. Style: high-end marketing photography, warm lighting, lifestyle-meets-feature.
7. On failure return: {"PROMPT": "GENERATION FAILED"}
8. NO text outside the JSON."""


# ─────────────────────────────────────────────────────────────
# Public API — takes ProductOutput dict directly
# ─────────────────────────────────────────────────────────────

async def generate_all_prompts(product: dict) -> dict:
    """
    Main entry point.
    Takes the full ProductOutput dict from main.py
    and returns all image prompts ready for image_generator.py.

    Args:
        product: The complete ProductOutput dict
                 (exact output of main.py / runner.py agent step)

    Returns:
        {
            "lifestyle": ["prompt string 1", "prompt string 2", "prompt string 3"],
            "features": [
                {"title": "Edgeless Design", "description": "...", "prompt": "..."},
                {"title": "Carbon Abrasion Surface", "description": "...", "prompt": "..."},
                ...
            ],
            "meta": {
                "product_name": "JOOLA Tyson McGuffin Magnus CAS 14mm",
                "category": "Pickleball Paddle",
                "environment": "OUTDOOR",
                "product_size": "MEDIUM",
                "lifestyle_count": 3,
                "feature_count": 6,
            }
        }
    """

    # ── Extract fields from schema ───────────────────────────
    inputs = extract_image_inputs(product)

    brand        = inputs["brand"]
    product_name = inputs["product_name"]
    category     = inputs["category"]
    description  = inputs["long_description"]
    key_features = inputs["key_features"]

    # ── Detect context from category + product_name ──────────
    environment  = _detect_environment(category, product_name)
    product_size = _detect_product_size(category, product_name)

    print(f"\n[image_prompts] product   : {product_name}")
    print(f"[image_prompts] category  : {category}")
    print(f"[image_prompts] environment: {environment}")
    print(f"[image_prompts] size       : {product_size}")
    print(f"[image_prompts] features   : {len(key_features)}")

    # ── Generate lifestyle prompts ───────────────────────────
    lifestyle = await _create_lifestyle_prompts(
        brand=brand,
        product_name=product_name,
        category=category,
        description=description,
        environment=environment,
        product_size=product_size,
        count=LIFESTYLE_IMAGE_COUNT
    )

    # ── Generate feature prompts ─────────────────────────────
    features = await _create_feature_prompts(
        key_features=key_features,
        category=category,
        brand=brand,
    )

    return {
        "lifestyle": lifestyle,
        "features":  features,
        "meta": {
            "product_name":    product_name,
            "category":        category,
            "environment":     environment,
            "product_size":    product_size,
            "lifestyle_count": len(lifestyle),
            "feature_count":   len(features),
        }
    }


# ─────────────────────────────────────────────────────────────
# Internal: lifestyle prompt generation
# ─────────────────────────────────────────────────────────────

async def _create_lifestyle_prompts(
    brand: str,
    product_name: str,
    category: str,
    description: str,
    environment: str,
    product_size: str,
    count: int = 3,
) -> list[str]:

    env_map = {
        "OUTDOOR": "outdoor setting appropriate for the sport (court, field, park, trail)",
        "INDOOR":  "modern indoor setting (home gym, fitness studio, gym floor)",
        "BOTH":    "versatile setting that works indoor or outdoor for natural use",
    }
    size_map = {
        "SMALL":  "The product is small and handheld — ensure it is clearly visible in the person's hand at close range.",
        "MEDIUM": "The product is medium-sized — show the person gripping, wearing, or actively swinging/using it.",
        "LARGE":  "The product is large equipment — person should be standing on, sitting in, or operating the full machine.",
    }

    prompts = []

    for i in range(count):
        angle = ANGLE_STRATEGIES[i % len(ANGLE_STRATEGIES)]

        user_message = (
            f"brand: {brand}\n"
            f"product_name: {product_name}\n"
            f"product_category: {category}\n"
            f"long_description: {description}\n"
            f"environment: {environment} — {env_map.get(environment, '')}\n"
            f"product_size: {product_size} — {size_map.get(product_size, '')}\n"
            f"viewing_angle: {angle['name']} — {angle['instruction']}\n\n"
            f"Generate a photorealistic lifestyle image prompt showing a real person "
            f"actively using this product. Do NOT describe product appearance."
        )

        print(f"  [image_prompts] lifestyle {i+1}/{count} ({angle['name']})...")

        try:
            response = await acompletion(
                model=f"openrouter/{get_dynamic_env('SCRAPING_MODEL', 'deepseek/deepseek-chat')}",
                messages=[
                    {"role": "system", "content": LIFESTYLE_SYSTEM_PROMPT},
                    {"role": "user",   "content": user_message},
                ],
                temperature=0.8,
                max_tokens=2000,
                api_key=get_dynamic_env("OPENROUTER_API_KEY"),
            )
            prompt = _parse_prompt(response.choices[0].message.content)
            if prompt:
                prompts.append(prompt)
                print(f"  [image_prompts] ✓ lifestyle {i+1}: {prompt[:80]}...")
            else:
                print(f"  [image_prompts] ✗ lifestyle {i+1}: parse failed")

        except Exception as e:
            print(f"  [image_prompts] ✗ lifestyle {i+1} error: {e}")

    return prompts


# ─────────────────────────────────────────────────────────────
# Internal: feature prompt generation
# Reads directly from key_features[] in schema
# Each item: {"title": "...", "description": "..."}
# ─────────────────────────────────────────────────────────────

async def _create_feature_prompts(
    key_features: list[dict],
    category: str,
    brand: str,
) -> list[dict]:
    """
    key_features comes directly from product["key_features"]
    Each dict has "title" and "description" — matching the schema exactly.
    """
    results = []

    for i, feature in enumerate(key_features):
        # read directly from schema field names
        title = feature.get("title", f"Feature {i+1}")
        desc  = feature.get("description", "")

        if not desc:
            print(f"  [image_prompts] ✗ feature '{title}': no description — skipping")
            continue

        user_message = (
            f"brand: {brand}\n"
            f"product_category: {category}\n"
            f"feature_title: {title}\n"
            f"feature_description: {desc}\n\n"
            f"Generate a photorealistic feature-highlight image prompt that visually "
            f"demonstrates '{title}'. Show the product in context where this feature's "
            f"benefit is obvious. Do NOT describe product appearance."
        )

        print(f"  [image_prompts] feature {i+1}/{len(key_features)}: {title}...")

        try:
            response = await acompletion(
                model=f"openrouter/{get_dynamic_env('SCRAPING_MODEL', 'deepseek/deepseek-chat')}",
                messages=[
                    {"role": "system", "content": FEATURE_SYSTEM_PROMPT},
                    {"role": "user",   "content": user_message},
                ],
                temperature=0.7,
                max_tokens=2000,
                api_key=get_dynamic_env("OPENROUTER_API_KEY"),
            )
            prompt = _parse_prompt(response.choices[0].message.content)
            if prompt:
                results.append({
                    "title":       title,        # from schema
                    "description": desc,         # from schema
                    "prompt":      prompt,       # generated
                })
                print(f"  [image_prompts] ✓ {title}: {prompt[:80]}...")
            else:
                print(f"  [image_prompts] ✗ {title}: parse failed")

        except Exception as e:
            print(f"  [image_prompts] ✗ {title} error: {e}")

    return results


# ─────────────────────────────────────────────────────────────
# Internal: parse LLM response → extract PROMPT string
# ─────────────────────────────────────────────────────────────

def _parse_prompt(raw: str) -> str:
    if not raw:
        print("    [parse] empty raw response")
        return ""

    import re
    text = raw.strip()
    # DEBUG: show first 300 chars of raw LLM output
    print(f"    [parse] raw ({len(text)} chars): {text[:300]}")

    # strip <think>...</think> blocks (DeepSeek reasoning)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()

    # strip ```json ... ``` fences if present
    if '```' in text:
        fence_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1).strip()

    # ── Strategy 1: Try standard JSON parse ──────────────────
    try:
        parsed = json.loads(text)
        value = parsed.get("PROMPT", "")
        if value and value != "GENERATION FAILED":
            return value
    except json.JSONDecodeError:
        pass

    # ── Strategy 2: DeepSeek uses single quotes — extract with regex ──
    # Match: "PROMPT": 'some text here'  or  "PROMPT": "some text here"
    sq_match = re.search(r'"PROMPT"\s*:\s*\'((?:[^\'\\]|\\.)*)\'', text)
    if sq_match:
        value = sq_match.group(1)
        if value and value != "GENERATION FAILED":
            return value

    # ── Strategy 3: Double-quoted value extraction ───────────
    dq_match = re.search(r'"PROMPT"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    if dq_match:
        value = dq_match.group(1)
        if value and value != "GENERATION FAILED":
            return value

    # ── Strategy 4: Replace single quotes with double quotes and retry ──
    try:
        fixed = re.sub(r"'([^']*)'", r'"\1"', text)
        parsed = json.loads(fixed)
        value = parsed.get("PROMPT", "")
        if value and value != "GENERATION FAILED":
            return value
    except json.JSONDecodeError:
        pass

    print("    [parse] could not extract PROMPT from response")
    return ""
