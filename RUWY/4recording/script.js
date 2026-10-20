const params = new URLSearchParams(window.location.search);
const childId = params.get('child');
const storyId = params.get('story');
const sessionId = params.get('session');

const message = document.getElementById('message');
const readerBackLink = document.getElementById('readerBackLink');
const selectedStory = document.getElementById('selectedStory');
const storageNotice = document.getElementById('storageNotice');
const audioCheck = document.getElementById('audioCheck');
const videoCheck = document.getElementById('videoCheck');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const cancelBtn = document.getElementById('cancelBtn');
const newBtn = document.getElementById('newBtn');
const retryBtn = document.getElementById('retryBtn');
const setupSection = document.getElementById('setupSection');
const readingSection = document.getElementById('readingSection');
const resultSection = document.getElementById('resultSection');
const preview = document.getElementById('preview');
const timer = document.getElementById('timer');
const storyTitle = document.getElementById('storyTitle');
const storyText = document.getElementById('storyText');
const recordingsBox = document.getElementById('recordings');

let context = null;
let story = null;
let stream = null;
let recorders = [];
let startTime = 0;
let pendingDurationSeconds = 0;
let timerId = null;
let isSaving = false;

function showMessage(text, type = '') {
    message.textContent = text;
    message.className = type;
}

function getErrorMessage(error) {
    if (error.name === 'NotAllowedError') return 'تم رفض إذن الميكروفون أو الكاميرا. اسمح بالوصول من إعدادات المتصفح ثم أعد المحاولة.';
    if (error.name === 'NotFoundError') return 'لم يتم العثور على ميكروفون أو كاميرا في هذا الجهاز.';
    if (error.name === 'NotReadableError') return 'الميكروفون أو الكاميرا مستخدمة من برنامج آخر.';
    return error.message || 'حدث خطأ غير معروف.';
}

function formatTime(seconds) {
    const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
    const rest = String(seconds % 60).padStart(2, '0');
    return minutes + ':' + rest;
}

function createRecorder(type, tracks) {
    const recorder = new MediaRecorder(new MediaStream(tracks));
    const item = {
        type,
        recorder,
        chunks: [],
        blob: null,
        uploaded: false,
        previewed: false
    };
    recorder.ondataavailable = function (event) {
        if (event.data.size > 0) item.chunks.push(event.data);
    };
    recorder.onerror = function () { showMessage('حدث خطأ أثناء التسجيل.', 'error'); };
    return item;
}

function stopRecorder(item) {
    return new Promise(function (resolve) {
        if (item.recorder.state === 'inactive') { resolve(); return; }
        item.recorder.addEventListener('stop', resolve, { once: true });
        item.recorder.stop();
    });
}

function stopStream() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
}

function backToSetup() {
    clearInterval(timerId);
    timerId = null;
    preview.srcObject = null;
    preview.classList.add('hidden');
    readingSection.classList.add('hidden');
    resultSection.classList.add('hidden');
    setupSection.classList.remove('hidden');
    startBtn.disabled = !(context && story && sessionId && window.RUWY_DB.config.recordingBucket.trim());
}

async function initRecording() {
    try {
        if (!childId || !storyId || !sessionId) {
            throw new Error('يلزم بدء جلسة قراءة من صفحة القصة قبل فتح التسجيل.');
        }

        const returnUrl = new URL('../3reading/reader.html', window.location.href);
        returnUrl.searchParams.set('child', childId);
        returnUrl.searchParams.set('story', storyId);
        returnUrl.searchParams.set('session', sessionId);
        readerBackLink.href = returnUrl.href;

        context = await window.RUWY_DB.getCurrentContext();
        if (!context) {
            window.location.replace('../1auth/index.html');
            return;
        }
        if (!context.profile || context.profile.role !== 'parent') {
            if (context.profile?.role === 'specialist') {
                window.location.replace('../5specialist-dashboard/specialist-dashboard.html');
                return;
            }
            throw new Error('لا يوجد ملف مستخدم صالح في جدول users.');
        }

        const { data: child, error: childError } = await context.client
            .from('children').select('child_id')
            .eq('child_id', childId)
.eq('parent_id', context.profile.user_id)
.maybeSingle();
        if (childError) throw childError;
        if (!child) throw new Error('ملف الطفل غير مرتبط بالحساب الحالي.');

        const { data: session, error: sessionError } = await context.client
            .from('reading_sessions').select('session_id, child_id, story_id, status')
            .eq('session_id', sessionId).eq('child_id', childId).maybeSingle();
        if (sessionError) throw sessionError;
        if (!session || String(session.story_id) !== String(storyId)) {
            throw new Error('لم يتم العثور على جلسة القراءة المطلوبة في قاعدة البيانات.');
        }

        const { data: storyData, error: storyError } = await context.client
            .from('stories').select('story_id, title, pages, content_url')
            .eq('story_id', storyId).maybeSingle();
        if (storyError) throw storyError;
        if (!storyData) throw new Error('لم يتم العثور على القصة في قاعدة البيانات.');
        story = storyData;
        selectedStory.textContent = story.title || '';
        storyTitle.textContent = story.title || '';

        let pageData = story.pages;
        if (typeof pageData === 'string') {
            try {
                pageData = JSON.parse(pageData);
            } catch {
                pageData = [];
            }
        }
        let pages = Array.isArray(pageData)
            ? pageData
            : Array.isArray(pageData?.pages)
                ? pageData.pages
                : [];

        if (!pages.length && story.content_url) {
            const response = await fetch(story.content_url);
            if (!response.ok) throw new Error('تعذّر تحميل صفحات القصة.');
            const content = await response.json();
            pages = Array.isArray(content)
                ? content
                : Array.isArray(content?.pages)
                    ? content.pages
                    : [];
        }

        storyText.textContent = pages.map(page =>
            typeof page === 'string' ? page : (page?.text || '')
        ).join('\n\n');

        if (!window.RUWY_DB.config.recordingBucket.trim()) {
            storageNotice.textContent = 'يلزم ربط Supabase Storage قبل حفظ التسجيلات. اسم المخزن في database.js فارغ، لذلك التسجيل معطّل حتى يتم إعداده.';
            startBtn.disabled = true;
            return;
        }

        storageNotice.textContent = '';
        startBtn.disabled = false;
    } catch (error) {
        console.error('Preparing recording failed:', error);
        selectedStory.textContent = '';
        storageNotice.textContent = error.message || 'تعذّر تجهيز التسجيل من قاعدة البيانات.';
        startBtn.disabled = true;
    }
}

startBtn.addEventListener('click', async function () {
    const useAudio = audioCheck.checked;
    const useVideo = videoCheck.checked;
    if (!useAudio && !useVideo) { showMessage('فعّلي الصوت أو الكاميرا على الأقل.', 'error'); return; }
    if (!window.isSecureContext) { showMessage('يجب فتح الصفحة عبر localhost أو HTTPS لاستخدام الميكروفون.', 'error'); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { showMessage('المتصفح لا يدعم التسجيل. استخدمي Chrome أو Edge.', 'error'); return; }
    if (!context || !story || !sessionId || !window.RUWY_DB.config.recordingBucket.trim()) {
        showMessage('إعدادات حفظ التسجيل غير مكتملة.', 'error');
        return;
    }

    startBtn.disabled = true;
    showMessage('اسمحي بالوصول إلى الميكروفون أو الكاميرا عند ظهور الطلب.', 'info');
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: useAudio, video: useVideo });
    } catch (error) {
        showMessage(getErrorMessage(error), 'error');
        startBtn.disabled = false;
        return;
    }

    recorders = [];
    if (stream.getAudioTracks().length) recorders.push(createRecorder('audio', stream.getAudioTracks()));
    if (stream.getVideoTracks().length) {
        recorders.push(createRecorder('video', stream.getVideoTracks()));
        preview.srcObject = stream;
        preview.classList.remove('hidden');
    }

    recorders.forEach(item => item.recorder.start(1000));
    startTime = Date.now();
    pendingDurationSeconds = 0;
    timer.textContent = '00:00';
    timerId = setInterval(() => {
        timer.textContent = formatTime(Math.round((Date.now() - startTime) / 1000));
    }, 1000);

    setupSection.classList.add('hidden');
    readingSection.classList.remove('hidden');
    showMessage('التسجيل جارٍ. ستُرفع الملفات إلى مخزن المشروع عند الإنهاء.', 'info');
});

stopBtn.addEventListener('click', saveFinishedRecordings);
retryBtn.addEventListener('click', saveFinishedRecordings);

async function saveFinishedRecordings() {
    if (isSaving) return;

    isSaving = true;
    stopBtn.disabled = true;
    retryBtn.disabled = true;
    clearInterval(timerId);

    if (!pendingDurationSeconds) {
        pendingDurationSeconds = Math.max(
            1,
            Math.round((Date.now() - startTime) / 1000)
        );
    }
    const durationSeconds = pendingDurationSeconds;

    try {
        await Promise.all(recorders.map(stopRecorder));
        stopStream();
        preview.srcObject = null;
        preview.classList.add('hidden');

        const validRecorders = recorders.filter(
            item => item.chunks.length > 0
        );

        if (!validRecorders.length) {
            recorders = [];
            pendingDurationSeconds = 0;
            throw new Error('لم يتم التقاط بيانات. حاولي التسجيل مرة أخرى.');
        }

        for (const item of validRecorders) {
            if (!item.blob) {
                item.blob = new Blob(item.chunks, {
                    type: item.recorder.mimeType ||
                        (item.type === 'video' ? 'video/webm' : 'audio/webm')
                });
            }

            if (!item.previewed) {
                showRecording(item.type, item.blob, durationSeconds);
                item.previewed = true;
            }

            if (!item.uploaded) {
                await window.RUWY_DB.uploadRecording({
                    sessionId,
                    mediaType: item.type,
                    blob: item.blob,
                    durationSeconds
                });
                item.uploaded = true;
            }
        }

        recorders = [];
        startTime = 0;
        pendingDurationSeconds = 0;
        resultSection.classList.remove('hidden');
        readingSection.classList.add('hidden');
        retryBtn.classList.add('hidden');
        showMessage('تم رفع التسجيل وحفظ بياناته في قاعدة البيانات.', 'success');
    } catch (error) {
        console.error('Saving recording failed:', error);
        showMessage(
            'تعذّر حفظ التسجيل. بقي الملف على هذه الصفحة؛ اضغطي «إعادة محاولة الحفظ». التفاصيل: ' +
                (error.message || 'خطأ غير معروف.'),
            'error'
        );

        if (recorders.some(item => item.chunks.length > 0)) {
            readingSection.classList.add('hidden');
            resultSection.classList.remove('hidden');
            retryBtn.classList.remove('hidden');
        } else {
            backToSetup();
        }
    } finally {
        stopStream();
        stopBtn.disabled = recorders.length === 0;
        retryBtn.disabled = false;
        isSaving = false;
    }
}

cancelBtn.addEventListener('click', async function () {
    if (!confirm('إلغاء التسجيل الحالي؟ لن تُرفع الملفات إلى قاعدة البيانات.')) return;
    await Promise.all(recorders.map(stopRecorder));
    stopStream();
    backToSetup();
    showMessage('تم إلغاء التسجيل دون حفظه.', 'info');
});

newBtn.addEventListener('click', function () {
    if (recorders.some(item => !item.uploaded)) {
        const discard = confirm('يوجد تسجيل لم يُحفظ. هل تريدين حذفه والبدء من جديد؟');
        if (!discard) return;
    }

    recorders = [];
    startTime = 0;
    pendingDurationSeconds = 0;
    backToSetup();
    recordingsBox.replaceChildren();
    retryBtn.classList.add('hidden');
    showMessage('');
});

function showRecording(type, blob, durationSeconds) {
    const item = document.createElement('div');
    item.className = 'recording-item';
    const title = document.createElement('p');
    title.textContent = (type === 'audio' ? 'تسجيل صوتي' : 'تسجيل فيديو') + ' - ' + formatTime(durationSeconds);
    const player = document.createElement(type === 'audio' ? 'audio' : 'video');
    player.controls = true;
    player.src = URL.createObjectURL(blob);
    item.append(title, player);
    recordingsBox.appendChild(item);
}

window.addEventListener('DOMContentLoaded', initRecording);
