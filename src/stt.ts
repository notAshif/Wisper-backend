import { readFile, writeFile } from "node:fs/promises";
import { SAMPLE_RATE, CHANNELS_COUNT, BITS_PER_SAMPLE } from "./audio.ts";
import { ContextEngine } from "./context.ts";
import "dotenv/config"

interface BaseTranscribeOptions {
    language?: string;
    prompt?: string;
    temperature?: number;
    responseFormat?: "json" | "text" | "verbose_json";
}

interface GroqTranscribeOptions extends BaseTranscribeOptions {
    apiKey?: string;
    model?: "whisper-large-v3" | "whisper-large-v3-turbo" | string;
}

interface TranscribeOptions extends BaseTranscribeOptions {
    provider?: "groq";
    apiKey?: string;
    model?: string;
}

interface LiveTranscriberOptions extends TranscribeOptions {
    chunkDurationMs?: number;
    overlapDurationMs?: number;
    onText: (text: string) => void;
    onError: (error: Error) => void;
}

export function createWavFile(
    pcmData: Buffer,
    sampleRate: number = SAMPLE_RATE,
    channels: number = CHANNELS_COUNT,
    bitsPerSample: number = BITS_PER_SAMPLE,
): Buffer {
    const headerSize = 44;
    const bytesPerSample = bitsPerSample / 8;
    const byteRate = channels * sampleRate * bytesPerSample;
    const blockAlign = channels * bytesPerSample;

    const header = Buffer.alloc(headerSize);

    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + pcmData.length, 4);
    header.write("WAVE", 8, "ascii");

    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    header.write("data", 36, "ascii");
    header.writeUInt32LE(pcmData.length, 40);

    return Buffer.concat([header, pcmData]);
}

function ensureEnvLoaded(): void {
    if (!process.env.GROQ_API_KEY && typeof process.loadEnvFile === "function") {
        try {
            process.loadEnvFile();
        } catch {
        }
    }
}

function toWavBuffer(audio: Buffer): Buffer {
    if (!audio || audio.length === 0) {
        throw new Error("Cannot transcribe empty audio buffer.");
    }
    if (audio.length >= 12 && audio.subarray(0, 4).toString("ascii") === "RIFF") {
        return audio;
    }
    return createWavFile(audio, SAMPLE_RATE, CHANNELS_COUNT, BITS_PER_SAMPLE);
}




export async function transcribeWithGroq(
    audio: Buffer,
    options: GroqTranscribeOptions = {},
): Promise<string> {
    ensureEnvLoaded();

    const apiKey = options.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error(
            "Missing Groq API key. Get a free key at https://console.groq.com/keys and set GROQ_API_KEY in your .env file.",
        );
    }

    const wavBuffer = toWavBuffer(audio);
    const model = options.model || "whisper-large-v3";
    const endpoint = "https://api.groq.com/openai/v1/audio/transcriptions";

    const formData = new FormData();
    const audioBlob = new Blob([wavBuffer as any], { type: "audio/wav" });
    formData.append("file", audioBlob, "audio.wav");
    formData.append("model", model);

    if (options.responseFormat) {
        formData.append("response_format", options.responseFormat);
    } else {
        formData.append("response_format", "json");
    }

    if (options.language) {
        formData.append("language", options.language);
    }
    if (options.prompt) {
        formData.append("prompt", options.prompt);
    }
    if (typeof options.temperature === "number") {
        formData.append("temperature", options.temperature.toString());
    }

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorDetails = errorText;
        try {
            const parsed = JSON.parse(errorText) as { error?: { message?: string } };
            if (parsed.error?.message) {
                errorDetails = parsed.error.message;
            }
        } catch {
        }
        throw new Error(`Groq STT failed (${response.status} ${response.statusText}): ${errorDetails}`);
    }

    if (options.responseFormat === "text") {
        return await response.text();
    }

    const data = (await response.json()) as { text?: string };
    return data.text || "";
}

export class LiveTranscriber {
    private readonly context = new ContextEngine();
    private readonly chunkBytes: number;
    private readonly overlapBytes: number;
    private readonly newAudioBytesPerChunk: number;
    private readonly onText: (text: string) => void;
    private readonly onError: (error: Error) => void;
    private readonly requestOptions: GroqTranscribeOptions;
    private bufferedChunks: Buffer[] = [];
    private bufferedBytes = 0;
    private previousOverlap = Buffer.alloc(0);
    private hasPreviousWindow = false;
    private stopped = false;
    private failed = false;
    private transcriptionQueue: Promise<void> = Promise.resolve();

    constructor(options: LiveTranscriberOptions) {
        const {
            chunkDurationMs = 5_000,
            overlapDurationMs = 500,
            onText,
            onError,
            apiKey,
            model,
            language,
            prompt,
            temperature,
            responseFormat,
        } = options;
        const bytesPerFrame = CHANNELS_COUNT * (BITS_PER_SAMPLE / 8);

        if (!Number.isFinite(chunkDurationMs) || !Number.isFinite(overlapDurationMs)) {
            throw new Error("Live transcription durations must be finite numbers.");
        }

        this.chunkBytes = Math.floor(SAMPLE_RATE * chunkDurationMs / 1_000 / bytesPerFrame) * bytesPerFrame;
        this.overlapBytes = Math.floor(SAMPLE_RATE * overlapDurationMs / 1_000 / bytesPerFrame) * bytesPerFrame;
        if (this.chunkBytes <= 0 || this.overlapBytes < 0 || this.overlapBytes >= this.chunkBytes) {
            throw new Error("Invalid live transcription chunk or overlap duration.");
        }

        this.newAudioBytesPerChunk = this.chunkBytes - this.overlapBytes;
        this.onText = onText;
        this.onError = onError;
        this.requestOptions = { apiKey, model, language, prompt, temperature, responseFormat };
    }

    get cleanupContext(): ContextEngine {
        return this.context;
    }

    push(pcmChunk: Buffer): void {
        if (this.stopped || this.failed || pcmChunk.length === 0) return;

        this.bufferedChunks.push(Buffer.from(pcmChunk));
        this.bufferedBytes += pcmChunk.length;

        while (this.bufferedBytes >= (this.hasPreviousWindow ? this.newAudioBytesPerChunk : this.chunkBytes)) {
            const requiredBytes = this.hasPreviousWindow ? this.newAudioBytesPerChunk : this.chunkBytes;
            const newAudio = this.takeBufferedBytes(requiredBytes);
            const window = this.hasPreviousWindow
                ? Buffer.concat([this.previousOverlap, newAudio])
                : newAudio;

            this.previousOverlap = Buffer.from(window.subarray(Math.max(0, window.length - this.overlapBytes)));
            this.hasPreviousWindow = true;
            this.enqueue(window);
        }
    }

    async stop(): Promise<void> {
        if (!this.stopped) {
            this.stopped = true;
            if (this.bufferedBytes >= 2) {
                const remainingAudio = this.takeBufferedBytes(this.bufferedBytes - (this.bufferedBytes % 2));
                const finalWindow = this.hasPreviousWindow
                    ? Buffer.concat([this.previousOverlap, remainingAudio])
                    : remainingAudio;
                this.enqueue(finalWindow);
            }
            this.bufferedChunks = [];
            this.bufferedBytes = 0;
            this.previousOverlap = Buffer.alloc(0);
        }

        await this.transcriptionQueue;
    }

    private takeBufferedBytes(length: number): Buffer {
        const result = Buffer.allocUnsafe(length);
        let written = 0;

        while (written < length) {
            const first = this.bufferedChunks[0];
            const count = Math.min(first.length, length - written);
            first.copy(result, written, 0, count);
            written += count;
            this.bufferedBytes -= count;

            if (count === first.length) {
                this.bufferedChunks.shift();
            } else {
                this.bufferedChunks[0] = first.subarray(count);
            }
        }

        return result;
    }

    private enqueue(pcmAudio: Buffer): void {
        if (pcmAudio.length < 2) return;

        this.transcriptionQueue = this.transcriptionQueue.then(async () => {
            if (this.failed) return;

            try {
                const prompt = this.context.prompt || this.requestOptions.prompt;
                const text = await transcribeWithGroq(createWavFile(pcmAudio), {
                    ...this.requestOptions,
                    prompt,
                });
                const newText = this.context.append(text);
                if (newText) this.onText(newText);
            } catch (error) {
                this.failed = true;
                const normalizedError = error instanceof Error ? error : new Error(String(error));
                try {
                    this.onError(normalizedError);
                } catch {
                    
                }
            }
        });
    }
}

export async function transcribeAudio(
    audio: Buffer,
    options: TranscribeOptions = {},
): Promise<any> {
    ensureEnvLoaded();

    const provider = options.provider || (process.env.GROQ_API_KEY ? "groq" : "openrouter");

    if (provider) {
        return transcribeWithGroq(audio, options);
    }
}

export async function transcribeFile(
    filePath: string,
    options: TranscribeOptions = {},
): Promise<string> {
    const fileBuffer = await readFile(filePath);
    return transcribeAudio(fileBuffer, options);
}

export async function saveWavFile(filePath: string, wavBuffer: Buffer): Promise<void> {
    await writeFile(filePath, wavBuffer);
}