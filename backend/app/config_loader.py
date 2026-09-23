import os
from pathlib import Path
from dotenv import dotenv_values

def get_dynamic_env(key: str, default: str = "") -> str:
    """
    Reads a key directly from the physical .env file on disk.
    This ensures that if the UI updates the .env file, long-running
    processes (like Celery workers) instantly see the new value
    without needing a container restart.
    """
    # Path to backend/.env
    env_path = Path(__file__).resolve().parent.parent / ".env"
    
    # Try reading directly from the file first (most up-to-date)
    try:
        if env_path.exists():
            values = dotenv_values(env_path)
            if key in values and values[key]:
                # Strip quotes in case they are there
                val = values[key].strip()
                if val.startswith("'") and val.endswith("'"):
                    val = val[1:-1]
                if val.startswith('"') and val.endswith('"'):
                    val = val[1:-1]
                return val
    except Exception as e:
        print(f"Could not read dynamic env from file {env_path}: {e}")
            
    # Fallback to the loaded OS environment (what Docker injected at boot)
    val = os.getenv(key, default).strip()
    if val.startswith("'") and val.endswith("'"):
        val = val[1:-1]
    if val.startswith('"') and val.endswith('"'):
        val = val[1:-1]
    return val
