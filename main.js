const recordButton = document.getElementById('recordButton');
const stopButton = document.getElementById('stopButton');
const clearButton = document.getElementById('clearButton');
const refreshQuestions = document.getElementById('refreshQuestions');
const stateLabel = document.getElementById('stateLabel');
const timerEl = document.getElementById('timer');
const lastUpdate = document.getElementById('lastUpdate');
const transcriptionStatus = document.getElementById('transcriptionStatus');
const transcriptBody = document.getElementById('transcriptBody');
const transcriptTitle = document.getElementById('transcriptTitle');
const questionList = document.getElementById('questionList');
const backendStatus = document.getElementById('backendStatus');

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
refreshQuestions.addEventListener('click', () => updateQuestions(state.transcript));

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
  transcriptTitle.textContent = 'يستمع…';
  startBackendStream();
}

function stopRecording() {
  if (!state.isRecording) return;
  state.isRecording = false;
  setUIRecording(false);
  stopTimer();
  stopBackendStream();
}

function handleStop() {
  stopStream();
  const blob = new Blob(state.chunks, { type: 'audio/webm' });
  state.chunks = [];
  transcriptionStatus.textContent = 'جارٍ التحويل للنص…';
  lastUpdate.textContent = new Date().toLocaleTimeString();
  mockTranscribeAudio(blob)
    .then(text => {
      const cleaned = text.trim();
      state.transcript = state.transcript
        ? `${state.transcript} ${cleaned}`
        : cleaned;
      transcriptTitle.textContent = 'أحدث نص تعليمي';
      transcriptBody.textContent = state.transcript;
      transcriptionStatus.textContent = 'تم التحويل';
      clearButton.disabled = !state.transcript;
      updateQuestions(state.transcript);
    })
    .catch(() => {
      transcriptionStatus.textContent = 'فشل التحويل إلى نص';
    });
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
  transcriptBody.textContent = '';
  transcriptTitle.textContent = 'ابدأ الشرح ليسجَّل';
  transcriptionStatus.textContent = 'بانتظار التسجيل…';
  clearButton.disabled = true;
  questionList.innerHTML = '';
}
function startBackendStream() {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      state.stream = stream;
      const ws = new WebSocket('ws://localhost:8000/ws');
      state.backendWs = ws;
      backendStatus.textContent = 'يتصل…';

      ws.onopen = () => {
        backendStatus.textContent = 'متصل';
        stateLabel.textContent = 'جارٍ البث';
        transcriptionStatus.textContent = 'يستمع…';

        setupAudioGraph(stream, chunk => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk);
          }
        });
      };

      ws.onmessage = ev => {
        try {
          const msg = JSON.parse(ev.data);

          if (msg.type === 'connected') {
            transcriptTitle.textContent = msg.message;
          }

          if (msg.type === 'partial') {
            const text = msg.text?.trim();
            if (!text) return;
            transcriptionStatus.textContent = 'نص جزئي';
            transcriptTitle.textContent = 'بث مباشر';
            transcriptBody.textContent = `${state.transcript} ${text}`.trim();
          }

          if (msg.type === 'final') {
            const text = msg.text?.trim();
            if (!text) return;

            state.transcript = state.transcript
              ? `${state.transcript} ${text}`
              : text;

            transcriptTitle.textContent = 'أحدث نص تعليمي';
            transcriptBody.textContent = state.transcript;
            transcriptionStatus.textContent = 'تم استلام نص';
            lastUpdate.textContent = new Date().toLocaleTimeString();
            clearButton.disabled = false;
            updateQuestions(state.transcript);
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
  if (state.backendWs) {
    try {
      state.backendWs.send(JSON.stringify({ type: 'stop' }));
    } catch (e) { /* ignore */ }
    state.backendWs.close();
    state.backendWs = null;
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

async function mockTranscribeAudio(blob) {
  // Replace this with your real API call. The blob contains the recorded audio.
  await delay(800);
  const samples = [
    'اليوم سنشرح كيفية حل المسائل خطوة بخطوة مع أمثلة مبسطة.',
    'سأراجع أهداف الدرس ثم أوضح المفهوم الأساسي بلغة سهلة.',
    'سنعرض تطبيقًا عمليًا ونلخص القواعد في نهاية الشرح.',
    'سأذكر الأخطاء الشائعة وكيف يمكن للمتعلم تجنبها أثناء الحل.',
  ];
  return samples[Math.floor(Math.random() * samples.length)];
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

function updateQuestions(text) {
  // إبقاء قائمة الأسئلة فارغة في هذه المرحلة.
  questionList.innerHTML = '';
}

function generateQuestions(text) {
  const lowered = text.toLowerCase();
  const bank = [];

  if (lowered.includes('تعلم') || lowered.includes('تعليم') || lowered.includes('دورة')) {
    bank.push('ما النتيجة التعليمية المستهدفة من هذا الجزء؟');
    bank.push('كيف ستقيس أن المتعلمين احتفظوا بالمادة فعلًا؟');
  }
  if (lowered.includes('ملاحظات') || lowered.includes('تغذية') || lowered.includes('feedback')) {
    bank.push('متى وأين يجدر بنا جمع ملاحظات المتعلمين؟');
  }
  if (lowered.includes('تفاعل') || lowered.includes('احتفاظ') || lowered.includes('engage')) {
    bank.push('أي لحظات تفاعل تستحق حوافز بصرية أو مكافآت صغيرة؟');
  }
  if (lowered.includes('تدريب') || lowered.includes('سؤال') || lowered.includes('practice')) {
    bank.push('كيف يجب أن تتكيّف أسئلة التدريب مع ملف المتعلم؟');
  }
  if (lowered.includes('خارطة') || lowered.includes('معلم') || lowered.includes('roadmap')) {
    bank.push('ما المعلم الواحد الذي يفتح المرحلة التالية؟');
  }

  if (bank.length < 4) {
    bank.push('ما الافتراض الذي يجب أن نتحقق منه أولًا؟');
    bank.push('من هو المستخدم الأساسي وما المهمة المباشرة التي يريد إنجازها؟');
    bank.push('ما أصغر تجربة يمكننا تنفيذها لاختبار هذه الفكرة؟');
  }

  return bank.slice(0, 6);
}

updateQuestions('');
