# Re-export all models so Alembic and create_all can discover them.
from app.models.scrape_task import ScrapeTask          # noqa: F401
from app.models.extracted_product import ExtractedProduct  # noqa: F401
from app.models.image_asset import ImageAsset          # noqa: F401
from app.models.generated_page import GeneratedPage    # noqa: F401
from app.models.user import User                       # noqa: F401
from app.models.system_config import SystemConfig      # noqa: F401
from app.models.category_spec import CategorySpec      # noqa: F401
