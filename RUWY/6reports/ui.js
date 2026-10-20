
let currentUserId = null;
let currentSpecialistId = null;
let currentUserName = '';
let currentRole = null;
let currentView = 'specialist';

function levelClass(risk) {
    if (risk === 'low') return 'level-good';
    if (risk === 'medium') return 'level-mid';
    if (risk === 'high') return 'level-low';
    return '';
}

function emptyBox(text) {
    return '<div class="card empty-box">' +
        escapeHTML(text) +
        '</div>';
}

function statBox(number, label) {
    return '<div class="col-4">' +
        '<div class="card text-center p-3">' +
        '<div class="stat-number">' + escapeHTML(number) + '</div>' +
        '<div class="stat-label">' + escapeHTML(label) + '</div>' +
        '</div></div>';
}

function childName(children, childId) {
    const child = children.find(function (item) {
        return String(item.child_id) === String(childId);
    });

    return child ? child.name : 'غير معروف';
}

function recommendationsHTML(recommendations, reportId) {
    const reportRecommendations = recommendations.filter(function (item) {
        return String(item.report_id) === String(reportId);
    });

    if (!reportRecommendations.length) {
        return '<div class="recommendation mt-3">' +
            '<small class="text-muted">لا توجد توصيات محفوظة لهذا التقرير بعد.</small>' +
            '</div>';
    }

    return reportRecommendations.map(function (item) {
        return '<div class="recommendation mt-3">' +
            '<b>توصية الأخصائي:</b> ' +
            escapeHTML(item.description) +
            '<div><small class="text-muted">' +
            escapeHTML(formatDate(item.created_at)) +
            '</small></div></div>';
    }).join('');
}

async function navbarHTML() {
    const notifications = await getTable('notifications');

    const unread = notifications.filter(function (item) {
        return String(item.user_id) === String(currentUserId) &&
            item.status !== 'read';
    }).length;

    return '<nav class="navbar-custom py-3">' +
        '<div class="container d-flex justify-content-between">' +
        '<span class="navbar-brand">روي | لوحة الأخصائي</span>' +
        '<span>' +
        '<a href="#" class="ms-3" data-action="dashboard">لوحة التحكم</a>' +
        '<a href="#" class="ms-3" data-action="notifications">الإشعارات (' +
        unread + ')</a>' +
        '<a href="#" class="ms-3" data-action="logout">تسجيل الخروج</a>' +
        '</span></div></nav>';
}

async function specialistView() {
    const reports = await getTable('reports');
    const children = await getTable('children');
    const recommendations = await getTable('recommendations');

    const myRecommendations = recommendations.filter(function (item) {
        return String(item.specialist_id) === String(currentSpecialistId);
    });

    const urgent = reports.filter(function (report) {
        return report.risk_level === 'high';
    }).length;

    let html = '<div class="mb-4">' +
        '<h2>مرحباً ' + escapeHTML(currentUserName) + '</h2>' +
        '<p class="text-muted">راجعي تقارير القراءة ونتائج التحليل، ' +
        'ثم أضيفي التوصيات المناسبة لأولياء الأمور.</p>' +
        '</div>';

    html += '<div class="row g-3 mb-4">' +
        statBox(reports.length, 'التقارير المتاحة') +
        statBox(urgent, 'مستوى خطورة مرتفع') +
        statBox(myRecommendations.length, 'التوصيات المحفوظة') +
        '</div>';

    html += '<h2 class="mb-3">تقارير القراءة</h2>';

    if (!reports.length) {
        return html + emptyBox(
            'لا توجد تقارير محفوظة في قاعدة البيانات حتى الآن.'
        );
    }

    reports.sort(function (a, b) {
        return new Date(b.generated_date || 0) -
            new Date(a.generated_date || 0);
    });

    reports.forEach(function (report) {
        const reportId = escapeHTML(report.report_id);
        const risk = report.risk_level;

        html += '<article class="card p-3 mb-3 report-card ' +
            levelClass(risk) + '">';

        html += '<div class="d-flex justify-content-between align-items-center">' +
            '<div>' +
            '<h5 class="mb-1">' +
            escapeHTML(childName(children, report.child_id)) +
            '</h5>' +
            '<small class="text-muted">تاريخ التقرير: ' +
            escapeHTML(formatDate(report.generated_date)) +
            '</small>' +
            '</div>' +
            '<span class="badge ' + levelClass(risk) + '">' +
            escapeHTML(riskLabel(risk)) +
            '</span>' +
            '</div>';

        html += '<hr>';

        html += '<div class="mb-3">' +
            '<h6>ملخص التحليل</h6>' +
            '<p class="mb-0">' +
            escapeHTML(report.summary || 'لا يوجد ملخص محفوظ لهذا التقرير.') +
            '</p>' +
            '</div>';

        html += '<div class="mb-3">' +
            '<h6>التوصيات السابقة</h6>' +
            recommendationsHTML(recommendations, report.report_id) +
            '</div>';

        html += '<div class="mt-2">' +
            '<label class="form-label" for="recommendation-' + reportId + '">' +
            'إضافة توصية جديدة' +
            '</label>' +
            '<textarea id="recommendation-' + reportId + '"' +
            ' class="form-control" rows="3"' +
            ' data-recommendation-input' +
            ' placeholder="اكتبي التوصية المناسبة بناءً على نتائج التقرير"></textarea>' +
            '</div>';

        html += '<div class="mt-3">' +
            '<button type="button" class="btn btn-main"' +
            ' data-action="send-recommendation"' +
            ' data-report-id="' + reportId + '">' +
            'حفظ التوصية وإشعار ولي الأمر' +
            '</button>' +
            '</div>';

        html += '</article>';
    });

    return html;
}

async function notificationsView() {
    const notifications = await getTable('notifications');

    const ownNotifications = notifications
        .filter(function (item) {
            return String(item.user_id) === String(currentUserId);
        })
        .sort(function (a, b) {
            return new Date(b.date_sent || 0) -
                new Date(a.date_sent || 0);
        });

    let html = '<h2 class="mb-3">الإشعارات</h2>';

    if (!ownNotifications.length) {
        return html + emptyBox('لا توجد إشعارات محفوظة لهذا الحساب.');
    }

    ownNotifications.forEach(function (notification) {
        html += '<div class="card p-3 mb-3">' +
            '<div>' + escapeHTML(notification.message || '') + '</div>' +
            '<small class="text-muted mt-2">' +
            escapeHTML(formatDate(notification.date_sent)) +
            '</small>' +
            '</div>';
    });

    return html;
}

async function render() {
    const app = document.getElementById('app');

    try {
        document.getElementById('top').innerHTML = await navbarHTML();

        if (currentView === 'notifications') {
            app.innerHTML = await notificationsView();

            await markNotificationsRead(currentUserId);

            document.getElementById('top').innerHTML = await navbarHTML();
        } else {
            app.innerHTML = await specialistView();
        }
    } catch (error) {
        console.error('Rendering specialist dashboard failed:', error);

        app.innerHTML =
            '<div class="alert alert-danger">' +
            escapeHTML(
                error.message ||
                'تعذّر تحميل البيانات من قاعدة البيانات.'
            ) +
            '</div>';
    }
}

async function handleAction(event) {
    const button = event.target.closest('[data-action]');

    if (!button) return;

    event.preventDefault();

    const action = button.dataset.action;

    if (action === 'dashboard') {
        currentView = 'specialist';
        await render();
        return;
    }

    if (action === 'notifications') {
        currentView = 'notifications';
        await render();
        return;
    }

    if (action === 'logout') {
        try {
            await window.RUWY_DB.signOut();
        } catch (error) {
            console.error('Sign out failed:', error);
        }

        window.location.replace('../1auth/index.html');
        return;
    }

    if (action === 'send-recommendation') {
        const card = button.closest('.report-card');
        const input = card?.querySelector('[data-recommendation-input]');
        const description = input?.value.trim();
        const reportId = button.dataset.reportId;

        if (!description) {
            alert('اكتبي التوصية أولاً.');
            return;
        }

        button.disabled = true;

        try {
            const saveResult = await addRecommendation(
                Number(reportId),
                currentSpecialistId,
                description
            );

            alert(saveResult.notificationCreated
                ? 'تم حفظ التوصية وإشعار ولي الأمر.'
                : 'تم حفظ التوصية، لكن تعذّر إنشاء إشعار لولي الأمر: ' +
                    (saveResult.notificationErrorMessage || 'تحققي من صلاحيات notifications.'));

            await render();
        } catch (error) {
            console.error('Saving recommendation failed:', error);

            alert(
                'تعذّر حفظ التوصية: ' +
                (error.message || 'حدث خطأ غير معروف.')
            );
        } finally {
            button.disabled = false;
        }
    }
}

async function initReports() {
    document.getElementById('app').addEventListener('click', handleAction);
    document.getElementById('top').addEventListener('click', handleAction);

    try {
        const context = await window.RUWY_DB.getCurrentContext();

        if (!context) {
            window.location.replace('../1auth/index.html');
            return;
        }

        if (!context.profile) {
            throw new Error(
                'لا يوجد ملف مستخدم لهذا الحساب في جدول users.'
            );
        }

        if (context.profile.role === 'parent') {
            window.location.replace('../2parentdashboard/parent_dashboard.html');
            return;
        }

        if (context.profile.role !== 'specialist') {
            throw new Error('هذه الصفحة مخصصة لحساب الأخصائي.');
        }

        const numericUserId = Number(context.profile.user_id);

        if (!Number.isSafeInteger(numericUserId) || numericUserId <= 0) {
            throw new Error(
                'معرّف المستخدم في جدول users ليس رقماً صحيحاً.'
            );
        }

        currentUserId = numericUserId;
        currentUserName = context.profile.name || '';
        currentRole = context.profile.role;

        const client = getDatabaseClient();

        const { data: specialist, error: specialistError } = await client
            .from('specialists')
            .select('specialist_id')
            .eq('specialist_id', currentUserId)
            .maybeSingle();

        if (specialistError) throw specialistError;

        if (!specialist) {
            throw new Error(
                'لم يتم العثور على سجل الأخصائي. تأكدي من وجود سجل في specialists ' +
                'حيث specialist_id يساوي ' + currentUserId + '.'
            );
        }

        currentSpecialistId = Number(specialist.specialist_id);

        await render();
    } catch (error) {
        console.error('Specialist dashboard initialization failed:', error);

        document.getElementById('app').innerHTML =
            '<div class="alert alert-danger">' +
            escapeHTML(
                error.message ||
                'تعذّر الاتصال بقاعدة البيانات.'
            ) +
            '</div>';
    }
}

window.addEventListener('DOMContentLoaded', initReports);
