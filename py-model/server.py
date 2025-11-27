from __future__ import annotations

import json
import os
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional

import torch
import torch.nn as nn
import torchvision.transforms as T
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel
from transformers import CLIPModel, CLIPProcessor
from ultralytics import YOLO
import timm

BASE_DIR = Path(__file__).resolve().parent
METADATA_JSON = BASE_DIR / "make_model_metadata.json"
CAR_TYPES_JSON = BASE_DIR / "car_types.json"
DEFAULT_WEIGHTS_PATH = BASE_DIR / "compcars_best_model.pth"
DEFAULT_YOLO_WEIGHTS = os.environ.get("YOLO_WEIGHTS", "yolov8n.pt")
DEFAULT_CLIP_MODEL = os.environ.get("CLIP_MODEL_NAME", "openai/clip-vit-base-patch32")


def load_json(path: Path, key: Optional[str] = None) -> Dict:
    if not path.exists():
        raise RuntimeError(f"Required metadata file is missing: {path}")
    data = json.loads(path.read_text())
    if key is not None and key not in data:
        raise RuntimeError(f"Metadata file {path} is missing expected key '{key}'.")
    return data


metadata = load_json(METADATA_JSON)
MAKE_NAMES: List[str] = metadata.get("makes", [])
MODEL_NAMES: List[str] = metadata.get("models", [])
CAR_TYPES: List[str] = load_json(CAR_TYPES_JSON).get("types", [])


class CarClassifier(nn.Module):
    def __init__(self, num_makes: int, num_models: int) -> None:
        super().__init__()
        self.backbone = timm.create_model("tf_efficientnetv2_s", pretrained=False, num_classes=0)
        feat_dim = self.backbone.num_features
        self.make_head = nn.Linear(feat_dim, num_makes)
        self.model_head = nn.Linear(feat_dim, num_models)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.backbone(x)
        return self.make_head(features), self.model_head(features)


class RankedPrediction(BaseModel):
    label: str
    confidence: float


class DetectionBox(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int


class DetectionPayload(BaseModel):
    status: str
    confidence: float
    label: Optional[str]
    box: Optional[DetectionBox]


class ColorPayload(BaseModel):
    name: str
    confidence: float


class AnalysisResponse(BaseModel):
    detection: DetectionPayload
    color: ColorPayload
    makes: List[RankedPrediction]
    models: List[RankedPrediction]


class VisionService:
    def __init__(self) -> None:
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.detector = YOLO(DEFAULT_YOLO_WEIGHTS)
        self.clip_model = CLIPModel.from_pretrained(DEFAULT_CLIP_MODEL).to(self.device)
        self.clip_processor = CLIPProcessor.from_pretrained(DEFAULT_CLIP_MODEL)
        self.classifier = self._load_classifier()
        self.transform = T.Compose(
            [
                T.Resize((224, 224)),
                T.ToTensor(),
                T.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
            ]
        )
        self.vehicle_classes = {2: "car", 5: "bus", 7: "truck"}

    def _load_classifier(self) -> CarClassifier:
        weights_path = Path(os.environ.get("CAR_MODEL_WEIGHTS", DEFAULT_WEIGHTS_PATH))
        if not weights_path.exists():
            raise RuntimeError(
                "Classifier weights not found. "
                "Set the CAR_MODEL_WEIGHTS environment variable to the .pth file for your model."
            )
        classifier = CarClassifier(len(MAKE_NAMES), len(MODEL_NAMES)).to(self.device)
        state_dict = torch.load(weights_path, map_location=self.device)
        classifier.load_state_dict(state_dict)
        classifier.eval()
        return classifier

    def _detect_color(self, image: Image.Image) -> ColorPayload:
        colors = [
            "black",
            "white",
            "silver",
            "grey",
            "red",
            "blue",
            "green",
            "yellow",
            "orange",
            "brown",
            "beige",
            "gold",
        ]
        text_prompts = [f"a photo of a {c} car" for c in colors]
        inputs = self.clip_processor(text=text_prompts, images=image, return_tensors="pt", padding=True).to(self.device)
        with torch.no_grad():
            outputs = self.clip_model(**inputs)
            logits_per_image = outputs.logits_per_image
            probs = logits_per_image.softmax(dim=1)
        top_prob, top_idx = probs.topk(1, dim=1)
        detected_color = colors[top_idx.item()]
        confidence = float(top_prob.item())
        return ColorPayload(name=detected_color.capitalize(), confidence=confidence)

    def _detect_vehicle(self, image: Image.Image) -> DetectionPayload:
        results = self.detector(image, verbose=False)
        best_box = None
        best_conf = 0.0
        best_label = None
        for result in results:
            for box in result.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                if cls_id in self.vehicle_classes and conf > best_conf:
                    best_conf = conf
                    best_box = box.xyxy[0].cpu().numpy()
                    best_label = self.vehicle_classes[cls_id]
        if best_box is not None:
            x1, y1, x2, y2 = map(int, best_box)
            margin_w = int((x2 - x1) * 0.05)
            margin_h = int((y2 - y1) * 0.05)
            x1 = max(0, x1 - margin_w)
            y1 = max(0, y1 - margin_h)
            x2 = min(image.width, x2 + margin_w)
            y2 = min(image.height, y2 + margin_h)
            return DetectionPayload(
                status="detected",
                confidence=best_conf,
                label=best_label,
                box=DetectionBox(x1=x1, y1=y1, x2=x2, y2=y2),
            )
        return DetectionPayload(status="not_detected", confidence=best_conf, label=None, box=None)

    def analyze(self, image_bytes: bytes) -> AnalysisResponse:
        try:
            original_img = Image.open(BytesIO(image_bytes)).convert("RGB")
        except Exception as exc:  # pragma: no cover - defensive
            raise ValueError("Unable to decode the uploaded image.") from exc

        detection = self._detect_vehicle(original_img)
        if detection.box is not None:
            crop = original_img.crop((detection.box.x1, detection.box.y1, detection.box.x2, detection.box.y2))
        else:
            crop = original_img

        color_payload = self._detect_color(crop)
        input_tensor = self.transform(crop).unsqueeze(0).to(self.device)
        with torch.no_grad():
            out_make, out_model = self.classifier(input_tensor)
            prob_make = torch.softmax(out_make, dim=1)
            prob_model = torch.softmax(out_model, dim=1)
            top_make_probs, top_make_idxs = prob_make.topk(3, dim=1)
            top_model_probs, top_model_idxs = prob_model.topk(3, dim=1)

        make_top_k = min(3, top_make_idxs.shape[1])
        model_top_k = min(3, top_model_idxs.shape[1])
        makes = [
            RankedPrediction(label=MAKE_NAMES[top_make_idxs[0][i].item()], confidence=float(top_make_probs[0][i].item()))
            for i in range(make_top_k)
        ]
        models = [
            RankedPrediction(
                label=MODEL_NAMES[top_model_idxs[0][i].item()], confidence=float(top_model_probs[0][i].item())
            )
            for i in range(model_top_k)
        ]

        return AnalysisResponse(detection=detection, color=color_payload, makes=makes, models=models)


service = VisionService()

app = FastAPI(
    title="Car Vision Service",
    description="Detection + make/model classification API driven by YOLO, CLIP, and EfficientNet.",
    version="1.0.0",
)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "device": service.device}


@app.get("/metadata")
def metadata() -> Dict[str, object]:
    return {"types": CAR_TYPES, "make_count": len(MAKE_NAMES), "model_count": len(MODEL_NAMES)}


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_image(file: UploadFile = File(...)) -> AnalysisResponse:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    try:
        return service.analyze(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="Model inference failed.") from exc


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("server:app", host=host, port=port, reload=False)

