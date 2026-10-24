export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('Recorder was not started'));
        return;
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
        this.stream?.getTracks().forEach((t) => t.stop());
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }
}

export async function decodeBlobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const buffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();
  return buffer;
}

const BASIC_PITCH_SAMPLE_RATE = 22050;

/**
 * Basic Pitch requires mono audio at exactly 22050 Hz. Connecting a buffer
 * source to an OfflineAudioContext with fewer channels / a different sample
 * rate makes the Web Audio API do the downmix + resample for us.
 */
export async function resampleForBasicPitch(buffer: AudioBuffer): Promise<Float32Array> {
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(buffer.duration * BASIC_PITCH_SAMPLE_RATE),
    BASIC_PITCH_SAMPLE_RATE,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}
