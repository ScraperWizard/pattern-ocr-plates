import { NextRequest, NextResponse } from "next/server";

const API_URL = "https://api.platerecognizer.com/v1/plate-reader/";

export async function POST(request: NextRequest) {
  const apiKey = process.env.CAR_VISION_API_KEY ?? process.env.PLATE_RECOGNIZER_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "Server misconfiguration. Missing vision API key." }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "Image file is required." }, { status: 400 });
    }

    const payload = new FormData();
    payload.append("upload", file, (file as File).name || "upload.jpg");
    payload.append("mmc", "true");

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
      },
      body: payload,
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: data?.detail || "Vision API request failed.",
          details: data,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Vision API error", error);
    return NextResponse.json({ error: "Unexpected server error. Please try again." }, { status: 500 });
  }
}
