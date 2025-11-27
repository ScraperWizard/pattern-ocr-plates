# Car Plate Detection

Mobile-first Next.js app that lets you capture or upload a vehicle photo from your phone, runs it through a cloud vision engine, and displays the decoded plate, vehicle insights, and alternate candidates.

## Features

- Camera-friendly uploader (`accept="image/*" capture="environment"`) for quick phone snaps.
- Live camera streaming at 1 fps with start/pause controls, bounding-box overlay, and status text.
- Secure API Route proxy so your vision token never leaves the server.
- Vehicle insights including type, make/model, color, and orientation plus alternate plate candidates.
- Local JSON registry that flags unknown or mismatched vehicles (plate ↔ make/model/color).

## Prerequisites

- Node.js 18.18+ (Next.js requirement).
- Cloud vision/OCR API token (the provided sample token works too).
- Python vision service running from `py-model/server.py` (FastAPI).

## Environment variables

Create a `.env.local` file at the project root:

```
PLATE_RECOGNIZER_API_KEY=your_token_here
CAR_VISION_MODEL_ENDPOINT=http://127.0.0.1:8000/analyze
```

> Use the provided OCR token (`8ee0d324189b1f227c25d808d93deafeb874dacb`) or substitute your own. Never commit this file. Point the model endpoint to wherever you run `py-model/server.py`.

## Local development

```bash
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) and try uploading or capturing a plate image. The local JSON database lives in `src/data/carDb.json`; edit it to reflect the plates/make/model/color combos you want to validate against. Each entry accepts `plate`, `make`, `model`, `color`, and an optional `wanted` flag (set to `true` for high-priority hits).

### Python model service

```
cd py-model
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
CAR_MODEL_WEIGHTS=/absolute/path/to/compcars_best_model.pth .venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000
```

The Next.js API route sends each upload to both Plate Recognizer (for OCR) and this FastAPI service (for make/model/color). The UI cross-checks those predictions against the JSON registry and flags mismatches.

## Live camera controls

- **Start camera**: requests permission, starts the preview, and begins sending 1 frame per second to the recognition service.
- **Pause capture**: keeps the preview open but pauses outbound API calls (useful to conserve credits).
- **Stop camera**: releases the media stream if you no longer need the preview.

Bounding boxes are rendered using the `box.x/y` coordinates returned in the OCR response. Make sure your browser grants camera permissions when prompted.

## Production build

```bash
npm run build
npm run start
```

Deploy anywhere Next.js runs (Vercel, Netlify, etc.). Remember to add `CAR_VISION_API_KEY` to the hosting provider's environment variables so the API route can authenticate upstream requests.
