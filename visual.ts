/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './visual-3d';

// Safari fallback type
declare global {
  interface Window { webkitAudioContext?: typeof AudioContext; }
}

function float32ToPCM16Base64(float32: Float32Array): string {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return btoa(String.fromCharCode(...new Uint8Array(out.buffer)));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() text = '';

  private ws!: WebSocket;
  private inputAudioContext = new ((window.AudioContext || (window as any).webkitAudioContext))({ sampleRate: 16000 });
  private outputAudioContext = new ((window.AudioContext || (window as any).webkitAudioContext))({ sampleRate: 24000 });

  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();

  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessorNode: ScriptProcessorNode | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    #status { position: absolute; bottom: 5vh; left: 0; right: 0; z-index: 10; text-align: center; }
    .controls { z-index: 10; position: absolute; bottom: 10vh; left: 0; right: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; }
    .controls button {
      outline: none; border: 1px solid rgba(255,255,255,.2); color: white; border-radius: 12px;
      background: rgba(255,255,255,.1); width: 64px; height: 64px; cursor: pointer; font-size: 24px;
    }
    .controls button:hover { background: rgba(255,255,255,.2); }
    .controls button[disabled] { display: none; }
    .bubble { position:absolute; top: 5vh; left: 0; right: 0; margin:auto; width: min(680px, 92vw); background: rgba(255,255,255,.1); padding: 12px 16px; border-radius: 12px; color:#fff; backdrop-filter: blur(6px);}
  `;

  constructor() {
    super();
    this.init();
  }

  private init() {
    this.nextStartTime = this.outputAudioContext.currentTime;
    this.outputNode.connect(this.outputAudioContext.destination);

    const wsUrl = (location.origin.replace(/^http/, 'ws')) + '/live';
    this.ws = new WebSocket(wsUrl);

    this.ws.addEventListener('open', () => this.status = 'Connected to Rev backend');
    this.ws.addEventListener('close', () => this.status = 'Disconnected');
    this.ws.addEventListener('error', () => this.error = 'WebSocket error');

    this.ws.addEventListener('message', async (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as any;
        if (msg.type === 'status') this.status = msg.message;
        if (msg.type === 'text') this.text = msg.text;

        if (msg.type === 'audio' && msg.base64) {
          // schedule audio
          const ab = base64ToArrayBuffer(msg.base64);
          const audioBuffer = await this.outputAudioContext.decodeAudioData(ab);
          this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
          const source = this.outputAudioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(this.outputNode);
          source.addEventListener('ended', () => this.sources.delete(source));
          source.start(this.nextStartTime);
          this.nextStartTime += audioBuffer.duration;
          this.sources.add(source);
        }
      } catch {}
    });
  }

  private sendText(text: string) {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify({ type: 'text', text }));
    }
  }

  private async startRecording() {
    if (this.isRecording) return;
    await this.inputAudioContext.resume();
    this.status = 'Requesting microphone access...';

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);
      this.scriptProcessorNode.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        const pcm = e.inputBuffer.getChannelData(0);
        const base64 = float32ToPCM16Base64(pcm);
        if (this.ws.readyState === this.ws.OPEN) {
          this.ws.send(JSON.stringify({ type: 'audio', base64 }));
        }
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
      this.status = '🔴 Recording…';
    } catch (err: any) {
      console.error(err);
      this.error = err?.message ?? 'Mic error';
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream) return;
    this.isRecording = false;

    try { this.scriptProcessorNode?.disconnect(); } catch {}
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.mediaStream?.getTracks().forEach(t => t.stop()); } catch {}

    this.scriptProcessorNode = null;
    this.sourceNode = null;
    this.mediaStream = null;
    this.status = 'Recording stopped.';
  }

  private reset() {
    // Ask backend to reopen a clean upstream session (re-sends system prompt)
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reset' }));
    }
    this.text = '';
    this.status = 'Session reset';
  }

  render() {
    return html`
      <div class="controls">
        <button @click=${() => this.reset()} ?disabled=${this.isRecording} title="Reset session">⟳</button>
        <button @click=${() => this.startRecording()} ?disabled=${this.isRecording} title="Start">●</button>
        <button @click=${() => this.stopRecording()} ?disabled=${!this.isRecording} title="Stop">■</button>
      </div>

      <div class="bubble">
        <div><strong>Status:</strong> ${this.status}</div>
        ${this.text ? html`<div style="margin-top:8px;"><strong>Rev:</strong> ${this.text}</div>` : null}
      </div>

      <gdm-live-audio-visuals-3d .inputNode=${this.inputNode} .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
    `;
  }
}
