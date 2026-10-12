import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AudioCapture, listAudioDevices } from "./src/audio.ts";
import { LiveTranscriber } from "./src/stt.ts";
import { cleanTranscriptWithMindStudio } from "./src/mindstudio.ts";

async function main(): Promise<void> {
    if (typeof process.loadEnvFile === "function") {
        try {
            process.loadEnvFile();
        } catch {
        }
    }

    const groqKey = process.env.GROQ_API_KEY?.trim();
    if (!groqKey) {
        throw new Error("Add GROQ_API_KEY to your .env file to transcribe microphone audio.");
    }
    if (!process.env.MINDSTUDIO_API_KEY?.trim()) {
        throw new Error("Add MINDSTUDIO_API_KEY to your .env file to format the final transcript.");
    }

    const devices = listAudioDevices();
    if (devices.length === 0) {
        throw new Error("No audio input devices are available.");
    }

    const configuredDeviceId = process.env.AUDIO_DEVICE_ID?.trim();
    const deviceId = configuredDeviceId ? Number(configuredDeviceId) : devices[0].id;
    if (!Number.isInteger(deviceId) || !devices.some((device) => device.id === deviceId)) {
        throw new Error("AUDIO_DEVICE_ID must match an available microphone device ID.");
    }

    const recorder = new AudioCapture({ deviceId, retainAudio: false });
    const chunkDurationSeconds = Number(process.env.GROQ_STT_CHUNK_SECONDS || 5);
    let transcriptionError: Error | undefined;
    let microphoneError: Error | undefined;
    const transcriber = new LiveTranscriber({
        apiKey: groqKey,
        chunkDurationMs: chunkDurationSeconds * 1_000,
        onText: (text) => process.stdout.write(text),
        onError: (error) => {
            transcriptionError = error;
        },
    });

    let capturedBytes = 0;
    const unsubscribeChunk = recorder.onChunk((chunk) => {
        capturedBytes += chunk.length;
        transcriber.push(chunk);
    });
    const unsubscribeError = recorder.onError((error) => {
        microphoneError = error instanceof Error ? error : new Error(String(error));
    });

    const rl = createInterface({ input, output });

    try {
        await rl.question("Press Enter to start recording...");
        recorder.start();
        await rl.question("Recording. Press Enter to stop...");

        recorder.stop();
        if (microphoneError) {
            throw new Error(`Microphone capture failed: ${microphoneError.message}`);
        }
        if (capturedBytes === 0) {
            throw new Error("No audio was captured.");
        }

        await transcriber.stop();
        if (transcriptionError) {
            throw transcriptionError;
        }

        const finalText = await cleanTranscriptWithMindStudio(transcriber.cleanupContext);
        process.stdout.write(`\n\n${finalText}\n`);
    } finally {
        if (recorder.recording) recorder.stop();
        unsubscribeChunk();
        unsubscribeError();
        rl.close();
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
