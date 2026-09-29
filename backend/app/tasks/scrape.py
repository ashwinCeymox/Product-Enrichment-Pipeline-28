"""
Celery tasks for scraping and scheduled job dispatch.
"""
from app.celery_app import celery_app
from app.database import SessionLocal
from app.models.scrape_task import ScrapeTask

from datetime import date
import re
from urllib.parse import urljoin
from bs4 import BeautifulSoup

def extract_all_images(html_content, base_url, soup=None):
    import re
    from urllib.parse import urljoin, urlparse
    if not soup:
        soup = BeautifulSoup(html_content, "html.parser")
        
    site_images = []
    seen_urls = set()

    def add_image(src, alt=""):
        if not src:
            return
        if ',' in src and ' ' in src:
            # Taking the LAST element in a srcset usually yields the highest resolution image
            # e.g., "img.jpg 300w, img-large.jpg 1000w" -> "img-large.jpg"
            src = src.split(',')[-1].strip().split(' ')[0]
            
        if src.startswith('data:'):
            return
        abs_src = urljoin(base_url, src)
        
        lower_src = abs_src.lower()
        # Filter junk/tracking pixels
        if any(j in lower_src for j in ['1x1', 'base64', 'sprite', 'icon', 'nav-', 'logo', 'banner', '.gif']):
            return
            
        if abs_src in seen_urls:
            return
            
        seen_urls.add(abs_src)
        
        img_str = f"Image: {abs_src} | Alt: {alt}"
        site_images.append(img_str)

    for element in soup.find_all(['img', 'source']):
        src = element.get('data-src') or element.get('data-original') or element.get('data-lazy-src') or element.get('srcset') or element.get('data-srcset') or element.get('src')
        alt = element.get('alt', '')
        add_image(src, alt)
        
    regex_urls = re.findall(r'https?(?::|\\\\u003a)?(?:/|\\\\/){2}[^\s\"\'<>;&\[\]\{\}]+\.(?:jpg|jpeg|png|webp)', html_content, re.IGNORECASE)
    for raw_url in regex_urls:
        raw_url = raw_url.replace("\\/", "/").replace("\\u003a", ":").replace("\\U003A", ":")
        add_image(raw_url, "Extracted via regex")
        
    return site_images


@celery_app.task(bind=True, name="app.tasks.scrape.process_scrape")
def process_scrape(self, task_id: str):
    """
    Phase 1: Scrape the URL, compress HTML, run AI extraction.
    Writes results to extracted_products and updates scrape_task status.
    """
    db = SessionLocal()
    try:
        task = db.query(ScrapeTask).filter(ScrapeTask.id == task_id).first()
        if not task:
            return f"Task {task_id} not found"


        # --- BrowserBase Pipeline Initialization ---
        import time
        from bs4 import BeautifulSoup
        import json
        import os
        import httpx
        from litellm import completion
        
        from app.config_loader import get_dynamic_env
        openrouter_key = get_dynamic_env("OPENROUTER_API_KEY")
        serper_key = get_dynamic_env("SERPER_API_KEY")
        
        if not openrouter_key:
            task.append_activity("error", "OPENROUTER_API_KEY is not configured.")
            db.commit()
            return
        if not serper_key:
            task.append_activity("error", "SERPER_API_KEY is not configured.")
            db.commit()
            return
        
        import logging
        logger = logging.getLogger(__name__)

        def fetch_via_steel_mcp(target_url):
            import asyncio
            import json
            from mcp import ClientSession
            from mcp.client.stdio import stdio_client, StdioServerParameters
            import sys
            
            async def _run():
                try:
                    params = StdioServerParameters(
                        command="node",
                        args=["/opt/steel-mcp-server/dist/stdio.js"],
                        env={
                            "STEEL_LOCAL": "true",
                            "STEEL_BASE_URL": "http://steel-api:3000",
                            "GLOBAL_WAIT_SECONDS": "1",
                            "PATH": "/usr/local/bin:/usr/bin:/bin"
                        }
                    )
                    
                    async with stdio_client(params, errlog=sys.__stderr__) as (read, write):
                        async with ClientSession(read, write) as session:
                            await session.initialize()
                            
                            import asyncio
                            import re

                            full_text = ""
                            
                            args = {
                                "url": target_url,
                                "format": ["html"],
                                "max_tokens": 100000,
                                "delay_ms": 5000,
                            }

                            result = await asyncio.wait_for(
                                session.call_tool("steel_scrape", arguments=args),
                                timeout=60
                            )
                            
                            if getattr(result, "isError", False):
                                err_msg = str(result.content)
                                logger.error(f"steel_scrape failed for {target_url}: {err_msg}")
                                return None
                            
                            content_pieces = result.content if hasattr(result, "content") else []
                            chunk_text = ""
                            for piece in content_pieces:
                                if hasattr(piece, "text"): chunk_text += piece.text
                                elif isinstance(piece, str): chunk_text += piece
                                    
                            # Remove any pagination cursor message that might be injected at the bottom
                            match = re.search(r'### Pagination\s*Truncated at the token budget.*?cursor="([^"]+)"', chunk_text, re.DOTALL)
                            if match:
                                chunk_text = chunk_text[:match.start()]
                            
                            full_text = chunk_text
                            return full_text
                except Exception as e:
                    logger.error(f"MCP Fetch Failed for {target_url}: {e}. Falling back to standard requests.")
                    import requests
                    try:
                        resp = requests.get(target_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
                        if resp.status_code == 200:
                            return resp.text
                    except Exception as req_err:
                        logger.error(f"Fallback requests failed: {req_err}")
                    return None
            
            try:
                return asyncio.run(asyncio.wait_for(_run(), timeout=180.0))
            except Exception as e:
                logger.error(f"MCP Subprocess Error for {target_url}: {e}")
                # Ultimate fallback
                import requests
                try:
                    resp = requests.get(target_url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
                    return resp.text if resp.status_code == 200 else None
                except:
                    return None
                return None

        def bulk_image_extraction(query: str):
            """
            Separate, simpler pipeline for bulk image collection.
            STEP 1: Serper integration
            STEP 2: Image URL extraction per site
            STEP 3: Output format
            STEP 4: Error handling
            """
            import os
            import httpx
            from urllib.parse import urljoin
            from bs4 import BeautifulSoup
            
            serper_api_key = get_dynamic_env("SERPER_API_KEY")
            if not serper_api_key or not serper_api_key.strip():
                raise ValueError("SERPER_API_KEY is missing from environment")

            # Step 1: Serper Search
            try:
                serper_resp = httpx.post(
                    "https://google.serper.dev/search",
                    headers={"X-API-KEY": serper_api_key, "Content-Type": "application/json"},
                    json={"q": query},
                    timeout=15.0
                )
                serper_resp.raise_for_status()
            except Exception as e:
                raise RuntimeError(f"Serper API request failed: {e}")
            
            organic_results = serper_resp.json().get("organic", [])
            top_urls = [item["link"] for item in organic_results if "link" in item][:3]

            results = []

            # Step 2 & 4: Scrape each URL, handling errors gracefully
            for url in top_urls:
                html_content = fetch_via_steel_mcp(url)
                if not html_content:
                    logger.warning(f"Skipping {url} due to MCP scrape failure.")
                    continue
                
                import re
                
                # Parse HTML for images via standard tags
                soup = BeautifulSoup(html_content, "html.parser")
                site_images = []
                seen_images = set()

                def add_image(src):
                    if not src:
                        return
                    if ',' in src and ' ' in src:
                        src = src.split(',')[0].strip().split(' ')[0]
                    if src.startswith('data:'):
                        return
                    abs_src = urljoin(url, src)
                    
                    # Filter junk
                    lower_src = abs_src.lower()
                    if any(j in lower_src for j in ['1x1', 'base64', 'sprite', 'icon', 'nav-', 'logo', 'banner', '.gif']):
                        return
                        
                    if abs_src not in seen_images:
                        seen_images.add(abs_src)
                        site_images.append(abs_src)

                # 1. Standard DOM attribute search
                for element in soup.find_all(['img', 'source']):
                    src = element.get('data-src') or element.get('data-original') or element.get('data-lazy-src') or element.get('srcset') or element.get('data-srcset') or element.get('src')
                    add_image(src)
                
                # 2. Aggressive regex search for hidden JSON blobs and custom attributes
                regex_urls = re.findall(r'https?(?::|\\\\u003a)?(?:/|\\\\/){2}[^\s\"\'<>;&\[\]\{\}]+\.(?:jpg|jpeg|png|webp)', html_content, re.IGNORECASE)
                for raw_url in regex_urls:
                    raw_url = raw_url.replace("\\/", "/").replace("\\u003a", ":").replace("\\U003A", ":")
                    add_image(raw_url)
                
                # Step 3: Output Format
                results.append({
                    "site_url": url,
                    "image_urls": site_images
                })

            return results

        # Phase 1: Fetch initial URL
        task.status = "scraping"
        task.progress = 30
        task.append_activity("scraping", f"Fetching HTML via Steel MCP from {task.url}")
        db.commit()

        try:
            html_content = fetch_via_steel_mcp(task.url)
        except Exception as e:
            raise Exception(f"Steel MCP fetch failed: {e}")

        # Compress HTML using BeautifulSoup
        if not html_content:
            raise Exception("Steel MCP returned empty content for the primary URL.")
        soup = BeautifulSoup(html_content, "html.parser")
        for el in soup(["script", "style", "svg", "noscript", "header", "footer", "nav"]):
            el.extract()
            
        clean_text = soup.get_text(separator=" ", strip=True)
        
        # Manually extract images so LLM can see them
        unique_images = extract_all_images(html_content, task.url, soup)
        seen = set(unique_images)
        task.append_activity("scraping", f"Found {len(unique_images)} images on primary URL")
        db.commit()
                
        images_context = "\n".join(unique_images)

        task.status = "ai_processing"
        task.progress = 60
        task.raw_html = soup.prettify()
        task.append_activity("ai_processing", "HTML compressed, running extraction")
        db.commit()

        title = soup.find("meta", property="og:title")
        description = soup.find("meta", property="og:description")
        image = soup.find("meta", property="og:image")
        
        title_val = title["content"] if title else soup.title.string if soup.title else "Unknown Product"
        desc_val = description["content"] if description else clean_text[:200] + "..."
        img_val = image["content"] if image else ""

        visited_urls = [task.url]
        
        product_data = {}
        if openrouter_key and openrouter_key.strip():
            # --- PHASE A: SOURCE EXTRACTION VIA AGENT ---
            task.append_activity("ai_processing", "Running AI Agent to navigate and extract source_data")
            db.commit()
            
            from app.tasks.agent import run_steel_agent
            schema_instruction = """
            {
              "product_identity": {
                "product_sku": "",
                "product_parent_sku": "",
                "product_barcode": "",
                "brand": "",
                "Country of Origin": "",
                "product_name": "",
                "Variant 1": "",
                "Variant 2": "",
                "Variant 3": "",
                "Variant Value 1": "",
                "Variant Value 2": "",
                "Variant Value 3": "",
                "product_box_weight": "",
                "product_CBM": "",
                "product_length": "",
                "product_breadth": "",
                "product_height": ""
              },
              "pricing_and_availability": {"price": "", "compare_at_price": "", "currency": "", "stock_status": true},
              "descriptions": {"short_description": "", "full_description": ""},
              "attributes": {"key": "value"},
              "features": ["feature 1"],
              "specifications": {"key": "value"},
              "breadcrumbs": ["Home"],
              "shipping_and_returns": {"shipping_info": "", "warranty_info": ""}
            }
            """
            agent_result = run_steel_agent(task.url, schema_instruction, "", openrouter_key)
            
            source_data = {}
            
            # Agent result might be enclosed in markdown JSON blocks
            clean_res = agent_result.replace("```json", "").replace("```", "").strip()
            try:
                source_data = json.loads(clean_res)
            except Exception as parse_e:
                # Fallback to standard extraction if agent failed to return pure JSON
                task.append_activity("ai_processing", f"Agent JSON parse failed ({parse_e}), falling back to text extraction")
                from app.tasks.source_extraction import extract_source_data
                source_data = extract_source_data(agent_result + "\n\n" + clean_text, unique_images, openrouter_key)
                
            task.source_data = source_data
            db.commit()
            
            product_name = source_data.get("product_identity", {}).get("product_name") or title_val
            
            # --- PHASE 3: Serper + DeepSeek URL Validation Gate + MCP Competitor Scrape ---
            serper_data = ""
            competitor_htmls = []
            urls_to_fetch = []

            # Domains that are always blocked from competitor scraping
            BLOCKED_DOMAINS = {
                "youtube.com", "youtu.be", "instagram.com", "facebook.com",
                "twitter.com", "x.com", "tiktok.com", "pinterest.com",
                "reddit.com", "linkedin.com", "snapchat.com"
            }

            def get_domain(url):
                try:
                    from urllib.parse import urlparse
                    return urlparse(url).netloc.lower().replace("www.", "")
                except Exception:
                    return ""

            input_domain = get_domain(str(task.url))

            
            if getattr(task, 'reference_urls', None) and isinstance(task.reference_urls, list) and len(task.reference_urls) > 0:
                urls_to_fetch = task.reference_urls
                task.append_activity("scraping", f"Using {len(urls_to_fetch)} manual reference URLs (bypassing Serper competitor search)")
                db.commit()
            elif serper_key and serper_key.strip() and product_name:
                pi = source_data.get("product_identity", {})
                sku = pi.get("sku", "") or pi.get("product_sku", "") or ""
                model = pi.get("model", "") or ""
                upc = pi.get("upc", "") or ""
                brand = pi.get("brand", "") or ""

                identifiers = " ".join([i for i in [sku, model, upc, brand] if str(i).strip()])
                search_query = f"{product_name} {identifiers} specifications details".replace("  ", " ").strip()
                task.append_activity("ai_processing", f"Querying Serper for '{search_query}'")
                db.commit()
                try:
                    # Sub-step 3A: Fetch wider result set (10 results)
                    serper_resp = httpx.post(
                        "https://google.serper.dev/search",
                        headers={"X-API-KEY": serper_key, "Content-Type": "application/json"},
                        json={"q": search_query, "num": 10}
                    )
                    serper_resp.raise_for_status()
                    organic_results = serper_resp.json().get("organic", [])
                    serper_data = json.dumps(organic_results[:5])

                    # Sub-step 3B: Python hard pre-filter (no AI cost)
                    pre_filtered = []
                    for item in organic_results:
                        link = item.get("link", "")
                        domain = get_domain(link)
                        if not link:
                            continue
                        if domain in BLOCKED_DOMAINS:
                            task.append_activity("scraping", f"Blocked social/video URL: {link}")
                            continue
                        if domain == input_domain:
                            task.append_activity("scraping", f"Blocked same-domain as input: {link}")
                            continue
                        pre_filtered.append(item)

                    db.commit()

                    # Sub-step 3C: DeepSeek URL Validation Gate
                    if pre_filtered and openrouter_key:
                        candidates_text = "\n".join([
                            f"{i+1}. URL: {item['link']}\n   Snippet: {item.get('snippet', 'No snippet')}"
                            for i, item in enumerate(pre_filtered[:10])
                        ])
                        validation_prompt = (
                            f"Product we are enriching:\n"
                            f"  Brand: {brand}\n"
                            f"  Name: {product_name}\n"
                            f"  Model: {model}\n"
                            f"  SKU: {sku}\n\n"
                            f"Candidate competitor URLs from Google Search (Preserving Serper Sort Order):\n{candidates_text}\n\n"
                            f"Task: Review each URL's snippet and return ONLY the URLs that are "
                            f"definitely for the EXACT SAME product (matching Brand, Model, or SKU). "
                            f"CRITICAL: Give high priority to the search engine's original sorting order—candidates higher in the list (e.g. 1, 2) are typically the most relevant. "
                            f"Reject any URL that is for a different product/brand, a generic category page, "
                            f"a brand homepage, or has no product-specific snippet. "
                            f"Select a maximum of 3 best matching URLs. "
                            f'Return ONLY valid JSON in this format: {{"valid_urls": ["url1", "url2"]}}'
                        )
                        try:
                            from app.utils.json_utils import sanitize_llm_json
                            actual_val_model = task.text_model_override if getattr(task, 'text_model_override', None) else get_dynamic_env('SCRAPING_MODEL', 'deepseek/deepseek-chat')
                            val_resp = completion(
                                model=f"openrouter/{actual_val_model}",
                                messages=[
                                    {"role": "system", "content": "You are a strict product URL validator.\n\nRULES:\n1. Your ONLY job is to filter a list of URLs.\n2. Focus closely on matching the BRAND NAME and product identifiers.\n3. Respect the provided sort order (item 1 is most relevant).\n4. Output ONLY raw JSON. No markdown fences.\n5. Format MUST be exactly: {\"valid_urls\": [\"url1\", \"url2\"]}"},
                                    {"role": "user", "content": validation_prompt}
                                ],
                                api_key=openrouter_key,
                                max_tokens=512,
                                temperature=0.0,
                                response_format={"type": "json_object"}
                            )
                            raw_val = val_resp.choices[0].message.content or ""
                            val_json = json.loads(sanitize_llm_json(raw_val))
                            urls_to_fetch = val_json.get("valid_urls", [])[:3]
                            task.append_activity("ai_processing", f"AI validated {len(urls_to_fetch)} competitor URLs: {urls_to_fetch}")
                        except Exception as ve:
                            # Fallback: use pre-filtered list if validation fails
                            urls_to_fetch = [item["link"] for item in pre_filtered[:3]]
                            task.append_activity("ai_processing", f"URL validation failed ({ve}), using pre-filtered URLs")
                    else:
                        urls_to_fetch = [item["link"] for item in pre_filtered[:3]]

                    db.commit()
                except Exception as se:
                    print(f"Serper/Validation error: {se}")

            # Sub-step 3D: MCP scrape only the validated/manual URLs
            if urls_to_fetch:
                task.append_activity("scraping", f"Fetching {len(urls_to_fetch)} competitor/reference URLs via Steel MCP")
                db.commit()

                import concurrent.futures
                def fetch_bb(u):
                    try:
                        c = fetch_via_steel_mcp(u)
                        if not c:
                            return (f"--- Competitor URL: {u} ---\nContent: Empty response from Steel MCP.", [], None)
                        
                        from app.tasks.structured_extraction import build_product_json
                        comp_json = build_product_json(c, u)
                        
                        s = BeautifulSoup(c, "html.parser")
                        for el in s(["script", "style", "svg", "noscript", "header", "footer", "nav"]):
                            el.extract()
                        c_imgs = extract_all_images(c, u, s)
                        
                        return (f"--- Competitor URL: {u} ---\nSTRUCTURED JSON-LD DATA:\n{comp_json.model_dump_json(indent=2)}\n\nVISIBLE TEXT:\n{s.get_text(separator=' ', strip=True)}", c_imgs, u)
                    except Exception as ex:
                        return (f"--- Competitor URL: {u} ---\nContent: Failed to fetch ({ex})", [], None)

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    results = list(executor.map(fetch_bb, urls_to_fetch))
                    for text, c_imgs, u in results:
                        competitor_htmls.append(text)
                        if u:
                            visited_urls.append(u)
                        for img_str in c_imgs:
                            if img_str not in seen:
                                seen.add(img_str)
                                unique_images.append(img_str)

                images_context = "\n".join(unique_images)
                task.append_activity("scraping", f"Total unique images after competitors: {len(unique_images)}")
                db.commit()

            # --- TOKEN SAVING IMAGE COMPRESSION ---
            compressed_images_text = ""
            ENRICH_IMAGES_FROM_COMPETITORS = True
            if ENRICH_IMAGES_FROM_COMPETITORS and unique_images:
                try:
                    dense_imgs = []
                    seen_urls = set()
                    for img_str in unique_images:
                        parts = img_str.split(" | Alt: ")
                        url_part = parts[0].replace("Image: ", "").strip()
                        alt_part = parts[1].strip() if len(parts) > 1 else ""
                        if not url_part or url_part in seen_urls:
                            continue
                        seen_urls.add(url_part)
                        dense_imgs.append(f"{url_part}|{alt_part}")
                        
                    compressed_images_text = "\n".join(dense_imgs)
                    if isinstance(source_data, dict) and "images" in source_data:
                        del source_data["images"]
                    task.append_activity("scraping", f"Compressed {len(dense_imgs)} unique images for token-efficient LLM prompt")
                    db.commit()
                except Exception as img_inject_err:
                    logger.warning(f"Non-fatal: Failed to compress images: {img_inject_err}")
            # --- END TOKEN SAVING ---

            # Read the user's detailed system prompt
            system_prompt_path = os.path.join(os.path.dirname(__file__), "system_prompt.txt")
            try:
                with open(system_prompt_path, "r", encoding="utf-8") as f:
                    system_prompt_text = f.read()
            except Exception as e:
                system_prompt_text = "You are a product enrichment agent."

            from app.models.category_spec import CategorySpec
            category_specs = db.query(CategorySpec).all()
            if category_specs:
                rules = "CATEGORY-BASED SPECIFICATION RULES:\n"
                rules += "1. Determine the product category.\n"
                rules += "2. Here are the allowed specification fields for specific categories:\n"
                for c in category_specs:
                    rules += f"   - '{c.category_name}': {json.dumps(c.specifications)}\n"
                rules += "\nIMPORTANT DATA FORMATTING HINTS:\n"
                rules += "- If a specification key contains 'CBM', it stands for 'Cubic Meter'. Please extract or format the value appropriately.\n\n"
                
                # Check if user has manually forced a category via reschedule override
                category_override = getattr(task, 'category_override', None)
                if category_override:
                    matching = next((c for c in category_specs if c.category_name.lower() == category_override.lower()), None)
                    if matching:
                        rules += f"3. The user has MANUALLY FORCED the category to '{matching.category_name}'. STRICT ENFORCEMENT: The \"specifications\" dictionary MUST contain EXACTLY these keys: {json.dumps(matching.specifications)}. Do NOT omit ANY keys. If data is missing, output the key with value \"N/A\". Extra specs NOT in this list MUST go into a separate dictionary named \"additional_features\".\n"
                    else:
                        rules += f"3. The user tried to force category '{category_override}' but it was not found. Try your best to match the product.\n"
                else:
                    rules += "3. Identify which single category above BEST MATCHES this product. STRICT ENFORCEMENT: The \"specifications\" dictionary MUST contain EXACTLY all the keys listed for that matched category. Do NOT omit ANY keys. If data is missing, output the key with value \"N/A\". Extra specs NOT in this list MUST go into a separate dictionary named \"additional_features\".\n"
                    rules += "4. If you cannot confidently match the product to ANY of the listed categories above, you MUST output a JSON object with ONLY this field: {\"category_error\": \"No matching category found\"} and nothing else.\n"
                    rules += "5. Any extra specifications found that are not in the matched category's allowed list MUST be placed in the `additional_features` dictionary (e.g. {\"Bluetooth\": \"v5.0\"}).\n"
                system_prompt_text += "\n\n" + rules
            # --- PHASE B: AI ENRICHMENT ---
            task.append_activity("ai_processing", "Finalizing JSON with AI agent using combined context")
            db.commit()
            
            # Generate JSON-LD structure for primary URL
            from app.tasks.structured_extraction import build_product_json
            primary_json = build_product_json(html_content, task.url)

            # Truncate text FAIRLY to avoid exceeding model context limits, ensuring all competitors are included
            max_total_len = 30000
            if competitor_htmls:
                max_per_comp = max_total_len // len(competitor_htmls)
                truncated_comps = [c[:max_per_comp] for c in competitor_htmls]
                competitor_text = "\n\n".join(truncated_comps)
            else:
                competitor_text = ""
            
            # --- REVERSIBLE FIX: Improve image preservation in Phase 2 prompt ---
            PRESERVE_ALL_SCRAPED_IMAGES = True
            if PRESERVE_ALL_SCRAPED_IMAGES:
                image_instruction = (
                    "For the 'images' array, you MUST use the following raw images we scraped.\n"
                    "Format each as {\"media_type\": \"image\", \"media\": \"URL\", \"media_alt_tag\": \"ALT\"}.\n"
                    "Sort them strictly based on relevance (best hero product shots first). Filter out any payment/bank banners, pure logos, or UI buttons if any slipped through.\n"
                    f"RAW SCRAPED IMAGES (Format: URL|ALT):\n{compressed_images_text}\n"
                    "Do NOT drop valid product images."
                )
            else:
                image_instruction = "For the 'images' array, rely on the images extracted in the JSON-LD data."
            # --- END REVERSIBLE FIX ---
            
            prompt2 = f"Primary URL STRUCTURED JSON-LD:\n{primary_json.model_dump_json(indent=2)}\n\nPhase 1 Agent Data (Structured JSON):\n{json.dumps(source_data, indent=2)}\n\nExtra Search Context (Serper):\n{serper_data}\n\nCompetitor Content:\n{competitor_text}\n\nMerge the Competitor Content and JSON-LD data into the Source Data to enrich it, filling in any missing fields. {image_instruction} Output the final JSON exactly as specified in the OUTPUT FORMAT."
            
            # Save the LLM prompt alongside raw HTML so the frontend can display both
            existing_html = task.raw_html or ""
            # Strip out any previous Prompt2 if this is a reschedule to avoid infinite growing
            if "\n<!--LLM_INPUT_2_DELIMITER-->\n" in existing_html:
                existing_html = existing_html.split("\n<!--LLM_INPUT_2_DELIMITER-->\n")[0]
            json_ld_display = f"Primary URL STRUCTURED JSON-LD:\n{primary_json.model_dump_json(indent=2)}"
            task.raw_html = json_ld_display + "\n<!--LLM_INPUT_DELIMITER-->\n" + existing_html + "\n<!--LLM_INPUT_2_DELIMITER-->\n" + prompt2
            db.commit()
            
            logger.info("FINAL LLM INPUT (PROMPT 2):")
            logger.info(prompt2)
            
            try:
                from app.utils.json_utils import sanitize_llm_json
                actual_model = task.text_model_override if getattr(task, 'text_model_override', None) else get_dynamic_env('SCRAPING_MODEL', 'deepseek/deepseek-chat')
                ai_resp2 = completion(
                    model=f"openrouter/{actual_model}",
                    messages=[
                        {"role": "system", "content": system_prompt_text},
                        {"role": "user", "content": prompt2}
                    ],
                    api_key=openrouter_key,
                    max_tokens=8192,
                    temperature=0.15,
                    response_format={"type": "json_object"}
                )
                raw_content = ai_resp2.choices[0].message.content or ""
                clean_content = sanitize_llm_json(raw_content)
                try:
                    product_data = json.loads(clean_content)
                except json.JSONDecodeError:
                    # Attempt to recover truncated JSON by closing open structures
                    import re
                    fixed = raw_content.rstrip().rstrip(",")
                    # Close any unclosed arrays/objects
                    open_braces = fixed.count("{") - fixed.count("}")
                    open_brackets = fixed.count("[") - fixed.count("]")
                    fixed += "]" * max(0, open_brackets) + "}" * max(0, open_braces)
                    try:
                        product_data = json.loads(fixed)
                        task.append_activity("ai_processing", "Warning: AI output was truncated, recovered partial JSON.")
                    except Exception:
                        raise Exception(f"JSON parse failed even after repair attempt. Raw snippet: {raw_content[-200:]}")
                
                # Detect graceful category matching failure
                if "category_error" in product_data:
                    error_msg = product_data.get("category_error", "No matching category found")
                    task.status = "failed"
                    task.error_message = f"Category Error: {error_msg}. Please reschedule and manually select a category."
                    task.append_activity("category_error", error_msg)
                    db.commit()
                    return f"Task {task_id} failed: {error_msg}"
                        

                # --- BULLETPROOF PYTHON CATEGORY VALIDATION & PADDING ---
                try:
                    # Determine the category the LLM picked, or default to the override
                    detected_category = product_data.get("product_identity", {}).get("category", "")
                    cat_override = getattr(task, 'category_override', None)
                    if cat_override:
                        detected_category = cat_override
                        
                    # Find matching DB schema
                    from app.models.category_spec import CategorySpec
                    db_specs = db.query(CategorySpec).all()
                    matched_spec = next((c for c in db_specs if c.category_name.lower() == detected_category.lower()), None)
                    
                    if matched_spec and matched_spec.specifications:
                        required_keys = matched_spec.specifications
                        
                        # Ensure dictionaries exist
                        if "specifications" not in product_data or not isinstance(product_data["specifications"], dict):
                            product_data["specifications"] = {}
                        if "additional_features" not in product_data or not isinstance(product_data["additional_features"], dict):
                            product_data["additional_features"] = {}
                            
                        llm_specs = product_data["specifications"]
                        
                        # 1. Pruning: Move extra keys from specifications -> additional_features
                        keys_to_move = []
                        for k in llm_specs.keys():
                            if k not in required_keys:
                                keys_to_move.append(k)
                        
                        for k in keys_to_move:
                            val = llm_specs.pop(k)
                            product_data["additional_features"][k] = val
                            
                        # 2. Padding: Inject missing keys with "N/A"
                        for rk in required_keys:
                            if rk not in llm_specs:
                                llm_specs[rk] = "N/A"
                                
                        # 3. Format Enforcement: Re-sort to match the DB order exactly
                        sorted_specs = {rk: llm_specs[rk] for rk in required_keys}
                        product_data["specifications"] = sorted_specs
                        task.append_activity("ai_processing", f"Strict JSON enforcement applied for category '{matched_spec.category_name}'")
                        
                except Exception as ve:
                    print(f"Post-processing validation error (non-fatal): {ve}")
                # --- END BULLETPROOF VALIDATION ---
                
                # --- REVERSIBLE FIX: Guarantee scraped images survive LLM truncation ---
                # Set to False to revert to old behavior (only fallback to single og:image)
                GUARANTEE_SCRAPED_IMAGES = True
                if GUARANTEE_SCRAPED_IMAGES:
                    if not product_data.get("images") or len(product_data.get("images", [])) == 0:
                        try:
                            all_imgs = []
                            for img_str in unique_images:
                                parts = img_str.split(" | Alt: ")
                                u_part = parts[0].replace("Image: ", "").strip()
                                if u_part:
                                    all_imgs.append({"media_type": "image", "media": u_part, "media_alt_tag": parts[1].strip() if len(parts) > 1 else ""})
                            if all_imgs:
                                product_data["images"] = all_imgs
                                task.append_activity("ai_processing", f"LLM dropped images. Forcibly restored {len(all_imgs)} scraped images.")
                        except Exception:
                            pass
                
                # Original fallback if all else fails
                if not product_data.get("images") and img_val:
                    product_data["images"] = [{"media_type": "image", "media": img_val, "media_alt_tag": "Fallback"}]
                # --- END REVERSIBLE FIX ---
                    
                # Inject visited URLs as sources
                product_data["sources"] = visited_urls
                
                # Remove legacy enrichment_metadata if AI generated it
                if "enrichment_metadata" in product_data:
                    del product_data["enrichment_metadata"]
            except Exception as e:
                task.append_activity("ai_enrichment_failed", str(e))
                raise Exception(f"AI JSON enrichment failed: {str(e)}")
        else:
            # Fallback JSON
            product_data = {
                "title": title_val,
                "description": desc_val,
                "price": "$0.00",
                "features": ["Durable", "High quality"],
                "images": [{"media_type": "image", "media": img_val, "media_alt_tag": "Fallback"}] if img_val else [],
                "source_url": task.url
            }

        # Save to database
        task.product_data = product_data
        
        if task.generate_ai_images:
            images_val = product_data.get("images")
            if isinstance(images_val, dict):
                scraped = images_val.get("scraped_images", [])
            elif isinstance(images_val, list):
                scraped = images_val
            else:
                scraped = []
                
            unique_urls = set()
            for item in scraped:
                url = (item.get("media") or item.get("url")) if isinstance(item, dict) else item
                if isinstance(url, str) and url.strip() and not url.startswith("data:"):
                    unique_urls.add(url.strip())
                    
            if len(unique_urls) < 2:
                task.error_message = f"No reference image found. At least 2 valid scraped reference images are required for image generation. Found: {len(unique_urls)}."
                task.append_activity("Image_generation_blocked_no_reference_images", f"Image generation blocked: required = 2, found = {len(unique_urls)}")

        task.status = "waiting_for_approval"
        task.progress = 90
        task.append_activity("waiting_for_approval", "Extraction complete, awaiting admin review")
        db.commit()

        return f"Task {task_id} scrape complete → waiting_for_approval"

    except Exception as e:
        error_str = str(e).lower()
        is_recoverable = any(term in error_str for term in [
            "429", "500", "502", "503", "504", "timeout", "rate limit", 
            "insufficient", "credit", "quota", "connection"
        ])
        
        task.status = "rescheduled" if is_recoverable else "error"
        task.error_message = str(e)
        task.append_activity("Task_processing_failed", str(e))
        db.commit()
        return f"Task {task_id} failed: {e}"
    finally:
        db.close()


@celery_app.task(name="app.tasks.scrape.dispatch_scheduled_jobs")
def dispatch_scheduled_jobs():
    """
    Celery Beat periodic task: find scrape_tasks with
    scheduled_date <= today and status='pending', dispatch them.
    """
    db = SessionLocal()
    try:
        today = date.today()
        due_tasks = (
            db.query(ScrapeTask)
            .filter(
                ScrapeTask.status == "pending",
                ScrapeTask.scheduled_date <= today,
            )
            .all()
        )

        dispatched = 0
        for task in due_tasks:
            try:
                task.status = "queued"
                task.append_activity("queued", "Dispatched by Celery Beat scheduler")
                db.commit()
                # Dispatch the actual scrape task
                process_scrape.delay(task.id)
                dispatched += 1
            except Exception as e:
                task.status = "failed"
                task.error_message = f"Failed to dispatch to Celery: {e}"
                task.append_activity("failed", f"Beat dispatch error: {e}")
                db.commit()

        return f"Dispatched {dispatched} scheduled job(s)"
    finally:
        db.close()
