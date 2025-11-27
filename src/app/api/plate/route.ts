import { NextRequest, NextResponse } from "next/server";

const OCR_API_URL = "https://api.platerecognizer.com/v1/plate-reader/";
const MODEL_API_URL = "http://46.224.1.73:8000/analyze";
const OCR_API_KEY = "8ee0d324189b1f227c25d808d93deafeb874dacb";

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

    const ocrPayload = new FormData();
    ocrPayload.append("upload", new Blob([fileBuffer], { type: contentType }), fileName);

    const visionPayload = new FormData();
    visionPayload.append("file", new Blob([fileBuffer], { type: contentType }), fileName);

    const [ocrResponse, visionResponse] = await Promise.all([
      fetch(OCR_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Token ${OCR_API_KEY}`,
        },
        body: ocrPayload,
      }),
      fetch(MODEL_API_URL, {
        method: "POST",
        body: visionPayload,
      }),
    ]);

    const [ocrData, visionData] = await Promise.all([ocrResponse.json(), visionResponse.json()]);

    if (!ocrResponse.ok) {
      return NextResponse.json(
        {
          error: ocrData?.detail || "Plate OCR request failed.",
          details: ocrData,
        },
        { status: ocrResponse.status }
      );
    }

    if (!visionResponse.ok) {
      return NextResponse.json(
        {
          error: visionData?.detail || "Vision model request failed.",
          details: visionData,
        },
        { status: visionResponse.status }
      );
    }

    return NextResponse.json({ ocr: ocrData, vision: visionData });
  } catch (error) {
    console.error("Vision integration error", error);
    return NextResponse.json({ error: "Unexpected server error. Please try again." }, { status: 500 });
  }
}
