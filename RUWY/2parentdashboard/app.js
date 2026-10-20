const $ = id => document.getElementById(id);
const STORY_PAGE = '../3reading/stories.html';

let currentUserId = null;
let childrenCache = [];
let sessionsCache = [];
let reportsCache = [];
let recommendationsCache = [];
let busy = false;

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[character]));

function notify(message, success = false) {
    const notice = $('notice');
    notice.className = 'notice' + (success ? ' ok' : '');
    notice.textContent = message;
}

function ageOf(date) {
    if (!date) return '—';
    const birth = new Date(`${date}T00:00:00`);
    if (Number.isNaN(birth.getTime())) return '—';
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() ||
        (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
    return Math.max(0, age);
}

function duration(session) {
    if (!session.start_time || !session.end_time) return 0;
    const minutes = (new Date(session.end_time) - new Date(session.start_time)) / 60000;
    return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
}

function reportRiskLabel(risk) {
    return ({ low: 'منخفض', medium: 'متوسط', high: 'مرتفع' })[risk] || 'غير محدد';
}

async function init() {
    $('addChildBtn').onclick = $('addChildSecondary').onclick = () => openChild();
    $('closeChild').onclick = $('cancelChild').onclick = () => $('childDialog').close();
    $('closeHistory').onclick = $('doneHistory').onclick = () => $('historyDialog').close();
    $('childForm').onsubmit = saveChild;
    $('logoutBtn').onclick = logout;
    $('childrenList').addEventListener('click', onChildAction);
    $('childBirth').max = new Date().toISOString().slice(0, 10);

    try {
        const context = await window.RUWY_DB.getCurrentContext();
        if (!context) {
            window.location.replace('../1auth/index.html');
            return;
        }
        if (!context.profile) {
            throw new Error('لا يوجد ملف مستخدم مرتبط بهذا الحساب في جدول users.');
        }
        if (context.profile.role !== 'parent') {
            if (context.profile.role === 'specialist') {
                window.location.replace('../5specialist-dashboard/specialist-dashboard.html');
                return;
            }
            throw new Error('هذا القسم مخصص لحساب ولي الأمر.');
        }

        currentUserId = context.profile.user_id;
        $('parentName').textContent = context.profile.name || '';
        $('sideParent').textContent = context.profile.name || '';
        $('modePill').textContent = '';
        await refresh();
    } catch (error) {
        console.error('Parent dashboard initialization failed:', error);
        $('modePill').textContent = 'الاتصال غير مكتمل';
        $('addChildBtn').disabled = true;
        $('addChildSecondary').disabled = true;
        notify(error.message || 'تعذّر الاتصال بقاعدة البيانات.');
        render();
    }
}

async function refresh() {
    const client = window.RUWY_DB.getClient();
    const { data: children, error: childrenError } = await client
        .from('children')
        .select('child_id, name, birth_date, gender, parent_id')
        .eq('parent_id', currentUserId);
    if (childrenError) throw childrenError;
    childrenCache = children || [];

    const childIds = childrenCache.map(child => child.child_id);
    if (childIds.length) {
        const { data: sessions, error: sessionsError } = await client
            .from('reading_sessions')
            .select('session_id, child_id, story_id, start_time, end_time, status')
            .in('child_id', childIds)
            .order('start_time', { ascending: false })
            .limit(100);
        if (sessionsError) throw sessionsError;

        const sessionRows = sessions || [];
        const storyIds = [...new Set(
            sessionRows.map(session => session.story_id).filter(Boolean)
        )];
        let storyTitles = new Map();

        if (storyIds.length) {
            const { data: stories, error: storiesError } = await client
                .from('stories')
                .select('story_id, title')
                .in('story_id', storyIds);
            if (storiesError) throw storiesError;
            storyTitles = new Map((stories || []).map(story => [
                String(story.story_id),
                story.title || ''
            ]));
        }

        sessionsCache = sessionRows.map(session => ({
            ...session,
            stories: { title: storyTitles.get(String(session.story_id)) || '' }
        }));

        const { data: reports, error: reportsError } = await client
            .from('reports')
            .select('report_id, child_id, generated_date, summary, risk_level')
            .in('child_id', childIds)
            .order('generated_date', { ascending: false });
        if (reportsError) throw reportsError;
        reportsCache = reports || [];

        const reportIds = reportsCache.map(report => report.report_id);
        if (reportIds.length) {
            const { data: recommendations, error: recommendationsError } = await client
                .from('recommendations')
                .select('recommendation_id, report_id, specialist_id, description, created_at')
                .in('report_id', reportIds);
            if (recommendationsError) throw recommendationsError;
            recommendationsCache = recommendations || [];
        } else {
            recommendationsCache = [];
        }
    } else {
        sessionsCache = [];
        reportsCache = [];
        recommendationsCache = [];
    }

    render();
}

function render() {
    $('statChildren').textContent = childrenCache.length;
    $('statSessions').textContent = sessionsCache.length;
    $('statMinutes').textContent = sessionsCache.reduce((sum, session) => sum + duration(session), 0);

    $('childrenList').innerHTML = childrenCache.length
        ? childrenCache.map(child => {
            const id = escapeHTML(child.child_id);
            const name = escapeHTML(child.name);
            const firstLetter = escapeHTML(String(child.name || '').charAt(0));
            const count = sessionsCache.filter(session => String(session.child_id) === String(child.child_id)).length;
            return `<article class="child-card">
                <div class="child-top">
                    <div class="avatar">${firstLetter}</div>
                    <div><h3>${name}</h3><p>ملف الطفل</p></div>
                </div>
                <div class="child-tags">
                    <span class="tag">${ageOf(child.birth_date)} سنوات</span>
                    <span class="tag">${child.gender === 'male' ? 'ذكر' : child.gender === 'female' ? 'أنثى' : '—'}</span>
                    <span class="tag">${count} جلسات</span>
                </div>
                <div class="actions">
                    <button type="button" class="primary" data-action="read" data-id="${id}">بدء القراءة ←</button>
                    <button type="button" class="outline" data-action="history" data-id="${id}">السجل</button>
                    <button type="button" class="outline" data-action="edit" data-id="${id}">تعديل</button>
                    <button type="button" class="outline danger" data-action="delete" data-id="${id}">حذف</button>
                </div>
            </article>`;
        }).join('')
        : '<div class="panel empty"><div class="empty-symbol">♧</div><strong>لا يوجد أطفال مسجلون بعد</strong><p>أضيفي ملف الطفل لبدء المتابعة.</p></div>';

    $('sessionsList').innerHTML = sessionsCache.length
        ? sessionsCache.slice(0, 8).map(session => {
            const child = childrenCache.find(item => String(item.child_id) === String(session.child_id));
            const storyTitle = escapeHTML(session.stories?.title || '');
            const date = session.start_time ? new Date(session.start_time).toLocaleDateString('ar-SA') : '—';
            const status = session.status === 'completed' ? 'مكتملة' : session.status === 'cancelled' ? 'ملغاة' : 'قيد التنفيذ';
            return `<div class="session">
                <div><strong>${storyTitle}</strong><small>${escapeHTML(child?.name || '')} · ${date}</small></div>
                <span>${duration(session)} دقيقة</span><span class="status">${status}</span>
            </div>`;
        }).join('')
        : '<div class="empty">لا توجد جلسات قراءة في قاعدة البيانات بعد.</div>';

    $('reportsList').innerHTML = reportsCache.length
        ? reportsCache.map(report => {
            const child = childrenCache.find(item => String(item.child_id) === String(report.child_id));
            const recommendations = recommendationsCache.filter(item => String(item.report_id) === String(report.report_id));
            const recommendationsHTML = recommendations.length
                ? recommendations.map(item => `<div class="recommendation"><strong>توصية الأخصائي:</strong> ${escapeHTML(item.description)}</div>`).join('')
                : '<p class="empty">لم تُسجّل توصية لهذا التقرير بعد.</p>';
            const date = report.generated_date ? new Date(report.generated_date).toLocaleDateString('ar-SA') : '—';
            return `<article class="session report-entry">
                <div><strong>${escapeHTML(child?.name || '')}</strong><small>${date} · مستوى الخطورة: ${escapeHTML(reportRiskLabel(report.risk_level))}</small>
                <p>${escapeHTML(report.summary || '')}</p>${recommendationsHTML}</div>
            </article>`;
        }).join('')
        : '<div class="empty">لا توجد تقارير محفوظة في قاعدة البيانات بعد.</div>';
}

function onChildAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const child = childrenCache.find(item => String(item.child_id) === button.dataset.id);
    if (!child) return;
    if (button.dataset.action === 'read') startReading(child);
    if (button.dataset.action === 'history') showHistory(child);
    if (button.dataset.action === 'edit') openChild(child);
    if (button.dataset.action === 'delete') deleteChild(child);
}

function openChild(child = null) {
    $('childForm').reset();
    $('childId').value = child?.child_id || '';
    $('childName').value = child?.name || '';
    $('childBirth').value = child?.birth_date || '';
    $('childGender').value = child?.gender || 'male';
    $('dialogTitle').textContent = child ? 'تعديل بيانات الطفل' : 'إضافة طفل جديد';
    $('childDialog').showModal();
}

async function saveChild(event) {
    event.preventDefault();
    if (busy) return;

    const id = $('childId').value;
    const name = $('childName').value.trim();
    const birthDate = $('childBirth').value;
    const gender = $('childGender').value;
    const today = new Date().toISOString().slice(0, 10);

    if (!name || name.length > 80 || !birthDate || birthDate > today) {
        notify('تحققي من اسم الطفل وتاريخ الميلاد.');
        return;
    }

    busy = true;
    $('saveChildBtn').disabled = true;
    try {
        const client = window.RUWY_DB.getClient();
        let query;
        if (id) {
            query = client.from('children').update({ name, birth_date: birthDate, gender })
                .eq('child_id', id).eq('parent_id', currentUserId);
        } else {
            query = client.from('children').insert({ name, birth_date: birthDate, gender, parent_id: currentUserId });
        }
        const { error } = await query;
        if (error) throw error;
        $('childDialog').close();
        notify('تم حفظ بيانات الطفل في قاعدة البيانات.', true);
        await refresh();
    } catch (error) {
        console.error('Save child failed:', error);
        notify('تعذّر حفظ البيانات: ' + error.message);
    } finally {
        busy = false;
        $('saveChildBtn').disabled = false;
    }
}

async function deleteChild(child) {
    if (!confirm(`هل تريدين حذف ملف ${child.name}؟ قد تمنع العلاقات في قاعدة البيانات هذا الحذف.`)) return;
    try {
        const { error } = await window.RUWY_DB.getClient().from('children')
            .delete().eq('child_id', child.child_id).eq('parent_id', currentUserId);
        if (error) throw error;
        notify('تم حذف ملف الطفل من قاعدة البيانات.', true);
        await refresh();
    } catch (error) {
        console.error('Delete child failed:', error);
        notify('تعذّر حذف الملف: ' + error.message);
    }
}

function showHistory(child) {
    $('historyTitle').textContent = 'سجل قراءة ' + child.name;
    const childSessions = sessionsCache.filter(session => String(session.child_id) === String(child.child_id));
    $('historyList').innerHTML = childSessions.length
        ? childSessions.map(session => {
            const title = escapeHTML(session.stories?.title || '');
            const date = session.start_time ? new Date(session.start_time).toLocaleDateString('ar-SA') : '—';
            return `<div class="session"><div><strong>${title}</strong><small>${date}</small></div><span>${duration(session)} دقيقة</span></div>`;
        }).join('')
        : '<p>لا توجد جلسات قراءة مسجلة لهذا الطفل في قاعدة البيانات.</p>';
    $('historyDialog').showModal();
}

function startReading(child) {
    window.location.href = `${STORY_PAGE}?child=${encodeURIComponent(child.child_id)}`;
}

async function logout() {
    try {
        await window.RUWY_DB.signOut();
    } catch (error) {
        console.error('Logout failed:', error);
    }
    window.location.replace('../1auth/index.html');
}

window.addEventListener('DOMContentLoaded', init);
