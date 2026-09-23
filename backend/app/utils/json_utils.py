import re

def sanitize_llm_json(raw_content: str) -> str:
    """
    Strips markdown code fences, leading/trailing whitespace, 
    and common LLM wrapping artifacts before JSON parsing.
    """
    if not raw_content:
        return ""
        
    text = raw_content.strip()
    
    # Remove markdown code fences like ```json ... ``` or just ``` ... ```
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\s*```$', '', text)
    
    # Strip whitespace again after removing fences
    text = text.strip()
    return text
