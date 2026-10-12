# Whisper backend

The CLI captures microphone audio in memory and streams recognized text to the terminal as Groq transcribes short overlapping chunks. After recording stops, it sends the combined transcript to MindStudio for cleanup and prints the final formatted text. It does not save a WAV file.

## Configure

Copy `.env.example` to `.env`, then set `GROQ_API_KEY` and `MINDSTUDIO_API_KEY`. The default cleanup model is `gemini-2.5-flash-lite`; set `MINDSTUDIO_MODEL` to another available model ID if needed. `AUDIO_DEVICE_ID` is optional and defaults to the first available input device.

## Run

```sh
npm install
npm run dev
```

Press Enter to start and stop recording. The full transcript is cleaned once recording ends.
