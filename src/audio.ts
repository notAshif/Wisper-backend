import portAudio from "naudiodon2"
import fs from "node:fs"

const CHANNELS_COUNT = 1;
const SAMPLE_FORMAT = portAudio.SampleFormat16Bit;
const SAMPLE_RATE = 48_000;
// 8 bits and bytes => 8 / 16

const devices = portAudio.getDevices()

const chunks: Buffer[] = [];

/**
 * 1 Microphone (AB13X USB Audio)
 */
for (const device of devices) {
    if (device.maxInputChannels > 0) {
        console.log(device.id, device.name)
    }
}

const Microphone = portAudio.AudioIO({
    inOptions: {
        channelCount: CHANNELS_COUNT,
        sampleFormat: SAMPLE_FORMAT,
        sampleRate: SAMPLE_RATE,
        deviceId: -1,
        closeOnError: true,
    }
})

Microphone.on("data", (chunk: Buffer) => {
    chunks.push(chunk)
    console.log(`Received chunk ${chunk.length} bytes`)
})

Microphone.on("error", (err: any) => {
    console.log("error", err.message)
})

Microphone.start()

const audio_file = fs.createWriteStream("audio.wav")
Microphone.pipe(audio_file)

console.log("Start Microphone and Please into your microphone...")

Microphone.on("SIGINT", () => {
    console.log('Received SIGINT. Stopping recording.');
    Microphone.quit();

    const pcmData = Buffer.concat(chunks)
    console.log("pcm data:", pcmData.length)
    process.exit(0);
})

//TODO:: Implement createWavFile() function -> headers ofn pcm audio....
