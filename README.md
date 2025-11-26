# Car Plate Detection

Mobile-first Next.js app that lets you capture or upload a vehicle photo from your phone, runs it through a cloud vision engine, and displays the decoded plate, vehicle insights, and alternate candidates.

## Features

- Camera-friendly uploader (`accept="image/*" capture="environment"`) for quick phone snaps.
- Live camera streaming at 1 fps with start/pause controls, bounding-box overlay, and status text.
- Secure API Route proxy so your vision token never leaves the server.
- Vehicle insights including type, make/model, color, and orientation plus alternate plate candidates.

## Prerequisites

- Node.js 18.18+ (Next.js requirement).
- Cloud vision API token (the provided sample token works too).

## Environment variables

Create a `.env.local` file at the project root:

```
CAR_VISION_API_KEY=your_token_here
```

> Drop in the provided token (`8ee0d324189b1f227c25d808d93deafeb874dacb`) or substitute your own. Never commit this file.

## Local development

```bash
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) and try uploading or capturing a plate image.

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
