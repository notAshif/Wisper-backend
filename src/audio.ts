import portAudio from "naudiodon2";

export const CHANNELS_COUNT = 1;
export const SAMPLE_FORMAT = portAudio.SampleFormat16Bit;
export const SAMPLE_RATE = 16_000;
export const BITS_PER_SAMPLE = 16;

interface AudioCaptureOptions {
    deviceId?: number;
    sampleRate?: number;
    channelCount?: number;
    retainAudio?: boolean;
}

interface AudioDeviceInfo {
    id: number;
    name: string;
    maxInputChannels: number;
    defaultSampleRate: number;
}


export class AudioCapture {
    private microphone: any = null;
    private chunks: Buffer[] = [];
    private isRecording: boolean = false;
    private deviceId: number;
    private sampleRate: number;
    private channelCount: number;
    private retainAudio: boolean;
    private chunkListeners = new Set<(chunk: Buffer) => void>();
    private errorListeners = new Set<(error: unknown) => void>();

    constructor(deviceIdOrOptions: number | AudioCaptureOptions = 1) {
        if (typeof deviceIdOrOptions === "number") {
            this.deviceId = deviceIdOrOptions;
            this.sampleRate = SAMPLE_RATE;
            this.channelCount = CHANNELS_COUNT;
            this.retainAudio = true;
        } else {
            this.deviceId = deviceIdOrOptions.deviceId ?? 1;
            this.sampleRate = deviceIdOrOptions.sampleRate ?? SAMPLE_RATE;
            this.channelCount = deviceIdOrOptions.channelCount ?? CHANNELS_COUNT;
            this.retainAudio = deviceIdOrOptions.retainAudio ?? true;
        }
    }

    onChunk(listener: (chunk: Buffer) => void): () => void {
        this.chunkListeners.add(listener);
        return () => this.chunkListeners.delete(listener);
    }

    onError(listener: (error: unknown) => void): () => void {
        this.errorListeners.add(listener);
        return () => this.errorListeners.delete(listener);
    }

    start(): void {
        if (this.isRecording) return;

        this.chunks = [];
        this.microphone = portAudio.AudioIO({
            inOptions: {
                channelCount: this.channelCount,
                sampleFormat: SAMPLE_FORMAT,
                sampleRate: this.sampleRate,
                deviceId: this.deviceId,
                closeOnError: true,
            },
        });

        this.microphone.on("data", (chunk: Buffer) => {
            if (this.isRecording) {
                const audioChunk = Buffer.from(chunk);
                if (this.retainAudio) {
                    this.chunks.push(audioChunk);
                }
                for (const listener of this.chunkListeners) {
                    listener(audioChunk);
                }
            }
        });

        this.microphone.on("error", (err: any) => {
            this.isRecording = false;
            for (const listener of this.errorListeners) {
                listener(err);
            }
        });

        this.isRecording = true;
        this.microphone.start();
    }

    stop(): Buffer {
        if (!this.isRecording && !this.microphone) return Buffer.alloc(0);

        this.isRecording = false;
        if (this.microphone) {
            const microphone = this.microphone;
            this.microphone = null;
            microphone.quit();
        }

        const pcmData = Buffer.concat(this.chunks);

        return pcmData;
    }

    getChunks(): Buffer[] {
        return this.chunks;
    }

    get recording(): boolean {
        return this.isRecording;
    }
}

export function createAudioCapture(deviceIdOrOptions: number | AudioCaptureOptions = 1): AudioCapture {
    return new AudioCapture(deviceIdOrOptions);
}

export function listAudioDevices(): AudioDeviceInfo[] {
    const devices = portAudio.getDevices();
    const inputDevices: AudioDeviceInfo[] = [];

    for (const device of devices) {
        if (device.maxInputChannels > 0) {
            inputDevices.push({
                id: device.id,
                name: device.name,
                maxInputChannels: device.maxInputChannels,
                defaultSampleRate: device.defaultSampleRate,
            });
        }
    }

    return inputDevices;
}
