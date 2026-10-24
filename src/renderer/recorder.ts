import { CH } from '../shared/channels';
import type { RecCommand, RecLayout, RecorderInit, RecStarted, RecTrack } from '../shared/types';
import { desk } from './common';

interface Running {
  track: RecTrack;
  rec: MediaRecorder;
  stream: MediaStream;
  sending: Promise<void>;
  startedAt: number;
}

const running: Running[] = [];
const teardown: Array<() => void> = [];

declare const MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

async function acrossScreens(init: RecorderInit, layout: RecLayout, video: MediaTrackConstraints): Promise<{ screen: MediaStream; noSystemAudio: boolean }> {
  const sources: MediaStream[] = [];
  teardown.push(() => sources.forEach((s) => s.getTracks().forEach((t) => t.stop())));
  for (let i = 0; i < layout.screens.length; i++) sources.push(await navigator.mediaDevices.getDisplayMedia({ video, audio: false }));
  let sound: MediaStreamTrack[] = [];
  let noSystemAudio = false;
  if (init.systemAudio) {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: true });
      s.getVideoTracks().forEach((t) => t.stop());
      sound = s.getAudioTracks();
      teardown.push(() => sound.forEach((t) => t.stop()));
    } catch {
      noSystemAudio = true;
    }
  }
  const latest: Array<VideoFrame | null> = sources.map(() => null);
  sources.forEach((s, i) => {
    const reader = new MediaStreamTrackProcessor({ track: s.getVideoTracks()[0] }).readable.getReader();
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done || !value) return;
        latest[i]?.close();
        latest[i] = value;
      }
    })();
    teardown.push(() => {
      void reader.cancel().catch(() => {});
      latest[i]?.close();
      latest[i] = null;
    });
  });
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const paint = () => layout.screens.forEach((r, i) => latest[i] && ctx.drawImage(latest[i]!, r.x, r.y, r.w, r.h));
  const timer = setInterval(paint, 1000 / init.fps);
  teardown.push(() => clearInterval(timer));
  paint();
  const screen = canvas.captureStream(init.fps);
  sound.forEach((t) => screen.addTrack(t));
  return { screen, noSystemAudio };
}

function pick(types: string[]): string {
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

function record(track: RecTrack, stream: MediaStream, options: MediaRecorderOptions): Promise<Running> {
  return new Promise((resolve, reject) => {
    const rec = new MediaRecorder(stream, options);
    const item: Running = { track, rec, stream, sending: Promise.resolve(), startedAt: 0 };
    rec.ondataavailable = (event) => {
      if (!event.data.size) return;
      item.sending = item.sending.then(async () => {
        desk.send(CH.recChunk, { track, bytes: new Uint8Array(await event.data.arrayBuffer()) });
      });
    };
    rec.onstart = () => {
      item.startedAt = performance.now();
      resolve(item);
    };
    rec.onerror = () => reject(new Error(`${track} recorder failed`));
    rec.start(1000);
  });
}

async function start(): Promise<void> {
  const init = await desk.invoke<RecorderInit>(CH.recInit);
  const video = { frameRate: init.fps, cursor: init.cursor ? 'always' : 'never' } as MediaTrackConstraints;
  let screen: MediaStream;
  let noSystemAudio = false;
  if (init.layout) ({ screen, noSystemAudio } = await acrossScreens(init, init.layout, video));
  else {
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({ video, audio: init.systemAudio });
    } catch (err) {
      if (!init.systemAudio) throw err;
      screen = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
      noSystemAudio = true;
    }
  }
  const settings = init.layout ? { width: init.layout.width, height: init.layout.height } : (screen.getVideoTracks()[0]?.getSettings() ?? {});
  const pixels = (settings.width ?? 1920) * (settings.height ?? 1080);
  const bitrate = Math.min(40e6, Math.max(4e6, Math.round(pixels * init.fps * 0.1)));
  const withSound = screen.getAudioTracks().length > 0;
  const screenType = withSound
    ? pick(['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus'])
    : pick(['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9']);

  const extra: Array<Promise<MediaStream | null>> = [
    init.micId
      ? navigator.mediaDevices
          .getUserMedia({ audio: { deviceId: { exact: init.micId }, echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
          .catch(() => null)
      : Promise.resolve(null),
    init.webcamId
      ? navigator.mediaDevices
          .getUserMedia({ video: { deviceId: { exact: init.webcamId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })
          .catch(() => null)
      : Promise.resolve(null),
  ];
  const [mic, webcam] = await Promise.all(extra);

  const first = await record('screen', screen, { mimeType: screenType, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192000 });
  running.push(first);
  if (mic) running.push(await record('mic', mic, { mimeType: pick(['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2']), audioBitsPerSecond: 160000 }));
  if (webcam) running.push(await record('webcam', webcam, { mimeType: pick(['video/webm;codecs=vp9', 'video/mp4;codecs=avc1']), videoBitsPerSecond: 4e6 }));

  const started: RecStarted = { mimes: {}, offsets: {}, noSystemAudio, startedAt: performance.timeOrigin + first.startedAt };
  for (const r of running) {
    started.mimes[r.track] = r.rec.mimeType;
    if (r.track !== 'screen') started.offsets[r.track] = Math.max(0, (r.startedAt - first.startedAt) / 1000);
  }
  desk.send(CH.recStarted, started);
}

async function stop(): Promise<void> {
  await Promise.all(
    running.map(
      (r) =>
        new Promise<void>((resolve) => {
          if (r.rec.state === 'inactive') return resolve();
          r.rec.addEventListener('stop', () => resolve(), { once: true });
          r.rec.stop();
        }),
    ),
  );
  await Promise.all(running.map((r) => r.sending));
  for (const r of running) r.stream.getTracks().forEach((t) => t.stop());
  teardown.forEach((undo) => undo());
  desk.send(CH.recDone);
}

desk.on<RecCommand>(CH.recCommand, (cmd) => {
  if (cmd === 'pause') running.forEach((r) => r.rec.state === 'recording' && r.rec.pause());
  else if (cmd === 'resume') running.forEach((r) => r.rec.state === 'paused' && r.rec.resume());
  else if (cmd === 'stop') void stop();
});

start().catch((err: unknown) => {
  running.forEach((r) => r.stream.getTracks().forEach((t) => t.stop()));
  teardown.forEach((undo) => undo());
  desk.send(CH.recFailed, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
});
