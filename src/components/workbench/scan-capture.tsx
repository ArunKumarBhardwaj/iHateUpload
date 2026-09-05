"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export function ScanCapture({
  onCapture,
  disabled,
}: {
  onCapture: (file: File) => void;
  disabled: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("no-camera");
        }
        const pending = navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        const timeout = new Promise<null>((resolve) => {
          window.setTimeout(() => resolve(null), 2500);
        });
        const raced = await Promise.race([pending, timeout]);
        if (!raced) {
          pending
            .then((late) => late.getTracks().forEach((track) => track.stop()))
            .catch(() => {});
          throw new Error("camera-timeout");
        }
        stream = raced;
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setLive(true);
      } catch {
        if (!cancelled) setError("Camera is off. Drop a photo instead.");
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(
          new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" }),
        );
      },
      "image/jpeg",
      0.88,
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : (
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-video w-full rounded-xl bg-ink/5 object-cover"
        />
      )}
      <Button
        type="button"
        size="sm"
        disabled={disabled || !live}
        onClick={capture}
      >
        Capture page
      </Button>
    </div>
  );
}
