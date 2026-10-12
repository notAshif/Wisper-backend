import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AudioCapture, listAudioDevices } from "./src/audio.ts";
import { createWavFile, transcribeAudio, saveWavFile } from "./src/stt.ts";

async function main() {
    if (typeof process.loadEnvFile === "function") {
        try {
            process.loadEnvFile();
        } catch {
        }
    }

    console.log("=== Whisper Backend STT Demo ===\n");

    const groqKey = process.env.GROQ_API_KEY?.trim();
    // const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();

    if (groqKey) {
        console.log("Using Provider: Groq (whisper-large-v3, 100% Free)");
    }  else {
        console.log("Notice: No API key detected. Please add GROQ_API_KEY to your .env file.");
    }

    listAudioDevices();

    const deviceId = 1;
    const recorder = new AudioCapture(deviceId);

    const rl = createInterface({ input, output });

    console.log(`\nReady to record on device ID: ${deviceId}`);
    await rl.question("Press [Enter] to START recording...");

    recorder.start();

    await rl.question("Recording in progress... Press [Enter] to STOP recording.\n");

    const pcmData = recorder.stop();

    if (pcmData.length === 0) {
        console.log("No audio recorded.");
        rl.close();
        return;
    }

    console.log(`Captured ${pcmData.length} bytes of raw PCM audio.`);

    const wavBuffer = createWavFile(pcmData);
    console.log(`Created WAV file buffer (${wavBuffer.length} bytes).`);

    const outputFilename = "test_recording.wav";
    await saveWavFile(outputFilename, wavBuffer);
    console.log(`Saved audio locally to ${outputFilename}`);

    console.log("\nTranscribing audio with Whisper Large v3...");

    try {
        const text = await transcribeAudio(wavBuffer);
        console.log("\n================ TRANSCRIPTION ================");
        console.log(text);
        console.log("===============================================\n");
    } catch (err: any) {
        console.error("\nTranscription error:", err.message);
    } finally {
        rl.close();
    }
}

main().catch(console.error);
