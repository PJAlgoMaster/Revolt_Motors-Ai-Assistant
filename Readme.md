

# Rev – Live Audio Assistant for Revolt Motors

> ""Rev"" is a voice-based AI assistant that only answers questions about ""Revolt Motors"".
> Built with **Vite + TypeScript** for the frontend and a **Node.js backend** that injects strict system instructions before every AI interaction.

---

## 🚀 Features

* 🎤 Real-time microphone input
* 🔊 Audio output streaming from Google Gemini
* 🎨 3D audio visualization
* ✅ Strict domain enforcement (Revolt Motors only)
* 🔒 Backend-injected system prompt for secure persona control

---

## 📂 Project Structure

```
LIVE-AUDIO/
├─ backend/                  # Node backend for system prompt injection
│  ├─ server.ts              # Main WebSocket + GenAI connection logic
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ .env                   # GEMINI_API_KEY + PORT
├─ public/                   # Static assets
├─ src/                      # Frontend source code
│  ├─ index.tsx              # App entry
│  ├─ visual.ts              # Audio component with WebSocket client
│  ├─ visual-3d.ts           # Audio visualization logic
│  ├─ analyser.ts
│  └─ utils.ts
├─ index.html
├─ vite.config.ts
├─ tsconfig.json
└─ README.md
```

---

## ✅ Requirements

* **Node.js** ≥ 18
* **npm** or **pnpm/yarn**
* **Google Gemini API Key**

---

## ⚙️ Setup Instructions

### 1. Backend Setup

1. Navigate to `backend` folder:

   ```bash
   cd backend
   npm install
   ```
2. Create `.env` file in `backend`:

   ```
   GEMINI_API_KEY=your-google-gemini-api-key
   PORT=8787
   ```
3. Run backend in development:

   ```bash
   npx tsx watch server.ts
   ```

---

### 2. Frontend Setup

1. From project root:

   ```bash
   npm install
   ```
2. Configure Vite proxy in `vite.config.ts`:

   ```ts
   server: {
     proxy: {
       '/live': { target: 'http://localhost:8787', ws: true, changeOrigin: true }
     }
   }
   ```
3. Start frontend:

   ```bash
   npm run dev
   ```
4. Open the app at the URL printed by Vite (usually `http://localhost:5173`).

---

## 🔑 How It Works

* **Frontend**
  Captures microphone input, sends PCM chunks to backend over WebSocket, and plays audio from AI responses.
* **Backend**
  Uses Google Gemini **Live API** to maintain an audio session with a **system prompt**:

  ```
  Your name is Rev. You are an AI assistant exclusively for Revolt Motors.
  Only answer questions related to Revolt Motors products, pricing, services, battery, warranty, and dealerships.
  If the question is unrelated, reply: "I'm here to help with Revolt Motors questions only."
  ```

---

## 🛡️ Why Backend Prompt Injection?

Placing system instructions in the backend ensures:

* The AI **cannot be tricked** by user prompt injection.
* API keys remain secure and **never exposed to frontend**.

---

## 🖼️ UI Overview

* 🎛 **Start / Stop Recording Buttons**
* 🔊 **Audio Playback**
* 🌐 **Visualizer Canvas** (`visual-3d.ts`)

---

## 🔒 Security Notes

* Keep your **GEMINI\_API\_KEY** private.
* Rotate keys periodically.
* Do not expose backend without authentication if deploying publicly.

---

## ⚠️ Troubleshooting

### Decorator Errors (`@state()`, `@customElement`)

Enable in `tsconfig.json`:

```json
"experimentalDecorators": true,
"useDefineForClassFields": false
```

### `import.meta.env` Issues

Add `vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

### WebSocket Connection Issues

* Confirm Vite proxy for `/live` is set to backend URL.
* Ensure backend logs show successful Gemini connection.

---

## 📦 Build for Production

```bash
npm run build
```

Serve `dist/` folder via your hosting (Netlify, Vercel, Nginx, etc.) and run backend separately on a server.

---

## ✅ Commands Summary

```bash
# Backend
cd backend && npm install && npx tsx watch server.ts

# Frontend
npm install && npm run dev
```

---

## 📌 License


---
