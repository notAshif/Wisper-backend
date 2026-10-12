//TODO::gemini for cleanup and format...

import { MindStudioAgent } from "@mindstudio-ai/agent";
import type { ContextEngine } from "./context.ts";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";

export async function cleanTranscriptWithMindStudio(context: ContextEngine): Promise<string> {
    const apiKey = process.env.MINDSTUDIO_API_KEY?.trim();
    if (!apiKey) {
        throw new Error("Add MINDSTUDIO_API_KEY to your .env file to format the final transcript.");
    }

    const model = process.env.MINDSTUDIO_MODEL?.trim() || DEFAULT_MODEL;
    const agent = new MindStudioAgent({ apiKey });
    const result = await agent.generateText({
        message: context.renderForCleanup(),
        modelOverride: {
            model,
            temperature: 0.1,
            maxResponseTokens: 4_000,
        },
    });

    const finalText = result.content.trim();
    if (!finalText) {
        throw new Error("MindStudio returned an empty final transcript.");
    }

    return finalText;
}
