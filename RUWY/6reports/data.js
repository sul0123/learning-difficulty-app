const ALLOWED_TABLES = new Set([
    'users',
    'children',
    'reading_sessions',
    'analysis_results',
    'reports',
    'recommendations',
    'notifications'
]);

function isConnected() {
    return Boolean(window.RUWY_DB && window.RUWY_DB.isConfigured());
}

function getDatabaseClient() {
    if (!window.RUWY_DB) throw new Error('ملف database.js غير محمّل.');
    return window.RUWY_DB.getClient();
}

async function getTable(table) {
    if (!ALLOWED_TABLES.has(table)) throw new Error('اسم جدول غير مسموح به: ' + table);
    const { data, error } = await getDatabaseClient().from(table).select('*');
    if (error) throw error;
    return data || [];
}

async function insertRow(table, row) {
    if (!ALLOWED_TABLES.has(table)) throw new Error('اسم جدول غير مسموح به: ' + table);
    const { data, error } = await getDatabaseClient().from(table).insert(row).select('*').single();
    if (error) throw error;
    return data;
}

async function markNotificationsRead(userId) {
    const { error } = await getDatabaseClient().from('notifications')
        .update({ status: 'read' })
        .eq('user_id', userId)
        .neq('status', 'read');
    if (error) throw error;
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ar-SA-u-ca-gregory');
}

function escapeHTML(value) {
    const element = document.createElement('span');
    element.textContent = String(value ?? '');
    return element.innerHTML;
}

function fmt(value) {
    return value === null || value === undefined || value === '' ? '—' : value;
}

const RISK_LABELS = { low: 'منخفض', medium: 'متوسط', high: 'مرتفع' };
function riskLabel(risk) {
    return RISK_LABELS[risk] || 'غير محدد';
}

async function addRecommendation(reportId, specialistId, description) {
    const cleanDescription = String(description || '').trim();
    if (!cleanDescription) throw new Error('اكتبي التوصية أولاً.');

    const recommendation = await insertRow('recommendations', {
        report_id: reportId,
        specialist_id: specialistId,
        description: cleanDescription,
        created_at: new Date().toISOString()
    });

    let notificationCreated = false;
    let notificationErrorMessage = '';

    try {
        const client = getDatabaseClient();
        const { data: report, error: reportError } = await client
            .from('reports')
            .select('report_id, child_id')
            .eq('report_id', reportId)
            .single();
        if (reportError) throw reportError;

        const { data: child, error: childError } = await client
            .from('children')
            .select('child_id, parent_id')
            .eq('child_id', report.child_id)
            .single();
        if (childError) throw childError;

        const { error } = await client.from('notifications').insert({
            user_id: child.parent_id,
            message: 'أضاف الأخصائي توصية جديدة على تقرير القراءة.',
            date_sent: new Date().toISOString(),
            status: 'sent'
        });
        if (error) throw error;
        notificationCreated = true;
    } catch (error) {
        notificationErrorMessage = error.message || 'تعذّر إنشاء الإشعار.';
        console.error(
            'Recommendation was saved, but the parent notification failed:',
            error
        );
    }

    return {
        recommendation,
        notificationCreated,
        notificationErrorMessage
    };
}
