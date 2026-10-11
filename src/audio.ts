import portAudio from "naudiodon2"
import fs from "node:fs"

const CHANNELS_COUNT = 1;
const SAMPLE_FORMAT = portAudio.SampleFormat16Bit;
const SAMPLE_RATE = 16_000;
// 18 bits and bytes => 8 / 16

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

const microphone = portAudio.AudioIO({
    inOptions: {
        channelCount: CHANNELS_COUNT,
        sampleFormat: SAMPLE_FORMAT,
        sampleRate: SAMPLE_RATE,
        deviceId: 1,
        closeOnError: true,
    }
})

microphone.on("data", (chunk: Buffer) => {
    chunks.push(chunk)
    console.log(`Received chunk ${chunk.length} bytes`)
})

microphone.on("error", (err: any) => {
    console.log("error", err.message)
})

microphone.start()

// const audio_file = fs.createWriteStream("audio.wav")
// Microphone.pipe(audio_file)

console.log("Start Microphone and Please into your microphone...")

process.on("SIGINT", () => {
    console.log('Received SIGINT. Stopping recording.');
    microphone.quit();

    const pcmData = Buffer.concat(chunks)
    console.log("pcm data length", pcmData.length)

    const waveFile = createWavFile(
        pcmData,
        SAMPLE_RATE,
        CHANNELS_COUNT,
        16,
    )

    fs.writeFileSync("recording.wav", waveFile)

    console.log(`Received wave file length:  ${waveFile.length} bytes`)

    process.exit(0);
})

//TODO:: Implement createWavFile() function -> headers ofn pcm audio....
function createWavFile(
    pcmData: Buffer,
    sampleRate: number,
    channels: number,
    bitsPerSample: number,
): Buffer {
    const headerSize = 44;

    const bytesPerSample = bitsPerSample / 8;

    const byteRate = channels * sampleRate * bytesPerSample;

    const blockAlign = channels * bytesPerSample;

    const header = Buffer.alloc(headerSize);


    // RIFF
    header.write("RIFF", 0, "ascii");

    // File size - 8
    header.writeUInt32LE(
        36 + pcmData.length,
        4
    );

    // WAVE
    header.write("WAVE", 8, "ascii");

    // fmt chunk
    header.write("fmt ", 12, "ascii");

    // PCM format chunk size
    header.writeUInt32LE(16, 16);

    // Audio format
    // 1 = PCM
    header.writeUInt16LE(1, 20);

    // Number of channels
    header.writeUInt16LE(
        channels,
        22
    );

    // Sample rate
    header.writeUInt32LE(
        sampleRate,
        24
    );

    // Byte rate
    header.writeUInt32LE(
        byteRate,
        28
    );

    // Block align
    header.writeUInt16LE(
        blockAlign,
        32
    );

    // Bits per sample
    header.writeUInt16LE(
        bitsPerSample,
        34
    );

    // data chunk
    header.write("data", 36, "ascii");

    // PCM data size
    header.writeUInt32LE(
        pcmData.length,
        40
    );


    return Buffer.concat([
        header,
        pcmData
    ])
}
