import portAudio from "naudiodon2";

export const CHANNELS_COUNT = 1;
export const SAMPLE_FORMAT = portAudio.SampleFormat16Bit;
export const SAMPLE_RATE = 16_000;
export const BITS_PER_SAMPLE = 16;

interface AudioCaptureOptions {
    deviceId?: number;
    sampleRate?: number;
    channelCount?: number;
}

export class AudioCapture {
    private microphone: any = null;
    private chunks: Buffer[] = [];
    private isRecording: boolean = false;
    private deviceId: number;
    private sampleRate: number;
    private channelCount: number;

    constructor(deviceIdOrOptions: number | AudioCaptureOptions = 1) {
        if (typeof deviceIdOrOptions === "number") {
            this.deviceId = deviceIdOrOptions;
            this.sampleRate = SAMPLE_RATE;
            this.channelCount = CHANNELS_COUNT;
        } else {
            this.deviceId = deviceIdOrOptions.deviceId ?? 1;
            this.sampleRate = deviceIdOrOptions.sampleRate ?? SAMPLE_RATE;
            this.channelCount = deviceIdOrOptions.channelCount ?? CHANNELS_COUNT;
        }
    }

    start(): void {
        if (this.isRecording) {
            console.log("Already recording");
            return;
        }

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
                this.chunks.push(chunk);
            }
        });

        this.microphone.on("error", (err: any) => {
            console.error("Microphone error:", err?.message || err);
        });

        this.isRecording = true;
        this.microphone.start();
        console.log("Microphone started. Please speak into your microphone...");
    }

    stop(): Buffer {
        if (!this.isRecording) {
            console.log("Not recording");
            return Buffer.alloc(0);
        }

        this.isRecording = false;
        if (this.microphone) {
            this.microphone.quit();
            this.microphone = null;
        }

        const pcmData = Buffer.concat(this.chunks);
        console.log("Microphone stopped. PCM data length:", pcmData.length);

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

interface AudioDeviceInfo {
    id: number;
    name: string;
    maxInputChannels: number;
    defaultSampleRate: number;
}

export function listAudioDevices(): AudioDeviceInfo[] {
    const devices = portAudio.getDevices();
    const inputDevices: AudioDeviceInfo[] = [];

    console.log("Available audio input devices:");
    for (const device of devices) {
        if (device.maxInputChannels > 0) {
            inputDevices.push({
                id: device.id,
                name: device.name,
                maxInputChannels: device.maxInputChannels,
                defaultSampleRate: device.defaultSampleRate,
            });
            console.log(`  ID: ${device.id}, Name: ${device.name}`);
        }
    }

    return inputDevices;
}
