import asyncio
import os
import uuid
import httpx
from app.celery_app import celery_app
from app.database import SessionLocal
from app.models.scrape_task import ScrapeTask
from app.models.image_asset import ImageAsset
from app.tasks.tools.img_prompt import generate_all_prompts
from app.tasks.tools.image_generator import generate_product_images

REFERENCE_IMAGE_CACHE = "output/reference_cache"
MAX_SCRAPED_IMAGES = int(os.getenv("MAX_SCRAPED_IMAGES", "5"))

async def download_reference_images(product: dict, job_id: str, max_images: int = MAX_SCRAPED_IMAGES) -> list[str]:
    paths = []
    try:
        images_val = product.get("images")
        if isinstance(images_val, dict):
            scraped = images_val.get("scraped_images", [])
        elif isinstance(images_val, list):
            scraped = images_val
        else:
            scraped = []
            
        product_name = product.get("product_identity", {}).get("product_name", "").lower()
        
        # Normalize: if it's a list of strings, convert to dict format
        normalized_scraped = []
        for item in scraped:
            if isinstance(item, str):
                normalized_scraped.append({"url": item, "media_alt_tag": ""})
            elif isinstance(item, dict):
                if "media" in item and "url" not in item:
                    item["url"] = item["media"]
                normalized_scraped.append(item)
        
        # The LLM is now instructed to pre-sort images by relevance in the JSON.
        # We simply take the first few images, applying only a basic safety filter against egregious noise.
        scraped = [
            img for img in normalized_scraped
            if not any(bad in (img.get("url", "") or "").lower() for bad in ["logo", "icon", "tabby", "checkout", "banner", "menu", "pay"])
        ]
        
        job_cache_dir = os.path.join(REFERENCE_IMAGE_CACHE, job_id)
        os.makedirs(job_cache_dir, exist_ok=True)
        
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            for i, img in enumerate(scraped[:max_images]):
                url = img.get("url", "")
                if not url: continue
                
                ext = os.path.splitext(url.split("?")[0])[1] or ".jpg"
                save_path = os.path.join(job_cache_dir, f"ref_{uuid.uuid4().hex}{ext}")
                
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                    with open(save_path, "wb") as f:
                        f.write(response.content)
                    paths.append(save_path)
                except Exception as e:
                    print(f"Failed to download ref image {url}: {e}")
                    
        return paths
    except Exception as e:
        print(f"Ref images download failed: {e}")
        return paths

async def _run_image_pipeline(job_id: str):
    db = SessionLocal()
    credit_stop_requested = False
    try:
        job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
        if not job or not job.product_data:
            return
            
        if job.status in ["success", "aborted", "waiting_for_approval", "completed"]:
            return
            
        product = job.product_data
        base_sku = product.get("product_identity", {}).get("sku", job.task_name)
        # Ensure 100% filesystem isolation for this specific task
        sku = f"{base_sku}_{job.id}"
        
        # 1. Download Reference Images
        ref_image_paths = await download_reference_images(product, str(job.id))
        
        # 2. Generate Prompts (OpenRouter)
        prompt_results = await generate_all_prompts(product)
        if not prompt_results["lifestyle"] and not prompt_results["features"]:
            raise Exception("Failed to generate any image prompts. Check LLM (OpenRouter) configuration and Scraping Model settings.")
        
        # ── Credit check callback (Flow B) ───────────────────────
        from app.services import credit_service
        from app.credit_config import PER_IMAGE_COST_USD, MID_TASK_THRESHOLD_USD
        
        def on_image_cost(cost: float):
            nonlocal credit_stop_requested
            # Deduct from expected
            actual_cost = cost if cost > 0 else PER_IMAGE_COST_USD
            credit_service.deduct_expected(actual_cost)
            
            # Resync with real API (after every image — see §5 step 4)
            try:
                credit_service.refresh_actual_sync()
            except Exception as e:
                print(f"[credits] Resync failed (non-fatal): {e}")
            
            # Check threshold
            check = credit_service.check_mid_task()
            if check["status"] == "block":
                print(f"[credits] ⚠️ Credits below ${MID_TASK_THRESHOLD_USD} threshold — stopping generation")
                credit_stop_requested = True
        # ── End credit callback ──────────────────────────────────
        
        def check_cancel():
            db.refresh(job)
            if credit_stop_requested:
                return True
            return job.status in ["image_generation_stopped", "success", "aborted", "waiting_for_approval", "failed"]
            
        # Identify existing valid base images to skip regenerating them
        existing_assets = db.query(ImageAsset).filter(
            ImageAsset.scrape_task_id == job.id,
            ~ImageAsset.asset_name.like("%-regenerated%")
        ).all()
        existing_groups = {a.variation_group for a in existing_assets if a.status in ["success", "approved", "pending"]}
        
        def should_skip(group_type: str, index: int) -> bool:
            var_group = f"lifestyle_{index+1}" if group_type == "lifestyle" else f"feature_{index+1}"
            return var_group in existing_groups
            
        from app.config_loader import get_dynamic_env
        current_text_model = get_dynamic_env("SCRAPING_MODEL") or "unknown-text-model"
        current_image_model = get_dynamic_env("IMAGE_GENERATION_MODEL") or "unknown-image-model"
        
        def on_image_attempt(group_type: str, index: int, prompt: str, title: str = None):
            var_group = f"lifestyle_{index+1}" if group_type == "lifestyle" else f"feature_{index+1}"
            asset_name = f"Lifestyle-{index+1}.png" if group_type == "lifestyle" else f"Feature-{title.replace(' ', '')}.png" if title else f"Feature-{index+1}.png"
            
            existing = db.query(ImageAsset).filter(
                ImageAsset.scrape_task_id == job.id,
                ImageAsset.variation_group == var_group,
                ~ImageAsset.asset_name.like("%-regenerated%")
            ).first()
            
            if existing:
                existing.asset_name = asset_name
                existing.prompt_text = prompt
                existing.status = "generating"
                existing.text_model = current_text_model
                existing.image_model = current_image_model
            else:
                asset = ImageAsset(
                    scrape_task_id=job.id,
                    asset_name=asset_name,
                    prompt_text=prompt,
                    variation_group=var_group,
                    status="generating",
                    text_model=current_text_model,
                    image_model=current_image_model
                )
                db.add(asset)
            db.commit()

        def on_image_failed(group_type: str, index: int, error_msg: str, title: str = None):
            var_group = f"lifestyle_{index+1}" if group_type == "lifestyle" else f"feature_{index+1}"
            existing = db.query(ImageAsset).filter(
                ImageAsset.scrape_task_id == job.id,
                ImageAsset.variation_group == var_group,
                ~ImageAsset.asset_name.like("%-regenerated%")
            ).first()
            if existing:
                existing.status = "failed"
            db.commit()

        def on_image_generated(group_type: str, index: int, prompt: str, img_data: dict, title: str = None):
            var_group = f"lifestyle_{index+1}" if group_type == "lifestyle" else f"feature_{index+1}"
            asset_name = f"Lifestyle-{index+1}.png" if group_type == "lifestyle" else f"Feature-{title.replace(' ', '')}.png"
            
            # Check if an asset for this variation_group already exists (e.g. from a resumed or retried job)
            existing = db.query(ImageAsset).filter(
                ImageAsset.scrape_task_id == job.id,
                ImageAsset.variation_group == var_group,
                ~ImageAsset.asset_name.like("%-regenerated%") # Only overwrite base images, not regenerated ones
            ).first()
            
            if existing:
                existing.asset_name = asset_name
                existing.storage_path = img_data["path"]
                existing.prompt_text = prompt
                existing.status = "pending"
                existing.text_model = current_text_model
                existing.image_model = current_image_model
            else:
                asset = ImageAsset(
                    scrape_task_id=job.id,
                    asset_name=asset_name,
                    storage_path=img_data["path"],
                    prompt_text=prompt,
                    variation_group=var_group,
                    status="pending",
                    text_model=current_text_model,
                    image_model=current_image_model
                )
                db.add(asset)
            db.commit()
            
            # Sync the new image to the live AI JSON
            from app.routers.images import sync_images_to_product_data
            try:
                sync_images_to_product_data(str(job.id), db)
            except Exception as e:
                print(f"Failed to sync image to product data: {e}")
            
        # 3. Generate Images (OpenRouter Gemini Nano Banana)
        image_results = await generate_product_images(
            lifestyle_prompts=prompt_results["lifestyle"],
            feature_prompts=prompt_results["features"],
            product_sku=sku,
            reference_image_paths=ref_image_paths,
            check_cancel_cb=check_cancel,
            on_image_attempt_cb=on_image_attempt,
            on_image_generated_cb=on_image_generated,
            on_image_failed_cb=on_image_failed,
            should_skip_cb=should_skip,
            on_image_cost_cb=on_image_cost
        )
        
        # Check if generation was stopped due to credit exhaustion
        if credit_stop_requested:
            job.status = "rescheduled"
            job.error_message = "CREDITS_EXHAUSTED: OpenRouter API credits have been exhausted. Please top up at https://openrouter.ai/settings/credits"
            job.append_activity("Image_generation_failed", "Credit stop requested mid-task.")
            db.commit()
            return
        
        db.refresh(job)
        if job.status not in ["image_generation_stopped", "aborted", "waiting_for_approval", "failed", "rescheduled", "error"]:
            job.status = "image_generation_complete"
        db.commit()
        
    except Exception as e:
        error_str = str(e)
        print(f"Error in image pipeline: {error_str}")
        
        is_credit_error = ("402" in error_str and "Insufficient credits" in error_str) or credit_stop_requested
        error_str_lower = error_str.lower()
        is_recoverable = is_credit_error or any(term in error_str_lower for term in [
            "429", "500", "502", "503", "504", "timeout", "rate limit", 
            "insufficient", "credit", "quota", "connection"
        ])
        
        if is_recoverable:
            # Recoverable error: do NOT cleanup already-generated images.
            job.status = "rescheduled"
            if is_credit_error:
                job.error_message = "CREDITS_EXHAUSTED: OpenRouter API credits have been exhausted. Please top up at https://openrouter.ai/settings/credits"
            else:
                job.error_message = f"Image generation temporarily failed: {error_str}"
        else:
            # Permanent error: cleanup as before
            try:
                db.query(ImageAsset).filter(ImageAsset.scrape_task_id == job.id, ImageAsset.status != "success").delete()
                # Actually, if we want to preserve successful ones even on permanent errors, we should filter by status. 
                # But to follow previous logic mostly, we'll only delete non-successful ones.
                # Let's just delete the ones that are 'generating' or 'failed'
                db.query(ImageAsset).filter(ImageAsset.scrape_task_id == job.id, ImageAsset.status.in_(["generating", "failed"])).delete()
                from app.routers.images import cleanup_job_files
                # Note: cleanup_job_files deletes the folder. We might want to keep the folder if we keep some images, but permanent error aborts the task anyway.
                # cleanup_job_files(str(job.id), db) # Skipping complete deletion to preserve successful ones.
            except Exception as cleanup_err:
                print(f"Failed to cleanup after error: {cleanup_err}")
            
            job.status = "error"
            job.error_message = error_str

        job.append_activity("Image_generation_failed", error_str)
        db.commit()
    finally:
        db.close()

@celery_app.task(bind=True, name="app.tasks.gen_images.generate_images_task")
def generate_images_task(self, job_id: str):
    """Generate image variations via Nano Banana for each asset slot."""
    asyncio.run(_run_image_pipeline(job_id))
    return f"Image generation finished for {job_id}"

@celery_app.task(bind=True, name="app.tasks.gen_images.regenerate_asset_task")
def regenerate_asset_task(self, target_asset_id: str, reference_asset_id: str = None, override_model: str = None):
    """Regenerate a single image asset using an isolated reference image."""
    from app.tasks.tools.image_generator import _generate_single_image
    import uuid
    import asyncio
    db = SessionLocal()
    try:
        target_asset = db.query(ImageAsset).filter(ImageAsset.id == target_asset_id).first()
        if not target_asset: return
        job = db.query(ScrapeTask).filter(ScrapeTask.id == target_asset.scrape_task_id).first()
        product = job.product_data if job else {}
        
        from app.config_loader import get_dynamic_env
        model_to_use = override_model or get_dynamic_env("IMAGE_GENERATION_MODEL")
        sku = product.get("product_identity", {}).get("sku", "unknown")
        
        # Grab original scraped images from the reference cache to preserve the product's true features.
        ref_image_paths = []
        job_id_str = str(job.id) if job else str(target_asset.scrape_task_id)
        job_cache_dir = os.path.join(REFERENCE_IMAGE_CACHE, job_id_str)
        
        if os.path.exists(job_cache_dir):
            for filename in os.listdir(job_cache_dir):
                file_path = os.path.join(job_cache_dir, filename)
                if os.path.isfile(file_path):
                    ref_image_paths.append(file_path)
                    
        # Sort and limit to ensure consistent order and avoid exceeding limits
        ref_image_paths.sort()
        ref_image_paths = ref_image_paths[:MAX_SCRAPED_IMAGES]
            
        try:
            url, cost = asyncio.run(_generate_single_image(
                prompt=target_asset.prompt_text,
                reference_image_paths=ref_image_paths,
                save_path=target_asset.storage_path,
                model=model_to_use
            ))
            target_asset.status = "success" # Set to success upon successful generation
            url_path = "/images/" + os.path.basename(target_asset.storage_path)
            target_asset.url = url_path
            
            # Deduct credit and resync after successful variant generation
            from app.services import credit_service
            from app.credit_config import PER_IMAGE_COST_USD
            actual_cost = cost if cost > 0 else PER_IMAGE_COST_USD
            credit_service.deduct_expected(actual_cost)
            try:
                credit_service.refresh_actual_sync()
            except Exception:
                pass  # Non-critical — cache will catch up
        except Exception as e:
            print(f"Error regenerating asset: {e}")
            target_asset.status = "failed"
            target_asset.error_message = str(e)
            
        db.commit()
        
        # Sync the new variant image to the live AI JSON
        if target_asset.status == "success":
            from app.routers.images import sync_images_to_product_data
            try:
                sync_images_to_product_data(str(target_asset.scrape_task_id), db)
            except Exception as e:
                print(f"Failed to sync variation to product data: {e}")
                
    finally:
        db.close()
    return f"Regenerated asset {target_asset_id}"
