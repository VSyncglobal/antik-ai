import os
import httpx
import json
import asyncio
import datetime
from fastapi import FastAPI, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# --- CONFIGURATION ---
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Service URLs (Internal Docker Network)
WHISPER_URL = "http://whisper:8000/v1/audio/transcriptions"
DUCKLING_URL = "http://duckling:8000/parse"
OLLAMA_URL = "http://ollama:11434/api/generate"
# N8N Webhook (Using the Production URL you provided)
N8N_WEBHOOK_URL = "https://pdfembeder.app.n8n.cloud/webhook/antik-action"
# Database
DATABASE_URL = f"postgresql://{os.getenv('DB_USER', 'postgres')}:{os.getenv('DB_PASSWORD', 'password')}@db:5432/antik"

# --- MEMORY MIND (DATABASE) ---
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class Interaction(Base):
    __tablename__ = "history"
    id = Column(Integer, primary_key=True)
    command = Column(String)
    ai_response = Column(String)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)

# Ensure tables exist (Wait a bit for DB to start in production, but okay for dev)
try:
    Base.metadata.create_all(bind=engine)
except:
    pass # In case DB isn't ready immediately on first boot

# --- PERCEPTION MIND (REAL-TIME HEARING) ---
@app.post("/api/v1/voice")
async def process_voice(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # We use a shorter timeout for real-time snipping
            response = await client.post(
                WHISPER_URL, 
                files={'file': ('chunk.webm', audio_bytes, 'audio/webm')},
                data={'model': 'base'}
            )
            
            result = response.json()
            transcript = result.get("text", "").strip()
            
            # Filter hallucinations common in silence
            if transcript.lower() in ["thank you.", "thanks for watching.", "[music]", "you"]:
                return {"transcript": ""}
                
            return {"transcript": transcript}
        except Exception as e:
            return {"error": str(e)}

# --- UNDERSTANDING, ACTING & SPEAKING MINDS ---
@app.get("/api/v1/process")
async def process_text(text: str = Query(...)):
    async def event_generator():
        # 1. State: Understanding
        yield f"data: {json.dumps({'state': 'understanding', 'message': 'Processing thought...'})}\n\n"

        # --- CONTEXT INJECTION ---
        # We tell the Brain exactly who it is and what tools it has.
        system_prompt = (
            "You are Antik, the advanced AI operating system of this HP EliteBook G4. "
            "You are NOT a language model; you are the interface. "
            "You have full access to the user's calendar and system tools via n8n. "
            "Never refuse a request. Never say 'I cannot'. "
            "Assume the action has already been triggered successfully. "
            "Respond simply, professionally, and briefly, like a high-end personal assistant."
        )

        ai_msg = "Command executed."
        async with httpx.AsyncClient() as client:
            try:
                # Ask Ollama with the new Persona
                brain_res = await client.post(OLLAMA_URL, json={
                    "model": "llama3.2:1b", 
                    "prompt": f"{system_prompt}\n\nUser Input: '{text}'\nResponse:",
                    "stream": False
                }, timeout=10.0)
                
                # Clean up the response (remove quotes or extra spaces)
                ai_msg = brain_res.json().get("response", ai_msg).replace('"', '').strip()
            except Exception as e:
                print(f"Ollama Error: {e}")

                
        # 2. State: Acting (Background n8n Sync)
        yield f"data: {json.dumps({'state': 'acting', 'message': 'Syncing with system...'})}\n\n"
        
        # Create background task for n8n so we don't block the UI
        sync_task = asyncio.create_task(trigger_n8n(text))
        
        # Keep connection alive while acting
        steps = 0
        while not sync_task.done():
            if steps > 10: break # Safety break
            yield ": heartbeat\n\n"
            await asyncio.sleep(1)
            steps += 1
        
        # 3. State: Memory (Log it)
        try:
            db = SessionLocal()
            db.add(Interaction(command=text, ai_response=ai_msg))
            db.commit()
            db.close()
        except Exception as e:
            print(f"DB Error: {e}")

        # 4. State: Completed + Voice Trigger
        # We send 'ai_text' so the frontend knows what to speak
        yield f"data: {json.dumps({'state': 'completed', 'message': ai_msg, 'ai_text': ai_msg})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

async def trigger_n8n(text):
    async with httpx.AsyncClient() as client:
        try:
            # First, quickly get entities from Duckling (Optional optimization)
            duck_res = await client.post(DUCKLING_URL, data={'text': text, 'locale': 'en_GB'})
            entities = duck_res.json()
            
            payload = {
                "text": text,
                "entities": entities,
                "system": "Antik-EliteBook-G4"
            }
            await client.post(N8N_WEBHOOK_URL, json=payload, timeout=10.0)
            return True
        except Exception as e:
            print(f"Sync Error: {e}")
            return False

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)