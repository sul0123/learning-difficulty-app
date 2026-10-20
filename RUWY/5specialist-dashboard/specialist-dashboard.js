const specialistApp = document.getElementById('app'); 
const specialistTop = document.getElementById('top'); 
const specialistNotice = document.getElementById('notice'); 

let specialistContext = null;
let specialistId = null;
let specialistName = '';
let specialistSpecialization = '';
let currentView = 'overview'; 
let isLoadingData = false; 

let specialistData = {
    reports: [],
    children: [],
    sessions: [],
    analyses: [],
    videos: [],
    audios: [],
    recommendations: [],
    notifications: [],
    problems: []
};

function esc(value) {
    if (value === null || value === undefined) {
        value = '';
    }

    let text = String(value);

    text = text.replace(/&/g, '&amp;');
    text = text.replace(/</g, '&lt;');
    text = text.replace(/>/g, '&gt;');
    text = text.replace(/"/g, '&quot;');
    text = text.replace(/'/g, '&#39;');

    return text;
}

function specialistMessage(message, type) {
    if (type === undefined) {
        type = 'info';
    }

    specialistNotice.textContent = message;
    specialistNotice.className = 'notice notice-' + type;
    specialistNotice.hidden = false;
}

function clearSpecialistMessage() {
    specialistNotice.textContent = '';
    specialistNotice.hidden = true;
}

function specialistFindChild(childId) {
    for (let i = 0; i < specialistData.children.length; i++) {
        const child = specialistData.children[i];

        if (String(child.child_id) === String(childId)) {
            return child;
        }
    }

    return null;
}

function specialistChildName(childId) {
    const child = specialistFindChild(childId);

    if (child && child.name) {
        return child.name;
    }

    return 'طفل بدون اسم';
}

function specialistAge(birthDate) {
    if (!birthDate) return null;

    const birth = new Date(birthDate + 'T00:00:00');

    if (Number.isNaN(birth.getTime())) return null;

    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();

    if (now.getMonth() < birth.getMonth()) {
        age--;
    } else if (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate()) {
        age--;
    }

    if (age < 0) age = 0;

    return age;
}

function specialistChildMeta(childId) {
    const child = specialistFindChild(childId);

    if (!child) return '';

    const parts = [];
    const age = specialistAge(child.birth_date);

    if (age !== null) parts.push(age + ' سنوات');
    if (child.gender === 'male') parts.push('ذكر');
    if (child.gender === 'female') parts.push('أنثى');

    return parts.join(' · ');
}

function specialistRiskClass(risk) {
    if (risk === 'low') return 'risk-low';
    if (risk === 'medium') return 'risk-medium';
    if (risk === 'high') return 'risk-high';

    return 'risk-unknown';
}

function specialistSessionStatus(status) {
    if (status === 'in_progress') return 'قيد التنفيذ';
    if (status === 'completed') return 'مكتملة';
    if (status === 'cancelled') return 'ملغاة';

    return 'غير محددة';
}

function specialistStatusClass(status) {
    if (status === 'completed') return 'risk-low';
    if (status === 'in_progress') return 'risk-medium';

    return 'status-neutral';
}

function specialistAnalysisValue(value) {
    if (value === null || value === undefined || value === '') {
        return '—';
    }

    const number = Number(value);

    if (Number.isFinite(number)) {
        return String(Math.round(number * 100) / 100);
    }

    return String(value);
}

function specialistSessionMinutes(session) {
    if (!session.start_time || !session.end_time) return null;

    const start = new Date(session.start_time);
    const end = new Date(session.end_time);
    const minutes = (end - start) / 60000; 

    if (Number.isFinite(minutes) && minutes >= 0) {
        let rounded = Math.round(minutes);
        if (rounded < 1) rounded = 1;
        return rounded;
    }

    return null;
}

function specialistAnalysisForSession(sessionId) {
    for (let i = 0; i < specialistData.analyses.length; i++) {
        const analysis = specialistData.analyses[i];

        if (String(analysis.session_id) === String(sessionId)) {
            return analysis;
        }
    }

    return null;
}

function specialistRecommendationsForReport(reportId) {
    const result = [];

    for (let i = 0; i < specialistData.recommendations.length; i++) {
        const recommendation = specialistData.recommendations[i];

        if (String(recommendation.report_id) === String(reportId)) {
            result.push(recommendation);
        }
    }

    return result;
}

function specialistUnreadCount() {
    let count = 0;

    for (let i = 0; i < specialistData.notifications.length; i++) {
        if (specialistData.notifications[i].status !== 'read') {
            count++;
        }
    }

    return count;
}

async function specialistQuery(label, query) {
    try {
        const result = await query; 

        if (result.error) {
            throw result.error;
        }

        return result.data || [];
    } catch (error) {
        console.error('Loading ' + label + ' failed:', error);

        let errorText = 'خطأ غير معروف';
        if (error.message) errorText = error.message;

        specialistData.problems.push(label + ': ' + errorText);

        return [];
    }
}

async function loadRecordingRows(client, tableName, label, sessionIds) {
    const rows = await specialistQuery(
        label,
        client
            .from(tableName)
            .select('recording_id, session_id, file_path, duration')
            .in('session_id', sessionIds)
            .order('recording_id', { ascending: false })
    );

    return rows;
}

function findSignedItem(signedList, filePath) {
    for (let i = 0; i < signedList.length; i++) {
        if (signedList[i].path === filePath) {
            return signedList[i];
        }
    }

    return null;
}

async function attachSignedUrls(client, rows) {
    if (rows.length === 0) return rows;

    try {
        const paths = [];
        for (let i = 0; i < rows.length; i++) {
            paths.push(rows[i].file_path);
        }

        const result = await client
            .storage
            .from(window.RUWY_DB.config.recordingBucket)
            .createSignedUrls(paths, 3600);

        if (result.error) {
            throw result.error;
        }

        const signedList = result.data || [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const signed = findSignedItem(signedList, row.file_path);

            row.signed_url = '';
            row.signed_error = '';

            if (signed) {
                row.signed_url = signed.signedUrl || '';
                row.signed_error = signed.error || '';
            }
        }

        return rows;
    } catch (error) {
        console.error('Signing recording URLs failed:', error);

        let errorText = 'خطأ غير معروف';
        if (error.message) errorText = error.message;

        specialistData.problems.push('روابط التسجيلات: ' + errorText);

        for (let i = 0; i < rows.length; i++) {
            rows[i].signed_url = '';
            rows[i].signed_error = '1';
        }

        return rows;
    }
}

async function loadSpecialistData() {
    const client = specialistContext.client;

    specialistData.problems = [];

    const reports = await specialistQuery(
        'التقارير',
        client
            .from('reports')
            .select('report_id, child_id, generated_date, summary, risk_level')
            .order('generated_date', { ascending: false })
    );

    const sessions = await specialistQuery(
        'جلسات القراءة',
        client
            .from('reading_sessions')
            .select('session_id, child_id, story_id, start_time, end_time, status')
            .order('start_time', { ascending: false })
            .limit(200)
    );

    const children = await specialistQuery(
        'الأطفال',
        client
            .from('children')
            .select('child_id, name, birth_date, gender')
            .order('child_id')
    );

    const notifications = await specialistQuery(
        'الإشعارات',
        client
            .from('notifications')
            .select('notification_id, user_id, message, date_sent, status')
            .eq('user_id', specialistId)
            .order('date_sent', { ascending: false })
    );

    specialistData.reports = reports;
    specialistData.children = children;
    specialistData.notifications = notifications;

    const storyIds = [];
    for (let i = 0; i < sessions.length; i++) {
        const storyId = sessions[i].story_id;

        if (storyId && !storyIds.includes(storyId)) {
            storyIds.push(storyId);
        }
    }

    const storyTitles = {};

    if (storyIds.length > 0) {
        const stories = await specialistQuery(
            'القصص',
            client.from('stories').select('story_id, title').in('story_id', storyIds)
        );

        for (let i = 0; i < stories.length; i++) {
            storyTitles[String(stories[i].story_id)] = stories[i].title || '';
        }
    }

    for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const title = storyTitles[String(session.story_id)] || '';

        session.stories = { title: title };
    }

    specialistData.sessions = sessions;

    const reportIds = [];
    for (let i = 0; i < reports.length; i++) {
        reportIds.push(reports[i].report_id);
    }

    if (reportIds.length > 0) {
        specialistData.recommendations = await specialistQuery(
            'التوصيات',
            client
                .from('recommendations')
                .select('recommendation_id, report_id, specialist_id, description, created_at')
                .in('report_id', reportIds)
                .order('created_at', { ascending: false })
        );
    } else {
        specialistData.recommendations = [];
    }

    const sessionIds = [];
    for (let i = 0; i < sessions.length; i++) {
        sessionIds.push(sessions[i].session_id);
    }

    if (sessionIds.length === 0) {
        specialistData.analyses = [];
        specialistData.videos = [];
        specialistData.audios = [];
        return;
    }

    specialistData.analyses = await specialistQuery(
        'نتائج التحليل',
        client
            .from('analysis_results')
            .select('result_id, session_id, accuracy_rate, fluency_score, pronunciation_score, analyzed_at')
            .in('session_id', sessionIds)
            .order('analyzed_at', { ascending: false })
    );

    const videoRows = await loadRecordingRows(client, 'video_recordings', 'تسجيلات الفيديو', sessionIds);
    const audioRows = await loadRecordingRows(client, 'audio_recordings', 'التسجيلات الصوتية', sessionIds);

    specialistData.videos = await attachSignedUrls(client, videoRows);
    specialistData.audios = await attachSignedUrls(client, audioRows);
} function renderSpecialistNavbar() {
    const unread = specialistUnreadCount();

    const views = [
        { id: 'overview', label: 'الرئيسية' },
        { id: 'reports', label: 'التقارير' },
        { id: 'sessions', label: 'جلسات القراءة' },
        { id: 'notifications', label: 'الإشعارات', badge: unread }
    ];

    let navButtons = '';

    for (let i = 0; i < views.length; i++) {
        const view = views[i];

        let activeClass = '';
        let ariaCurrent = '';
        if (currentView === view.id) {
            activeClass = 'active';
            ariaCurrent = 'aria-current="page"';
        }

        let badgeHTML = '';
        if (view.badge) {
            badgeHTML = '<span class="nav-badge">' + esc(view.badge) + '</span>';
        }

        navButtons += `
            <button type="button"
                class="nav-button ${activeClass}"
                data-specialist-view="${esc(view.id)}"
                ${ariaCurrent}>
                ${esc(view.label)}
                ${badgeHTML}
            </button>
        `;
    }

    let refreshDisabled = '';
    if (isLoadingData) {
        refreshDisabled = 'disabled';
    }

    specialistTop.innerHTML = `
        <div class="specialist-header">
            <div class="header-content">
                <div class="brand">
                    روي
                </div>

                <div class="header-actions">
                    <button type="button" class="btn-outline"
                        data-specialist-action="refresh"
                        ${refreshDisabled}>
                        تحديث البيانات
                    </button>

                    <button type="button" class="btn-outline btn-logout"
                        data-specialist-action="logout">
                        تسجيل الخروج
                    </button>
                </div>
            </div>
        </div>

        <div class="nav-wrap">
            <nav class="dashboard-nav" aria-label="التنقل في لوحة الأخصائي">
                ${navButtons}
            </nav>
        </div>
    `;
}

function specialistProblemsHTML() {
    if (specialistData.problems.length === 0) return '';

    let listItems = '';
    for (let i = 0; i < specialistData.problems.length; i++) {
        listItems += '<li>' + esc(specialistData.problems[i]) + '</li>';
    }

    return `
        <div class="notice notice-warning" role="alert">
            <strong>واجهتنا مشكلة في تحميل جزء من البيانات:</strong>
            <ul class="problem-list">
                ${listItems}
            </ul>
            السبب غالباً هو الصلاحيات (سياسات RLS). جرّبي تشغيل ملف
            <code>SUPABASE-SETUP.sql</code> في Supabase، ثم اضغطي «تحديث البيانات» لنحاول مرة أخرى.
        </div>
    `;
}

function specialistStat(label, value, description, tone) {
    if (tone === undefined) {
        tone = '';
    }

    return `
        <article class="stat-card ${esc(tone)}">
            <div class="stat-label">${esc(label)}</div>
            <div class="stat-number">${esc(value)}</div>
            <div class="stat-note">${esc(description)}</div>
        </article>
    `;
}

function specialistEmptyState(title, message) {
    return `
        <div class="empty-state">
            <h3>${esc(title)}</h3>
            <p>${esc(message)}</p>
        </div>
    `;
}

function specialistReportCard(report, showForm) {
    if (showForm === undefined) {
        showForm = true;
    }

    const reportId = esc(report.report_id);
    const recommendations = specialistRecommendationsForReport(report.report_id);
    const meta = specialistChildMeta(report.child_id);

    let recommendationsHTML = '';

    if (recommendations.length === 0) {
        recommendationsHTML = '<p class="section-description">لم تُضف أي توصية لهذا التقرير بعد.</p>';
    } else {
        for (let i = 0; i < recommendations.length; i++) {
            const item = recommendations[i];

            recommendationsHTML += `
                <div class="recommendation-item">
                    ${esc(item.description)}
                    <small class="recommendation-date">
                        ${esc(formatDate(item.created_at))}
                    </small>
                </div>
            `;
        }
    }

    let risk = 'unknown';
    if (report.risk_level === 'low' || report.risk_level === 'medium' || report.risk_level === 'high') {
        risk = report.risk_level;
    }

    const searchText = (
        specialistChildName(report.child_id) + ' ' +
        (report.summary || '') + ' ' +
        riskLabel(report.risk_level)
    ).toLocaleLowerCase();

    let metaHTML = '';
    if (meta) {
        metaHTML = '<div class="report-date">' + esc(meta) + '</div>';
    }

    let formHTML = '';
    if (showForm) {
        formHTML = `
            <form class="recommendation-form"
                data-specialist-recommendation
                data-report-id="${reportId}">
                <label for="recommendation-${reportId}">إضافة توصية جديدة</label>

                <textarea id="recommendation-${reportId}"
                    class="form-control" rows="3" maxlength="5000" required
                    placeholder="ما رأيك بعد مراجعة هذا التقرير؟ اكتبي توصيتك هنا..."></textarea>

                <button type="submit" class="btn-main">حفظ التوصية</button>
            </form>
        `;
    }

    return `
        <article class="report-card report-${esc(risk)}"
            data-specialist-report
            data-report-search="${esc(searchText)}"
            data-report-risk="${esc(risk)}">

            <div class="report-top">
                <div>
                    <div class="report-child">${esc(specialistChildName(report.child_id))}</div>
                    ${metaHTML}
                    <div class="report-date">
                        تاريخ التقرير: ${esc(formatDate(report.generated_date))}
                    </div>
                </div>

                <span class="risk-badge ${specialistRiskClass(report.risk_level)}">
                    ${esc(riskLabel(report.risk_level))}
                </span>
            </div>

            <div class="report-summary">
                <strong>ملخص التقرير</strong>
                <p>${esc(report.summary || 'لم يُكتب ملخص لهذا التقرير.')}</p>
            </div>

            <hr class="content-divider">

            <h3 class="subheading">التوصيات السابقة</h3>
            ${recommendationsHTML}

            ${formHTML}
        </article>
    `;
}

function specialistSessionMediaHTML(sessionId) {
    const mediaItems = [];

    for (let i = 0; i < specialistData.audios.length; i++) {
        const audio = specialistData.audios[i];

        if (String(audio.session_id) === String(sessionId)) {
            audio.media_type = 'audio';
            mediaItems.push(audio);
        }
    }

    for (let i = 0; i < specialistData.videos.length; i++) {
        const video = specialistData.videos[i];

        if (String(video.session_id) === String(sessionId)) {
            video.media_type = 'video';
            mediaItems.push(video);
        }
    }

    if (mediaItems.length === 0) {
        return '<p class="section-description">لا توجد تسجيلات لهذه الجلسة.</p>';
    }

    let itemsHTML = '';

    for (let i = 0; i < mediaItems.length; i++) {
        const item = mediaItems[i];

        let label = 'تسجيل فيديو';
        if (item.media_type === 'audio') {
            label = 'تسجيل صوتي';
        }

        let durationLabel = '';
        const duration = Number(item.duration);
        if (Number.isFinite(duration) && duration > 0) {
            durationLabel = ' · ' + Math.round(duration) + ' ثانية';
        }

        if (!item.signed_url) {
            itemsHTML += `
                <div class="recording-playback">
                    <strong>${label}${durationLabel}</strong>
                    <p class="section-description">
                        لم نتمكن من فتح هذا التسجيل الآن. تأكدي من وجود الملف في
                        Storage ومن سياسات المخزن.
                    </p>
                </div>`;
        } else {
            let tag = 'video';
            if (item.media_type === 'audio') {
                tag = 'audio';
            }

            itemsHTML += `
                <div class="recording-playback">
                    <strong>${label}${durationLabel}</strong>
                    <${tag} controls preload="metadata" src="${esc(item.signed_url)}"></${tag}>
                </div>`;
        }
    }

    return '<div class="session-recordings">' + itemsHTML + '</div>';
}

function specialistSessionCard(session) {
    const analysis = specialistAnalysisForSession(session.session_id);
    const minutes = specialistSessionMinutes(session);
    const meta = specialistChildMeta(session.child_id);

    let storyTitle = 'قصة بلا عنوان';
    if (session.stories && session.stories.title) {
        storyTitle = session.stories.title;
    }

    let analysisHTML = '';

    if (analysis) {
        analysisHTML = `
            <div class="analysis-grid">
                <div class="analysis-item">
                    <span>دقة القراءة</span>
                    <strong>${esc(specialistAnalysisValue(analysis.accuracy_rate))}</strong>
                </div>
                <div class="analysis-item">
                    <span>الطلاقة</span>
                    <strong>${esc(specialistAnalysisValue(analysis.fluency_score))}</strong>
                </div>
                <div class="analysis-item">
                    <span>النطق</span>
                    <strong>${esc(specialistAnalysisValue(analysis.pronunciation_score))}</strong>
                </div>
            </div>
            <div class="report-date">
                تاريخ التحليل: ${esc(formatDate(analysis.analyzed_at))}
            </div>`;
    } else {
        analysisHTML = `<p class="section-description">
                لم تظهر نتيجة تحليل لهذه الجلسة بعد.
           </p>`;
    }

    let metaHTML = '';
    if (meta) {
        metaHTML = ' (' + esc(meta) + ')';
    }

    let minutesHTML = '';
    if (minutes !== null) {
        minutesHTML = '<br>المدة: ' + esc(minutes) + ' دقيقة';
    }

    return `
        <article class="session-card" data-specialist-session
            data-session-child="${esc(session.child_id)}">
            <div class="session-heading">
                <div>
                    <div class="session-title">${esc(storyTitle)}</div>

                    <div class="session-meta">
                        الطفل: ${esc(specialistChildName(session.child_id))}
                        ${metaHTML}
                        <br>
                        تاريخ البدء: ${esc(formatDate(session.start_time))}
                        <br>
                        تاريخ الانتهاء: ${esc(formatDate(session.end_time))}
                        ${minutesHTML}
                    </div>
                </div>

                <span class="status-badge ${specialistStatusClass(session.status)}">
                    ${esc(specialistSessionStatus(session.status))}
                </span>
            </div>

            <hr class="content-divider">
            <h3 class="subheading">نتائج التحليل</h3>
            ${analysisHTML}

            <hr class="content-divider">
            <h3 class="subheading">تسجيلات القراءة</h3>
            ${specialistSessionMediaHTML(session.session_id)}
        </article>
    `;
}

function renderOverview() {
    let highRiskCount = 0;
    for (let i = 0; i < specialistData.reports.length; i++) {
        if (specialistData.reports[i].risk_level === 'high') {
            highRiskCount++;
        }
    }

    let completedCount = 0;
    for (let i = 0; i < specialistData.sessions.length; i++) {
        if (specialistData.sessions[i].status === 'completed') {
            completedCount++;
        }
    }

    let myRecommendationsCount = 0;
    for (let i = 0; i < specialistData.recommendations.length; i++) {
        if (String(specialistData.recommendations[i].specialist_id) === String(specialistId)) {
            myRecommendationsCount++;
        }
    }     const latestReports = specialistData.reports.slice(0, 4);
    const latestSessions = specialistData.sessions.slice(0, 4);

    let noChildrenWarning = '';
    if (specialistData.children.length === 0 && specialistData.problems.length === 0) {
        noChildrenWarning = `<div class="notice notice-warning" role="alert">
                لا يظهر أي طفل في حسابك حتى الآن. إذا كانت بيانات الأطفال موجودة في جدول children فغالباً
                أن سياسات RLS لم تُطبَّق بعد، فجرّبي تشغيل <code>SUPABASE-SETUP.sql</code>.
           </div>`;
    }

    let welcomeName = '';
    if (specialistName) {
        welcomeName = '، ' + esc(specialistName);
    }

    let highRiskTone = '';
    if (highRiskCount > 0) {
        highRiskTone = 'stat-alert';
    }

    let reportsHTML = '';
    if (latestReports.length === 0) {
        reportsHTML = specialistEmptyState('لا توجد تقارير بعد',
            'عندما يُحفظ أول تقرير سيظهر هنا.');
    } else {
        for (let i = 0; i < latestReports.length; i++) {
            reportsHTML += specialistReportCard(latestReports[i], false);
        }
    }

    let sessionsHTML = '';
    if (latestSessions.length === 0) {
        sessionsHTML = specialistEmptyState('لا توجد جلسات بعد',
            'عندما يبدأ الأطفال القراءة ستظهر جلساتهم هنا.');
    } else {
        for (let i = 0; i < latestSessions.length; i++) {
            sessionsHTML += specialistSessionCard(latestSessions[i]);
        }
    }

    return `
        ${specialistProblemsHTML()}
        ${noChildrenWarning}

        <section class="welcome-section">
            <h1>أهلاً بك${welcomeName}</h1>
            <p>سعداء برؤيتك مجدداً. هذه نظرة سريعة على أحدث ما وصل إلى لوحتك.</p>
        </section>

        <section class="stats-grid">
            ${specialistStat('التقارير', specialistData.reports.length,
                'كل التقارير التي يمكنك الاطلاع عليها')}
            ${specialistStat('تقارير تحتاج انتباهك', highRiskCount,
                'التي صُنّفت بخطورة مرتفعة', highRiskTone)}
            ${specialistStat('جلسات القراءة المكتملة', completedCount,
                'من أصل ' + specialistData.sessions.length + ' جلسة')}
            ${specialistStat('توصياتك', myRecommendationsCount,
                'التوصيات التي كتبتها بنفسك')}
        </section>

        <section>
            <div class="section-heading">
                <div>
                    <h2>أحدث التقارير</h2>
                </div>
                <button type="button" class="btn-outline" data-specialist-view="reports">
                    كل التقارير
                </button>
            </div>

            ${reportsHTML}
        </section>

        <section>
            <div class="section-heading">
                <div>
                    <h2>أحدث جلسات القراءة</h2>
                </div>
                <button type="button" class="btn-outline" data-specialist-view="sessions">
                    كل الجلسات
                </button>
            </div>

            ${sessionsHTML}
        </section>
    `;
}

function specialistNewReportForm() {
    let childOptions = '';
    for (let i = 0; i < specialistData.children.length; i++) {
        const child = specialistData.children[i];

        let childName = 'الطفل ' + child.child_id;
        if (child.name) {
            childName = child.name;
        }

        childOptions += `
            <option value="${esc(child.child_id)}">
                ${esc(childName)}
            </option>
        `;
    }

    let formHTML = '';

    if (specialistData.children.length === 0) {
        formHTML = specialistEmptyState('لا يوجد أطفال في حسابك بعد',
            'لم يظهر أي طفل في حسابك. تأكدي من وجود أطفال في جدول ' +
            'children ومن سياسات القراءة (SUPABASE-SETUP.sql).');
    } else {
        formHTML = `
            <form data-specialist-create-report class="report-card report-form">
                <div class="form-row">
                    <div class="form-field">
                        <label for="new-report-child">الطفل</label>
                        <select id="new-report-child" name="child_id"
                            class="form-select" required>
                            <option value="">اختاري الطفل</option>
                            ${childOptions}
                        </select>
                    </div>

                    <div class="form-field">
                        <label for="new-report-risk">مستوى الخطورة</label>
                        <select id="new-report-risk" name="risk_level"
                            class="form-select" required>
                            <option value="low">منخفض</option>
                            <option value="medium">متوسط</option>
                            <option value="high">مرتفع</option>
                        </select>
                    </div>
                </div>

                <div class="form-field">
                    <label for="new-report-summary">ملخص التقرير</label>
                    <textarea id="new-report-summary" name="summary"
                        class="form-control" rows="5" maxlength="10000" required
                        placeholder="اكتبي ما لاحظتِه أثناء متابعة الطفل..."></textarea>
                </div>

                <button type="submit" class="btn-main">حفظ التقرير</button>
            </form>`;
    }

    return `
        <section class="create-report-section">
            <div class="section-heading">
                <div>
                    <h2>كتابة تقرير جديد</h2>
                    <div class="section-description">
                        اختاري الطفل، ثم اكتبي ملاحظاتك وحددي مستوى الخطورة.
                    </div>
                </div>
            </div>

            ${formHTML}
        </section>
    `;
}

function renderReports() {
    let countText = 'لم يُسجَّل أي تقرير بعد.';
    if (specialistData.reports.length > 0) {
        countText = specialistData.reports.length + ' تقريراً حتى الآن.';
    }

    const header = `
        <div class="section-heading">
            <div>
                <h2>التقارير</h2>
                <div class="section-description">
                    ${countText}
                </div>
            </div>
        </div>`;

    if (specialistData.reports.length === 0) {
        return `
            ${specialistProblemsHTML()}
            ${specialistNewReportForm()}
            <section>
                ${header}
                ${specialistEmptyState('لا توجد تقارير بعد',
                    'يمكنك كتابة أول تقرير من النموذج أعلاه.')}
            </section>`;
    }

    let reportsHTML = '';
    for (let i = 0; i < specialistData.reports.length; i++) {
        reportsHTML += specialistReportCard(specialistData.reports[i], true);
    }

    return `
        ${specialistProblemsHTML()}
        ${specialistNewReportForm()}

        <section>
            ${header}

            <div class="report-tools">
                <input class="form-control search-control" id="specialist-report-search"
                    type="search" placeholder="ابحثي باسم الطفل أو بكلمة من الملخص..."
                    aria-label="البحث في التقارير">

                <select class="form-select filter-control" id="specialist-risk-filter"
                    aria-label="تصفية التقارير حسب مستوى الخطورة">
                    <option value="all">جميع المستويات</option>
                    <option value="low">منخفض</option>
                    <option value="medium">متوسط</option>
                    <option value="high">مرتفع</option>
                    <option value="unknown">غير محدد</option>
                </select>
            </div>

            <div id="specialist-reports-list">
                ${reportsHTML}
            </div>

            <div id="specialist-filter-empty" hidden>
                ${specialistEmptyState('لم نجد ما تبحثين عنه',
                    'جرّبي كلمات أخرى أو غيّري مستوى الخطورة.')}
            </div>
        </section>
    `;
}

function renderSessions() {
    let childOptions = '';
    for (let i = 0; i < specialistData.children.length; i++) {
        const child = specialistData.children[i];

        let childName = 'الطفل ' + child.child_id;
        if (child.name) {
            childName = child.name;
        }

        childOptions += '<option value="' + esc(child.child_id) + '">' + esc(childName) + '</option>';
    }

    let contentHTML = '';

    if (specialistData.sessions.length === 0) {
        contentHTML = specialistEmptyState('لا توجد جلسات بعد',
            'عندما يبدأ الأطفال القراءة ستظهر جلساتهم هنا.');
    } else {
        let sessionsHTML = '';
        for (let i = 0; i < specialistData.sessions.length; i++) {
            sessionsHTML += specialistSessionCard(specialistData.sessions[i]);
        }

        contentHTML = `
            <div class="report-tools">
                <select class="form-select filter-control" id="specialist-session-child"
                    aria-label="تصفية الجلسات حسب الطفل">
                    <option value="all">جميع الأطفال</option>
                    ${childOptions}
                </select>
            </div>

            <div id="specialist-sessions-list">
                ${sessionsHTML}
            </div>

            <div id="specialist-session-empty" hidden>
                ${specialistEmptyState('لا توجد جلسات لهذا الطفل بعد',
                    'جرّبي طفلاً آخر أو اعرضي الجميع.')}
            </div>`;
    }

    return `
        ${specialistProblemsHTML()}

        <section>
            <div class="section-heading">
                <div>
                    <h2>جلسات القراءة</h2>
                    <div class="section-description">
                        جلسات قراءة الأطفال ونتائج تحليلها.
                    </div>
                </div>
            </div>

            ${contentHTML}
        </section>
    `;
}

function renderNotifications() {
    const notifications = specialistData.notifications;

    if (notifications.length === 0) {
        return `
            ${specialistProblemsHTML()}
            <section>
                <div class="section-heading"><h2>الإشعارات</h2></div>
                ${specialistEmptyState('لا توجد إشعارات جديدة', 'سنخبرك هنا عندما يصل شيء جديد.')}
            </section>`;
    }

    let notificationsHTML = '';

    for (let i = 0; i < notifications.length; i++) {
        const notification = notifications[i];

        let unreadClass = '';
        if (notification.status !== 'read') {
            unreadClass = 'unread';
        }

        notificationsHTML += `
            <article class="notification-card ${unreadClass}">
                <p>${esc(notification.message || '')}</p>
                <div class="report-date">${esc(formatDate(notification.date_sent))}</div>
            </article>
        `;
    }

    return `
        ${specialistProblemsHTML()}
        <section>
            <div class="section-heading">
                <div>
                    <h2>الإشعارات</h2>
                    <div class="section-description">
                        آخر ما وصلك من تنبيهات.
                    </div>
                </div>
            </div>

            ${notificationsHTML}
        </section>
    `;
}

function renderSpecialistPage() {
    renderSpecialistNavbar();

    if (currentView === 'reports') {
        specialistApp.innerHTML = renderReports();
    } else if (currentView === 'sessions') {
        specialistApp.innerHTML = renderSessions();
    } else if (currentView === 'notifications') {
        specialistApp.innerHTML = renderNotifications();
    } else {
        specialistApp.innerHTML = renderOverview();
    }
}

function applySpecialistReportFilters() {
    const search = document.getElementById('specialist-report-search');
    const riskFilter = document.getElementById('specialist-risk-filter');
    const emptyState = document.getElementById('specialist-filter-empty');

    if (!search || !riskFilter || !emptyState) return;

    const searchText = search.value.trim().toLocaleLowerCase();
    const selectedRisk = riskFilter.value;
    let visibleCount = 0;

    const cards = document.querySelectorAll('[data-specialist-report]');

    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];

        const cardSearch = card.dataset.reportSearch || '';
        const cardRisk = card.dataset.reportRisk || 'unknown';

        const matchesSearch = cardSearch.includes(searchText);

        let matchesRisk = false;
        if (selectedRisk === 'all' || selectedRisk === cardRisk) {
            matchesRisk = true;
        }

        if (matchesSearch && matchesRisk) {
            card.hidden = false;
            visibleCount++;
        } else {
            card.hidden = true;
        }
    }

    emptyState.hidden = visibleCount > 0;
}

function applySpecialistSessionFilter() {
    const select = document.getElementById('specialist-session-child');
    const emptyState = document.getElementById('specialist-session-empty');

    if (!select || !emptyState) return;

    let visibleCount = 0;

    const cards = document.querySelectorAll('[data-specialist-session]');     for (let i = 0; i < cards.length; i++) {
        const card = cards[i];

        if (select.value === 'all' || card.dataset.sessionChild === select.value) {
            card.hidden = false;
            visibleCount++;
        } else {
            card.hidden = true;
        }
    }

    emptyState.hidden = visibleCount > 0;
}

async function changeSpecialistView(view) {
    currentView = view;
    clearSpecialistMessage();

    try {
        renderSpecialistPage();
        window.scrollTo({ top: 0 });

        if (view === 'notifications' && specialistUnreadCount() > 0) {
            try {
                await markNotificationsRead(specialistId);

                for (let i = 0; i < specialistData.notifications.length; i++) {
                    specialistData.notifications[i].status = 'read';
                }

                renderSpecialistNavbar();
            } catch (error) {
                console.error('Could not mark notifications as read:', error);
            }
        }
    } catch (error) {
        console.error('Rendering specialist page failed:', error);

        let errorText = 'لم نتمكن من عرض هذه الصفحة.';
        if (error.message) errorText = error.message;

        specialistMessage(errorText, 'error');
    }
}

async function refreshSpecialistDashboard() {
    if (isLoadingData) return;

    isLoadingData = true;
    clearSpecialistMessage();
    renderSpecialistNavbar();

    specialistApp.innerHTML = `
        <div class="loading-message" role="status">
            <span class="spinner" aria-hidden="true"></span>
            لحظات، نجهّز بياناتك...
        </div>
    `;

    try {
        await loadSpecialistData();
    } catch (error) {
        console.error('Specialist dashboard refresh failed:', error);

        let errorText = 'حدث خطأ غير معروف.';
        if (error.message) errorText = error.message;

        specialistData.problems.push(errorText);
    } finally {
        isLoadingData = false;
    }

    renderSpecialistPage();
}

async function handleSpecialistClick(event) {
    const viewButton = event.target.closest('[data-specialist-view]');

    if (viewButton) {
        const view = viewButton.dataset.specialistView;

        if (view === 'overview' || view === 'reports' || view === 'sessions' || view === 'notifications') {
            await changeSpecialistView(view);
        }

        return;
    }

    const actionButton = event.target.closest('[data-specialist-action]');

    if (!actionButton) return;

    const action = actionButton.dataset.specialistAction;

    if (action === 'refresh') {
        await refreshSpecialistDashboard();
        return;
    }

    if (action === 'logout') {
        actionButton.disabled = true;

        try {
            await window.RUWY_DB.signOut();
            window.location.replace('../1auth/index.html');
        } catch (error) {
            console.error('Logout failed:', error);
            actionButton.disabled = false;
            specialistMessage('لم نتمكن من تسجيل خروجك: ' + error.message, 'error');
        }
    }
}

async function handleSpecialistReportCreation(form) {
    const childId = Number(form.elements.child_id.value);
    const riskLevel = form.elements.risk_level.value;
    const summary = form.elements.summary.value.trim();
    const submitButton = form.querySelector('button[type="submit"]');

    if (!Number.isSafeInteger(childId) || childId <= 0) {
        specialistMessage('اختاري الطفل أولاً.', 'error');
        return;
    }

    if (!summary) {
        specialistMessage('اكتبي ملخص التقرير أولاً.', 'error');
        return;
    }

    if (riskLevel !== 'low' && riskLevel !== 'medium' && riskLevel !== 'high') {
        specialistMessage('اختاري مستوى الخطورة من القائمة.', 'error');
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'نحفظ التقرير...';
    clearSpecialistMessage();

    try {
        const result = await specialistContext.client
            .from('reports')
            .insert({
                child_id: childId,
                generated_date: new Date().toISOString(),
                summary: summary,
                risk_level: riskLevel
            });

        if (result.error) {
            throw result.error;
        }

        await loadSpecialistData();
        currentView = 'reports';
        renderSpecialistPage();

        specialistMessage('تم حفظ التقرير، شكراً لك!', 'success');
    } catch (error) {
        console.error('Creating report failed:', error);

        let errorText = 'حدث خطأ غير معروف.';
        if (error.message) errorText = error.message;

        specialistMessage('لم نتمكن من حفظ التقرير: ' + errorText, 'error');

        submitButton.disabled = false;
        submitButton.textContent = 'حفظ التقرير';
    }
}

async function handleSpecialistRecommendation(form) {
    const reportId = form.dataset.reportId;
    const input = form.querySelector('textarea');
    const submitButton = form.querySelector('button[type="submit"]');
    const description = input.value.trim();

    if (!description) {
        input.focus();
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'نحفظ توصيتك...';

    try {
        const saveResult = await addRecommendation(reportId, specialistId, description);

        await loadSpecialistData();
        currentView = 'reports';
        renderSpecialistPage();

        if (saveResult.notificationCreated) {
            specialistMessage('تم حفظ توصيتك، وأبلغنا ولي الأمر بها.', 'success');
        } else {
            let reason = 'تحققي من صلاحيات notifications.';
            if (saveResult.notificationErrorMessage) {
                reason = saveResult.notificationErrorMessage;
            }

            specialistMessage('حُفظت توصيتك، لكن لم نتمكن من إبلاغ ولي الأمر: ' + reason, 'error');
        }
    } catch (error) {
        console.error('Saving recommendation failed:', error);

        let errorText = 'تحققي من صلاحيات.';
        if (error.message) errorText = error.message;

        specialistMessage('لم نتمكن من حفظ التوصية: ' + errorText, 'error');

        submitButton.disabled = false;
        submitButton.textContent = 'حفظ التوصية';
    }
}

function handleSpecialistSubmit(event) {
    const reportForm = event.target.closest('[data-specialist-create-report]');

    if (reportForm) {
        event.preventDefault();
        handleSpecialistReportCreation(reportForm);
        return;
    }

    const recommendationForm = event.target.closest('[data-specialist-recommendation]');

    if (recommendationForm) {
        event.preventDefault();
        handleSpecialistRecommendation(recommendationForm);
    }
}

function initializeSpecialistEvents() {
    specialistTop.addEventListener('click', handleSpecialistClick);
    specialistApp.addEventListener('click', handleSpecialistClick);
    specialistApp.addEventListener('submit', handleSpecialistSubmit);

    specialistApp.addEventListener('input', function (event) {
        if (event.target.id === 'specialist-report-search') {
            applySpecialistReportFilters();
        }
    });

    specialistApp.addEventListener('change', function (event) {
        if (event.target.id === 'specialist-risk-filter') {
            applySpecialistReportFilters();
        }

        if (event.target.id === 'specialist-session-child') {
            applySpecialistSessionFilter();
        }
    });
}

async function initializeSpecialistDashboard() {
    initializeSpecialistEvents();

    try {
        if (!window.RUWY_DB) {
            throw new Error('تعذّر تحميل ../database.js. تأكدي من تشغيل المشروع عبر Live Server.');
        }

        if (typeof addRecommendation !== 'function' || typeof formatDate !== 'function') {
            throw new Error('تعذّر تحميل ../6reports/data.js. تأكدي من وجود المجلد 6reports.');
        }

        const context = await window.RUWY_DB.getCurrentContext();

        if (!context) {
            window.location.replace('../1auth/index.html');
            return;
        }

        if (!context.profile) {
            throw new Error('لا يوجد ملف مستخدم مرتبط بهذا الحساب في جدول users.');
        }

        if (context.profile.role === 'parent') {
            window.location.replace('../2parentdashboard/parent_dashboard.html');
            return;
        }

        if (context.profile.role !== 'specialist') {
            throw new Error('هذه الصفحة مخصصة لحساب الأخصائي فقط.');
        }

        specialistContext = context;
        specialistId = Number(context.profile.user_id);
        specialistName = context.profile.name || '';

        if (!Number.isSafeInteger(specialistId) || specialistId <= 0) {
            throw new Error('معرّف الأخصائي الرقمي غير صالح في جدول users.');
        }

        const rowResult = await context.client
            .from('specialists')
            .select('specialist_id, specialization')
            .eq('specialist_id', specialistId)
            .maybeSingle();

        if (rowResult.error) {
            throw rowResult.error;
        }

        const specialistRow = rowResult.data;

        if (!specialistRow) {
            throw new Error(
                'لم يتم العثور على سجل الأخصائي. يجب أن يوجد صف في جدول specialists ' +
                'قيمة specialist_id فيه ' + specialistId + '، وأن تكون سياسات RLS مطبّقة ' +
                '(SUPABASE-SETUP.sql).'
            );
        }

        specialistSpecialization = specialistRow.specialization || '';

        renderSpecialistNavbar();
        await refreshSpecialistDashboard();
    } catch (error) {
        console.error('Specialist dashboard initialization failed:', error);

        specialistApp.innerHTML = `
            <div class="empty-state">
                <h3>عذراً، لم نتمكن من فتح لوحتك</h3>
                <p>اقرئي الرسالة أعلاه، ثم حدّثي الصفحة أو سجّلي الخروج وادخلي من جديد.</p>
                <button type="button" class="btn-outline btn-logout"
                    data-specialist-action="logout">تسجيل الخروج</button>
            </div>`;

        let errorText = 'تعذّر فتح لوحة الأخصائي.';
        if (error.message) errorText = error.message;

        specialistMessage(errorText, 'error');
    }
}

window.addEventListener('DOMContentLoaded', initializeSpecialistDashboard);