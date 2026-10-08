"""
Dashboard stats router.
Provides aggregate statistics across all pipeline tables.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.scrape_task import ScrapeTask
from app.models.extracted_product import ExtractedProduct
from app.models.image_asset import ImageAsset
from app.models.generated_page import GeneratedPage
from app.schemas.dashboard import (
    DashboardStats,
    PendingApprovalBreakdown,
    RecentActivityItem,
    RecentActivityResponse,
)
from app.dependencies import get_current_user

router = APIRouter(
    prefix="/dashboard", 
    tags=["Dashboard"],
    dependencies=[Depends(get_current_user)]
)


@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    total_jobs = db.query(ScrapeTask).count()
    completed = db.query(ScrapeTask).filter(ScrapeTask.status == "completed").count()
    failed = db.query(ScrapeTask).filter(ScrapeTask.status.in_(["failed", "aborted"])).count()

    # Pending approvals breakdown
    json_pending = db.query(ScrapeTask).filter(ScrapeTask.status == "waiting_for_approval").count()
    img_pending = db.query(ScrapeTask).filter(ScrapeTask.status.in_([
        "image_generation", 
        "image_generation_stopped",
        "image_generation_complete",
        "image_generation_failed"
    ])).count()
    from app.models.generated_page import GeneratedPage
    html_pending = db.query(GeneratedPage).filter(GeneratedPage.status == "pending").count()

    return DashboardStats(
        total_jobs=total_jobs,
        pending_approvals=json_pending + img_pending + html_pending,
        approval_breakdown=PendingApprovalBreakdown(
            json_count=json_pending,
            image_count=img_pending,
            html_count=html_pending,
        ),
        completed=completed,
        failed=failed,
    )


def get_task_stage_and_status(status: str):
    if status == 'waiting_for_approval':
        return 'JSON_REVIEW', 'PENDING_APPROVAL'
    elif status in ['image_generation', 'image_generation_stopped', 'image_generation_complete', 'image_generation_failed']:
        return 'IMAGE_REVIEW', 'PENDING_APPROVAL'
    elif status == 'html_generation':
        return 'HTML_REVIEW', 'PENDING_APPROVAL'
    elif status == 'bundle_generation':
        return 'BUNDLE_REVIEW', 'PENDING_APPROVAL'
    elif status in ['success', 'completed']:
        return 'COMPLETED', 'SUCCESS'
    elif status in ['failed', 'aborted']:
        return 'FAILED', 'ERROR'
    else:
        return 'PROCESSING', 'IN_PROGRESS'

@router.get("/recent-activity", response_model=RecentActivityResponse)
def get_recent_activity(limit: int = 20, db: Session = Depends(get_db)):
    tasks = (
        db.query(ScrapeTask)
        .order_by(ScrapeTask.created_at.desc())
        .limit(limit)
        .all()
    )
    items = []
    for t in tasks:
        stage, current_status = get_task_stage_and_status(t.status)

        # Extract the product name from whichever data field has it
        product_name = None
        for data in [t.source_data, t.product_data]:
            if isinstance(data, dict):
                identity = data.get("product_identity", {})
                product_name = identity.get("product_name") or identity.get("brand")
                if product_name:
                    break

        items.append(RecentActivityItem(
            job_id=t.id,
            task_id=t.id,
            task_name=t.task_name,
            source_url=t.url,
            status=t.status,
            current_stage=stage,
            current_status=current_status,
            progress=t.progress or 0,
            created_at=t.created_at,
            error_message=t.error_message,
            generate_ai_images=t.generate_ai_images,
            product_name=product_name,
        ))
    return RecentActivityResponse(items=items)

@router.get("/error-logs", response_model=RecentActivityResponse)
def get_error_logs(limit: int = 100, db: Session = Depends(get_db)):
    tasks = (
        db.query(ScrapeTask)
        .filter(ScrapeTask.status.in_(["failed", "aborted"]))
        .order_by(ScrapeTask.created_at.desc())
        .limit(limit)
        .all()
    )
    items = []
    for t in tasks:
        stage, current_status = get_task_stage_and_status(t.status)
        items.append(RecentActivityItem(
            job_id=t.id,
            task_id=t.id,
            task_name=t.task_name,
            source_url=t.url,
            priority=t.priority,
            product_type=t.product_type,
            status=t.status,
            current_stage=stage,
            current_status=current_status,
            progress=t.progress or 0,
            created_at=t.created_at,
            error_message=t.error_message,
            generate_ai_images=t.generate_ai_images,
        ))
    return RecentActivityResponse(items=items)
