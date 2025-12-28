import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Send, Sparkles, Square, Trash2, Calendar } from 'lucide-react';

const AntikAI = () => {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState({ state: 'idle', message: 'Ready' });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [audioData, setAudioData] = useState(new Uint8Array(0));
  
  const mediaStream = useRef(null);
  const mediaRecorder = useRef(null);
  const audioContext = useRef(null);
  const analyser = useRef(null);
  const animationFrame = useRef(null);

  // --- AUDIO VISUALIZER (Symmetrical EQ Style) ---
  const startAudioVisualizer = (stream) => {
    if (!audioContext.current) {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    analyser.current = audioContext.current.createAnalyser();
    const source = audioContext.current.createMediaStreamSource(stream);
    source.connect(analyser.current);
    analyser.current.fftSize = 64; 
    const dataArray = new Uint8Array(analyser.current.frequencyBinCount);

    const update = () => {
      if (!mediaStream.current) return;
      analyser.current.getByteFrequencyData(dataArray);
      setAudioData(new Uint8Array(dataArray));
      animationFrame.current = requestAnimationFrame(update);
    };
    update();
  };

  // --- VOICE ENGINE WAKE UP ---
  const wakeUpVoice = () => {
    // This silent call forces the browser to activate the text-to-speech engine
    // preventing the "first call silence" bug.
    const silent = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(silent);
  };

  // --- LISTENING (3s Snipping) ---
  const startListening = async () => {
    wakeUpVoice(); // <--- ACTIVATE VOICE ENGINE ON CLICK
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStream.current = stream;
      setIsListening(true);
      startAudioVisualizer(stream);

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      let chunks = [];

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
          
          // SNIPPER: Send accumulated audio every 3 seconds for real-time text
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const formData = new FormData();
          formData.append('file', blob, 'stream.webm');

          try {
            const res = await fetch('http://localhost:8000/api/v1/voice', { method: 'POST', body: formData });
            const data = await res.json();
            if (data.transcript) setInput(data.transcript);
          } catch (err) { console.error("Hearing glitch:", err); }
        }
      };

      recorder.start(3000); 
      mediaRecorder.current = recorder;
    } catch (err) {
      console.error("Mic Access Denied:", err);
      setStatus({ state: 'error', message: 'Mic Blocked' });
    }
  };

  const stopListening = (discard = false) => {
    if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
      mediaRecorder.current.stop();
    }
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach(track => track.stop());
      mediaStream.current = null;
    }
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    
    setIsListening(false);
    
    if (discard) {
      setInput('');
      setStatus({ state: 'idle', message: 'Ready' });
    } else if (input.trim()) {
      processCommand(null, input);
    }
  };

  // --- PROCESSING (SSE with Smart Voice Feedback) ---
  const processCommand = async (e, forcedText = null) => {
    if (e) e.preventDefault();
    const text = forcedText || input;
    if (!text.trim() || isProcessing) return;

    setIsProcessing(true);
    setStatus({ state: 'understanding', message: 'Thinking...' });

    const es = new EventSource(`http://localhost:8000/api/v1/process?text=${encodeURIComponent(text)}`);
    
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setStatus({ state: data.state, message: data.message, events: data.events }); // Capture events if sent

      if (data.state === 'completed') {
        // CALL FEEDBACK: Speak the AI response
        if (data.ai_text) {
          // 1. CLEAR THE THROAT: Cancel any stuck speech
          window.speechSynthesis.cancel();
          
          const utterance = new SpeechSynthesisUtterance(data.ai_text);
          
          // 2. VOICE SELECTION: Try to find a high-quality voice
          const voices = window.speechSynthesis.getVoices();
          // Look for "Google US English" or "Samantha" (common high-quality voices)
          const preferred = voices.find(v => v.name.includes("Google US") || v.name.includes("Samantha"));
          if (preferred) utterance.voice = preferred;

          utterance.rate = 1.05; 
          utterance.pitch = 1.0;
          window.speechSynthesis.speak(utterance);
        }
        es.close();
        setIsProcessing(false);
        setInput('');
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      setStatus({ state: 'error', message: 'Connection Lost' });
      es.close();
      setIsProcessing(false);
    };
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center font-sans overflow-hidden selection:bg-purple-500/30">
      
      {/* VISUALIZER & ORB */}
      <div className="relative flex items-center justify-center mb-10 w-full h-64">
        {/* Symmetrical Bars */}
        <div className="absolute flex gap-1 items-end h-32 opacity-30 pointer-events-none">
           {/* Left Side (Mirrored) */}
           {Array.from(audioData).slice(0, 20).reverse().map((v, i) => (
             <motion.div key={`l-${i}`} animate={{ height: (v / 255) * 100 + '%' }} className="w-2 bg-purple-500 rounded-t-sm" />
           ))}
           {/* Right Side */}
           {Array.from(audioData).slice(0, 20).map((v, i) => (
             <motion.div key={`r-${i}`} animate={{ height: (v / 255) * 100 + '%' }} className="w-2 bg-cyan-500 rounded-t-sm" />
           ))}
        </div>

        {/* The Liquid Core */}
        <motion.div
          animate={{
            scale: isListening ? [1, 1.05, 1] : 1,
            borderRadius: isListening ? ["50%", "40%", "50%"] : "50%",
            boxShadow: isListening ? "0 0 60px rgba(168, 85, 247, 0.4)" : "0 0 0px rgba(0,0,0,0)"
          }}
          transition={{ duration: 2, repeat: Infinity }}
          className={`relative z-10 w-28 h-28 flex items-center justify-center rounded-full cursor-pointer transition-all duration-500 ${isListening ? 'bg-white' : 'bg-gradient-to-br from-purple-700 to-slate-900 border border-white/10'}`}
          onClick={isListening ? () => stopListening(false) : startListening}
        >
          {isListening ? <Square className="text-purple-900 fill-purple-900" size={28} /> : <Mic className="text-white" size={32} />}
        </motion.div>
      </div>

      {/* STATUS & INPUT */}
      <div className="w-full max-w-md px-6 flex flex-col items-center gap-6">
        <p className="text-[10px] font-bold tracking-[0.4em] text-slate-500 uppercase">{status.message}</p>
        
        {/* EVENT LIST CARD (Appears when Querying) */}
        <AnimatePresence>
          {status.events && status.events.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full bg-white/5 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-md"
            >
              <div className="p-3 border-b border-white/10 bg-purple-500/10 flex items-center gap-2">
                <Calendar size={12} className="text-purple-300" />
                <span className="text-[10px] font-bold text-purple-300 uppercase tracking-widest">Upcoming Schedule</span>
              </div>
              <div className="p-2 max-h-48 overflow-y-auto custom-scrollbar">
                {status.events.map((evt, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 hover:bg-white/5 rounded-lg transition-colors group">
                    <div className="w-1 h-8 bg-cyan-500 rounded-full group-hover:bg-cyan-400 transition-colors" />
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-medium text-slate-200 truncate">{evt.summary || "Untitled"}</p>
                      <p className="text-[10px] text-slate-500">
                        {evt.start?.dateTime ? new Date(evt.start.dateTime).toLocaleString([], {weekday: 'short', hour: '2-digit', minute:'2-digit'}) : 'All Day'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic Transcript Display */}
        <AnimatePresence>
          {input && (
             <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center">
               <h2 className="text-2xl font-light text-slate-200 leading-tight">"{input}"</h2>
             </motion.div>
          )}
        </AnimatePresence>

        {/* Input Bar (Hidden while listening for clean look) */}
        {!isListening && (
          <motion.form 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} 
            onSubmit={processCommand} 
            className="w-full flex gap-2 p-2 bg-white/5 border border-white/10 rounded-full backdrop-blur-md"
          >
            <input 
              value={input} 
              onChange={(e) => setInput(e.target.value)} 
              placeholder="Type or click the orb..." 
              className="flex-1 bg-transparent px-4 py-2 outline-none text-sm font-light placeholder:text-slate-600" 
            />
            <button type="submit" className="bg-purple-600 p-3 rounded-full hover:bg-purple-500 transition-colors">
              {isProcessing ? <Sparkles size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </motion.form>
        )}
      </div>
      
      {/* DISCARD BUTTON */}
      <AnimatePresence>
        {isListening && (
          <motion.button 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} 
            onClick={() => stopListening(true)}
            className="absolute bottom-12 flex items-center gap-2 text-xs font-bold text-red-500/50 hover:text-red-500 uppercase tracking-widest transition-colors"
          >
            <Trash2 size={14} /> Discard
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AntikAI;