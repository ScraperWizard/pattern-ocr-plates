import { NextRequest, NextResponse } from "next/server";

const OCR_API_URL = "https://api.platerecognizer.com/v1/plate-reader/";
const MODEL_API_URL = "http://46.224.1.73:8000/analyze";
const OCR_API_KEY = "8ee0d324189b1f227c25d808d93deafeb874dacb";

type VisionDetection = {
  status?: string;
};

type VisionApiResponse = {
  detection?: VisionDetection;
  detail?: string;
  [key: string]: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "Image file is required." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const fileName = (file as File).name || "upload.jpg";
    const contentType = (file as File).type || "application/octet-stream";

    const toBlob = () => new Blob([fileBuffer], { type: contentType });

    const visionPayload = new FormData();
    visionPayload.append("file", toBlob(), fileName);

    let visionData: VisionApiResponse | null = null;
    let visionStatus: "success" | "error" = "error";
    let visionError: string | null = null;

    try {
      const visionResponse = await fetch(MODEL_API_URL, {
        method: "POST",
        body: visionPayload,
      });
      const maybeVision = (await visionResponse.json()) as VisionApiResponse;
      if (visionResponse.ok) {
        visionData = maybeVision;
        visionStatus = "success";
      } else {
        visionStatus = "error";
        visionError = typeof maybeVision?.detail === "string" ? maybeVision.detail : "Vision model request failed.";
        console.error("Vision model error", maybeVision);
      }
    } catch (visionErr) {
      visionStatus = "error";
      visionError = visionErr instanceof Error ? visionErr.message : "Vision model unreachable.";
      console.error("Failed to reach vision model", visionErr);
    }

    const shouldCallOcr =
      visionStatus === "success" && visionData?.detection?.status?.toLowerCase?.() === "detected";

    let ocrData: unknown = { results: [] };
    let ocrStatus: "success" | "skipped" = "skipped";
    let ocrSkipReason: string | null = null;

    if (shouldCallOcr) {
      const ocrPayload = new FormData();
      ocrPayload.append("upload", toBlob(), fileName);

      const ocrResponse = await fetch(OCR_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Token ${OCR_API_KEY}`,
        },
        body: ocrPayload,
      });
      const maybeOcr = await ocrResponse.json();

      if (!ocrResponse.ok) {
        return NextResponse.json(
          {
            error: maybeOcr?.detail || "Plate OCR request failed.",
            details: maybeOcr,
          },
          { status: ocrResponse.status }
        );
      }

      ocrData = maybeOcr;
      ocrStatus = "success";
    } else {
      ocrSkipReason =
        visionStatus === "success"
          ? "Vehicle not detected, OCR skipped."
          : visionError ?? "Vision model unavailable, OCR skipped.";
    }

    return NextResponse.json({
      ocr: ocrData,
      ocrStatus,
      ocrSkipReason,
      vision: visionData,
      visionStatus,
      visionError,
    });
  } catch (error) {
    console.error("Vision integration error", error);
    return NextResponse.json({ error: "Unexpected server error. Please try again." }, { status: 500 });
  }
}
