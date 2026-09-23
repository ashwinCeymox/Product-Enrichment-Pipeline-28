import os
import aiohttp
from app.services import credit_service
from fastapi import APIRouter, Depends
from app.dependencies import require_superadmin

router = APIRouter(
    prefix="/settings", 
    tags=["Settings"],
    dependencies=[Depends(require_superadmin)]
)

@router.get("/credentials", summary="Get AI Tool Credentials")
def get_credentials():
    return {
        "nano_banana": os.getenv("NANO_BANANA_BEARER_TOKEN", ""),
        "serper": os.getenv("SERPER_API_KEY", ""),
        "openrouter": os.getenv("OPENROUTER_API_KEY", "")
    }

from pydantic import BaseModel
class CredentialsUpdate(BaseModel):
    openrouter: str | None = None
    serper: str | None = None

@router.post("/credentials", summary="Update AI Tool Credentials")
def update_credentials(payload: CredentialsUpdate):
    import dotenv
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
    
    updates = {
        "OPENROUTER_API_KEY": payload.openrouter,
        "SERPER_API_KEY": payload.serper
    }
    
    for key, val in updates.items():
        if val is not None:
            if val == "":
                dotenv.unset_key(env_file, key)
                if key in os.environ:
                    del os.environ[key]
            else:
                # Update the file
                dotenv.set_key(env_file, key, val)
                # Update memory so it works instantly without a server restart
                os.environ[key] = val
            
    return {"status": "success", "message": "Credentials saved"}

@router.post("/verify/openrouter", summary="Verify OpenRouter Key")
async def verify_openrouter():
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        return {"status": "error", "message": "Key not set"}
    async with aiohttp.ClientSession() as session:
        headers = {"Authorization": f"Bearer {key}"}
        async with session.get("https://openrouter.ai/api/v1/auth/key", headers=headers) as resp:
            if resp.status == 200:
                data = await resp.json()
                label = data.get("data", {}).get("label", "Valid Key")
                
                # Fetch balance via credits endpoint
                try:
                    credits_remaining = await credit_service.fetch_openrouter_credits()
                    
                    # Refresh the credit cache so REMAINING CREDITS badge updates
                    credit_service._set_float(credit_service.KEY_ACTUAL, credits_remaining)
                    credit_service._set_float(credit_service.KEY_EXPECTED, credits_remaining)
                except Exception:
                    credits_remaining = None

                return {
                    "status": "success", 
                    "message": f"Verified ({label})",
                    "credits_remaining": f"${credits_remaining:.4f}" if credits_remaining is not None else "Balance unavailable"
                }
            else:
                return {"status": "error", "message": f"HTTP {resp.status}"}

@router.post("/verify/deepseek", summary="Verify Deepseek Key")
async def verify_deepseek():
    key = os.getenv("DEEPSEEK_API_KEY", "")
    if not key:
        return {"status": "error", "message": "Key not set"}
    async with aiohttp.ClientSession() as session:
        # First verify the key is valid
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        async with session.get("https://api.deepseek.com/models", headers=headers) as resp:
            if resp.status != 200:
                return {"status": "error", "message": f"HTTP {resp.status}"}
        
        # Then fetch balance info
        headers_balance = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
        try:
            async with session.get("https://api.deepseek.com/user/balance", headers=headers_balance) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    credits_remaining = None
                    for info in data.get("balance_infos", []):
                        if info.get("currency") == "USD":
                            credits_remaining = round(float(info.get("total_balance", 0)), 4)
                            break
                    if credits_remaining is None:
                        for info in data.get("balance_infos", []):
                            if info.get("currency") == "CNY":
                                credits_remaining = round(float(info.get("total_balance", 0)) / 7.25, 4)
                                break
                    return {
                        "status": "success",
                        "message": "Key is valid",
                        "credits_remaining": credits_remaining
                    }
        except Exception:
            pass
        
        return {"status": "success", "message": "Key is valid"}

@router.post("/verify/serper", summary="Verify Serper Key")
async def verify_serper():
    key = os.getenv("SERPER_API_KEY", "")
    if not key:
        return {"status": "error", "message": "Key not set"}
    async with aiohttp.ClientSession() as session:
        headers = {"X-API-KEY": key, "Content-Type": "application/json"}
        payload = {"q": "test"}
        async with session.post("https://google.serper.dev/search", headers=headers, json=payload) as resp:
            if resp.status == 200:
                return {"status": "success", "message": "Key is valid"}
            else:
                return {"status": "error", "message": f"HTTP {resp.status}"}

from sqlalchemy.orm import Session
from app.database import get_db
from app.models.category_spec import CategorySpec
from typing import List

class CategorySpecBase(BaseModel):
    category_name: str
    specifications: List[str]

@router.get("/category-specs", summary="Get all Category Specifications")
def get_category_specs(db: Session = Depends(get_db)):
    specs = db.query(CategorySpec).all()
    return [{"id": s.id, "category_name": s.category_name, "specifications": s.specifications} for s in specs]

@router.post("/category-specs", summary="Create or Update Category Specification")
def save_category_spec(payload: CategorySpecBase, db: Session = Depends(get_db)):
    spec = db.query(CategorySpec).filter(CategorySpec.category_name == payload.category_name).first()
    if spec:
        spec.specifications = payload.specifications
    else:
        spec = CategorySpec(category_name=payload.category_name, specifications=payload.specifications)
        db.add(spec)
    db.commit()
    return {"status": "success", "message": "Category Specification saved"}

@router.delete("/category-specs/{spec_id}", summary="Delete Category Specification")
def delete_category_spec(spec_id: str, db: Session = Depends(get_db)):
    spec = db.query(CategorySpec).filter(CategorySpec.id == spec_id).first()
    if spec:
        db.delete(spec)
        db.commit()
    return {"status": "success", "message": "Deleted"}

@router.get("/models", summary="Get configured AI Models")
def get_models():
    from app.config_loader import get_dynamic_env
    return {
        "scraping_model": get_dynamic_env("SCRAPING_MODEL", "deepseek/deepseek-chat"),
        "image_generation_model": get_dynamic_env("IMAGE_GENERATION_MODEL", "google/gemini-2.5-flash-image")
    }

class ModelsUpdate(BaseModel):
    scraping_model: str | None = None
    image_generation_model: str | None = None

@router.post("/models", summary="Update AI Models Configuration")
def update_models(payload: ModelsUpdate):
    import dotenv
    env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")
    
    updates = {
        "SCRAPING_MODEL": payload.scraping_model,
        "IMAGE_GENERATION_MODEL": payload.image_generation_model
    }
    
    for key, val in updates.items():
        if val is not None:
            if val == "":
                dotenv.unset_key(env_file, key)
                if key in os.environ:
                    del os.environ[key]
            else:
                dotenv.set_key(env_file, key, val)
                os.environ[key] = val
            
    return {"status": "success", "message": "Models saved successfully"}

@router.get("/openrouter-models", summary="Fetch available models from OpenRouter")
async def get_openrouter_models():
    from app.config_loader import get_dynamic_env
    key = get_dynamic_env("OPENROUTER_API_KEY", "")
    if not key:
        return {"status": "error", "message": "OpenRouter API Key not configured"}
    
    async with aiohttp.ClientSession() as session:
        headers = {"Authorization": f"Bearer {key}"}
        async with session.get("https://openrouter.ai/api/v1/models", headers=headers) as resp:
            if resp.status == 200:
                data = await resp.json()
                models = data.get("data", [])
                
                # Format to a simplified list for the dropdown
                formatted_models = []
                for m in models:
                    formatted_models.append({
                        "id": m.get("id"),
                        "name": m.get("name"),
                        "context_length": m.get("context_length"),
                        "pricing": m.get("pricing")
                    })
                
                return {"status": "success", "models": formatted_models}
            else:
                return {"status": "error", "message": f"HTTP {resp.status} from OpenRouter"}


