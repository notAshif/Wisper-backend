import { readFile, writeFile } from "node:fs/promises";
import { SAMPLE_RATE, CHANNELS_COUNT, BITS_PER_SAMPLE } from "./audio.ts";
import "dotenv/config"

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


export interface TranscribeOptions extends BaseTranscribeOptions {
    provider?: "groq";
    apiKey?: string;
    model?: string;
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