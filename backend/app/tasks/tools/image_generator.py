# src/tools/image_generator.py
"""
Image Generator — OpenRouter API (Gemini 2.5 Flash Image / Nano Banana)

Calls OpenRouter /chat/completions with modalities: ["image", "text"]
to generate images from a text prompt + optional reference product image.

Input:  lifestyle_prompts  — list of prompt strings
        feature_prompts    — list of dicts {title, description, prompt}
        product_sku        — used as folder name
        reference_image_paths — optional list of local product image paths

Output: {
    "folder":    "output/images/JOOLA-MAGNUS/",
    "lifestyle": [{"path": ..., "alt": ..., "type": "marketing"}],
    "features":  [{"path": ..., "title": ..., "description": ...,
                   "alt": ..., "type": "marketing"}],
    "total_generated": 9,
    "total_failed":    0,
}
"""

import os
import base64
import asyncio
import json
import re
import ssl
import aiohttp
import certifi
from app.config_loader import get_dynamic_env

IMAGE_MODEL = os.getenv("IMAGE_MODEL", "google/gemini-2.5-flash-image")
IMAGE_OUTPUT_DIR = os.getenv("IMAGE_OUTPUT_DIR", "output/images")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"



# ─────────────────────────────────────────────────────────────
# Core: single image generation call via OpenRouter
# ─────────────────────────────────────────────────────────────

class ImageGenerationError(Exception):
    pass

async def _generate_single_image(
    prompt: str,
    reference_image_paths: list[str] | None,
    save_path: str,
) -> tuple[str, float]:
    """
    Calls OpenRouter chat completions for one image prompt.
    Uses modalities: ["image", "text"] to enable Gemini image output.

    Sends reference images as base64 data URIs in image_url format.
    Saves the returned image to save_path.
    Raises ImageGenerationError on failure.
    """

    openrouter_api_key = get_dynamic_env("OPENROUTER_API_KEY")
    if not openrouter_api_key:
        raise ImageGenerationError("OPENROUTER_API_KEY not configured")

    # ── Build message content ────────────────────────────────
    content = []

    # attach reference images as base64 data URIs
    if reference_image_paths:
        for ref_path in reference_image_paths:
            if os.path.exists(ref_path):
                with open(ref_path, "rb") as f:
                    image_b64 = base64.b64encode(f.read()).decode("utf-8")

                ext = os.path.splitext(ref_path)[1].lower()
                mime_map = {
                    ".jpg":  "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".png":  "image/png",
                    ".webp": "image/webp",
                }
                mime_type = mime_map.get(ext, "image/jpeg")

                # OpenRouter expects image_url with data URI for inline images
                data_uri = f"data:{mime_type};base64,{image_b64}"
                content.append({
                    "type": "image_url",
                    "image_url": {"url": data_uri},
                })
                print(f"    [image_gen] reference: {os.path.basename(ref_path)}")

    # always add the text prompt — enforce 1:1 square aspect ratio
    square_instruction = " Output a square image with a 1:1 aspect ratio."
    content.append({"type": "text", "text": prompt + square_instruction})

    # ── Build OpenRouter chat completions payload ────────────
    payload = {
        "model": get_dynamic_env("IMAGE_GENERATION_MODEL", "google/gemini-2.5-flash-image"),
        "modalities": ["image", "text"],   # ← CRITICAL for image generation
        "messages": [
            {"role": "user", "content": content}
        ],
    }

    headers = {
        "Authorization": f"Bearer {openrouter_api_key}",
        "Content-Type":  "application/json",
    }

    # ── Call the API ─────────────────────────────────────────
    max_retries = 3
    api_response = None
    last_error = None
    
    for attempt in range(max_retries):
        try:
            ssl_ctx = ssl.create_default_context(cafile=certifi.where())
            # Use force_close to prevent reusing dead connections that cause [Errno 32] Broken pipe
            conn = aiohttp.TCPConnector(ssl=ssl_ctx, force_close=True)
            async with aiohttp.ClientSession(connector=conn) as session:
                async with session.post(
                    OPENROUTER_URL,
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=120),
                ) as resp:
                    if resp.status != 200:
                        body = await resp.text()
                        if resp.status == 429:
                            raise ImageGenerationError("Rate limit exceeded (429). Please try again later.")
                        raise ImageGenerationError(f"API error {resp.status}: {body[:200]}")

                    api_response = await resp.json()
                    break # Success!
        except aiohttp.ClientError as e:
            last_error = e
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)
                continue
            raise ImageGenerationError(f"Network error connecting to image API: {e}")
        except asyncio.TimeoutError:
            raise ImageGenerationError("Image API request timed out (120s)")
    
    # ── Check for API-level errors ───────────────────────────
    if "error" in api_response:
        err = api_response["error"]
        msg = err.get("message", json.dumps(err)) if isinstance(err, dict) else str(err)
        raise ImageGenerationError(f"Image API returned error: {msg}")

    # ── Extract image from response ──────────────────────────
    image_b64_data = _extract_image_from_response(api_response)

    if not image_b64_data:
        raise ImageGenerationError("No valid image data extracted from API response")

    # ── Save to disk ─────────────────────────────────────────
    os.makedirs(os.path.dirname(save_path), exist_ok=True)

    try:
        image_bytes = base64.b64decode(image_b64_data)
    except Exception as e:
        raise ImageGenerationError(f"Failed to decode base64 image data: {e}")

    with open(save_path, "wb") as f:
        f.write(image_bytes)

    size_kb = len(image_bytes) // 1024
    
    # ── Extract Cost ─────────────────────────────────────────
    usage = api_response.get("usage", {})
    cost = usage.get("cost") or usage.get("total_cost") or api_response.get("cost") or api_response.get("total_cost") or 0.0

    print(f"    [image_gen] saved: {save_path} ({size_kb} KB) | cost: ${cost:.6f}")
    return save_path, float(cost)


# ─────────────────────────────────────────────────────────────
# Response parser — handles ALL known OpenRouter/Gemini formats
# ─────────────────────────────────────────────────────────────

def _extract_image_from_response(api_response: dict) -> str | None:
    """
    Extract base64 image data from OpenRouter chat completions response.

    Handles:
      Format 1: image_url  → { type: "image_url", image_url: { url: "data:..." } }
      Format 2: image+url  → { type: "image", url: "data:..." }
      Format 3: image+image→ { type: "image", image: { url: "data:..." } }
      Format 4: inline_data→ { type: "inline_data", inline_data: { mime_type, data } }
      Format 5: inline alt → { inline_data: { data } }  (no type field)
      Format 6: anthropic  → { type: "image", source: { data } }
      Format 7: b64_json   → { b64_json: "..." }
      Format 8: text w/ URI→ data:image/...;base64,... embedded in text string

    Returns base64 string or None.
    """
    choices = api_response.get("choices", [])

    for choice in choices:
        msg = choice.get("message", {})
        msg_content = msg.get("content")

        # ── Format 9: OpenRouter images[] array on message ────
        # { message: { content: null, images: [{ type: "image_url", image_url: { url: "data:..." } }] } }
        msg_images = msg.get("images", [])
        if isinstance(msg_images, list):
            for img in msg_images:
                img_type = img.get("type", "")
                if img_type == "image_url" and "image_url" in img:
                    url = img["image_url"].get("url", "")
                    if url.startswith("data:"):
                        b64 = _data_uri_to_b64(url)
                        if b64:
                            return b64
                elif "url" in img:
                    url = img["url"]
                    if isinstance(url, str) and url.startswith("data:"):
                        b64 = _data_uri_to_b64(url)
                        if b64:
                            return b64

        # ── content is a plain string ────────────────────────
        if isinstance(msg_content, str):
            # look for inline data URIs in the text
            match = re.search(
                r"data:image/[a-zA-Z]+;base64,([A-Za-z0-9+/=]+)",
                msg_content,
            )
            if match:
                return match.group(1)

        # ── content is a list of parts ───────────────────────
        elif isinstance(msg_content, list):
            for part in msg_content:
                ptype = part.get("type", "")

                # Format 1: OpenAI style — image_url with data URI
                if ptype == "image_url" and "image_url" in part:
                    url = part["image_url"].get("url", "")
                    if url.startswith("data:"):
                        b64 = _data_uri_to_b64(url)
                        if b64:
                            return b64

                # Format 2: { type: "image", url: "data:..." }
                elif ptype == "image" and "url" in part:
                    url = part["url"]
                    if url.startswith("data:"):
                        b64 = _data_uri_to_b64(url)
                        if b64:
                            return b64

                # Format 3: { type: "image", image: { url: "data:..." } }
                elif ptype == "image" and "image" in part:
                    url = part["image"].get("url", "")
                    if url.startswith("data:"):
                        b64 = _data_uri_to_b64(url)
                        if b64:
                            return b64

                # Format 4: Gemini native — inline_data
                elif ptype == "inline_data" and "inline_data" in part:
                    data = part["inline_data"].get("data", "")
                    if data:
                        return data

                # Format 5: Gemini alt — inline_data without type field
                elif "inline_data" in part and "data" in part.get("inline_data", {}):
                    data = part["inline_data"]["data"]
                    if data:
                        return data

                # Format 6: Anthropic style — source.data
                elif ptype == "image" and "source" in part:
                    data = part["source"].get("data", "")
                    if data:
                        return data

                # Format 7: b64_json
                elif "b64_json" in part:
                    data = part["b64_json"]
                    if data:
                        return data

    return None


def _data_uri_to_b64(data_uri: str) -> str | None:
    """Extract raw base64 data from a data URI string."""
    match = re.match(r"data:image/[a-zA-Z]+;base64,(.+)", data_uri)
    return match.group(1) if match else None


# ─────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────

async def generate_product_images(
    lifestyle_prompts: list[str],
    feature_prompts:   list[dict],
    product_sku:       str,
    reference_image_paths: list[str] | None = None,
    check_cancel_cb=None,
    on_image_attempt_cb=None,
    on_image_generated_cb=None,
    on_image_failed_cb=None,
    should_skip_cb=None,
    on_image_cost_cb=None,
) -> dict:
    """
    Generates all lifestyle + feature images for one product.

    Args:
        lifestyle_prompts:    list of prompt strings from img_prompt.py
        feature_prompts:      list of dicts — each has:
                                "title"       from key_features[i]["title"]
                                "description" from key_features[i]["description"]
                                "prompt"      generated by LLM
        product_sku:          folder name for this product's images
        reference_image_paths: optional list of paths to local product reference images

    Returns:
        {
            "folder":    "output/images/JOOLA-MAGNUS/",
            "lifestyle": [ {"path": ..., "alt": ..., "type": "marketing"} ],
            "features":  [ {"path": ..., "title": ..., "description": ...,
                            "alt": ..., "type": "marketing"} ],
            "total_generated": int,
            "total_failed":    int,
        }
    """

    safe_sku = _safe_folder_name(product_sku)
    folder   = os.path.join(IMAGE_OUTPUT_DIR, safe_sku)
    os.makedirs(folder, exist_ok=True)

    print(f"\n[image_gen] model    : {get_dynamic_env('IMAGE_GENERATION_MODEL', 'google/gemini-2.5-flash-image')}")
    print(f"[image_gen] folder   : {folder}")
    print(f"[image_gen] lifestyle: {len(lifestyle_prompts)} prompts")
    print(f"[image_gen] features : {len(feature_prompts)} prompts")
    if reference_image_paths:
        print(f"[image_gen] reference: {len(reference_image_paths)} image(s)")
    else:
        print(f"[image_gen] reference: NONE (text-only prompts)")

    lifestyle_results = []
    feature_results   = []
    failed            = 0

    # ── Lifestyle images ─────────────────────────────────────
    for i, prompt in enumerate(lifestyle_prompts):
        if check_cancel_cb and check_cancel_cb():
            print("[image_gen] 🛑 Cancellation requested during lifestyle images")
            break

        if should_skip_cb and should_skip_cb("lifestyle", i):
            print(f"  [image_gen] ⏭️ Skipping lifestyle {i+1} (already exists)")
            continue

        save_path = os.path.join(folder, f"lifestyle_{i+1}.png")

        print(f"\n  [image_gen] lifestyle {i+1}/{len(lifestyle_prompts)}")
        print(f"    prompt: {prompt[:100]}...")

        try:
            if on_image_attempt_cb:
                on_image_attempt_cb("lifestyle", i, prompt)
                
            result = await _generate_single_image(
                prompt=prompt,
                reference_image_paths=reference_image_paths,
                save_path=save_path,
            )
        except Exception as e:
            error_msg = str(e)
            print(f"  [image_gen] ✗ lifestyle {i+1} failed: {error_msg}")
            if on_image_failed_cb:
                on_image_failed_cb("lifestyle", i, error_msg)
            # Re-raise ALL exceptions so the pipeline-level handler can classify as recoverable or permanent
            raise ImageGenerationError(error_msg)

        if result:
            final_path, cost = result
            img_data = {
                "path": final_path,
                "alt":  f"Lifestyle image {i+1}",
                "type": "marketing",
                "cost": cost,
            }
            lifestyle_results.append(img_data)
            if on_image_generated_cb:
                on_image_generated_cb("lifestyle", i, prompt, img_data)
            if on_image_cost_cb:
                on_image_cost_cb(cost)
        else:
            failed += 1
            print(f"  [image_gen] ✗ lifestyle {i+1} failed")

        # rate limit pause between calls
        await asyncio.sleep(2.0)

    # ── Feature images ───────────────────────────────────────
    for i, feat in enumerate(feature_prompts):
        if check_cancel_cb and check_cancel_cb():
            print("[image_gen] 🛑 Cancellation requested during feature images")
            break

        if should_skip_cb and should_skip_cb("feature", i):
            print(f"  [image_gen] ⏭️ Skipping feature {i+1} (already exists)")
            continue

        title       = feat.get("title", f"feature_{i+1}")
        prompt      = feat.get("prompt", "")
        safe_title  = _safe_folder_name(title)
        save_path   = os.path.join(folder, f"feature_{i+1}_{safe_title}.png")

        print(f"\n  [image_gen] feature {i+1}/{len(feature_prompts)}: {title}")
        print(f"    prompt: {prompt[:100]}...")

        try:
            if on_image_attempt_cb:
                on_image_attempt_cb("feature", i, prompt, title=title)
                
            result = await _generate_single_image(
                prompt=prompt,
                reference_image_paths=reference_image_paths,
                save_path=save_path,
            )
        except Exception as e:
            error_msg = str(e)
            print(f"  [image_gen] ✗ feature '{title}' failed: {error_msg}")
            if on_image_failed_cb:
                on_image_failed_cb("feature", i, error_msg, title=title)
            # Re-raise ALL exceptions so the pipeline-level handler can classify as recoverable or permanent
            raise ImageGenerationError(error_msg)

        if result:
            final_path, cost = result
            img_data = {
                "path":        final_path,
                "title":       title,
                "description": feat.get("description", ""),
                "alt":         f"{title} feature image",
                "type":        "marketing",
                "cost":        cost,
            }
            feature_results.append(img_data)
            if on_image_generated_cb:
                on_image_generated_cb("feature", i, prompt, img_data, title)
            if on_image_cost_cb:
                on_image_cost_cb(cost)
        else:
            failed += 1
            print(f"  [image_gen] ✗ feature '{title}' failed")

        await asyncio.sleep(2.0)

    total = len(lifestyle_results) + len(feature_results)
    print(f"\n[image_gen] done — {total} saved, {failed} failed")
    print(f"[image_gen] folder: {folder}")
    
    if total == 0 and failed > 0:
        raise ImageGenerationError(f"All {failed} image generation attempts failed. Check logs for details.")

    return {
        "folder":          folder,
        "lifestyle":       lifestyle_results,
        "features":        feature_results,
        "total_generated": total,
        "total_failed":    failed,
    }


# ─────────────────────────────────────────────────────────────
# Helper
# ─────────────────────────────────────────────────────────────

def _safe_folder_name(text: str) -> str:
    """Converts any string into a safe folder/file name."""
    safe = re.sub(r'[^\w\-]', '-', text.upper())
    safe = re.sub(r'-+', '-', safe).strip('-')
    return safe[:60]
