# Weather Cape

A full-stack weather sounding analysis tool. A FastAPI backend fetches and analyzes atmospheric soundings (e.g. from the University of Wyoming) using MetPy, and a React + Three.js frontend visualizes the results and allows you to use local Ollama vision models to analyze current image with CSV data to give you weather analysis that you can chat with.

<img height="1280" alt="image" src="https://github.com/user-attachments/assets/99223c4d-691e-45b5-82a6-07867def7372" />


## Project Structure

```
weather-cape/
├── backend/          FastAPI + MetPy API
│   ├── app/
│   │   ├── main.py             API entrypoint (app.main:app)
│   │   ├── analysis.py         MetPy parcel & layer analysis
│   │   └── sounding_fetch.py   Wyoming sounding fetch/parse
│   └── requirements.txt
└── frontend/         Vite + React + TypeScript + three.js
    ├── src/
    ├── package.json
    └── vite.config.ts          proxies /api → http://127.0.0.1:8000
```

## Prerequisites

- **Python** 3.10+ (for the backend)
- **Node.js** 18+ and **npm** (for the frontend)

## Setup

Run these once after cloning.

### 1. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Frontend

```bash
cd frontend
npm install
```

## Running Both Servers

The frontend dev server proxies requests to `/api` over to the backend at `http://127.0.0.1:8000`, so you need both running at the same time. Open **two terminals**:

### Terminal 1 — Backend (port 8000)

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The API is now available at `http://127.0.0.1:8000`:

- Health check: `http://127.0.0.1:8000/api/health`
- Interactive docs: `http://127.0.0.1:8000/docs`

### Terminal 2 — Frontend (port 5173)

```bash
cd frontend
npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173`). API calls from the frontend to `/api/...` are transparently proxied to the backend.

## API

- `GET /api/health` — liveness check.
- `POST /api/sounding/analyze` — analyze a Wyoming (or compatible) sounding page.
- `POST /api/chat/sounding` — stream an NDJSON chat from local **Ollama** (`/api/chat`) for vision analysis of a client-provided PNG (base64). Body: `{ "messages": [{ "role": "user"|"assistant"|"system", "content": "..." }], "image_b64": "<optional base64>", "use_default_system_prompt": true }`.

### Ollama (AI chat)

Set these when running the backend (defaults shown):

- `OLLAMA_HOST` — `http://127.0.0.1:11434`
- `OLLAMA_VISION_MODEL` — `gemma4:latest`
- `OLLAMA_TIMEOUT_S` — `120`

The frontend **Analyze with AI** panel snapshots the Three.js scene and sends the first user message with that image.

  Request body:

  ```json
  { "url": "https://weather.uwyo.edu/cgi-bin/sounding?..." }
  ```

  Returns parsed levels, parcel analysis, Δt, and rough moist/dry layers derived from RH.

## Production Build

Build the frontend and serve it however you like (static host, CDN, or reverse proxy in front of the API):

```bash
cd frontend
npm run build
npm run preview   # optional, serves dist/ locally
```

Run the backend without `--reload` in production, e.g.:

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Troubleshooting

- **CORS / proxy issues**: in development, always hit the frontend (`localhost:5173`) — not the backend directly — so the Vite proxy handles `/api`. The backend also enables permissive CORS for convenience.
- **Port already in use**: change the backend port with `--port <n>` and update `frontend/vite.config.ts`'s `server.proxy` target to match.
- **MetPy / numpy install errors**: ensure you are using Python 3.10+ and a fresh virtualenv; some scientific wheels require a recent `pip` (`pip install -U pip`).
