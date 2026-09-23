n 

# Pro-Active Fitness: Pipeline Architecture & Technical Documentation

## 1. Project Overview

The **Pro-Active Fitness Pipeline** is a highly automated AI-driven web application designed to scrape e-commerce product URLs, intelligently extract structured data (using DeepSeek LLM enriched by Serper API), generate contextual lifestyle and feature images (using Nano Banana/Gemini models via OpenRouter), and ultimately compile a ready-to-deploy HTML package with linked assets.

It features a strict human-in-the-loop review process (JSON Approval Queue & Image Approval Queue) and robust API credit management to prevent runaway costs.

---

## 2. Technology Stack & Libraries

### **Backend**

- **Framework:** `FastAPI` (High-performance, async-ready Python framework).
- **Task Queue:** `Celery` + `Redis` (Handles long-running scraping and image generation tasks asynchronously).
- **Database:** `PostgreSQL` + `SQLAlchemy` (ORM) + `Alembic` (Migrations).
- **AI Integration:** `litellm` (Standardized interface for all LLM calls).
- **Search API:** `httpx` for querying the **Serper API** (Google Search data).

### **Frontend**

- **Framework:** `React` (via `Vite` for lightning-fast HMR and building).
- **Styling:** `Tailwind CSS` (Utility-first styling).
- **Icons:** `lucide-react`.
- **State Management:** React Context API & standard hooks (`useState`, `useEffect`).
- **HTTP Client:** `axios` with interceptors for auth handling.

### **Infrastructure / Deployment**

- **Docker Compose:** Multi-container deployment orchestrating the API, Frontend (Nginx), Celery Worker, Celery Beat, PostgreSQL, and Redis.

---

## 3. Core Logic & Data Flow

The system operates in a strict, step-by-step pipeline:

### **Phase 1: Scraping & Extraction (Celery Worker)**

1. Admin submits a URL or bulk CSV. Job is queued.
2. Celery worker pulls the URL, fetches the raw HTML, and extracts the core `product_name`.
3. **Serper Enrichment:** The worker pings the Serper API with the `product_name` to get live Google Search context (top 3 organic results).
4. **DeepSeek Extraction:** The raw HTML + Serper context + image URLs are sent to DeepSeek (`deepseek-chat`). DeepSeek parses this into a strictly structured JSON containing key features, technical specs, and SEO content.
5. The job enters the **JSON Approval Queue**.

### **Phase 2: Human Review (Frontend)**

1. Admin reviews the extracted JSON in the UI (`JsonReview.jsx`). They can edit the text, delete bad records, or approve.
2. **Image Generation Trigger:** Upon clicking "Approve", the backend transitions the job to `image_generation` and fires off the next Celery task.

### **Phase 3: Image Generation (Celery Worker)**

1. Based on the approved JSON (which contains prompts for a lifestyle image and feature-specific images), Celery requests images from the `nano-banana` (Gemini-2.5-flash) model via OpenRouter.
2. The downloaded images are cached in the `output/reference_cache` folder.
3. The job enters the **Image Approval Queue**.

### **Phase 4: Final Bundle Generation**

1. Admin reviews the generated images. If acceptable, they click "Approve Bundle".
2. The system generates a final HTML layout injecting the approved JSON data and the local image paths.
3. Everything is zipped up into a downloadable bundle.

---

## 4. Complex Implementations & Credit Gating

To protect against runaway AI costs, we built a highly resilient **Credit Management System** (`credit_service.py` & `credits.py`):

- **Live Redis Caching:** We cache OpenRouter/Nano Banana credits in Redis. Instead of querying the API on every page load, the frontend polls the cached value.
- **Pre-Flight Checks:** Before a CSV of URLs is accepted by the API, it calculates the estimated cost and blocks the upload (HTTP `402`) if credits are below a `$0.70` threshold.
- **Mid-Flight Checks (DeepSeek):** Because scraping takes time, credits could run out *during* a long batch run. We injected a `deepseek_worker_check()` directly into the Celery scraping loop that halts the worker safely if credits dip mid-run.
- **Credit Modal Interception:** The frontend globally intercepts `402 Insufficient Credits` errors and automatically pops up a specialized `InsufficientCreditsModal` explaining exactly how much is left, what provider failed, and how to top up.

---

## 5. Key Challenges & How We Resolved Them

### 💥 Challenge 1: The "Celery Limbo State" Bug

**Issue:** When an Admin clicked "Approve", the backend updated the Postgres database to `status='image_generation'`, and *then* called `generate_images_task.delay()`. If Redis was down or the Celery queue dropped the connection, the `.delay()` threw an error (500 Internal Server Error). The database was permanently stuck thinking it was in `image_generation`, but Celery never received the job. It vanished from all queues.
**Resolution:** Wrapped all Celery `.delay()` dispatches (`jobs.py` and `scrape.py`) in strict `try/except` blocks. If the queue dispatch fails, the backend intercepts the error, rolls back the status to `failed`, and logs the error in the Error Logs UI so the admin can explicitly click "Reschedule".

### 💥 Challenge 2: AI Hallucinations on Technical Specs

**Issue:** Scraping raw HTML from fitness equipment websites often yielded messy data, causing DeepSeek to hallucinate technical specifications (like weight capacities or dimensions) that weren't clearly defined in the HTML.
**Resolution:** Integrated the **Serper API**. By running a background Google Search for the exact product name, we injected the top 3 Google search result snippets into the DeepSeek prompt as `"Extra Search Context"`. This grounded the LLM in reality, drastically improving extraction accuracy.

### 💥 Challenge 3: Nano Banana Ghost Credits (Stale Cache)

**Issue:** When the Admin deleted their API Key from the Settings UI, the Dashboard continued to show that they had credits. The system was reading stale data buffered in Redis because the refresh function bypassed the API call when the key was missing.
**Resolution:** Updated the `/credits/all-providers` endpoint to explicitly verify `bool(get_dynamic_env("OPENROUTER_API_KEY"))`. If the key is missing, the backend instantly forces the value to `null`, triggering the frontend to show a warning triangle instead of false credits.

### 💥 Challenge 4: Frontend Stale Assets in Docker

**Issue:** After pushing massive backend and frontend code updates (via `rsync`), the Dockerized API updated instantly via Volume Mounts, but the frontend UI was frozen on the Login Screen.
**Resolution:** Vite/React is compiled into static assets served by Nginx in the `frontend` container. Source code updates do not auto-reload in production builds. We resolved this by explicitly running `docker compose up -d --build frontend` to rebuild the Nginx assets, ensuring the UI accurately reflected the new API endpoints.

---

*Document compiled for future AI Agents / Vibe Coders stepping into the repository. Follow the strict modularity in `routers/` and `tasks/` when adding new AI providers.*
