

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

/* ---------- أدوات عامة ---------- */

// escapeHTML في data.js لا يهرّب علامات الاقتباس، وهذا يكسر الخصائص مثل data-*="..."
function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[character]));
}

function specialistMessage(message, type = 'info') {
    specialistNotice.textContent = message;
    specialistNotice.className = 'notice notice-' + type;
    specialistNotice.hidden = false;
}

function clearSpecialistMessage() {
    specialistNotice.textContent = '';
    specialistNotice.hidden = true;
}

function specialistFindChild(childId) {
    return specialistData.children.find(
        item => String(item.child_id) === String(childId)
    );
}

function specialistChildName(childId) {
    return specialistFindChild(childId)?.name || 'اسم الطفل غير متاح';
}

function specialistAge(birthDate) {
    if (!birthDate) return null;

    const birth = new Date(birthDate + 'T00:00:00');
    if (Number.isNaN(birth.getTime())) return null;

    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();

    if (
        now.getMonth() < birth.getMonth() ||
        (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
    ) {
        age--;
    }

    return Math.max(0, age);
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
    const statuses = {
        in_progress: 'قيد التنفيذ',
        completed: 'مكتملة',
        cancelled: 'ملغاة'
    };

    return statuses[status] || 'غير محددة';
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

    return Number.isFinite(number)
        ? String(Math.round(number * 100) / 100)
        : String(value);
}

function specialistSessionMinutes(session) {
    if (!session.start_time || !session.end_time) return null;

    const minutes =
        (new Date(session.end_time) - new Date(session.start_time)) / 60000;

    return Number.isFinite(minutes) && minutes >= 0
        ? Math.max(1, Math.round(minutes))
        : null;
}

function specialistAnalysisForSession(sessionId) {
    return specialistData.analyses.find(
        item => String(item.session_id) === String(sessionId)
    );
}

function specialistRecommendationsForReport(reportId) {
    return specialistData.recommendations.filter(
        item => String(item.report_id) === String(reportId)
    );
}

function specialistUnreadCount() {
    return specialistData.notifications.filter(
        item => item.status !== 'read'
    ).length;
}

/* ---------- تحميل البيانات ---------- */

// كل استعلام مستقل: فشل جدول واحد لا يُسقط اللوحة كلها.
async function specialistQuery(label, query) {
    try {
        const { data, error } = await query;

        if (error) throw error;

        return data || [];
    } catch (error) {
        console.error('Loading ' + label + ' failed:', error);

        specialistData.problems.push(
            label + ': ' + (error.message || 'خطأ غير معروف')
        );

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

// رابط موقّع واحد لكل ملف، بطلب واحد لكل الملفات.
async function attachSignedUrls(client, rows) {
    if (!rows.length) return rows;

    try {
        const { data, error } = await client
            .storage
            .from(window.RUWY_DB.config.recordingBucket)
            .createSignedUrls(rows.map(item => item.file_path), 3600);

        if (error) throw error;

        const urls = new Map(
            (data || []).map(item => [item.path, item])
        );

        return rows.map(row => {
            const signed = urls.get(row.file_path);

            return {
                ...row,
                signed_url: signed?.signedUrl || '',
                signed_error: signed?.error || ''
            };
        });
    } catch (error) {
        console.error('Signing recording URLs failed:', error);

        specialistData.problems.push(
            'روابط التسجيلات: ' + (error.message || 'خطأ غير معروف')
        );

        return rows.map(row => ({ ...row, signed_url: '', signed_error: '1' }));
    }
}

async function loadSpecialistData() {
    const client = specialistContext.client;

    specialistData.problems = [];

    const [reports, sessions, children, notifications] = await Promise.all([
        specialistQuery(
            'التقارير',
            client
                .from('reports')
                .select('report_id, child_id, generated_date, summary, risk_level')
                .order('generated_date', { ascending: false })
        ),
        specialistQuery(
            'جلسات القراءة',
            client
                .from('reading_sessions')
                .select('session_id, child_id, story_id, start_time, end_time, status')
                .order('start_time', { ascending: false })
                .limit(200)
        ),
        specialistQuery(
            'الأطفال',
            client
                .from('children')
                .select('child_id, name, birth_date, gender')
                .order('child_id')
        ),
        specialistQuery(
            'الإشعارات',
            client
                .from('notifications')
                .select('notification_id, user_id, message, date_sent, status')
                .eq('user_id', specialistId)
                .order('date_sent', { ascending: false })
        )
    ]);

    specialistData.reports = reports;
    specialistData.children = children;
    specialistData.notifications = notifications;

    // عناوين القصص باستعلام مستقل (لا نعتمد على علاقة PostgREST مضمنة).
    const storyIds = [
        ...new Set(sessions.map(item => item.story_id).filter(Boolean))
    ];

    let storyTitles = new Map();

    if (storyIds.length) {
        const stories = await specialistQuery(
            'القصص',
            client.from('stories').select('story_id, title').in('story_id', storyIds)
        );

        storyTitles = new Map(
            stories.map(item => [String(item.story_id), item.title || ''])
        );
    }

    specialistData.sessions = sessions.map(session => ({
        ...session,
        stories: { title: storyTitles.get(String(session.story_id)) || '' }
    }));

    const reportIds = reports.map(item => item.report_id);

    specialistData.recommendations = reportIds.length
        ? await specialistQuery(
            'التوصيات',
            client
                .from('recommendations')
                .select('recommendation_id, report_id, specialist_id, description, created_at')
                .in('report_id', reportIds)
                .order('created_at', { ascending: false })
        )
        : [];

    const sessionIds = specialistData.sessions.map(item => item.session_id);

    if (!sessionIds.length) {
        specialistData.analyses = [];
        specialistData.videos = [];
        specialistData.audios = [];
        return;
    }

    const [analyses, videoRows, audioRows] = await Promise.all([
        specialistQuery(
            'نتائج التحليل',
            client
                .from('analysis_results')
                .select('result_id, session_id, accuracy_rate, fluency_score, pronunciation_score, analyzed_at')
                .in('session_id', sessionIds)
                .order('analyzed_at', { ascending: false })
        ),
        loadRecordingRows(client, 'video_recordings', 'تسجيلات الفيديو', sessionIds),
        loadRecordingRows(client, 'audio_recordings', 'التسجيلات الصوتية', sessionIds)
    ]);

    specialistData.analyses = analyses;

    const [videos, audios] = await Promise.all([
        attachSignedUrls(client, videoRows),
        attachSignedUrls(client, audioRows)
    ]);

    specialistData.videos = videos;
    specialistData.audios = audios;
}

/* ---------- الواجهة ---------- */

function renderSpecialistNavbar() {
    const unread = specialistUnreadCount();

    const views = [
        { id: 'overview', label: 'الرئيسية' },
        { id: 'reports', label: 'التقارير' },
        { id: 'sessions', label: 'جلسات القراءة' },
        { id: 'notifications', label: 'الإشعارات', badge: unread }
    ];

    specialistTop.innerHTML = `
        <div class="specialist-header">
            <div class="header-content">
                <div class="brand">
                    روي
                </div>

                <div class="header-actions">
                    <button type="button" class="btn-outline"
                        data-specialist-action="refresh"
                        ${isLoadingData ? 'disabled' : ''}>
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
                ${views.map(view => `
                    <button type="button"
                        class="nav-button ${currentView === view.id ? 'active' : ''}"
                        data-specialist-view="${esc(view.id)}"
                        ${currentView === view.id ? 'aria-current="page"' : ''}>
                        ${esc(view.label)}
                        ${view.badge ? `<span class="nav-badge">${esc(view.badge)}</span>` : ''}
                    </button>
                `).join('')}
            </nav>
        </div>
    `;
}

function specialistProblemsHTML() {
    if (!specialistData.problems.length) return '';

    return `
        <div class="notice notice-warning" role="alert">
            <strong>تعذّر تحميل جزء من البيانات:</strong>
            <ul class="problem-list">
                ${specialistData.problems.map(item => `<li>${esc(item)}</li>`).join('')}
            </ul>
            غالباً السبب سياسات RLS أو الصلاحيات؛ شغّلي ملف
            <code>SUPABASE-SETUP.sql</code> في Supabase ثم اضغطي «تحديث البيانات».
        </div>
    `;
}

function specialistStat(label, value, description, tone = '') {
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

function specialistReportCard(report, showForm = true) {
    const reportId = esc(report.report_id);
    const recommendations = specialistRecommendationsForReport(report.report_id);
    const meta = specialistChildMeta(report.child_id);

    const recommendationsHTML = recommendations.length
        ? recommendations.map(item => `
            <div class="recommendation-item">
                ${esc(item.description)}
                <small class="recommendation-date">
                    ${esc(formatDate(item.created_at))}
                </small>
            </div>
        `).join('')
        : '<p class="section-description">لا توجد توصيات محفوظة لهذا التقرير.</p>';

    const risk = ['low', 'medium', 'high'].includes(report.risk_level)
        ? report.risk_level
        : 'unknown';

    return `
        <article class="report-card report-${esc(risk)}"
            data-specialist-report
            data-report-search="${esc([
                specialistChildName(report.child_id),
                report.summary || '',
                riskLabel(report.risk_level)
            ].join(' ').toLocaleLowerCase())}"
            data-report-risk="${esc(risk)}">

            <div class="report-top">
                <div>
                    <div class="report-child">${esc(specialistChildName(report.child_id))}</div>
                    ${meta ? `<div class="report-date">${esc(meta)}</div>` : ''}
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
                <p>${esc(report.summary || 'لا يوجد ملخص محفوظ لهذا التقرير.')}</p>
            </div>

            <hr class="content-divider">

            <h3 class="subheading">التوصيات السابقة</h3>
            ${recommendationsHTML}

            ${showForm ? `
                <form class="recommendation-form"
                    data-specialist-recommendation
                    data-report-id="${reportId}">
                    <label for="recommendation-${reportId}">إضافة توصية جديدة</label>

                    <textarea id="recommendation-${reportId}"
                        class="form-control" rows="3" maxlength="5000" required
                        placeholder="اكتبي التوصية المهنية بعد مراجعة التقرير..."></textarea>

                    <button type="submit" class="btn-main">حفظ التوصية</button>
                </form>
            ` : ''}
        </article>
    `;
}

function specialistSessionMediaHTML(sessionId) {
    const mediaItems = [
        ...specialistData.audios
            .filter(item => String(item.session_id) === String(sessionId))
            .map(item => ({ ...item, media_type: 'audio' })),
        ...specialistData.videos
            .filter(item => String(item.session_id) === String(sessionId))
            .map(item => ({ ...item, media_type: 'video' }))
    ];

    if (!mediaItems.length) {
        return '<p class="section-description">لا توجد تسجيلات محفوظة لهذه الجلسة.</p>';
    }

    return `<div class="session-recordings">${mediaItems.map(item => {
        const label = item.media_type === 'audio' ? 'تسجيل صوتي' : 'تسجيل فيديو';
        const duration = Number(item.duration);
        const durationLabel = Number.isFinite(duration) && duration > 0
            ? ' · ' + Math.round(duration) + ' ثانية'
            : '';

        if (!item.signed_url) {
            return `
                <div class="recording-playback">
                    <strong>${label}${durationLabel}</strong>
                    <p class="section-description">
                        تعذّر إنشاء رابط آمن لهذا الملف. تحققي من وجود الملف في
                        Storage ومن سياسات المخزن.
                    </p>
                </div>`;
        }

        const tag = item.media_type === 'audio' ? 'audio' : 'video';

        return `
            <div class="recording-playback">
                <strong>${label}${durationLabel}</strong>
                <${tag} controls preload="metadata" src="${esc(item.signed_url)}"></${tag}>
            </div>`;
    }).join('')}</div>`;
}

function specialistSessionCard(session) {
    const analysis = specialistAnalysisForSession(session.session_id);
    const storyTitle = session.stories?.title || 'عنوان القصة غير متاح';
    const minutes = specialistSessionMinutes(session);
    const meta = specialistChildMeta(session.child_id);

    const analysisHTML = analysis
        ? `
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
            </div>`
        : `<p class="section-description">
                لا توجد نتيجة تحليل محفوظة.
           </p>`;

    return `
        <article class="session-card" data-specialist-session
            data-session-child="${esc(session.child_id)}">
            <div class="session-heading">
                <div>
                    <div class="session-title">${esc(storyTitle)}</div>

                    <div class="session-meta">
                        الطفل: ${esc(specialistChildName(session.child_id))}
                        ${meta ? ' (' + esc(meta) + ')' : ''}
                        <br>
                        تاريخ البدء: ${esc(formatDate(session.start_time))}
                        <br>
                        تاريخ الانتهاء: ${esc(formatDate(session.end_time))}
                        ${minutes !== null ? '<br>المدة: ' + esc(minutes) + ' دقيقة' : ''}
                    </div>
                </div>

                <span class="status-badge ${specialistStatusClass(session.status)}">
                    ${esc(specialistSessionStatus(session.status))}
                </span>
            </div>

            <hr class="content-divider">
            <h3 class="subheading">نتائج التحليل المسجلة</h3>
            ${analysisHTML}

            <hr class="content-divider">
            <h3 class="subheading">تسجيلات القراءة</h3>
            ${specialistSessionMediaHTML(session.session_id)}
        </article>
    `;
}

function renderOverview() {
    const highRiskCount = specialistData.reports.filter(
        report => report.risk_level === 'high'
    ).length;

    const completedCount = specialistData.sessions.filter(
        session => session.status === 'completed'
    ).length;

    const myRecommendations = specialistData.recommendations.filter(
        item => String(item.specialist_id) === String(specialistId)
    );

    const latestReports = specialistData.reports.slice(0, 4);
    const latestSessions = specialistData.sessions.slice(0, 4);

    const noChildrenWarning =
        !specialistData.children.length && !specialistData.problems.length
            ? `<div class="notice notice-warning" role="alert">
                    لا يظهر أي طفل لحسابك. إذا كان في جدول children بيانات فهذا يعني
                    أن سياسات RLS لم تُطبَّق بعد؛ شغّلي <code>SUPABASE-SETUP.sql</code>.
               </div>`
            : '';

    return `
        ${specialistProblemsHTML()}
        ${noChildrenWarning}

        <section class="welcome-section">
    <h1>مرحباً ${esc(specialistName)}</h1>
</section>

        <section class="stats-grid">
            ${specialistStat('التقارير المتاحة', specialistData.reports.length,
                'التقارير التي تسمح صلاحيات حسابك بعرضها')}
            ${specialistStat('تقارير الخطورة المرتفعة', highRiskCount,
                'حسب المستوى المسجل في قاعدة البيانات',
                highRiskCount ? 'stat-alert' : '')}
            ${specialistStat('جلسات القراءة المكتملة', completedCount,
                'من أصل ' + specialistData.sessions.length + ' جلسة')}
            ${specialistStat('توصياتي المحفوظة', myRecommendations.length,
                'التوصيات المرتبطة بحسابك')}
        </section>

        <section>
            <div class="section-heading">
                <div>
                    <h2>أحدث التقارير</h2>
                    
                </div>
                <button type="button" class="btn-outline" data-specialist-view="reports">
                    عرض التقارير
                </button>
            </div>

            ${latestReports.length
                ? latestReports.map(report => specialistReportCard(report, false)).join('')
                : specialistEmptyState('لا توجد تقارير محفوظة',
                    'ستظهر التقارير هنا بعد حفظها في.')}
        </section>

        <section>
            <div class="section-heading">
                <div>
                    <h2>أحدث جلسات القراءة</h2>
                </div>
                <button type="button" class="btn-outline" data-specialist-view="sessions">
                    عرض الجلسات
                </button>
            </div>

            ${latestSessions.length
                ? latestSessions.map(specialistSessionCard).join('')
                : specialistEmptyState('لا توجد جلسات قراءة',
                    'ستظهر الجلسات بعد تسجيلها في.')}
        </section>
    `;
}

function specialistNewReportForm() {
    const childOptions = specialistData.children.map(child => `
        <option value="${esc(child.child_id)}">
            ${esc(child.name || ('الطفل ' + child.child_id))}
        </option>
    `).join('');

    return `
        <section class="create-report-section">
            <div class="section-heading">
                <div>
                    <h2>كتابة تقرير جديد</h2>
                    <div class="section-description">
                        اختاري الطفل واكتبي ملخص التقرير وحددي مستوى الخطورة.
                    </div>
                </div>
            </div>

            ${!specialistData.children.length
                ? specialistEmptyState('لا يوجد أطفال متاحون',
                    'لم يتم تحميل أي أطفال لحسابك. تأكدي من وجود أطفال في جدول ' +
                    'children ومن سياسات القراءة (SUPABASE-SETUP.sql).')
                : `
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
                            placeholder="اكتبي ملخص التقرير وملاحظاتك المهنية..."></textarea>
                    </div>

                    <button type="submit" class="btn-main">حفظ التقرير</button>
                </form>`}
        </section>
    `;
}

function renderReports() {
    const header = `
        <div class="section-heading">
            <div>
                <h2>التقارير المحفوظة</h2>
                <div class="section-description">
                    ${specialistData.reports.length
                        ? specialistData.reports.length + ' تقريراً.'
                        : 'التقارير المسجلة.'}
                </div>
            </div>
        </div>`;

    if (!specialistData.reports.length) {
        return `
            ${specialistProblemsHTML()}
            ${specialistNewReportForm()}
            <section>
                ${header}
                ${specialistEmptyState('لا توجد تقارير محفوظة',
                    'يمكنك كتابة تقرير جديد باستخدام النموذج أعلاه.')}
            </section>`;
    }

    return `
        ${specialistProblemsHTML()}
        ${specialistNewReportForm()}

        <section>
            ${header}

            <div class="report-tools">
                <input class="form-control search-control" id="specialist-report-search"
                    type="search" placeholder="ابحث باسم الطفل أو ملخص التقرير..."
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
                ${specialistData.reports.map(r => specialistReportCard(r, true)).join('')}
            </div>

            <div id="specialist-filter-empty" hidden>
                ${specialistEmptyState('لا توجد نتائج مطابقة',
                    'جرّبي تغيير كلمات البحث أو مستوى الخطورة.')}
            </div>
        </section>
    `;
}

function renderSessions() {
    const childOptions = specialistData.children.map(child => `
        <option value="${esc(child.child_id)}">${esc(child.name || ('الطفل ' + child.child_id))}</option>
    `).join('');

    return `
        ${specialistProblemsHTML()}

        <section>
            <div class="section-heading">
                <div>
                    <h2>جلسات القراءة</h2>
                    <div class="section-description">
                        الجلسات المسجلة في قاعدة البيانات ونتائج تحليلها، إن وُجدت.
                    </div>
                </div>
            </div>

            ${specialistData.sessions.length ? `
                <div class="report-tools">
                    <select class="form-select filter-control" id="specialist-session-child"
                        aria-label="تصفية الجلسات حسب الطفل">
                        <option value="all">جميع الأطفال</option>
                        ${childOptions}
                    </select>
                </div>

                <div id="specialist-sessions-list">
                    ${specialistData.sessions.map(specialistSessionCard).join('')}
                </div>

                <div id="specialist-session-empty" hidden>
                    ${specialistEmptyState('لا توجد جلسات لهذا الطفل',
                        'اختاري طفلاً آخر أو اعرضي جميع الأطفال.')}
                </div>`
                : specialistEmptyState('لا توجد جلسات قراءة',
                    'لا توجد جلسات يمكن عرضها حالياً.')}
        </section>
    `;
}

function renderNotifications() {
    const notifications = specialistData.notifications;

    if (!notifications.length) {
        return `
            ${specialistProblemsHTML()}
            <section>
                <div class="section-heading"><h2>الإشعارات</h2></div>
                ${specialistEmptyState('لا توجد إشعارات')}
            </section>`;
    }

    return `
        ${specialistProblemsHTML()}
        <section>
            <div class="section-heading">
                <div>
                    <h2>الإشعارات</h2>
                    <div class="section-description">
                        الإشعارات المحفوظة لحساب الأخصائي الحالي.
                    </div>
                </div>
            </div>

            ${notifications.map(notification => `
                <article class="notification-card ${notification.status !== 'read' ? 'unread' : ''}">
                    <p>${esc(notification.message || '')}</p>
                    <div class="report-date">${esc(formatDate(notification.date_sent))}</div>
                </article>
            `).join('')}
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

    document.querySelectorAll('[data-specialist-report]').forEach(card => {
        const matchesSearch = (card.dataset.reportSearch || '').includes(searchText);
        const matchesRisk =
            selectedRisk === 'all' ||
            selectedRisk === (card.dataset.reportRisk || 'unknown');
        const visible = matchesSearch && matchesRisk;

        card.hidden = !visible;
        if (visible) visibleCount++;
    });

    emptyState.hidden = visibleCount > 0;
}

function applySpecialistSessionFilter() {
    const select = document.getElementById('specialist-session-child');
    const emptyState = document.getElementById('specialist-session-empty');

    if (!select || !emptyState) return;

    let visibleCount = 0;

    document.querySelectorAll('[data-specialist-session]').forEach(card => {
        const visible =
            select.value === 'all' || card.dataset.sessionChild === select.value;

        card.hidden = !visible;
        if (visible) visibleCount++;
    });

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

                specialistData.notifications = specialistData.notifications.map(
                    notification => ({ ...notification, status: 'read' })
                );

                renderSpecialistNavbar();
            } catch (error) {
                console.error('Could not mark notifications as read:', error);
            }
        }
    } catch (error) {
        console.error('Rendering specialist page failed:', error);
        specialistMessage(error.message || 'تعذّر عرض الصفحة المطلوبة.', 'error');
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
            جاري تحميل البيانات...
        </div>
    `;

    try {
        await loadSpecialistData();
    } catch (error) {
        console.error('Specialist dashboard refresh failed:', error);

        specialistData.problems.push(error.message || 'حدث خطأ غير معروف.');
    } finally {
        isLoadingData = false;
    }

    renderSpecialistPage();
}

async function handleSpecialistClick(event) {
    const viewButton = event.target.closest('[data-specialist-view]');

    if (viewButton) {
        const view = viewButton.dataset.specialistView;

        if (['overview', 'reports', 'sessions', 'notifications'].includes(view)) {
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
            specialistMessage('تعذّر تسجيل الخروج: ' + error.message, 'error');
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

    if (!['low', 'medium', 'high'].includes(riskLevel)) {
        specialistMessage('مستوى الخطورة غير صالح.', 'error');
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'جاري حفظ التقرير...';
    clearSpecialistMessage();

    try {
        const { error } = await specialistContext.client
            .from('reports')
            .insert({
                child_id: childId,
                generated_date: new Date().toISOString(),
                summary: summary,
                risk_level: riskLevel
            });

        if (error) throw error;

        await loadSpecialistData();
        currentView = 'reports';
        renderSpecialistPage();

        specialistMessage('تم حفظ التقرير بنجاح.', 'success');
    } catch (error) {
        console.error('Creating report failed:', error);

        specialistMessage(
            'تعذّر حفظ التقرير: ' + (error.message || 'حدث خطأ غير معروف.'),
            'error'
        );

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
    submitButton.textContent = 'جاري الحفظ...';

    try {
        const saveResult = await addRecommendation(reportId, specialistId, description);

        await loadSpecialistData();
        currentView = 'reports';
        renderSpecialistPage();

        specialistMessage(
            saveResult.notificationCreated
                ? 'تم حفظ التوصية وإشعار ولي الأمر.'
                : 'تم حفظ التوصية، لكن تعذّر إنشاء إشعار لولي الأمر: ' +
                    (saveResult.notificationErrorMessage || 'تحققي من صلاحيات notifications.'),
            saveResult.notificationCreated ? 'success' : 'error'
        );
    } catch (error) {
        console.error('Saving recommendation failed:', error);

        specialistMessage(
            'تعذّر حفظ التوصية: ' +
            (error.message || 'تحققي من صلاحيات.'),
            'error'
        );

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

    specialistApp.addEventListener('input', event => {
        if (event.target.id === 'specialist-report-search') {
            applySpecialistReportFilters();
        }
    });

    specialistApp.addEventListener('change', event => {
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

        // التوصيات تتطلب سجلاً في specialists (مفتاح أجنبي)؛ نتحقق منه مبكراً برسالة واضحة.
        const { data: specialistRow, error: specialistError } = await context.client
            .from('specialists')
            .select('specialist_id, specialization')
            .eq('specialist_id', specialistId)
            .maybeSingle();

        if (specialistError) throw specialistError;

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
                <h3>تعذّر فتح لوحة الأخصائي</h3>
                <p>راجعي الرسالة أعلاه، ثم حدّثي الصفحة أو سجّلي الخروج.</p>
                <button type="button" class="btn-outline btn-logout"
                    data-specialist-action="logout">تسجيل الخروج</button>
            </div>`;
        specialistMessage(error.message || 'تعذّر فتح لوحة الأخصائي.', 'error');
    }
}

window.addEventListener('DOMContentLoaded', initializeSpecialistDashboard);
