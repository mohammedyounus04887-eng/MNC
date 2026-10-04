/**
 * Shared face-recognition module — ONE place for everything face-api related.
 *
 * Before this, model loading + detector options + descriptor matching were
 * copy-pasted across 5+ files (Reception, FaceVerification, ReceptionGuestWizard,
 * VolunteerGrid, …), each loading the ~MBs of models independently and using
 * slightly different thresholds/sizes. That meant a tuning change had to be made
 * in many places, and the models were downloaded/initialised several times.
 *
 * Everything face-related should import from here:
 *   - loadFaceModels()      → idempotent, loads the nets exactly ONCE per session
 *   - faceModelsReady()     → has the one-time load finished?
 *   - FACE_DETECTOR_OPTS    → the single shared detector config (speed/accuracy)
 *   - detectFaceDescriptor()→ run a single detection on a video/canvas
 *   - isFaceMatch()         → euclidean-distance match against a stored descriptor
 *
 * NOTE: this module is about face DETECTION/RECOGNITION mechanics only. Whether a
 * given flow should *require* a scan is governed by the club's
 * `faceVerificationEnabled` toggle at the call-site; face ENROLLMENT always loads
 * models (it never depends on that toggle).
 */

import * as faceapi from "face-api.js";

/** The single shared detector config — tune speed/accuracy in ONE place.
 *  inputSize 320 (down from the 416 default) ~halves inference time and is
 *  plenty for a close webcam; scoreThreshold 0.5 is the established value. */
export const FACE_DETECTOR_OPTS = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

/** Distance below which two descriptors are considered the same person. */
export const FACE_MATCH_THRESHOLD = 0.5;

const MODELS_URI = "/models";

let modelsPromise: Promise<void> | null = null;
let modelsReady = false;

/**
 * Load the face-api nets exactly once per session. Safe to call from anywhere,
 * any number of times — concurrent callers share the same in-flight promise,
 * and a completed load resolves instantly. On failure the cache is cleared so a
 * later call can retry.
 */
export function loadFaceModels(): Promise<void> {
    if (modelsReady) return Promise.resolve();
    if (modelsPromise) return modelsPromise;
    modelsPromise = (async () => {
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URI),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URI),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URI),
        ]);
        modelsReady = true;
        // Warm up the TF graph on a blank canvas so the first real detection
        // isn't slow (best-effort — never blocks readiness).
        try {
            const c = document.createElement("canvas");
            c.width = 320; c.height = 320;
            await faceapi.detectSingleFace(c, FACE_DETECTOR_OPTS);
        } catch { /* warm-up is best effort */ }
    })().catch((e) => {
        modelsPromise = null;   // allow a retry on the next call
        throw e;
    });
    return modelsPromise;
}

/** True once the one-time model load has completed. */
export function faceModelsReady(): boolean {
    return modelsReady;
}

/**
 * Run a single face detection on a video/canvas element and return the 128-d
 * descriptor (or null if no face). Uses the shared detector options.
 */
export async function detectFaceDescriptor(
    input: HTMLVideoElement | HTMLCanvasElement,
): Promise<Float32Array | null> {
    const det = await faceapi
        .detectSingleFace(input, FACE_DETECTOR_OPTS)
        .withFaceLandmarks()
        .withFaceDescriptor();
    return det ? det.descriptor : null;
}

/** Euclidean-distance match of a live descriptor against a stored one. */
export function isFaceMatch(
    live: Float32Array | number[],
    stored: Float32Array | number[],
    threshold = FACE_MATCH_THRESHOLD,
): boolean {
    if (!live || !stored) return false;
    return faceapi.euclideanDistance(live as any, stored as any) < threshold;
}
