"""
Job creation & management router.
Merged from backend/routes/jobs.py and fastapi endpoints/job_structure/main.py.

Endpoints:
  POST /jobs           — create job (single or multi-URL)
  POST /jobs/upload-csv — CSV batch upload
  GET  /jobs           — list/filter jobs
  GET  /jobs/{batch_id} — get batch details
  POST /jobs/stop      — stop all pending/in-progress jobs
"""
import csv
import io
import time
import uuid
from datetime import date
from typing import List, Optional

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse, HTMLResponse
from pydantic import HttpUrl, ValidationError, BaseModel
from sqlalchemy import func, case
from sqlalchemy.orm import Session
import httpx
from urllib.parse import urlparse

from app.database import get_db
from app.models.scrape_task import ScrapeTask
from app.schemas.jobs import (
    BatchSubmitResponse,
    JobListResponse,
    JobResponse,
    MultiURLRequest,
    PriorityEnum,
    SingleURLRequest,
    TaskPercentage,
    TaskStatus,
)
from app.dependencies import get_current_user
from app.models.user import User

from pydantic import BaseModel
import httpx
import json
from urllib.parse import urlparse

class SearchUrlsRequest(BaseModel):
    query: str
    country: str = "us"

class SearchResultItem(BaseModel):
    title: str
    url: str
    snippet: str
    domain: str
    position: int

class SearchUrlsResponse(BaseModel):
    results: List[SearchResultItem]
    total: int


router = APIRouter(
    prefix="/jobs", 
    tags=["Jobs"],
    dependencies=[Depends(get_current_user)]
)


# ── Celery import with fallback ──────────────────────────────────
try:
    from app.tasks.scrape import process_scrape
    from app.tasks.gen_images import generate_images_task
    CELERY_AVAILABLE = True
except ImportError:
    CELERY_AVAILABLE = False


# ── Helpers ──────────────────────────────────────────────────────
def _dispatch(task_id: str) -> str:
    """Dispatch using Celery."""
    result = process_scrape.delay(task_id)
    return result.id


def _validate_urls(raw: List[str]) -> tuple[List[str], List[str]]:
    valid, invalid = [], []
    for raw_url in raw:
        raw_url = raw_url.strip()
        if not raw_url:
            continue
        try:
            HttpUrl(raw_url)
            valid.append(raw_url)
        except (ValidationError, ValueError):
            invalid.append(raw_url)
    return valid, invalid


def _build_jobs(
    db: Session,
    *,
    jobs_to_create: List[dict],
    priority: Optional[str],
    task_name: str,
    scheduled_date: Optional[date],
    created_by: Optional[str],
    product_type: str,
    generate_ai_images: bool,
    text_model_override: Optional[str] = None,
    background_tasks: BackgroundTasks,
) -> tuple[str, List[ScrapeTask]]:
    """Insert one ScrapeTask per URL under a shared batch_id."""
    batch_id = str(uuid.uuid4())
    jobs: List[ScrapeTask] = []

    for item in jobs_to_create:
        job = ScrapeTask(
            batch_id=batch_id,
            task_name=task_name,
            priority=priority or "low",
            url=item["url"],
            reference_urls=item.get("reference_urls"),
            product_type=product_type,
            status="pending",
            progress=0,
            scheduled_date=scheduled_date,
            created_by=created_by,
            generate_ai_images=generate_ai_images,
            text_model_override=text_model_override,
            activity_log=[{"timestamp": time.time(), "action": "created", "detail": f"Job created for {item['url']}"}],
        )
        db.add(job)
        jobs.append(job)

    db.commit()
    for job in jobs:
        db.refresh(job)

    # Dispatch jobs that are not scheduled for a future date
    for job in jobs:
        if scheduled_date and scheduled_date > date.today():
            job.status = "pending"
            job.append_activity("scheduled", f"Scheduled for {scheduled_date}")
        else:
            try:
                celery_id = _dispatch(job.id)
                job.celery_task_id = celery_id
                job.status = "queued"
                job.append_activity("queued", "Dispatched to worker")
            except Exception as e:
                print(f"Celery dispatch failed for job {job.id}: {e}")
                job.status = "failed"
                job.error_message = f"Dispatch failed: {e}"
                job.append_activity("failed", "Failed to dispatch to task queue")
        db.commit()

    return batch_id, jobs


# ── Routes ───────────────────────────────────────────────────────

def _check_credentials():
    from app.config_loader import get_dynamic_env
    missing = []
    if not get_dynamic_env("OPENROUTER_API_KEY"):
        missing.append("OpenRouter (LLM & Image Generation)")
    if not get_dynamic_env("SERPER_API_KEY"):
        missing.append("Serper (Search API)")
        
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CREDENTIALS_MISSING: Your credentials are not configured ({', '.join(missing)}). Contact your administrator."
        )

@router.post(
    "",
    response_model=BatchSubmitResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit one or more URLs for processing",
)
def create_job(
    payload: MultiURLRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    _check_credentials()
    jobs_list = []
    valid_urls = []
    if payload.urls:
        valid_urls = [str(u) for u in payload.urls]
        for u in payload.urls:
            jobs_list.append({"url": str(u), "reference_urls": None})
    elif payload.primary_url:
        valid_urls = [str(payload.primary_url)]
        ref_urls = [str(r) for r in payload.reference_urls] if payload.reference_urls else []
        jobs_list.append({"url": str(payload.primary_url), "reference_urls": ref_urls})
    
    if not jobs_list:
        raise HTTPException(status_code=400, detail="Must provide urls or primary_url")
    


    # ── OpenRouter Credit Check ──────────────────────────────────
    from app.services import credit_service
    if payload.generate_ai_images:
        # Assume roughly 4 images per URL
        or_check = credit_service.check_initial_approval(len(valid_urls) * 4)
        if or_check["status"] == "block":
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_credits",
                    "provider": "openrouter",
                    "message": or_check.get("reason", "Insufficient OpenRouter credits for image generation"),
                    "balance": or_check.get("balance"),
                    "job_cost": or_check.get("job_cost"),
                    "block_threshold": or_check.get("threshold"),
                }
            )
    # ── End OpenRouter Credit Check ──────────────────────────────
    
    batch_id, jobs = _build_jobs(
        db,
        jobs_to_create=jobs_list,
        task_name=payload.task_name,
        priority=payload.priority,
        scheduled_date=payload.scheduled_date,
        created_by=payload.created_by,
        product_type=payload.product_type,
        generate_ai_images=payload.generate_ai_images,
        text_model_override=payload.text_model_override,
        background_tasks=background_tasks,
    )
    response = BatchSubmitResponse(
        batch_id=batch_id,
        task_name=payload.task_name,
        total_urls=len(valid_urls),
        submitted=len(jobs),
        skipped=0,
        skipped_urls=[],
        jobs=jobs,
        message=f"{len(jobs)} URL job(s) submitted successfully.",
    )
    return response


@router.post(
    "/upload-csv",
    response_model=BatchSubmitResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a CSV file containing URLs",
)
async def upload_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    task_name: str = Query(...),
    url_column: str = Query("url"),
    priority: Optional[PriorityEnum] = Query(PriorityEnum.low),
    product_type: str = Query("simple"),
    generate_ai_images: bool = Query(False),
    scheduled_date: Optional[date] = Query(None),
    created_by: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    _check_credentials()
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=415, detail="Only .csv files are accepted.")

    raw_bytes = await file.read()
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded.")

    df = pd.read_csv(io.StringIO(text))

    # Find the URL column
    if url_column in df.columns:
        column = url_column
    elif len(df.columns) == 1:
        column = df.columns[0]
    else:
        raise HTTPException(
            status_code=422,
            detail=f"Column '{url_column}' not found. Available: {list(df.columns)}",
        )

    raw_urls = df[column].dropna().drop_duplicates().astype(str).str.strip().tolist()
    if not raw_urls:
        raise HTTPException(status_code=400, detail="CSV file contains no URL values.")

    valid_urls, invalid_urls = _validate_urls(raw_urls)
    if not valid_urls:
        raise HTTPException(status_code=422, detail="No valid URLs found in CSV.")
        
    jobs_list = [{"url": str(u), "reference_urls": None} for u in valid_urls]



    # ── OpenRouter Credit Check ──────────────────────────────────
    from app.services import credit_service
    if generate_ai_images:
        # Assume roughly 4 images per URL
        or_check = credit_service.check_initial_approval(len(valid_urls) * 4)
        if or_check["status"] == "block":
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_credits",
                    "provider": "openrouter",
                    "message": or_check.get("reason", "Insufficient OpenRouter credits for image generation"),
                    "balance": or_check.get("balance"),
                    "job_cost": or_check.get("job_cost"),
                    "block_threshold": or_check.get("threshold"),
                }
            )
    # ── End OpenRouter Credit Check ──────────────────────────────

    batch_id, jobs = _build_jobs(
        db,
        jobs_to_create=jobs_list,
        task_name=task_name,
        priority=priority,
        scheduled_date=scheduled_date,
        created_by=created_by,
        product_type=product_type,
        generate_ai_images=generate_ai_images,
        background_tasks=background_tasks,
    )

    response = BatchSubmitResponse(
        batch_id=batch_id,
        task_name=task_name,
        total_urls=len(raw_urls),
        submitted=len(jobs),
        skipped=len(invalid_urls),
        skipped_urls=invalid_urls,
        jobs=jobs,
        message=f"{len(jobs)} URL(s) submitted; {len(invalid_urls)} skipped.",
    )

    return response


@router.get("/", response_model=JobListResponse, summary="List jobs with filtering")
def list_jobs(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    task_name: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    query = db.query(ScrapeTask)
    if task_name:
        query = query.filter(ScrapeTask.task_name == task_name)
    if status_filter:
        statuses = [s.strip() for s in status_filter.split(",")]
        query = query.filter(ScrapeTask.status.in_(statuses))

    total = query.count()
    pending = query.filter(ScrapeTask.status.in_(["pending", "queued"])).count()
    processing = query.filter(ScrapeTask.status.in_(["processing", "scraping", "ai_processing"])).count()
    completed = query.filter(ScrapeTask.status == "success").count()
    failed = query.filter(ScrapeTask.status == "failed").count()

    jobs = query.order_by(ScrapeTask.created_at.desc()).offset(skip).limit(limit).all()
    return JobListResponse(
        total=total,
        remaining=pending + processing,
        pending=pending,
        processing=processing,
        completed=completed,
        failed=failed,
        jobs=jobs,
    )


@router.get("/proxy", summary="Proxy a URL to bypass X-Frame-Options")
async def proxy_url(url: str):
    """
    Proxies a URL to strip X-Frame-Options and CSP headers so it can be embedded in an iframe.
    Injects a <base> tag to ensure relative assets (CSS/JS) load correctly.
    """
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid URL")
        
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            response = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"})
            
            content_type = response.headers.get("content-type", "")
            if "text/html" in content_type.lower():
                html = response.text
                
                parsed_url = urlparse(url)
                base_href = f"{parsed_url.scheme}://{parsed_url.netloc}/"
                
                import re
                
                # Strip all <script> tags to prevent SPA framebusting and CORS crashes
                html = re.sub(r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>', '', html, flags=re.IGNORECASE)
                
                # Strip meta CSP if present in HTML
                html = re.sub(r'<meta[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>', '', html, flags=re.IGNORECASE)
                
                # Remove Shoplift A/B testing hiders
                html = html.replace('shoplift-hide', '')
                html = html.replace('opacity: 0 !important', '')
                
                # Trick the CSS into thinking JS is enabled so it doesn't hide .no-js elements
                html = html.replace('class="no-js"', 'class="js"')

                # Inject <base>, CSS overrides, and a lazy-load image fixer
                injections = f"""
                <base href="{base_href}">
                <style>
                    body, html, main, #MainContent, .page-wrapper {{
                        opacity: 1 !important;
                        visibility: visible !important;
                        display: block !important;
                    }}
                    .lazyload, .lazyloading {{
                        opacity: 1 !important;
                    }}
                </style>
                <script>
                    document.addEventListener("DOMContentLoaded", function() {{
                        document.querySelectorAll('img[data-src], img[data-srcset], source[data-srcset]').forEach(function(el) {{
                            if (el.hasAttribute('data-src')) el.setAttribute('src', el.getAttribute('data-src'));
                            if (el.hasAttribute('data-srcset')) el.setAttribute('srcset', el.getAttribute('data-srcset'));
                            el.classList.remove('lazyload');
                            el.classList.add('lazyloaded');
                        }});
                    }});
                </script>
                """

                if "<head" in html.lower():
                    html = re.sub(r'(<head[^>]*>)', f'\\1{injections}', html, flags=re.IGNORECASE, count=1)
                else:
                    html = f'<head>{injections}</head>' + html
                    
                headers = dict(response.headers)
                headers.pop("x-frame-options", None)
                headers.pop("content-security-policy", None)
                headers.pop("content-length", None)
                headers.pop("transfer-encoding", None)
                
                return HTMLResponse(content=html, status_code=response.status_code, headers=headers)
            else:
                return StreamingResponse(
                    response.aiter_raw(),
                    status_code=response.status_code,
                    headers={k: v for k, v in response.headers.items() if k.lower() not in ["x-frame-options", "content-security-policy", "content-length", "transfer-encoding"]}
                )
    except Exception as e:
        return HTMLResponse(content=f"<html><body><h2>Failed to proxy URL: {str(e)}</h2></body></html>", status_code=500)


@router.get("/{batch_id}", response_model=JobListResponse, summary="Get all jobs for a batch")
def get_batch_jobs(batch_id: str, db: Session = Depends(get_db)):
    jobs = db.query(ScrapeTask).filter(ScrapeTask.batch_id == batch_id).all()
    if not jobs:
        raise HTTPException(status_code=404, detail=f"No jobs found for batch '{batch_id}'")
    return JobListResponse(total=len(jobs), jobs=jobs)


@router.get("/detail/{job_id}", response_model=JobResponse, summary="Get a single job's detail")
def get_job_detail(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/stop", summary="Stop all pending/in-progress jobs")
def stop_all_jobs(db: Session = Depends(get_db)):
    count = (
        db.query(ScrapeTask)
        .filter(ScrapeTask.status.in_(["pending", "queued", "processing", "scraping"]))
        .update({"status": "failed", "error_message": "Stopped by user"}, synchronize_session=False)
    )
    db.commit()
    return {"status": "success", "stopped": count}


@router.get("/stats/percentage", response_model=TaskPercentage, summary="Get task completion percentage")
def get_task_percentage(task_name: str = Query(...), db: Session = Depends(get_db)):
    total = db.query(ScrapeTask).filter(ScrapeTask.task_name == task_name).count()
    completed = db.query(ScrapeTask).filter(
        ScrapeTask.task_name == task_name, ScrapeTask.status == "success"
    ).count()
    remaining = total - completed
    percentage = (completed / total * 100) if total > 0 else 0.0
    return TaskPercentage(task_name=task_name, percentage=percentage, remaining_count=remaining)


from app.schemas.jobs import ApprovalRequest

@router.post("/{job_id}/approve", summary="Approve JSON and send to Image Queue")
def approve_job(job_id: str, payload: ApprovalRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if payload.product_data is not None:
        from sqlalchemy.orm.attributes import flag_modified
        job.product_data = payload.product_data
        flag_modified(job, "product_data")

        if job.status not in ["image_generation", "image_generation_complete", "success"]:
            job.status = "image_generation"
            job.append_activity("json_approved", "Admin saved the JSON payload")
            db.commit()
            
        return {"status": "success", "message": "Job updated successfully"}
    else:
        # Skip image generation completely
        job.status = "completed"
        job.append_activity("finalized", "JSON approved. Image generation skipped.")
        
        # We can optionally call the finalize logic directly here, or just let it be marked completed.
        # Calling finalize logic to ensure zip generation if needed.
        # For simplicity, we just mark it completed. The download logic can handle it.
        db.commit()
        return {"status": "success", "message": "Job approved and completed (AI images skipped)"}

@router.post("/{job_id}/reject", summary="Reject JSON")
def reject_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job.status = "failed"
    job.error_message = "Rejected by admin during JSON review"
    job.append_activity("json_rejected", "Admin rejected the JSON payload")
    db.commit()
    return {"status": "success", "message": "Job rejected"}


class RescheduleRequest(BaseModel):
    scheduled_date: Optional[date] = None
    category_override: Optional[str] = None

@router.post("/{job_id}/reschedule", summary="Reschedule a failed/aborted job by recreating it")
def reschedule_job(
    job_id: str,
    background_tasks: BackgroundTasks,
    payload: RescheduleRequest,
    db: Session = Depends(get_db)
):
    # 1. Fetch old job
    old_job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not old_job:
        raise HTTPException(status_code=404, detail="Job not found")

    if old_job.status not in ["failed", "aborted", "image_generation_failed", "image_generation_stopped", "error", "rescheduled"]:
        raise HTTPException(status_code=400, detail="Only failed or aborted jobs can be rescheduled")

    # Reset basic error states
    old_job.error_message = None
    if payload and payload.category_override:
        old_job.category_override = payload.category_override
    if payload and payload.scheduled_date:
        old_job.scheduled_date = payload.scheduled_date

    # Smart Checkpoint Logic
    has_product_data = bool(old_job.product_data)

    if has_product_data and old_job.generate_ai_images:
        # Scenario B: Scraping finished, but image generation failed. Resume images!
        old_job.status = "image_generation"
        old_job.progress = 100
        old_job.append_activity("rescheduled", "Resumed failed image generation checkpoint")
        db.commit()

        from app.tasks.gen_images import generate_images_task
        task = generate_images_task.delay(job_id)
        old_job.celery_task_id = task.id
        db.commit()
    else:
        # Scenario A: Failed during scraping or no images requested. Start from scratch.
        old_job.status = "queued"
        old_job.progress = 0
        old_job.source_data = None
        old_job.product_data = None
        old_job.append_activity("rescheduled", "Restarted job from the beginning")
        db.commit()

        from app.tasks.scrape import process_scrape
        task = process_scrape.delay(job_id)
        old_job.celery_task_id = task.id
        db.commit()

    return {"status": "success", "message": "Job rescheduled successfully", "new_job_id": job_id}


@router.delete("/task/{task_name}", summary="Abort all jobs for a specific task group")
def delete_task_group(task_name: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    jobs = db.query(ScrapeTask).filter(ScrapeTask.task_name == task_name).all()
    if not jobs:
        raise HTTPException(status_code=404, detail="No jobs found for this task name")

    # ── Phase 1 (Instant): Mark all as aborted + revoke Celery tasks ──
    job_ids = []
    for job in jobs:
        job_ids.append(str(job.id))
        # Revoke any active Celery worker so it stops processing
        if job.celery_task_id:
            try:
                from app.celery_app import celery_app as _celery
                _celery.control.revoke(job.celery_task_id, terminate=True, signal="SIGTERM")
            except Exception:
                pass
        job.status = "aborted"
        job.error_message = "Aborted by user"
    db.commit()

    # ── Phase 2 (Background): Heavy cleanup without blocking the UI ──
    def _cleanup_task_group(task_job_ids: list[str]):
        """Runs in a background thread — deletes files and DB rows."""
        import shutil
        import os
        from app.database import SessionLocal
        from app.models.image_asset import ImageAsset

        cleanup_db = SessionLocal()
        try:
            from app.tasks.tools.image_generator import _safe_folder_name
            IMAGE_OUTPUT_DIR = os.getenv("IMAGE_OUTPUT_DIR", "output/images")

            for jid in task_job_ids:
                job = cleanup_db.query(ScrapeTask).filter(ScrapeTask.id == jid).first()
                if not job:
                    continue

                # Cleanup image output folder
                sku = job.task_name
                if job.product_data:
                    sku = job.product_data.get("product_identity", {}).get("sku", job.task_name)
                full_sku = f"{sku}_{job.id}"
                safe_sku = _safe_folder_name(full_sku)
                folder = os.path.join(IMAGE_OUTPUT_DIR, safe_sku)
                if os.path.exists(folder):
                    try:
                        shutil.rmtree(folder)
                    except Exception:
                        pass

                # Cleanup reference cache folder
                ref_dir = os.path.join("output/reference_cache", str(job.id))
                if os.path.exists(ref_dir):
                    try:
                        shutil.rmtree(ref_dir)
                    except Exception:
                        pass

                # Let SQLAlchemy cascade handle child tables
                cleanup_db.delete(job)

            cleanup_db.commit()
            print(f"[cleanup] Successfully deleted {len(task_job_ids)} jobs for task group")
        except Exception as e:
            cleanup_db.rollback()
            print(f"[cleanup] Error during task group cleanup: {e}")
        finally:
            cleanup_db.close()

    background_tasks.add_task(_cleanup_task_group, job_ids)

    return {"status": "success", "message": f"Aborted {len(job_ids)} jobs. Cleanup running in background."}


@router.delete("/{job_id}", summary="Abort a job or mark as hidden")
def delete_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    # Revoke Celery task if it is actively running
    if job.celery_task_id:
        try:
            from app.celery_app import celery_app as _celery
            _celery.control.revoke(job.celery_task_id, terminate=True, signal="SIGTERM")
        except Exception:
            pass
            
    import shutil
    import os
    
    # 1. Delete generated images output directory
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
        except Exception as e:
            print(f"Failed to clean up images folder {folder_to_delete}: {e}")
                
    # 2. Delete reference image cache directory
    reference_cache_dir = os.path.join("output/reference_cache", str(job.id))
    if os.path.exists(reference_cache_dir):
        try:
            shutil.rmtree(reference_cache_dir)
        except Exception as e:
            print(f"Failed to clean up reference cache {reference_cache_dir}: {e}")
    
    # Let SQLAlchemy cascade handle ImageAsset + ExtractedProduct + GeneratedPage cleanup
    db.delete(job)
    db.commit()
    return {"status": "success", "message": "Job deleted completely"}


import zipfile
import io
import json
import os
import copy
from fastapi.responses import StreamingResponse

@router.get("/{job_id}/download", summary="Download the finalized bundle as a ZIP")
def download_bundle(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job or job.status not in ["success", "completed"]:
        raise HTTPException(status_code=404, detail="Job not found or not finalized")

    # Deepcopy to avoid modifying the DB object in memory
    prod_data = copy.deepcopy(job.product_data or {})
    ai_images_dict = prod_data.get("Product Highlights Ai Images", {})
    ai_images = ai_images_dict.get("lifestyle_images", []) + ai_images_dict.get("feature_images", [])

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "a", zipfile.ZIP_DEFLATED, False) as zip_file:
        safe_name = job.task_name.replace(" ", "_").replace("/", "-")
        bundle_folder = f"{safe_name}_bundle"
        
        # Add images
        for img in ai_images:
            local_path = img.get("local_path")
            url = img.get("url") # e.g. "images/filename.png" or just "filename.png"
            if local_path and os.path.exists(local_path):
                current_filename = os.path.basename(url) if url else os.path.basename(local_path)
                
                # Fetch product name and sku
                identity = prod_data.get("product_identity", {})
                product_name = str(identity.get("product_name", "product")).replace(" ", "_").replace("/", "-")
                sku = str(identity.get("product_sku", "sku"))
                
                # Desired format: product name600164{sku/model no}01.JPG{currentname}
                new_filename = f"{product_name}600164{sku}01.JPG{current_filename}"
                new_url = f"images/{new_filename}"
                
                # Put the image inside the bundle folder
                zip_file.write(local_path, arcname=f"{bundle_folder}/{new_url}")
                img["url"] = new_url # Update JSON reference
            
            if "local_path" in img:
                del img["local_path"]

        # Add JSON
        json_str = json.dumps(prod_data, indent=2)
        zip_file.writestr(f"{bundle_folder}/{safe_name}.json", json_str)

    zip_buffer.seek(0)
    headers = {
        "Content-Disposition": f"attachment; filename={safe_name}_bundle.zip"
    }
    return StreamingResponse(zip_buffer, media_type="application/zip", headers=headers)

@router.post("/{job_id}/update_data", summary="Update product data without finalizing")
def update_job_data(job_id: str, payload: ApprovalRequest, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    if payload.product_data is not None:
        from sqlalchemy.orm.attributes import flag_modified
        job.product_data = payload.product_data
        flag_modified(job, "product_data")
        db.commit()
    return {"status": "success", "message": "Product data updated"}

@router.post("/{job_id}/finalize", summary="Finalize JSON and Bundle")
def finalize_job(job_id: str, payload: ApprovalRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    if payload.product_data is not None:
        from sqlalchemy.orm.attributes import flag_modified
        job.product_data = payload.product_data
        flag_modified(job, "product_data")
        
    job.status = "completed"
    job.append_activity("finalized", "Bundle finalized and ready for download")
    
    # Generate the ZIP file permanently to disk so Downloads can reference it
    prod_data = copy.deepcopy(job.product_data or {})
    ai_images_dict = prod_data.get("Product Highlights Ai Images", {})
    ai_images = ai_images_dict.get("lifestyle_images", []) + ai_images_dict.get("feature_images", [])
    
    safe_name = job.task_name.replace(" ", "_").replace("/", "-")
    zip_filename = f"{safe_name}_bundle_{str(job.id)[:8]}.zip"
    
    # Generate the ZIP file in memory
    import io
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for img in ai_images:
            local_path = img.get("local_path")
            url = img.get("url") # e.g. "images/filename.png" or just "filename.png"
            if local_path and os.path.exists(local_path):
                # Rename the image file
                current_filename = os.path.basename(url) if url else os.path.basename(local_path)
                
                # Fetch product name and sku
                identity = prod_data.get("product_identity", {})
                product_name = str(identity.get("product_name", "product")).replace(" ", "_").replace("/", "-")
                sku = str(identity.get("product_sku", "sku"))
                
                # Desired format: product name600164{sku/model no}01.JPG{currentname}
                new_filename = f"{product_name}600164{sku}01.JPG{current_filename}"
                new_url = f"images/{new_filename}"
                
                zip_file.write(local_path, arcname=new_url)
                img["url"] = new_url # Update JSON reference to match the new image name
            
            if "local_path" in img:
                del img["local_path"]
                
        json_str = json.dumps(prod_data, indent=2)
        zip_file.writestr(f"{safe_name}.json", json_str)
        
    # Update the DB with the modified product_data (which now contains the new image URLs)
    job.product_data = prod_data
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(job, "product_data")
        
    zip_bytes = zip_buffer.getvalue()
    size_mb = round(len(zip_bytes) / (1024*1024), 2)
        
    # Update result_zip_file metadata in DB
    from sqlalchemy.orm.attributes import flag_modified
    job.result_zip_file = {
        "url": f"/jobs/{job.id}/download-zip", 
        "filename": zip_filename,
        "size": f"{size_mb} MB",
        "approved_by": current_user.full_name or current_user.username or current_user.email
    }
    job.result_data = zip_bytes
    flag_modified(job, "result_zip_file")
    
    from app.models.extracted_product import ExtractedProduct
    from app.models.generated_page import GeneratedPage
    extracted = db.query(ExtractedProduct).filter(ExtractedProduct.scrape_task_id == job.id).first()
    if extracted:
        gen_page = db.query(GeneratedPage).filter(GeneratedPage.extracted_product_id == extracted.id).first()
        if gen_page:
            gen_page.status = "approved"
            gen_page.finalized_zip = zip_bytes
            gen_page.html_content = payload.product_data.get("html", "<!-- Placeholder HTML Content -->") if payload.product_data else None
            
    # Commit changes to PostgreSQL first to ensure the binary blob is safely stored
    db.commit()
            
    # Cleanup memory/storage: Delete the generated images folder for this SKU
    sku = "unknown"
    if job.product_data:
        sku = job.product_data.get("product_identity", {}).get("sku", "unknown")
        
    from app.tasks.tools.image_generator import _safe_folder_name
    import shutil
    
    safe_sku = _safe_folder_name(sku)
    safe_sku = f"{safe_sku}_{job.id}"
    
    IMAGE_OUTPUT_DIR = os.getenv("IMAGE_OUTPUT_DIR", "output/images")
    folder_to_delete = os.path.join(IMAGE_OUTPUT_DIR, safe_sku)
    if os.path.exists(folder_to_delete):
        try:
            shutil.rmtree(folder_to_delete)
            print(f"Cleaned up images folder: {folder_to_delete}")
        except Exception as e:
            print(f"Failed to clean up images folder {folder_to_delete}: {e}")
                
    # Cleanup reference image cache for this specific job
    reference_cache_dir = os.path.join("output/reference_cache", str(job.id))
    if os.path.exists(reference_cache_dir):
        try:
            shutil.rmtree(reference_cache_dir)
            print(f"Cleaned up reference cache folder: {reference_cache_dir}")
        except Exception as e:
            print(f"Failed to clean up reference cache {reference_cache_dir}: {e}")
            
    return {"status": "success", "message": "Bundle finalized and saved"}

@router.get("/{job_id}/download-zip", summary="Download the generated ZIP file")
def download_generated_zip(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ScrapeTask).filter(ScrapeTask.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
        
    zip_bytes = job.result_data
    if not zip_bytes:
        # Fallback for older bundles
        from app.models.extracted_product import ExtractedProduct
        from app.models.generated_page import GeneratedPage
        extracted = db.query(ExtractedProduct).filter(ExtractedProduct.scrape_task_id == job_id).first()
        if extracted:
            gen_page = db.query(GeneratedPage).filter(GeneratedPage.extracted_product_id == extracted.id).first()
            if gen_page:
                zip_bytes = gen_page.finalized_zip

    if zip_bytes:
        import io
        from fastapi.responses import StreamingResponse
        zip_buffer = io.BytesIO(zip_bytes)
        zip_buffer.seek(0)
        
        safe_name = job.task_name.replace(" ", "_").replace("/", "-")
        filename = f"{safe_name}_bundle.zip"
        if job.result_zip_file and isinstance(job.result_zip_file, dict) and "filename" in job.result_zip_file:
            filename = job.result_zip_file["filename"]
            
        headers = {"Content-Disposition": f"attachment; filename={filename}"}
        
        if job.status == "completed":
            # Keep status as completed so it stays in the Downloads tab
            job.append_activity("downloaded", "User downloaded the final bundle")
            db.commit()
            
        return StreamingResponse(zip_buffer, media_type="application/zip", headers=headers)
            
    raise HTTPException(status_code=404, detail="Zip file not found in database")



@router.get("/stats/status", response_model=list[TaskStatus], summary="Get status breakdown by task")
def get_task_statuses(db: Session = Depends(get_db)):
    tasks = (
        db.query(
            ScrapeTask.task_name,
            func.count(ScrapeTask.id).label("total"),
            func.sum(case((ScrapeTask.status == "success", 1), else_=0)).label("completed"),
            ScrapeTask.status,
        )
        .group_by(ScrapeTask.task_name, ScrapeTask.status)
        .all()
    )

    return [
        TaskStatus(
            task_name=t.task_name,
            completed_percentage=int(round((t.completed / t.total) * 100)) if t.total else 0,
            status=t.status,
        )
        for t in tasks
    ]


@router.post("/search-urls", response_model=SearchUrlsResponse, summary="Search Serper for candidate URLs")
def search_urls(payload: SearchUrlsRequest, current_user: User = Depends(get_current_user)):
    from app.config_loader import get_dynamic_env
    serper_key = get_dynamic_env("SERPER_API_KEY")
    if not serper_key:
        raise HTTPException(status_code=500, detail="SERPER_API_KEY is not configured.")

    try:
        serper_resp = httpx.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
            json={"q": payload.query, "gl": payload.country.lower(), "num": 20}
        )
        serper_resp.raise_for_status()
        organic_results = serper_resp.json().get("organic", [])
        
        seen_domains = set()
        seen_urls = set()
        final_results = []
        
        for item in organic_results:
            link = item.get("link", "")
            if not link or link in seen_urls:
                continue
            
            try:
                domain = urlparse(link).netloc.lower()
                if domain.startswith("www."):
                    domain = domain[4:]
            except:
                domain = link
                
            seen_urls.add(link)
            
            final_results.append(SearchResultItem(
                title=item.get("title", ""),
                url=link,
                snippet=item.get("snippet", ""),
                domain=domain,
                position=len(final_results) + 1
            ))
            
            if len(final_results) >= 10:
                break
                
        return SearchUrlsResponse(results=final_results, total=len(final_results))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
