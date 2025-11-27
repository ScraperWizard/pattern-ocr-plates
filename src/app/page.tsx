"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import carDatabase from "@/data/carDb.json";
import styles from "./page.module.css";

type PlateBox = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

type ModelMake = {
  make: string;
  model: string;
  score: number;
};

type VehicleColor = {
  color: string;
  score: number;
};

type VehicleOrientation = {
  orientation: string;
  score: number;
};

type PlateCandidate = {
  plate: string;
  score: number;
};

type PlateRegion = {
  code: string;
  score: number;
};

type PlateResult = {
  plate: string;
  score: number;
  region?: PlateRegion;
  candidates?: PlateCandidate[];
  vehicle?: {
    type?: string;
    score?: number;
  };
  box?: PlateBox;
  model_make?: ModelMake[];
  color?: VehicleColor[];
  orientation?: VehicleOrientation[];
};

type PlateResponse = {
  processing_time?: number;
  results?: PlateResult[];
  error?: string;
  image_width?: number;
  image_height?: number;
};

type VisionPrediction = {
  label: string;
  confidence: number;
};

type VisionResponse = {
  detection: {
    status: string;
    confidence: number;
    label?: string;
    box?: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    };
  };
  color: {
    name: string;
    confidence: number;
  };
  makes: VisionPrediction[];
  models: VisionPrediction[];
};

type ScanResponse = {
  ocr: PlateResponse;
  vision: VisionResponse;
};

type CarRecordRaw = {
  plate: string;
  make: string;
  model: string;
  color: string;
  wanted?: boolean | number;
};

type CarRecord = {
  plate: string;
  make: string;
  model: string;
  color: string;
  wanted: boolean;
};

const CAR_DB: CarRecord[] = (carDatabase as CarRecordRaw[]).map((entry) => ({
  plate: entry.plate.toUpperCase(),
  make: entry.make,
  model: entry.model,
  color: entry.color,
  wanted: Boolean(entry.wanted),
}));

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [liveResult, setLiveResult] = useState<PlateResponse | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isLiveReady, setIsLiveReady] = useState(false);
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [liveStatus, setLiveStatus] = useState("Camera idle");
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const isSendingRef = useRef(false);
  const liveReadyRef = useRef(false);
  const livePausedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) {
      return;
    }

    const handleLoadedMetadata = () => {
      setVideoSize({
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
      });
    };

    videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => {
      videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (loopRef.current && typeof window !== "undefined") {
        window.clearInterval(loopRef.current);
        loopRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    liveReadyRef.current = isLiveReady;
  }, [isLiveReady]);

  useEffect(() => {
    livePausedRef.current = isLivePaused;
  }, [isLivePaused]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setScanResult(null);
    setError(null);
  };

  const resetSelection = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setSelectedFile(null);
    setPreviewUrl(null);
    setScanResult(null);
    setError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedFile) {
      setError("Please select an image first.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const payload = new FormData();
      payload.append("file", selectedFile);

      const response = await fetch("/api/plate", {
        method: "POST",
        body: payload,
      });

      const data = (await response.json()) as { ocr?: PlateResponse; vision?: VisionResponse; error?: string };

      if (!response.ok || !data?.ocr || !data?.vision) {
        throw new Error(data?.error ?? "Unable to process the image. Please try again.");
      }

      setScanResult({ ocr: data.ocr, vision: data.vision });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error. Please try again.";
      setError(message);
      setScanResult(null);
    } finally {
      setIsLoading(false);
    }
  };

  const startInterval = () => {
    if (loopRef.current && typeof window !== "undefined") {
      window.clearInterval(loopRef.current);
    }

    loopRef.current = window.setInterval(() => {
      void captureFrame();
    }, 1000);
  };

  const captureFrame = async () => {
    if (!liveReadyRef.current || livePausedRef.current || isSendingRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(video, 0, 0, width, height);

    isSendingRef.current = true;
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) {
        throw new Error("Unable to capture camera frame.");
      }

      const payload = new FormData();
      payload.append("file", new File([blob], `frame-${Date.now()}.jpg`, { type: blob.type }));

      const response = await fetch("/api/plate", {
        method: "POST",
        body: payload,
      });

      const data = (await response.json()) as PlateResponse;

      if (!response.ok) {
        throw new Error(data?.error ?? "Live scan failed.");
      }

      setLiveResult(data);
      setLiveError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Live scan failed.";
      setLiveError(message);
    } finally {
      isSendingRef.current = false;
    }
  };

  const startLiveCamera = async () => {
    if (isLiveReady && !isLivePaused) {
      return;
    }

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setLiveError("Camera is not available in this browser.");
      setLiveStatus("Camera idle");
      return;
    }

    if (isLivePaused) {
      livePausedRef.current = false;
      setIsLivePaused(false);
      setLiveStatus("Streaming frames (1 fps)");
      startInterval();
      setTimeout(() => {
        void captureFrame();
      }, 0);
      return;
    }

    setLiveStatus("Requesting camera access…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });

      streamRef.current = stream;

      const videoElement = videoRef.current;
      if (videoElement) {
        videoElement.srcObject = stream;
        await videoElement.play();
        setVideoSize({
          width: videoElement.videoWidth,
          height: videoElement.videoHeight,
        });
      }

      liveReadyRef.current = true;
      livePausedRef.current = false;
      setIsLiveReady(true);
      setIsLivePaused(false);
      setLiveResult(null);
      setLiveStatus("Streaming frames (1 fps)");
      setLiveError(null);
      startInterval();
      setTimeout(() => {
        void captureFrame();
      }, 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to access the camera. Please check browser permissions.";
      setLiveError(message);
      setLiveStatus("Camera idle");
    }
  };

  const pauseLiveCamera = () => {
    if (!isLiveReady || isLivePaused) {
      return;
    }

    if (loopRef.current && typeof window !== "undefined") {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }

    livePausedRef.current = true;
    setIsLivePaused(true);
    setLiveStatus("Paused (camera preview still running)");
  };

  const stopLiveCamera = () => {
    if (loopRef.current && typeof window !== "undefined") {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    liveReadyRef.current = false;
    livePausedRef.current = false;
    setIsLiveReady(false);
    setIsLivePaused(false);
    setLiveResult(null);
    setLiveStatus("Camera idle");
    setLiveError(null);
  };

  const topResult = useMemo(() => scanResult?.ocr?.results?.[0], [scanResult]);
  const topLivePlate = useMemo(() => liveResult?.results?.[0], [liveResult]);

  const formatScore = (value?: number) => {
    if (typeof value !== "number") {
      return "—";
    }

    return `${(value * 100).toFixed(1)}%`;
  };

  const primaryMake = scanResult?.vision?.makes?.[0]?.label ?? null;
  const primaryModel = scanResult?.vision?.models?.[0]?.label ?? null;
  const primaryColor = scanResult?.vision?.color?.name ?? null;
  const primaryPlate = topResult?.plate?.toUpperCase() ?? null;

  type ComplianceState = { status: "no-plate" } | { status: "unknown" } | { status: "match"; record: CarRecord } | { status: "mismatch"; record: CarRecord; mismatches: string[] };

  const compliance = useMemo<ComplianceState>(() => {
    if (!primaryPlate) {
      return { status: "no-plate" };
    }

    const record = CAR_DB.find((entry) => entry.plate === primaryPlate);
    if (!record) {
      return { status: "unknown" };
    }

    const normalize = (value?: string | null) => value?.trim().toLowerCase() ?? null;
    const mismatches: string[] = [];

    const detectedMake = normalize(primaryMake);
    const detectedModel = normalize(primaryModel);
    const detectedColor = normalize(primaryColor);

    if (detectedMake && normalize(record.make) !== detectedMake) {
      mismatches.push(`Expected make "${record.make}" but detected "${primaryMake}".`);
    }
    if (detectedModel && normalize(record.model) !== detectedModel) {
      mismatches.push(`Expected model "${record.model}" but detected "${primaryModel}".`);
    }
    if (detectedColor && normalize(record.color) !== detectedColor) {
      mismatches.push(`Expected color "${record.color}" but detected "${primaryColor}".`);
    }

    if (mismatches.length > 0) {
      return { status: "mismatch", record, mismatches };
    }

    return { status: "match", record };
  }, [primaryPlate, primaryMake, primaryModel, primaryColor]);

  const complianceRecord = compliance.status === "match" || compliance.status === "mismatch" ? compliance.record : null;

  const mismatchList = compliance.status === "mismatch" ? compliance.mismatches : [];

  const auditClass = complianceRecord?.wanted ? styles.auditWanted : compliance.status === "match" ? styles.auditMatch : compliance.status === "mismatch" ? styles.auditMismatch : styles.auditNeutral;

  const renderBoxStyle = (box?: PlateBox) => {
    const imageWidth = liveResult?.image_width ?? videoSize.width;
    const imageHeight = liveResult?.image_height ?? videoSize.height;

    if (!box || !imageWidth || !imageHeight) {
      return undefined;
    }

    const { xmin, ymin, xmax, ymax } = box;
    const widthPercent = ((xmax - xmin) / imageWidth) * 100;
    const heightPercent = ((ymax - ymin) / imageHeight) * 100;
    const leftPercent = (xmin / imageWidth) * 100;
    const topPercent = (ymin / imageHeight) * 100;

    return {
      width: `${widthPercent}%`,
      height: `${heightPercent}%`,
      left: `${leftPercent}%`,
      top: `${topPercent}%`,
    };
  };

  return (
    <div className={styles.page}>
      <main className={styles.grid}>
        <section className={styles.card}>
          <header className={styles.header}>
            <p className={styles.tag}>Snapshot upload</p>
            <h1>Upload a still frame and decode it instantly</h1>
            <p>Use your phone camera or upload an existing photo. Our edge stack extracts the plate, vehicle profile, confidence score, and alternates in seconds.</p>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.uploader} htmlFor="photo-input">
              <input id="photo-input" type="file" accept="image/*" capture="environment" onChange={handleFileChange} className={styles.input} />

              {previewUrl ? (
                <div className={styles.previewWrapper}>
                  <Image src={previewUrl} alt="Selected car plate" fill sizes="(max-width: 768px) 100vw, 720px" className={styles.preview} priority unoptimized />
                </div>
              ) : (
                <div className={styles.placeholder}>
                  <span>Tap to take or upload a photo</span>
                  <small>We recommend clear, front-facing shots of the plate.</small>
                </div>
              )}
            </label>

            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={resetSelection} disabled={!selectedFile || isLoading}>
                Remove photo
              </button>
              <button type="submit" className={styles.primaryButton} disabled={!selectedFile || isLoading}>
                {isLoading ? "Detecting..." : "Detect plate"}
              </button>
            </div>
          </form>

          <section className={styles.results} aria-live="polite">
            {error && <p className={styles.error}>{error}</p>}

            {isLoading && <p className={styles.status}>Analyzing snapshot…</p>}

            {!isLoading && !error && !scanResult && <p className={styles.helper}>Your scan results will show up here.</p>}

            {scanResult?.ocr?.results && scanResult.ocr.results.length > 0 && (
              <>
                <div className={styles.summary}>
                  <div>
                    <p className={styles.summaryLabel}>Plate</p>
                    <p className={styles.summaryPlate}>{topResult?.plate?.toUpperCase() ?? "—"}</p>
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Vehicle type</p>
                    <p className={styles.summaryValue}>{scanResult.vision.detection.label ?? topResult?.vehicle?.type ?? "—"}</p>
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Make</p>
                    <p className={styles.summaryValue}>{primaryMake ?? "—"}</p>
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Model</p>
                    <p className={styles.summaryValue}>{primaryModel ?? "—"}</p>
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Color</p>
                    <p className={styles.summaryValue}>{primaryColor ?? "—"}</p>
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Confidence</p>
                    <p className={styles.summaryValue}>{formatScore(topResult?.score)}</p>
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Processing</p>
                    <p className={styles.summaryValue}>{scanResult.ocr.processing_time ? `${scanResult.ocr.processing_time.toFixed(0)} ms` : "—"}</p>
                  </div>
                </div>

                <div className={`${styles.auditCard} ${auditClass}`}>
                  {complianceRecord?.wanted && <p className={styles.wantedNotice}>🚨 This plate is flagged as WANTED. Notify security immediately.</p>}
                  {compliance.status === "match" && complianceRecord && (
                    <>
                      <p>✅ Plate matches local inventory.</p>
                      <small>
                        Registered as {complianceRecord.plate} · {complianceRecord.make} {complianceRecord.model} ({complianceRecord.color}).
                      </small>
                    </>
                  )}
                  {compliance.status === "mismatch" && complianceRecord && (
                    <>
                      <p>⚠️ Detected vehicle differs from the expected record.</p>
                      <small>
                        Expected {complianceRecord.make} {complianceRecord.model} ({complianceRecord.color}).
                      </small>
                      <ul>
                        {mismatchList.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {compliance.status === "unknown" && (
                    <>
                      <p>ℹ️ Plate {primaryPlate} is not in the local registry.</p>
                      <small>Review and add it to the JSON DB if this vehicle should be tracked.</small>
                    </>
                  )}
                  {compliance.status === "no-plate" && (
                    <>
                      <p>ℹ️ Plate was not confidently decoded. Please retry with a clearer image.</p>
                    </>
                  )}
                </div>

                <ul className={styles.resultList}>
                  {scanResult.ocr.results.map((item, index) => (
                    <li key={`${item.plate}-${index}`} className={styles.resultItem}>
                      <div>
                        <p className={styles.plate}>{item.plate?.toUpperCase() ?? "Unknown"}</p>
                        <p className={styles.meta}>
                          {formatScore(item.score)} match · {item.region?.code?.toUpperCase() ?? "Region N/A"}
                        </p>
                        <p className={styles.meta}>Vehicle: {item.vehicle?.type ?? "Unknown"}</p>
                      </div>

                      {item.candidates && item.candidates.length > 1 && (
                        <details className={styles.candidates}>
                          <summary>Alternatives</summary>
                          <ul>
                            {item.candidates.slice(1).map((candidate) => (
                              <li key={candidate.plate}>
                                <span>{candidate.plate.toUpperCase()}</span>
                                <span>{formatScore(candidate.score)}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </section>

        <section className={`${styles.card} ${styles.liveCard}`}>
          <header className={styles.header}>
            <p className={styles.tag}>Live camera</p>
            <h2>Stream your camera at 1 fps and see live detections</h2>
            <p>
              We capture a frame every second, uplink it to our recognition engine, and render bounding boxes in real time. Use Start to request the camera, then Pause whenever you need to conserve
              calls.
            </p>
          </header>

          <div className={styles.videoShell}>
            <div className={styles.videoFrame}>
              <video ref={videoRef} className={styles.video} muted playsInline autoPlay aria-label="Live camera preview" />
              <div className={styles.overlay}>
                {liveResult?.results?.map((item, index) => (
                  <div key={`${item.plate}-${index}`} className={styles.box} style={renderBoxStyle(item.box)}>
                    <span className={styles.boxLabel}>{item.plate?.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className={styles.liveStatus}>{liveStatus}</p>
            {liveError && <p className={styles.liveError}>{liveError}</p>}
          </div>

          <div className={styles.liveControls}>
            <button type="button" className={styles.primaryButton} onClick={startLiveCamera} disabled={isLiveReady && !isLivePaused}>
              {!isLiveReady ? "Start camera" : isLivePaused ? "Resume & stream" : "Live streaming"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={pauseLiveCamera} disabled={!isLiveReady || isLivePaused}>
              {isLivePaused ? "Paused" : "Pause capture"}
            </button>
            <button type="button" className={styles.ghostButton} onClick={stopLiveCamera} disabled={!isLiveReady}>
              Stop camera
            </button>
          </div>

          <section className={styles.results} aria-live="polite">
            {!liveResult && !liveError && <p className={styles.helper}>Start the camera to see rolling results.</p>}

            {liveResult?.results && liveResult.results.length > 0 && (
              <>
                <div className={styles.summary}>
                  <div>
                    <p className={styles.summaryLabel}>Plate</p>
                    <p className={styles.summaryPlate}>{topLivePlate?.plate?.toUpperCase() ?? "—"}</p>
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Vehicle type</p>
                    <p className={styles.summaryValue}>{topLivePlate?.vehicle?.type ?? "—"}</p>
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Confidence</p>
                    <p className={styles.summaryValue}>{formatScore(topLivePlate?.score)}</p>
                  </div>
                  <div>
                    <p className={styles.summaryLabel}>Processing</p>
                    <p className={styles.summaryValue}>{liveResult.processing_time ? `${liveResult.processing_time.toFixed(0)} ms` : "—"}</p>
                  </div>
                </div>

                <ul className={styles.resultList}>
                  {liveResult.results.map((item, index) => (
                    <li key={`${item.plate}-${index}`} className={styles.resultItem}>
                      <div>
                        <p className={styles.plate}>{item.plate?.toUpperCase() ?? "Unknown"}</p>
                        <p className={styles.meta}>
                          {formatScore(item.score)} match · {item.region?.code?.toUpperCase() ?? "Region N/A"}
                        </p>
                        <p className={styles.meta}>Vehicle: {item.vehicle?.type ?? "Unknown"}</p>
                        {item.box && (
                          <p className={styles.meta}>
                            Box: x[{item.box.xmin} - {item.box.xmax}] · y[{item.box.ymin} - {item.box.ymax}]
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </section>
      </main>

      <canvas ref={canvasRef} className={styles.hiddenCanvas} aria-hidden="true" />
    </div>
  );
}
