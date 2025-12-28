import asyncio
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()

async def event_generator(input_text: str):
    """
    Simulates the 'Mind' processing stages
    """
    yield f"data: {{\"state\": \"identifying\", \"message\": \"Antik is listening...\"}}\n\n"
    await asyncio.sleep(1) # Simulating NLP processing
    
    yield f"data: {{\"state\": \"processing\", \"message\": \"Analysing: {input_text}\"}}\n\n"
    await asyncio.sleep(1)
    
    yield f"data: {{\"state\": \"completed\", \"message\": \"Task created successfully.\"}}\n\n"

@app.get("/ask")
async def ask_antik(prompt: str):
    return StreamingResponse(event_generator(prompt), media_type="text/event-stream")