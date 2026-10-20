const params = new URLSearchParams(window.location.search);

const childId = params.get('child');
const storyId = params.get('story');
const requestedSessionId = params.get('session');

const title = document.getElementById('story-title');
const message = document.getElementById('message');
const description = document.getElementById('story-description');

const startSection = document.getElementById('start-section');
const readerSection = document.getElementById('reader-section');

const startBtn = document.getElementById('start-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const finishBtn = document.getElementById('finish-btn');
const endBtn = document.getElementById('end-btn');
const backLink = document.getElementById('back-link');

const pageIndicator = document.getElementById('page-indicator');
const pageText = document.getElementById('page-text');

const storageNotice = document.getElementById('storageNotice');
const audioCheck = document.getElementById('audioCheck');
const videoCheck = document.getElementById('videoCheck');
const startRecordBtn = document.getElementById('startRecordBtn');
const stopRecordBtn = document.getElementById('stopRecordBtn');
const preview = document.getElementById('preview');
const timer = document.getElementById('timer');
const recordingsBox = document.getElementById('recordings');

let context = null;
let story = null;
let pages = [];

let currentPage = 0;
let sessionId = null;

let stream = null;
let recorders = [];
let recordingStartedAt = 0;
let pendingRecordingDurationSeconds = 0;
let timerId = null;

let isSavingRecording = false;
let isEndingSession = false;

const backUrl = new URL('stories.html', window.location.href);

if (childId) {
    backUrl.searchParams.set('child', childId);
}

backLink.href = backUrl.href;


function showMessage(text, type = '') {
    message.textContent = text;
    message.className = type;
}


function getBucketName() {
    return String(
        window.RUWY_DB?.config?.recordingBucket || ''
    ).trim();
}


function formatTime(seconds) {
    const minutes = String(
        Math.floor(seconds / 60)
    ).padStart(2, '0');

    const rest = String(
        seconds % 60
    ).padStart(2, '0');

    return minutes + ':' + rest;
}


function getErrorMessage(error) {
    if (error.name === 'NotAllowedError') {
        return 'لم يتم السماح بالوصول إلى الميكروفون أو الكاميرا.';
    }

    if (error.name === 'NotFoundError') {
        return 'لم يتم العثور على ميكروفون أو كاميرا في هذا الجهاز.';
    }

    if (error.name === 'NotReadableError') {
        return 'الميكروفون أو الكاميرا مستخدمة من برنامج آخر.';
    }

    return error.message || 'حدث خطأ غير معروف.';
}


function getPages(value) {
    if (typeof value === 'string') {
        try {
            return getPages(JSON.parse(value));
        } catch {
            return [];
        }
    }

    if (Array.isArray(value)) {
        return value;
    }

    if (Array.isArray(value?.pages)) {
        return value.pages;
    }

    return [];
}


async function init() {
    try {
        if (!window.RUWY_DB) {
            throw new Error(
                'تعذّر تحميل اتصال قاعدة البيانات.'
            );
        }

        if (!childId || !storyId) {
            throw new Error(
                'رابط القصة غير مكتمل. اختاري القصة من قائمة القصص.'
            );
        }

        context = await window.RUWY_DB.getCurrentContext();

        if (!context) {
            window.location.replace('../1auth/index.html');
            return;
        }

        if (!context.profile) {
            throw new Error(
                'لم يتم ربط حسابك بسجل المستخدم في قاعدة البيانات.'
            );
        }

        if (context.profile.role !== 'parent') {
            if (context.profile.role === 'specialist') {
                window.location.replace('../5specialist-dashboard/specialist-dashboard.html');
                return;
            }

            throw new Error(
                'هذه الصفحة مخصصة لحساب ولي الأمر.'
            );
        }

        // parent_id رقم من جدول users وليس UUID تسجيل الدخول.
        const { data: child, error: childError } =
            await context.client
                .from('children')
                .select('child_id, name')
                .eq('child_id', childId)
                .eq('parent_id', context.profile.user_id)
                .maybeSingle();

        if (childError) throw childError;

        if (!child) {
            throw new Error(
                'ملف الطفل غير مرتبط بحساب ولي الأمر الحالي.'
            );
        }

        const { data: storyData, error: storyError } =
            await context.client
                .from('stories')
                .select(
                    'story_id, title, age_group, difficulty_level, pages, content_url'
                )
                .eq('story_id', storyId)
                .maybeSingle();

        if (storyError) throw storyError;

        if (!storyData) {
            throw new Error(
                'لم يتم العثور على القصة في قاعدة البيانات.'
            );
        }

        story = storyData;
        pages = getPages(story.pages);

        // دعم القصص التي تحفظ محتواها في ملف JSON منفصل.
        if (!pages.length && story.content_url) {
            const response = await fetch(story.content_url);

            if (!response.ok) {
                throw new Error('تعذّر تحميل صفحات القصة.');
            }

            const content = await response.json();
            pages = getPages(content);
        }

        if (!pages.length) {
            throw new Error(
                'القصة لا تحتوي على صفحات قابلة للعرض.'
            );
        }

        title.textContent = story.title;
        description.textContent =
            'العمر المناسب: ' + (story.age_group || 'غير محدد') +
            ' | مستوى الصعوبة: ' +
            (story.difficulty_level || 'غير محدد');

        const bucket = getBucketName();

        if (bucket) {
            storageNotice.textContent =
                'يمكنك تسجيل القراءة وحفظها في المشروع.';
            startRecordBtn.disabled = true;
        } else {
            storageNotice.textContent =
                'اسم Storage bucket غير مضبوط في database.js. ' +
                'يمكنك قراءة القصة، لكن التسجيل غير متاح للحفظ.';
            startRecordBtn.disabled = true;
        }

        if (requestedSessionId) {
            if (!/^[1-9]\d*$/.test(requestedSessionId)) {
                throw new Error('معرّف جلسة القراءة في الرابط غير صالح.');
            }

            const { data: existingSession, error: existingSessionError } =
                await context.client
                    .from('reading_sessions')
                    .select('session_id, child_id, story_id, status')
                    .eq('session_id', requestedSessionId)
                    .eq('child_id', childId)
                    .maybeSingle();

            if (existingSessionError) throw existingSessionError;

            if (
                !existingSession ||
                String(existingSession.story_id) !== String(storyId) ||
                existingSession.status !== 'in_progress'
            ) {
                throw new Error('جلسة القراءة المطلوبة غير موجودة أو أنها ليست قيد التنفيذ.');
            }

            sessionId = existingSession.session_id;
            startSection.classList.add('hidden');
            readerSection.classList.remove('hidden');
            startRecordBtn.disabled = !getBucketName();
            showPage();
        } else {
            startBtn.disabled = false;
        }

    } catch (error) {
        console.error('Reader initialization failed:', error);

        showMessage(
            error.message || 'تعذّر تجهيز صفحة القراءة.',
            'error'
        );

        startBtn.disabled = true;
        startRecordBtn.disabled = true;
    }
}


async function startSession() {
    if (!context || !story || sessionId || isEndingSession) {
        return;
    }

    startBtn.disabled = true;

    try {
        const { data, error } = await context.client
            .from('reading_sessions')
            .insert({
                child_id: Number(childId),
                story_id: Number(storyId),
                start_time: new Date().toISOString(),
                status: 'in_progress'
            })
            .select('session_id')
            .single();

        if (error) throw error;

        sessionId = data.session_id;
        currentPage = 0;

        startSection.classList.add('hidden');
        readerSection.classList.remove('hidden');

        startRecordBtn.disabled = !getBucketName();

        showMessage('');
        showPage();

    } catch (error) {
        console.error('Starting session failed:', error);

        showMessage(
            'تعذّر بدء جلسة القراءة: ' + error.message,
            'error'
        );

        startBtn.disabled = false;
    }
}


function showPage() {
    if (!pages.length) return;

    pageText.textContent = typeof pages[currentPage] === 'string'
        ? pages[currentPage]
        : (pages[currentPage]?.text || '');

    pageIndicator.textContent =
        'صفحة ' + (currentPage + 1) +
        ' من ' + pages.length;

    prevBtn.disabled = currentPage === 0;

    nextBtn.classList.toggle(
        'hidden',
        currentPage === pages.length - 1
    );

    finishBtn.classList.toggle(
        'hidden',
        currentPage !== pages.length - 1
    );
}


function createRecorder(type, tracks) {
    const recorder = new MediaRecorder(
        new MediaStream(tracks)
    );

    const item = {
        type: type,
        recorder: recorder,
        chunks: [],
        blob: null,
        uploaded: false,
        previewed: false
    };

    recorder.ondataavailable = function (event) {
        if (event.data.size > 0) {
            item.chunks.push(event.data);
        }
    };

    recorder.onerror = function () {
        showMessage('حدث خطأ أثناء التسجيل.', 'error');
    };

    return item;
}


function stopRecorder(item) {
    return new Promise(function (resolve) {
        if (item.recorder.state === 'inactive') {
            resolve();
            return;
        }

        item.recorder.addEventListener(
            'stop',
            resolve,
            { once: true }
        );

        item.recorder.stop();
    });
}


function stopStream() {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }

    preview.srcObject = null;
    preview.classList.add('hidden');
}


async function startRecording() {
    if (
        !sessionId ||
        isSavingRecording ||
        isEndingSession ||
        recorders.length
    ) {
        return;
    }

    const useAudio = audioCheck.checked;
    const useVideo = videoCheck.checked;

    if (!useAudio && !useVideo) {
        showMessage(
            'فعّلي تسجيل الصوت أو الفيديو على الأقل.',
            'error'
        );
        return;
    }

    if (!getBucketName()) {
        showMessage(
            'تأكدي من إعداد اسم Storage bucket في database.js.',
            'error'
        );
        return;
    }

    if (!window.isSecureContext) {
        showMessage(
            'يجب فتح الصفحة عبر localhost أو HTTPS للتسجيل.',
            'error'
        );
        return;
    }

    if (
        !navigator.mediaDevices ||
        !window.MediaRecorder
    ) {
        showMessage(
            'المتصفح لا يدعم التسجيل المطلوب.',
            'error'
        );
        return;
    }

    startRecordBtn.disabled = true;

    showMessage(
        'اسمحي بالوصول إلى الميكروفون أو الكاميرا عند ظهور الطلب.',
        'info'
    );

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: useAudio,
            video: useVideo
        });

        recorders = [];

        if (stream.getAudioTracks().length) {
            recorders.push(
                createRecorder('audio', stream.getAudioTracks())
            );
        }

        if (stream.getVideoTracks().length) {
            recorders.push(
                createRecorder('video', stream.getVideoTracks())
            );

            preview.srcObject = stream;
            preview.classList.remove('hidden');
        }

        recorders.forEach(function (item) {
            item.recorder.start(1000);
        });

        recordingStartedAt = Date.now();
        pendingRecordingDurationSeconds = 0;
        timer.textContent = '00:00';

        timerId = setInterval(function () {
            const elapsed = Math.round(
                (Date.now() - recordingStartedAt) / 1000
            );

            timer.textContent = formatTime(elapsed);
        }, 1000);

        stopRecordBtn.disabled = false;

        showMessage(
            'التسجيل جارٍ. يمكنك التنقل بين صفحات القصة أثناء التسجيل.',
            'info'
        );

    } catch (error) {
        console.error('Starting recording failed:', error);

        stopStream();
        recorders = [];

        showMessage(getErrorMessage(error), 'error');

        startRecordBtn.disabled = false;
    }
}


async function saveRecording() {
    if (!sessionId || !recorders.length || isSavingRecording) {
        return false;
    }

    isSavingRecording = true;
    stopRecordBtn.disabled = true;
    startRecordBtn.disabled = true;

    clearInterval(timerId);
    timerId = null;

    if (!pendingRecordingDurationSeconds) {
        pendingRecordingDurationSeconds = Math.max(
            1,
            Math.round((Date.now() - recordingStartedAt) / 1000)
        );
    }
    const durationSeconds = pendingRecordingDurationSeconds;

    const finishedRecorders = [...recorders];

    try {
        await Promise.all(finishedRecorders.map(stopRecorder));
        stopStream();

        const validRecorders = finishedRecorders.filter(
            item => item.chunks.length > 0
        );

        if (!validRecorders.length) {
            recorders = [];
            pendingRecordingDurationSeconds = 0;
            throw new Error(
                'لم يتم التقاط بيانات. حاولي بدء التسجيل مرة أخرى.'
            );
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

            // عند إعادة المحاولة، لا نرفع الملف الذي حُفظ بنجاح مسبقًا.
            if (!item.uploaded) {
                await window.RUWY_DB.uploadRecording({
                    sessionId: sessionId,
                    mediaType: item.type,
                    blob: item.blob,
                    durationSeconds: durationSeconds
                });
                item.uploaded = true;
            }
        }

        recorders = [];
        recordingStartedAt = 0;
        pendingRecordingDurationSeconds = 0;
        timer.textContent = '00:00';
        stopRecordBtn.textContent = 'إيقاف التسجيل وحفظه';

        showMessage(
            'تم رفع التسجيل وحفظ بياناته في قاعدة البيانات.',
            'success'
        );

        return true;
    } catch (error) {
        console.error('Saving recording failed:', error);
        showMessage(
            'تعذّر حفظ التسجيل. بقي التسجيل على هذه الصفحة؛ اضغطي «إعادة محاولة الحفظ» بعد التحقق من الاتصال والصلاحيات. التفاصيل: ' +
                (error.message || 'خطأ غير معروف.'),
            'error'
        );
        return false;
    } finally {
        stopStream();
        stopRecordBtn.disabled = recorders.length === 0;
        stopRecordBtn.textContent = recorders.length
            ? 'إعادة محاولة الحفظ'
            : 'إيقاف التسجيل وحفظه';
        startRecordBtn.disabled =
            !sessionId ||
            !getBucketName() ||
            isEndingSession ||
            recorders.length > 0;
        isSavingRecording = false;
    }
}


function showRecording(type, blob, durationSeconds) {
    const item = document.createElement('div');
    item.className = 'recording-item';

    const recordingTitle = document.createElement('p');

    recordingTitle.textContent =
        (type === 'audio' ? 'تسجيل صوتي' : 'تسجيل فيديو') +
        ' - ' + formatTime(durationSeconds);

    const player = document.createElement(
        type === 'audio' ? 'audio' : 'video'
    );

    player.controls = true;
    player.preload = 'metadata';
    player.src = URL.createObjectURL(blob);

    item.append(recordingTitle, player);
    recordingsBox.appendChild(item);
}


async function endSession(status) {
    if (!sessionId || isEndingSession) return;

    isEndingSession = true;

    finishBtn.disabled = true;
    endBtn.disabled = true;
    startRecordBtn.disabled = true;

    try {
        // احفظ التسجيل الجاري أولًا قبل إنهاء جلسة القراءة.
        if (recorders.length) {
            const recordingSaved = await saveRecording();

            if (!recordingSaved) {
                throw new Error(
                    'لم يُحفظ التسجيل؛ أعيدي محاولة الحفظ قبل إنهاء الجلسة.'
                );
            }
        }

        const { error } = await context.client
            .from('reading_sessions')
            .update({
                end_time: new Date().toISOString(),
                status: status
            })
            .eq('session_id', sessionId);

        if (error) throw error;

        window.location.href = backUrl.href;

    } catch (error) {
        console.error('Ending session failed:', error);

        showMessage(
            'تعذّر إنهاء الجلسة: ' + error.message,
            'error'
        );

        finishBtn.disabled = false;
        endBtn.disabled = false;
        isEndingSession = false;
        startRecordBtn.disabled =
            !sessionId || !getBucketName() || recorders.length > 0;
        stopRecordBtn.disabled = recorders.length === 0;
    }
}


startBtn.addEventListener('click', startSession);
startRecordBtn.addEventListener('click', startRecording);
stopRecordBtn.addEventListener('click', saveRecording);

prevBtn.addEventListener('click', function () {
    if (currentPage > 0) {
        currentPage--;
        showPage();
    }
});

nextBtn.addEventListener('click', function () {
    if (currentPage < pages.length - 1) {
        currentPage++;
        showPage();
    }
});

finishBtn.addEventListener('click', function () {
    endSession('completed');
});

endBtn.addEventListener('click', function () {
    endSession('cancelled');
});

window.addEventListener('beforeunload', function (event) {
    clearInterval(timerId);
    stopStream();

    if (recorders.some(item => !item.uploaded)) {
        event.preventDefault();
        event.returnValue = '';
    }
});

window.addEventListener('DOMContentLoaded', init);