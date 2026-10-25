import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import { useEffect, useRef, useState } from "react";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { useT } from "../i18n";

// Serve the decoder ourselves instead of from a CDN: the room's internet
// connection is not always there.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path),
  },
});

const FORMATS = ["data_matrix", "qr_code", "code_128"] as const;

/** Live camera view that calls onCode with each decoded label. */
export function Scanner({ onCode, paused }: { onCode: (text: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<"noCamera" | "denied" | "failed" | null>(null);
  const t = useT();
  const [torch, setTorch] = useState<MediaStreamTrack | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const detector = new BarcodeDetector({ formats: [...FORMATS] });

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("noCamera");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch (e) {
        setError(e instanceof DOMException && e.name === "NotAllowedError" ? "denied" : "failed");
        return;
      }
      if (stopped || !video.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
      if (caps?.torch) setTorch(track);
      tick();
    }

    let last = "";
    let lastAt = 0;
    async function tick() {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2 && !pausedRef.current) {
        try {
          const found = await detector.detect(v);
          const text = found[0]?.rawValue;
          // Ignore the same code seen again within 2 s.
          if (text && (text !== last || Date.now() - lastAt > 2000)) {
            last = text;
            lastAt = Date.now();
            navigator.vibrate?.(40);
            onCodeRef.current(text);
          }
        } catch {
          // a frame that could not be read
        }
      }
      timer = setTimeout(tick, 150);
    }

    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, []);

  async function toggleTorch() {
    if (!torch) return;
    const on = !torchOn;
    await torch.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => {});
    setTorchOn(on);
  }

  if (error)
    return (
      <div className="alert alert-danger" role="alert">
        {t.scanner[error]}
      </div>
    );
  return (
    <div className="scanner">
      <video ref={video} playsInline muted />
      <div className="scanner-aim" />
      <div className="scanner-hint">{t.scanner.hint}</div>
      {torch && (
        <button type="button" className="btn btn-sm scanner-torch" onClick={toggleTorch}>
          {torchOn ? t.scanner.lightOff : t.scanner.lightOn}
        </button>
      )}
    </div>
  );
}
