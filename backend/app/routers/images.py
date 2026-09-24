from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db, SessionLocal
from app.models.scrape_task import ScrapeTask
from app.models.image_asset import ImageAsset
import os
import asyncio
from app.dependencies import get_current_user

router = APIRouter(
    prefix="/images", 
    tags=["Images"],
    dependencies=[Depends(get_current_user)]
)

public_router = APIRouter(
    prefix="/images", 
    tags=["Images"]
)

@public_router.get("/serve", summary="Serve an image by local path")
def serve_image(path: str):
    if not os.path.exists(path):
        # Fallback to check if it's a relative path from the project root
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        abs_path = os.path.join(project_root, path)
        if not os.path.exists(abs_path):
            raise HTTPException(status_code=404, detail="Image not found")
        return FileResponse(abs_path)
    return FileResponse(path)

@router.get("/queue", summary="Get all jobs currently in image generation or review")
def get_image_queue(active_job_id: str = None, db: Session = Depends(get_db)):
    jobs = db.query(ScrapeTask).filter(ScrapeTask.status.in_([
        "image_generation", 
        "image_generation_stopped",
        "image_generation_complete",
        "image_generation_failed"
    ])).all()
    
    queue = []
    for job in jobs:
        # Skip heavy asset querying and file stat for non-active jobs to prevent SQLite locks and disk IO blocking
        if active_job_id != job.id:
            queue.append({
                "job_id": job.id,
                "task_name": job.task_name,
                "product_name": job.product_data.get("product_identity", {}).get("product_name", job.task_name) if job.product_data else job.task_name,
                "status": job.status,
                "error_message": job.error_message,
                "assets": []
            })
            continue

        assets = db.query(ImageAsset).filter(ImageAsset.scrape_task_id == job.id).all()
        # Group by variation group
        groups = {}
        for a in assets:
            if a.variation_group not in groups:
                groups[a.variation_group] = []
            groups[a.variation_group].append(a)

        queue.append({
            "job_id": job.id,
            "task_name": job.task_name,
            "product_name": job.product_data.get("product_identity", {}).get("product_name", job.task_name) if job.product_data else job.task_name,
            "status": job.status,
            "error_message": job.error_message,
            "assets": [
                {
                    "variation_group": name,
                    "prompt": items[0].prompt_text if items else "",
                    "variations": [
                        {
                            "id": i.id,
                            "url": i.storage_path,
                            "status": i.status,
                            "asset_name": i.asset_name,
                            "prompt": i.prompt_text,
                                "metadata": {
                                    "size_kb": round(os.path.getsize(i.storage_path) / 1024, 1) if os.path.exists(i.storage_path) else 0,
                                    "type": "Lifestyle" if "lifestyle" in name.lower() else "Feature" if "feature" in name.lower() else "Banner (A+)",
                                    "ratio": "1:1",
                                    "created_on": i.created_at.strftime("%b %d, %Y %H:%M") if i.created_at else "Unknown",
                                    "text_model": i.text_model,
                                    "image_model": i.image_model
                                }
                        } for i in items
                    ]
                } for name, items in groups.items()
            ]
        })
    return queue

@router.post("/{asset_id}/regenerate", summary="Regenerate an image variation")
def regenerate_asset(asset_id: str, prompt_text: str, override_model: str = None, background_tasks: BackgroundTasks = None, db: Session = Depends(get_db)):
    local_asset = db.query(ImageAsset).filter(ImageAsset.id == asset_id).first()
    if not local_asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    # ── Credit Check (Flow C) ────────────────────────────────────────
    # Check BEFORE calling the generation API — do not generate first.
    from app.services import credit_service
    variant_check = credit_service.check_variant(count=1)
    if variant_check["status"] == "block":
        raise HTTPException(
            status_code=402,
            detail={
                "error": "insufficient_credits",
                "message": variant_check.get("reason", "Insufficient credits"),
                "expected_remaining": variant_check.get("expected_remaining"),
                "variant_cost": variant_check.get("variant_cost"),
            }
        )
    # ── End Credit Check ─────────────────────────────────────────────
        
    job = db.query(ScrapeTask).filter(ScrapeTask.id == local_asset.scrape_task_id).first()
    sku = "unknown"
    product = {}
    if job and job.product_data:
        product = job.product_data
        sku = product.get("product_identity", {}).get("sku", "unknown")
        
    from app.tasks.tools.image_generator import _safe_folder_name
    safe_sku = _safe_folder_name(sku)
    if job and hasattr(job, "id"):
        safe_sku = f"{safe_sku}_{job.id}"
        
    IMAGE_OUTPUT_DIR = os.getenv("IMAGE_OUTPUT_DIR", "output/images")
    folder = os.path.join(IMAGE_OUTPUT_DIR, safe_sku)
    os.makedirs(folder, exist_ok=True)
    
    # Count existing regenerated items for this group to append number
    regen_count = db.query(ImageAsset).filter(
        ImageAsset.scrape_task_id == local_asset.scrape_task_id,
        ImageAsset.variation_group == local_asset.variation_group,
        ImageAsset.asset_name.like("%-regenerated%")
    ).count()
    
    prod_name = product.get("product_identity", {}).get("product_name", sku)
    safe_prod_name = _safe_folder_name(prod_name)[:30] # Limit length
    safe_group = _safe_folder_name(local_asset.variation_group)
    import uuid
    short_id = str(uuid.uuid4())[:8]
    new_asset_name = f"{safe_prod_name}-{safe_group}-regen-{short_id}.png"
    
    save_path = os.path.join(folder, new_asset_name)
    
    # Fetch default text/image models if not overridden
    from app.config_loader import get_dynamic_env
    text_model = local_asset.text_model or get_dynamic_env("SCRAPING_MODEL") or "unknown-text-model"
    image_model_val = override_model if override_model else (local_asset.image_model or get_dynamic_env("IMAGE_GENERATION_MODEL") or "unknown-image-model")
    
    # Insert the new asset immediately with status="generating"
    new_asset = ImageAsset(
        scrape_task_id=local_asset.scrape_task_id,
        asset_name=new_asset_name,
        storage_path=save_path,
        prompt_text=prompt_text,
        variation_group=local_asset.variation_group,
        status="generating",
        text_model=text_model,
        image_model=image_model_val
    )
    db.add(new_asset)
    db.commit()
    db.refresh(new_asset)
    
    new_asset_id = str(new_asset.id)
    
    # Use Celery strictly
    from app.tasks.gen_images import regenerate_asset_task
    regenerate_asset_task.delay(new_asset_id, str(local_asset.id), override_model)
        
    response = {"status": "success", "message": "Regenerating..."}
    if variant_check["status"] == "warn":
        response["warning"] = True
        response["warning_message"] = variant_check.get("reason", "Credits running low")
    return response
@router.post("/{asset_id}/approve", summary="Approve an image variation")
def approve_asset(asset_id: str, db: Session = Depends(get_db)):
    asset = db.query(ImageAsset).filter(ImageAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    # Reject others in the same group
    db.query(ImageAsset).filter(
        ImageAsset.scrape_task_id == asset.scrape_task_id,
        ImageAsset.variation_group == asset.variation_group,
        ImageAsset.id != asset_id
    ).update({"status": "rejected"}, synchronize_session=False)
    
    # Approve this one
    db.query(ImageAsset).filter(
        ImageAsset.id == asset_id
    ).update({"status": "approved"}, synchronize_session=False)
    
    db.commit()
    
    # Sync the newly approved image to the live JSON immediately
    sync_images_to_product_data(str(asset.scrape_task_id), db)
    
    # Check if all groups have at least one approved asset
    all_assets = db.query(ImageAsset).filter(ImageAsset.scrape_task_id == asset.scrape_task_id).all()
    groups = {}
    for a in all_assets:
        groups.setdefault(a.variation_group, []).append(a)
        
    all_approved = True
    for g, items in groups.items():
        if not any(i.status == "approved" for i in items):
            all_approved = False
            break
            
    if all_approved:
        # Auto finish if all are approved
        finish_review(asset.scrape_task_id, db)
        
    return {"status": "success", "message": "Asset approved"}

@router.post("/job/{job_id}/stop", summary="Stop image generation for a job")
def stop_generation(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.status = "image_generation_stopped"
    db.commit()
    return {"status": "success", "message": "Stopping..."}

def cleanup_job_files(job_id: str, db: Session):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job: return
    
    import shutil
    import os
    
    sku = job.task_name
    if job.product_data:
        sku = job.product_data.get("product_identity", {}).get("sku", job.task_name)
        
    from app.tasks.tools.image_generator import _safe_folder_name
    full_sku = f"{sku}_{job.id}"
    safe_sku = _safe_folder_name(full_sku)
    IMAGE_OUTPUT_DIR = os.getenv("IMAGE_OUTPUT_DIR", "output/images")
    folder_to_delete = os.path.join(IMAGE_OUTPUT_DIR, safe_sku)
    if os.path.exists(folder_to_delete):
        try:
            shutil.rmtree(folder_to_delete)
        except Exception:
            pass
            
    reference_cache_dir = os.path.join("output/reference_cache", str(job.id))
    if os.path.exists(reference_cache_dir):
        try:
            shutil.rmtree(reference_cache_dir)
        except Exception:
            pass

@router.post("/job/{job_id}/abort", summary="Abort image generation entirely")
def abort_generation(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Delete all generated image assets for this job
    db.query(ImageAsset).filter(ImageAsset.scrape_task_id == job_id).delete()
    cleanup_job_files(job_id, db)
    
    job.status = "aborted"
    db.commit()
    return {"status": "success", "message": "Job aborted"}

@router.post("/job/{job_id}/revert", summary="Revert job to JSON Review")
def revert_to_json(job_id: str, keep_images: bool = False, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if not keep_images:
        # Delete all generated image assets for this job
        db.query(ImageAsset).filter(ImageAsset.scrape_task_id == job_id).delete()
        cleanup_job_files(job_id, db)
    
    job.status = "waiting_for_approval"
    db.commit()
    return {"status": "success", "message": "Job reverted to JSON review"}

@router.post("/job/{job_id}/resume", summary="Resume image generation for a job")
def resume_generation(job_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.status = "image_generation"
    db.commit()
    
    # Capture job_id as a plain string BEFORE the session closes
    job_id_str = str(job.id)
    
    from app.tasks.gen_images import generate_images_task
    generate_images_task.delay(job_id_str)

    return {"status": "success", "message": "Resuming..."}


    
def sync_images_to_product_data(job_id: str, db: Session):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        return
    
    # Embed approved (or newest) images into the JSON product_data
    assets = db.query(ImageAsset).filter(ImageAsset.scrape_task_id == job_id).all()
    
    grouped = {}
    for a in assets:
        if a.variation_group not in grouped:
            grouped[a.variation_group] = []
        grouped[a.variation_group].append(a)
    
    lifestyle_images = []
    feature_images = []
    
    prod = job.product_data or {}
    key_features = prod.get("key_features", [])
    
    for group_name, items in grouped.items():
        # Sort items by created_at descending so the newest is preferred if none are approved
        items.sort(key=lambda x: x.created_at, reverse=True)
        approved = next((i for i in items if i.status == "approved"), None)
        chosen = approved if approved else items[0]
        
        # Don't overwrite statuses inside the sync helper, that's the job of finish_review or approve_asset
        
        import os
        filename = os.path.basename(chosen.storage_path) if chosen.storage_path else "placeholder.png"
        
        img_dict = {
            "group": group_name,
            "url": f"images/{filename}",
            "local_path": chosen.storage_path,
            "asset_name": chosen.asset_name,
            "type": "lifestyle" if "lifestyle" in group_name else "feature"
        }
        
        if "lifestyle" in group_name:
            # Lifestyle images don't have a specific title/description from features
            img_dict["alt"] = "Lifestyle Image"
            lifestyle_images.append(img_dict)
        else:
            # For feature images, extract the corresponding title/desc from key_features
            # group_name is e.g. "feature_1"
            feature_idx = 0
            try:
                feature_idx = int(group_name.split("_")[1]) - 1
            except Exception:
                pass
            
            if feature_idx < len(key_features):
                img_dict["title"] = key_features[feature_idx].get("title", "")
                img_dict["description"] = key_features[feature_idx].get("description", "")
                img_dict["alt"] = img_dict["title"]
            else:
                img_dict["title"] = f"Feature {feature_idx + 1}"
                img_dict["description"] = "Premium feature"
                img_dict["alt"] = img_dict["title"]
                
            feature_images.append(img_dict)
        
    if "Product Highlights Ai Images" not in prod:
        prod["Product Highlights Ai Images"] = {}
        
    # Sort by group name to guarantee order matches key_features index
    lifestyle_images.sort(key=lambda x: x.get("group", ""))
    feature_images.sort(key=lambda x: x.get("group", ""))
    
    prod["Product Highlights Ai Images"]["lifestyle_images"] = lifestyle_images
    prod["Product Highlights Ai Images"]["feature_images"] = feature_images
    
    from sqlalchemy.orm.attributes import flag_modified
    job.product_data = prod
    flag_modified(job, "product_data")
    db.commit()


@router.post("/job/{job_id}/finish", summary="Finish image review and move to bundle/success phase")
def finish_review(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Update statuses of assets: mark chosen as approved, others as rejected
    assets = db.query(ImageAsset).filter(ImageAsset.scrape_task_id == job_id).all()
    grouped = {}
    for a in assets:
        grouped.setdefault(a.variation_group, []).append(a)
        
    for group_name, items in grouped.items():
        approved = next((i for i in items if i.status == "approved"), None)
        chosen = approved if approved else items[0]
        
        db.query(ImageAsset).filter(ImageAsset.id == chosen.id).update({"status": "approved"}, synchronize_session=False)
        db.query(ImageAsset).filter(
            ImageAsset.scrape_task_id == job_id,
            ImageAsset.variation_group == group_name,
            ImageAsset.id != chosen.id
        ).update({"status": "rejected"}, synchronize_session=False)
    
    db.commit()
    
    sync_images_to_product_data(job_id, db)
    
    # Refresh job object since it was modified in sync
    db.refresh(job)
    
    # Check if ExtractedProduct exists
    from app.models.extracted_product import ExtractedProduct
    from app.models.generated_page import GeneratedPage
    
    prod = job.product_data or {}
    
    extracted = db.query(ExtractedProduct).filter(ExtractedProduct.scrape_task_id == job.id).first()
    if not extracted:
        product_name = prod.get("product_identity", {}).get("product_name", job.task_name)
        extracted = ExtractedProduct(
            scrape_task_id=job.id,
            name=product_name,
            raw_json=prod,
            approval_status="approved"
        )
        db.add(extracted)
        db.flush() # to get extracted.id
        
    # Check if GeneratedPage exists
    gen_page = db.query(GeneratedPage).filter(GeneratedPage.extracted_product_id == extracted.id).first()
    if not gen_page:
        gen_page = GeneratedPage(
            extracted_product_id=extracted.id,
            bundle_name=job.task_name,
            status="pending"
        )
        db.add(gen_page)
    else:
        gen_page.status = "pending"
    
    job.status = "success"  # Ready for bundles
    job.progress = 100
    db.commit()
    return {"status": "success", "message": "Image review finished"}

@router.delete("/{asset_id}", summary="Delete an image variation")
def delete_asset(asset_id: str, db: Session = Depends(get_db)):
    asset = db.query(ImageAsset).filter(ImageAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    # Optionally remove file from disk
    if os.path.exists(asset.storage_path):
        try:
            os.remove(asset.storage_path)
        except Exception:
            pass

    db.delete(asset)
    db.commit()
    return {"status": "success", "message": "Asset deleted"}
