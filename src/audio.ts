import portAudio from "naudiodon2"
import fs from "node:fs"

// const devices = portAudio.getDevices()
// /**
//  * 1 Microphone (AB13X USB Audio)
//  */
// for (const device of devices) {
//     if (device.maxInputChannels > 0) {
//         console.log(device.id, device.name)
//     }
// }
const Microphone =  portAudio.AudioIO({
    inOptions: {
        channelCount: 1,
        sampleFormat: portAudio.SampleFormat16Bit,
        sampleRate: 16000,
        deviceId: -1,
        closeOnError: true,
    }
})

Microphone.on("data", (chunk: Buffer) => {
    console.log(`Received chunk ${chunk.length}`)
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
    process.exit(0);
})