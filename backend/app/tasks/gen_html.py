"""Celery tasks for HTML page generation. Placeholder for Phase 6."""
from app.celery_app import celery_app


@celery_app.task(bind=True, name="app.tasks.gen_html.generate_html_page")
def generate_html_page(self, product_id: str):
    """Assemble approved JSON + approved images into an HTML landing page."""
    # TODO: Phase 6 implementation
    return f"HTML generation placeholder for product {product_id}"
