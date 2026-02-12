const recordButton = document.getElementById('recordButton');
const stopButton = document.getElementById('stopButton');
const clearButton = document.getElementById('clearButton');
const stateLabel = document.getElementById('stateLabel');
const timerEl = document.getElementById('timer');
const lastUpdate = document.getElementById('lastUpdate');
const transcriptionStatus = document.getElementById('transcriptionStatus');
const backendStatus = document.getElementById('backendStatus');
const aiEditorContainer = document.getElementById('aiEditor');

// Backend WebSocket URL (development: always use port 8000)
const getBackendUrl = () => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'ws://localhost:8000/ws';
  }
  // Production: same domain
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
};

const BACKEND_WS_URL = getBackendUrl();

window.addEventListener('DOMContentLoaded', () => {
    aiEditorContainer.contentEditable = 'true';
    aiEditorContainer.dataset.placeholder = 'سيظهر النص المحول هنا...';
    aiEditorContainer.classList.add('fallback-editor');
});

const state = {
  stream: null,
  isRecording: false,
  timerInterval: null,
  startedAt: null,
  transcript: '',
  backendWs: null,
  audioCtx: null,
  processor: null,
};

recordButton.addEventListener('click', startRecording);
stopButton.addEventListener('click', stopRecording);
clearButton.addEventListener('click', clearTranscript);

function setUIRecording(active) {
  stateLabel.textContent = active ? 'جارٍ التسجيل' : 'متوقف';
  recordButton.disabled = active;
  stopButton.disabled = !active;
  clearButton.disabled = !state.transcript;
  transcriptionStatus.textContent = active ? 'يستمع…' : 'بانتظار التسجيل…';
}

function startRecording() {
  if (state.isRecording) return;
  state.isRecording = true;
  state.startedAt = Date.now();
  setUIRecording(true);
  startTimer();
  startBackendStream();
}

function stopRecording() {
  if (!state.isRecording) return;
  state.isRecording = false;
  setUIRecording(false);
  stopTimer();
  stopBackendStream();
  setTimeout(() => {
    if (aiEditorContainer.textContent && aiEditorContainer.textContent.trim().length > 0) {
      transcriptionStatus.textContent = 'جارٍ التصحيح والتنسيق…';
      correctTranscript(aiEditorContainer.textContent);
    } else {
      transcriptionStatus.textContent = 'بانتظار التسجيل…';
    }
  }, 500); // Small delay to allow final WebSocket processing
}

async function correctTranscript(text) {
  if (!text || text.trim().length === 0) {
    transcriptionStatus.textContent = 'لا يوجد نص لتصحيحه';
    return;
  }
  
  try {
    const response = await fetch('http://127.0.0.1:8000/correctText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: text.trim() })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'success' && data.result) {
      // Replace transcript with corrected text
      state.transcript = data.result;
      
      // Display corrected text in editor
      if (aiEditorContainer) {
        aiEditorContainer.textContent = data.result;
      }
      
      transcriptionStatus.textContent = 'تم التصحيح والتنسيق بنجاح';
      lastUpdate.textContent = new Date().toLocaleTimeString();
      clearButton.disabled = false;
    } else {
      transcriptionStatus.textContent = data.message || 'فشل التصحيح';
    }
  } catch (error) {
    console.error('Correction error:', error);
    transcriptionStatus.textContent = `خطأ في التصحيح: ${error.message}`;
  }
}

function startTimer() {
  updateTimer();
  state.timerInterval = setInterval(updateTimer, 500);
}

function stopTimer() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  timerEl.textContent = '00:00';
}

function updateTimer() {
  if (!state.startedAt) return;
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  timerEl.textContent = `${mm}:${ss}`;
}

function clearTranscript() {
  state.transcript = '';
  if (aiEditorContainer) {
    aiEditorContainer.textContent = '';
  }
  transcriptionStatus.textContent = 'بانتظار التسجيل…';
  clearButton.disabled = true;
}

function startBackendStream() {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      state.stream = stream;
      const ws = new WebSocket(BACKEND_WS_URL);
      state.backendWs = ws;
      backendStatus.textContent = 'يتصل…';

      ws.onopen = () => {
        backendStatus.textContent = 'متصل';
        stateLabel.textContent = 'جارٍ البث';
        transcriptionStatus.textContent = 'يستمع…';

        setupAudioGraph(stream, (chunk) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk);
          }
        });
      };

      ws.onmessage = (ev) => {
        
        if (state.stopping) return;
        
        try {
          const msg = JSON.parse(ev.data);

          if (msg.type === 'connected') {
            backendStatus.textContent = 'متصل';
          }

          if (msg.type === 'partial') {
            const text = msg.text?.trim();
            if (!text) return;
            transcriptionStatus.textContent = 'نص جزئي';

            const combined = `${state.transcript} ${text}`.trim();
            if (aiEditorContainer) {
              aiEditorContainer.textContent = combined;
            }
          }

          if (msg.type === 'final') {
            const text = msg.text?.trim();
            if (!text) return;

            state.transcript = state.transcript
              ? `${state.transcript} ${text}`
              : text;

            if (aiEditorContainer) {
              aiEditorContainer.textContent = state.transcript;
            }
            transcriptionStatus.textContent = 'تم استلام نص';
            lastUpdate.textContent = new Date().toLocaleTimeString();
            clearButton.disabled = false;
          }

          if (msg.type === 'error') {
            transcriptionStatus.textContent = msg.message;
            backendStatus.textContent = 'خطأ';
          }
        } catch (err) {
          console.error('Parse error:', err);
        }
      };

      ws.onerror = () => {
        backendStatus.textContent = 'خطأ في الاتصال';
        transcriptionStatus.textContent = 'فشل الاتصال بالخادم';
      };

      ws.onclose = () => {
        backendStatus.textContent = 'انقطع الاتصال';
        stateLabel.textContent = 'متوقف';
        state.backendWs = null;
        teardownAudioGraph();
        if (state.stream) {
          state.stream.getTracks().forEach(t => t.stop());
          state.stream = null;
        }
      };
    })
    .catch(() => {
      backendStatus.textContent = 'تم رفض الإذن';
      transcriptionStatus.textContent = 'لا يمكن الوصول للميكروفون';
      state.isRecording = false;
      setUIRecording(false);
      stopTimer();
    });
}

function stopBackendStream() {
  // Mark as stopping to prevent processing new messages
  state.stopping = true;
  
  if (state.backendWs) {
    try {
      // Send stop signal first
      state.backendWs.send(JSON.stringify({ type: 'stop' }));
      
      // Close after a short delay to allow final message processing
      setTimeout(() => {
        if (state.backendWs && state.backendWs.readyState === WebSocket.OPEN) {
          state.backendWs.close();
        }
        state.backendWs = null;
        state.stopping = false;
      }, 100);
    } catch (e) { 
      console.warn('Error stopping WebSocket:', e);
      state.backendWs = null;
      state.stopping = false;
    }
  } else {
    state.stopping = false;
  }
  
  teardownAudioGraph();
  
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  
  backendStatus.textContent = 'غير متصل';
  stateLabel.textContent = 'متوقف';
}

function setupAudioGraph(stream, onChunk) {
  const audioCtx = new AudioContext({ sampleRate: 48000 });
  const source = audioCtx.createMediaStreamSource(stream);
  const processor = audioCtx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = e => {
    const input = e.inputBuffer.getChannelData(0);
    const pcm16 = downsampleBuffer(input, audioCtx.sampleRate, 16000);
    if (pcm16) onChunk(pcm16.buffer);
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  state.audioCtx = audioCtx;
  state.processor = processor;
}

function teardownAudioGraph() {
  if (state.processor) {
    state.processor.disconnect();
    state.processor = null;
  }
  if (state.audioCtx) {
    state.audioCtx.close();
    state.audioCtx = null;
  }
}

function downsampleBuffer(buffer, inputRate, targetRate) {
  if (targetRate === inputRate) {
    const pcm = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      pcm[i] = Math.max(-1, Math.min(1, buffer[i])) * 0x7fff;
    }
    return pcm;
  }
  const ratio = inputRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const pcm = new Int16Array(newLength);
  let offset = 0;
  for (let i = 0; i < newLength; i++) {
    const nextOffset = Math.round((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = offset; j < nextOffset && j < buffer.length; j++) {
      sum += buffer[j];
      count++;
    }
    pcm[i] = Math.max(-1, Math.min(1, sum / count)) * 0x7fff;
    offset = nextOffset;
  }
  return pcm;
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }


