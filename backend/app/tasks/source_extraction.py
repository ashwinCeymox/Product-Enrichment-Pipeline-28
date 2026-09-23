import os
import json
from litellm import completion

def extract_source_data(clean_text: str, extracted_images: list, openrouter_key: str) -> dict:
    """
    Takes raw HTML text and an authoritative list of image URLs.
    Uses DeepSeek to map the HTML into the predefined source_data schema iteratively (Chunking).
    """
    system_prompt_path = os.path.join(os.path.dirname(__file__), "prompts", "source_extraction_system.txt")
    try:
        with open(system_prompt_path, "r", encoding="utf-8") as f:
            system_prompt_text = f.read()
    except Exception as e:
        print(f"Could not load source_extraction_system.txt: {e}")
        system_prompt_text = "You are a factual source extraction agent. Output JSON only."

    # Chunking the text to avoid token overflow and allow iterative memory build
    chunk_size = 15000
    chunks = [clean_text[i:i + chunk_size] for i in range(0, len(clean_text), chunk_size)]
    
    current_state = {
        "product_identity": {},
        "pricing_and_availability": {},
        "descriptions": {},
        "attributes": {},
        "features": [],
        "specifications": {},
        "breadcrumbs": [],
        "shipping_and_returns": {},
        "other_source_information": {}
    }
    
    if not chunks:
        chunks = [""] # Ensure at least one pass if empty

    for idx, chunk in enumerate(chunks):
        print(f"Processing chunk {idx+1}/{len(chunks)}...")
        prompt = (
            f"Current JSON State:\n{json.dumps(current_state, indent=2)}\n\n"
            f"New Text Chunk ({idx+1}/{len(chunks)}):\n{chunk}\n\n"
            "Task: Update the Current JSON State by extracting any new specifications, pricing, features, or product details found in this New Text Chunk. "
            "Do NOT delete or overwrite existing valid data in the JSON State unless the new text provides a clearly better or more accurate value. "
            "Extract strictly into the predefined schema and output ONLY the updated JSON object."
        )
        
        try:
            from app.config_loader import get_dynamic_env
            from app.utils.json_utils import sanitize_llm_json
            
            ai_resp = completion(
                model=f"openrouter/{get_dynamic_env('SCRAPING_MODEL', 'deepseek/deepseek-chat')}",
                messages=[
                    {"role": "system", "content": system_prompt_text},
                    {"role": "user", "content": prompt}
                ],
                api_key=openrouter_key,
                response_format={"type": "json_object"},
                temperature=0.1
            )
            raw_content = ai_resp.choices[0].message.content or ""
            clean_content = sanitize_llm_json(raw_content)
            parsed = json.loads(clean_content)
            # Merge logic: if parsing succeeds, update current_state
            if isinstance(parsed, dict):
                current_state = parsed
        except Exception as e:
            print(f"Source Extraction LLM Error on chunk {idx+1}: {e}")
            # If a chunk fails, we just keep the current_state from the previous chunk
            continue

    # Defensive cleanup: ensure critical keys are always the correct type
    # DeepSeek may return None for empty fields which would crash downstream .get() calls
    dict_keys = ["product_identity", "pricing_and_availability", "descriptions", 
                 "attributes", "specifications", "shipping_and_returns", "other_source_information"]
    list_keys = ["features", "breadcrumbs"]
    for k in dict_keys:
        if not isinstance(current_state.get(k), dict):
            current_state[k] = {}
    for k in list_keys:
        if not isinstance(current_state.get(k), list):
            current_state[k] = []

    # Programmatic Image Injection Guarantee
    image_objects = []
    for img_str in extracted_images:
        parts = img_str.split(" | Alt: ")
        url_part = parts[0].replace("Image: ", "").strip()
        alt_part = parts[1].strip() if len(parts) > 1 else ""
        if url_part:
            image_objects.append({"url": url_part, "alt": alt_part, "type": "scraped"})
            
    current_state["images"] = {"all_scraped_images": image_objects}

    return current_state
