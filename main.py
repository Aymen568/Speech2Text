import asyncio
import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from speechmatics.rt import (
    AsyncClient,
    AudioEncoding,
    AudioFormat,
    AuthenticationError,
    OperatingPoint,
    ServerMessageType,
    TranscriptResult,
    TranscriptionConfig,
)

load_dotenv()

API_KEY = os.getenv("SPEECHMATICS_API_KEY", "YOUR_API_KEY")
LANGUAGE = os.getenv("SPEECH_LANGUAGE", "ar")

app = FastAPI(title="Speechmatics RT API", version="2.1.0")

# Allow local dev from file:// or http://localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def healthcheck() -> JSONResponse:
    return JSONResponse(
        {
            "status": "ok",
            "language": LANGUAGE,
        }
    )


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Receive audio from browser, stream to Speechmatics RT, return partial/final transcripts."""
    await websocket.accept()

    audio_format = AudioFormat(
        encoding=AudioEncoding.PCM_S16LE,
        chunk_size=4096,
        sample_rate=16000,
    )

    transcription_config = TranscriptionConfig(
        language=LANGUAGE,
        enable_partials=True,
        operating_point=OperatingPoint.ENHANCED,
    )

    transcript_parts = []

    try:
        async with AsyncClient(api_key=API_KEY) as client:

            @client.on(ServerMessageType.ADD_TRANSCRIPT)
            def handle_final_transcript(message):
                result = TranscriptResult.from_message(message)
                transcript = result.metadata.transcript
                if transcript:
                    transcript_parts.append(transcript)
                    asyncio.create_task(
                        websocket.send_json({
                            "type": "final",
                            "text": transcript,
                        })
                    )

            @client.on(ServerMessageType.ADD_PARTIAL_TRANSCRIPT)
            def handle_partial_transcript(message):
                result = TranscriptResult.from_message(message)
                transcript = result.metadata.transcript
                if transcript:
                    asyncio.create_task(
                        websocket.send_json({
                            "type": "partial",
                            "text": transcript,
                        })
                    )

            await client.start_session(
                transcription_config=transcription_config,
                audio_format=audio_format,
            )

            await websocket.send_json({"type": "connected", "message": "متصل بالخادم"})

            while True:
                data = await websocket.receive()

                if "bytes" in data:
                    audio_chunk = data["bytes"]
                    await client.send_audio(audio_chunk)

                elif "text" in data:
                    msg = json.loads(data["text"])
                    if msg.get("type") == "stop":
                        break

    except WebSocketDisconnect:
        print("WebSocket disconnected")
    except AuthenticationError as e:
        await websocket.send_json({"type": "error", "message": f"Authentication error: {e}"})
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})
    finally:
        await websocket.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)