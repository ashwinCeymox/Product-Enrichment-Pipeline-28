import json
import re
from typing import Optional, List

import extruct
from w3lib.html import get_base_url
from bs4 import BeautifulSoup
from price_parser import Price
from pydantic import BaseModel, Field

# ---------- 1. Define the target schema ----------

class ProductIdentity(BaseModel):
    product_sku: str = ""
    product_barcode: str = ""
    brand: str = ""
    product_name: str = ""
    country_of_origin: str = ""

class Pricing(BaseModel):
    item_retail_price: str = ""
    currency: str = ""

class ProductImage(BaseModel):
    media: str
    media_alt_tag: str = ""

class ProductJSON(BaseModel):
    product_identity: ProductIdentity
    pricing: Pricing
    images: List[ProductImage] = Field(default_factory=list)
    short_description: str = ""
    long_description: str = ""
    meta_title: str = ""
    meta_desc: str = ""

# ---------- 2. Extract structured data (JSON-LD / OG / Microdata) ----------

def extract_structured_data(html: str, url: str) -> dict:
    base_url = get_base_url(html, url)
    try:
        data = extruct.extract(
            html,
            base_url=base_url,
            syntaxes=["json-ld", "opengraph", "microdata"],
            uniform=True,
        )
    except Exception:
        data = {}

    # Pull the first schema.org/Product block out of json-ld, if present
    product = next(
        (item for item in data.get("json-ld", [])
         if isinstance(item, dict) and item.get("@type") == "Product"),
        {}
    )
    
    og_flat = {}
    for block in data.get("opengraph", []):
        if isinstance(block, dict) and "properties" in block:
            for k, v in block.get("properties", {}).items():
                og_flat[k] = v

    return {"product": product, "opengraph": og_flat}

# ---------- 3. Fallback parsing with BeautifulSoup ----------

def extract_fallback(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

    def meta(name=None, prop=None):
        tag = soup.find("meta", attrs={"name": name} if name else {"property": prop})
        return tag["content"].strip() if tag and tag.get("content") else ""

    return {
        "title": soup.title.string.strip() if soup.title and soup.title.string else "",
        "meta_description": meta(name="description"),
        "og_title": meta(prop="og:title"),
        "og_description": meta(prop="og:description"),
        "og_image": meta(prop="og:image"),
    }

# ---------- 4. Price normalization ----------

def extract_price(raw_price_text: str) -> Pricing:
    p = Price.fromstring(raw_price_text or "")
    return Pricing(
        item_retail_price=str(p.amount) if p.amount is not None else "",
        currency=p.currency or "",
    )

# ---------- 5. Map everything into the target schema ----------

def build_product_json(html: str, url: str) -> ProductJSON:
    if not html:
        return ProductJSON(product_identity=ProductIdentity(), pricing=Pricing())
        
    structured = extract_structured_data(html, url)
    fallback = extract_fallback(html)
    product = structured.get("product", {})
    og = structured.get("opengraph", {})

    identity = ProductIdentity(
        product_sku=str(product.get("sku", "") or product.get("id", "") or product.get("mpn", "")),
        brand=str(product.get("brand") if isinstance(product.get("brand"), str)
               else (product.get("brand", {}) or {}).get("name", "")),
        product_name=str(product.get("name", "") or og.get("og:title", "") or fallback["title"]),
    )

    pricing = Pricing()
    offers = product.get("offers")
    if isinstance(offers, dict):
        pricing = extract_price(f"{offers.get('priceCurrency','')} {offers.get('price','')}")
    elif isinstance(offers, list) and len(offers) > 0 and isinstance(offers[0], dict):
        pricing = extract_price(f"{offers[0].get('priceCurrency','')} {offers[0].get('price','')}")

    images = []
    img_url = product.get("image") or og.get("og:image") or fallback["og_image"]
    if isinstance(img_url, list):
        images = [ProductImage(media=str(u)) for u in img_url if u]
    elif isinstance(img_url, str) and img_url:
        images = [ProductImage(media=img_url)]

    return ProductJSON(
        product_identity=identity,
        pricing=pricing,
        images=images,
        short_description=str(product.get("description", "") or og.get("og:description", "") or fallback["meta_description"]),
        long_description=str(product.get("description", "")),
        meta_title=fallback["title"],
        meta_desc=fallback["meta_description"],
    )
