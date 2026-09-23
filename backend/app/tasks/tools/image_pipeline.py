import asyncio
import json
import os
import re
import shutil
import zipfile
import httpx
from src.tools.img_prompt import generate_all_prompts
from src.tools.image_generator import generate_product_images

REFERENCE_IMAGE_CACHE = "output/reference_cache"

async def download_reference_image(product: dict) -> str | None:
    """
    Pulls the first scraped image URL from the new schema:
        product["images"]["scraped_images"][0]["url"]

    Downloads it locally and returns the file path.
    Returns None if no scraped images exist or download fails.
    """
    try:
        images_val = product.get("images")
        if isinstance(images_val, dict):
            scraped = images_val.get("scraped_images", [])
        elif isinstance(images_val, list):
            scraped = images_val
        else:
            scraped = []
            
        # Normalize: if it's a list of strings, convert to dict format
        normalized_scraped = []
        for item in scraped:
            if isinstance(item, str):
                normalized_scraped.append({"url": item})
            elif isinstance(item, dict):
                normalized_scraped.append(item)
        scraped = normalized_scraped

        if not scraped:
            print("[image_pipeline] no scraped_images found in schema \u2014 skipping reference")
            return None

        # always use index [0] \u2014 front/hero view
        hero = scraped[0]
        url  = hero.get("url", "")
        alt  = hero.get("alt", "reference")

        if not url:
            print("[image_pipeline] scraped_images[0] has no url \u2014 skipping reference")
            return None

        print(f"[image_pipeline] reference image url : {url}")
        print(f"[image_pipeline] reference image alt : {alt}")

        # build local save path
        os.makedirs(REFERENCE_IMAGE_CACHE, exist_ok=True)
        ext       = os.path.splitext(url.split("?")[0])[1] or ".jpg"
        save_path = os.path.join(REFERENCE_IMAGE_CACHE, f"hero{ext}")

        # download
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url)
            response.raise_for_status()

        with open(save_path, "wb") as f:
            f.write(response.content)

        size_kb = len(response.content) // 1024
        print(f"[image_pipeline] reference saved     : {save_path} ({size_kb} KB)")
        return save_path

    except Exception as e:
        print(f"[image_pipeline] reference image download failed: {e}")
        return None

async def process_images(product: dict) -> dict:
    """
    Runs the full image generation pipeline.
    Expects a validated product dictionary.
    Returns the enriched product dictionary.
    """
    identity = product.get("product_identity", {})
    print(f"\n[image_pipeline] \u2500\u2500 STARTING IMAGE ENRICHMENT \u2500\u2500")
    print(f"[image_pipeline] product  : {identity.get('product_name', 'unknown')}")
    print(f"[image_pipeline] sku      : {identity.get('sku', 'unknown')}")
    
    # \u2500\u2500 Step 1: Download reference image \u2500\u2500
    reference_image_path = await download_reference_image(product)

    # \u2500\u2500 Step 2: Generate image prompts \u2500\u2500
    print(f"\n[image_pipeline] \u2500\u2500 GENERATING IMAGE PROMPTS \u2500\u2500")
    prompt_results = await generate_all_prompts(product)

    # \u2500\u2500 Step 3: Generate images via OpenRouter \u2500\u2500
    print(f"\n[image_pipeline] \u2500\u2500 GENERATING IMAGES \u2500\u2500")
    sku = identity.get("sku") or identity.get("model") or "product"
    
    image_results = await generate_product_images(
        lifestyle_prompts=prompt_results["lifestyle"],
        feature_prompts=prompt_results["features"],
        product_sku=sku,
        reference_image_path=reference_image_path,
    )

    # \u2500\u2500 Step 4: Build image entries \u2500\u2500
    lifestyle_images = [
        {"url": item["path"], "alt": item["alt"], "type": "marketing"}
        for item in image_results["lifestyle"]
    ]

    feature_images = [
        {
            "url": item["path"],
            "alt": item["alt"],
            "description": item.get("description", ""),
            "type": "marketing"
        }
        for item in image_results["features"]
    ]

    # \u2500\u2500 Step 5: Append to product \u2500\u2500
    if "images" not in product:
        product["images"] = {}
    
    product["images"]["lifestyle_images"] = lifestyle_images
    product["images"]["feature_images"] = feature_images

    # \u2500\u2500 Step 6: Update metadata \u2500\u2500
    product["enrichment_metadata"] = {
        **product.get("enrichment_metadata", {}),
        "image_generation_status": (
            "success" if image_results["total_failed"] == 0
            else "partial" if image_results["total_generated"] > 0
            else "failed"
        ),
        "lifestyle_images_generated": len(image_results["lifestyle"]),
        "feature_images_generated": len(image_results["features"]),
        "lifestyle_images_failed": image_results["total_failed"],
        "feature_images_failed": 0,
    }

    # \u2500\u2500 Step 7: Zip output JSON and images \u2500\u2500
    product_name = identity.get("product_name", "product")
    safe_name = re.sub(r'[^\w\-]', '-', product_name).strip('-')
    safe_name = re.sub(r'-+', '-', safe_name)
    zip_filename = f"{safe_name}.zip"
    images_folder = image_results["folder"]

    with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 1. Write the enriched JSON file into the zip
        json_filename = f"{safe_name}.json"
        zf.writestr(json_filename, json.dumps(product, indent=2))
        
        # 2. Add the images, keeping them in an 'output' folder structure
        if os.path.isdir(images_folder):
            for root, dirs, files in os.walk(images_folder):
                for file in files:
                    file_path = os.path.join(root, file)
                    # By using file_path, the images are stored as 'output/images/...' inside the zip
                    zf.write(file_path, arcname=file_path)
                    
    zip_size_mb = os.path.getsize(zip_filename) / (1024 * 1024)
    print(f"\n[image_pipeline] \u2500\u2500 ZIP CREATED: {zip_filename} ({zip_size_mb:.1f} MB) \u2500\u2500")

    # \u2500\u2500 Step 8: Clean up \u2500\u2500
    for cleanup_dir in ["output/images", REFERENCE_IMAGE_CACHE]:
        if os.path.isdir(cleanup_dir):
            shutil.rmtree(cleanup_dir)

    print(f"\n[image_pipeline] \u2500\u2500 ENRICHMENT COMPLETE \u2500\u2500")
    return product
