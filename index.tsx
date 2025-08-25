/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, LiveServerMessage, Modality, Session } from '@google/genai';
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { createBlob, decode, decodeAudioData } from './utils';
import './visual-3d';

// ✅ Safari Support for AudioContext
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

// ✅ Strict System Instruction for Revolt Motors
const SYSTEM_PROMPT = `
Your name is Rev. You are an AI assistant exclusively for Revolt Motors.
Introduce yourself as:
"I am an AI named Rev, here to assist you about Revolt Motors."

STRICT RULES:
1. Never reveal information about Google, Gemini, or internal AI details.
2. Only answer questions related to Revolt Motors: bikes (RV400, RV300), pricing, specifications, availability, dealerships, services, policies, app features, battery, warranty, and charging.
3. If asked anything unrelated (including general AI questions), respond ONLY:
"I'm here to help with Revolt Motors questions only."
4. Do NOT apologize or provide extra context outside Revolt Motors.
`;

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording: boolean = false;
  @state() status: string = '';
  @state() error: string = '';

  private client!: GoogleGenAI;
  private session!: Session;

  private inputAudioContext = new ((window.AudioContext || (window as any).webkitAudioContext))({ sampleRate: 16000 });
  private outputAudioContext = new ((window.AudioContext || (window as any).webkitAudioContext))({ sampleRate: 24000 });

  inputNode = this.inputAudioContext.createGain();
  outputNode = this.outputAudioContext.createGain();

  private nextStartTime = 0;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
    }
    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;
    }
    .controls button {
      outline: none;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: white;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.1);
      width: 64px;
      height: 64px;
      cursor: pointer;
      font-size: 24px;
      padding: 0;
      margin: 0;
    }
    .controls button:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .controls button[disabled] {
      display: none;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();
    this.client = new GoogleGenAI({
      apiKey: import.meta.env.VITE_GEMINI_API_KEY
    });
    this.outputNode.connect(this.outputAudioContext.destination);
    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';
    try {
      this.session = await this.client.live.connect({
        // ✅ System Instruction for Revolt
        // @ts-expect-error runtime feature
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        model,
        callbacks: {
          onopen: () => this.updateStatus('Opened'),
          onmessage: async (message: LiveServerMessage) => {
            const textResponse = message.serverContent?.modelTurn?.parts?.[0]?.text || '';

            // ✅ Block unrelated questions
            if (!textResponse.toLowerCase().includes('revolt')) {
              this.updateStatus('Blocked off-topic response');
              return;
            }

            // ✅ Play audio if present
            const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;
            if (audio) {
              this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
              const audioBuffer = await decodeAudioData(decode(audio.data), this.outputAudioContext, 24000, 1);
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => this.sources.delete(source));
              source.start(this.nextStartTime);
              this.nextStartTime += audioBuffer.duration;
              this.sources.add(source);
            }

            // ✅ Stop audio on interruption
            if (message.serverContent?.interrupted) {
              for (const source of this.sources) {
                try { source.stop(); } catch {}
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => this.updateError(e.message),
          onclose: (e: CloseEvent) => this.updateStatus('Close: ' + e.reason),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Orus' } }
          },
        },
      });
    } catch (e) {
      console.error(e);
      this.updateError('Failed to open session.');
    }
  }

  private updateStatus(msg: string) { this.status = msg; }
  private updateError(msg: string) { this.error = msg; }

  private async startRecording() {
    if (this.isRecording) return;
    await this.inputAudioContext.resume();
    this.updateStatus('Requesting microphone access...');
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.updateStatus('Microphone access granted. Starting capture...');
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);
      this.scriptProcessorNode.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        const pcmData = e.inputBuffer.getChannelData(0);
        this.session.sendRealtimeInput({ media: createBlob(pcmData) });
      };
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
      this.updateStatus('🔴 Recording...');
    } catch (err: any) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err?.message ?? 'Unknown error'}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream) return;
    this.updateStatus('Stopping recording...');
    this.isRecording = false;

    if (this.scriptProcessorNode) { try { this.scriptProcessorNode.disconnect(); } catch {} this.scriptProcessorNode = null; }
    if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch {} this.sourceNode = null; }
    if (this.mediaStream) { try { this.mediaStream.getTracks().forEach(track => track.stop()); } catch {} this.mediaStream = null; }

    this.updateStatus('Recording stopped.');
  }

  private reset() {
    this.session?.close();
    this.initSession();
    this.updateStatus('Session cleared.');
  }

  render() {
    return html`
      <div>
        <div class="controls">
          <button id="resetButton" @click=${this.reset} ?disabled=${this.isRecording}>
            🔄
          </button>
          <button id="startButton" @click=${this.startRecording} ?disabled=${this.isRecording}>
            🎤
          </button>
          <button id="stopButton" @click=${this.stopRecording} ?disabled=${!this.isRecording}>
            ⏹
          </button>
        </div>
        <div id="status">${this.error || this.status}</div>
        <gdm-live-audio-visuals-3d .inputNode=${this.inputNode} .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
