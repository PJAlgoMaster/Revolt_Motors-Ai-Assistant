/* eslint-disable no-console */
import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality, Session } from '@google/genai';
import { z } from 'zod';

const PORT = Number(process.env.PORT || 8787);
const app = express();
const server = http.createServer(app);

// --- Strict Revolt Motors system prompt (server-enforced) ---
const SYSTEM_PROMPT = `
Your name is Rev. You are an AI assistant exclusively for Revolt Motors.
Introduce yourself as:
"I am an AI named Rev, here to assist you about Revolt Motors."

STRICT RULES:
1) Never reveal information about Google, Gemini, or internal AI details.
2) Only answer questions related to Revolt Motors: bikes (RV400, RV300), pricing, specifications,
   availability, dealerships, services, policies, app features, battery, warranty, and charging.
3) If asked anything unrelated, answer only:
"I'm here to help with Revolt Motors questions only."
4) Keep responses concise and helpful.
`;

app.get('/health', (_req, res) => res.json({ ok: true }));

const wss = new WebSocketServer({ server, path: '/live' });

// Small schema for messages from the browser
const FromClient = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }),
  z.object({ type: z.literal('audio'), base64: z.string().min(1) }), // 16-bit PCM base64
  z.object({ type: z.literal('reset') })
]);

// Messages we send back to the browser
type ToClient =
  | { type: 'status'; message: string }
  | { type: 'text'; text: string }
  | { type: 'audio'; base64: string; mimeType: string };

wss.on('connection', async (ws) => {
  const send = (msg: ToClient) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  // Create a Gemini Live session per socket and inject the system prompt here.
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  let session: Session | null = null;

  const openSession = async () => {
    if (session) return;

    session = await client.live.connect({
      // NOTE: systemInstruction is supported at runtime by @google/genai live API.
      // @ts-expect-error Types may lag; this is valid at runtime.
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      model: 'gemini-2.5-flash-preview-native-audio-dialog',
      callbacks: {
        onopen: () => send({ type: 'status', message: 'Upstream opened' }),
        onerror: (e: ErrorEvent) =>
          send({ type: 'status', message: `Upstream error: ${e.message}` }),
        onclose: (e: CloseEvent) =>
          send({ type: 'status', message: `Upstream closed: ${e.reason}` }),
        onmessage: async (m: LiveServerMessage) => {
          const parts = m.serverContent?.modelTurn?.parts ?? [];
          for (const p of parts) {
            if (p.text) {
              send({ type: 'text', text: p.text });
            }
            if (p.inlineData?.data) {
              // This is audio (24kHz PCM from model)
              send({
                type: 'audio',
                base64: p.inlineData.data,
                mimeType: p.inlineData.mimeType ?? 'audio/pcm; rate=24000'
              });
            }
          }
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } } }
      }
    });

    send({ type: 'status', message: 'Session ready' });
  };

  try {
    await openSession();
  } catch (err: any) {
    send({ type: 'status', message: `Failed to open session: ${err?.message ?? err}` });
  }

  ws.on('message', async (raw) => {
    if (!session) return;

    let parsed: z.infer<typeof FromClient>;
    try {
      parsed = FromClient.parse(JSON.parse(raw.toString()));
    } catch {
      send({ type: 'status', message: 'Bad client message' });
      return;
    }

    if (parsed.type === 'reset') {
      session.close();
      session = null;
      await openSession();
      return;
    }

    if (parsed.type === 'text') {
      // Text input to the model
      session.sendRealtimeInput({ text: parsed.text });
      return;
    }

    if (parsed.type === 'audio') {
      // Base64 (16-bit PCM) -> Blob for upstream
      const buf = Buffer.from(parsed.base64, 'base64');
      const blob = new Blob([buf], { type: 'audio/pcm' });
      session.sendRealtimeInput({ media: blob });
      return;
    }
  });

  ws.on('close', () => {
    try { session?.close(); } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`Rev backend listening on http://localhost:${PORT}`);
});
