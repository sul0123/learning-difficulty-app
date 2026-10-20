(function () {

    const config = {
        supabaseUrl: 'https://rouduiebiotpqzqaiupy.supabase.co',
        supabaseAnonKey: 'sb_publishable_CNs3fCFyYCULKy6lPOd4pg_ezBvKOty',
        recordingBucket: 'ruwy-recordings'
    };

    let supabaseClient = null;

    function isConfigured() {
        return Boolean(config.supabaseUrl && config.supabaseAnonKey);
    }

    function getClient() {
        if (!window.supabase) {
            throw new Error('تعذّر تحميل مكتبة Supabase. تحققي من اتصال الإنترنت.');
        }

        if (!isConfigured()) {
            throw new Error('إعدادات اتصال قاعدة البيانات غير مكتملة في database.js.');
        }

        if (!supabaseClient) {
            supabaseClient = window.supabase.createClient(
                config.supabaseUrl,
                config.supabaseAnonKey
            );
        }

        return supabaseClient;
    }

    async function getCurrentContext(options = {}) {
        const client = getClient();

        const { data: authData, error: authError } = await client.auth.getUser();
        if (authError) throw authError;

        const user = authData.user;
        if (!user) return null;

        const { data: profile, error: profileError } = await client
            .from('users')
            .select('user_id, auth_user_id, name, email, role')
            .eq('auth_user_id', user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (!profile && options.createParentProfile) {
            const name = String(user.user_metadata?.full_name || user.user_metadata?.name || '').trim();

            if (!name) {
                throw new Error('حسابك لا يحتوي على اسم. أضيفي اسمك إلى بيانات الحساب أو تواصلي مع مسؤول النظام.');
            }

            const { data: newProfile, error: createError } = await client
                .from('users')
                .insert({
                    auth_user_id: user.id,
                    name: name,
                    email: String(user.email || '').trim().toLowerCase(),
                    role: 'parent'
                })
                .select('user_id, auth_user_id, name, email, role')
                .single();

            if (createError) throw createError;

            return { client, user, profile: newProfile };
        }

        return { client, user, profile };
    }

    async function signOut() {
        const { error } = await getClient().auth.signOut();
        if (error) throw error;
    }

    async function uploadRecording({ sessionId, mediaType, blob, durationSeconds }) {

        const context = await getCurrentContext();

        if (!context) {
            throw new Error('يرجى تسجيل الدخول أولاً.');
        }
        if (!context.profile) {
            throw new Error('لم يتم ربط حسابك بسجل المستخدم في قاعدة البيانات.');
        }
        if (context.profile.role !== 'parent') {
            throw new Error('حفظ تسجيلات القراءة متاح لحساب ولي الأمر فقط.');
        }

        const client = context.client;
        const bucket = config.recordingBucket;
        const userId = String(context.profile.user_id);
        const session = String(sessionId);

        if (!bucket) {
            throw new Error('حفظ التسجيلات غير مفعّل. تحققي من اسم Storage bucket في database.js.');
        }
        if (!/^[1-9]\d*$/.test(session)) {
            throw new Error('معرّف جلسة القراءة غير صالح.');
        }
        if (!/^[1-9]\d*$/.test(userId)) {
            throw new Error('معرّف المستخدم الرقمي غير موجود أو غير صالح.');
        }
        if (!blob || !blob.size) {
            throw new Error('ملف التسجيل فارغ. حاولي التسجيل لمدة أطول.');
        }
        if (mediaType !== 'audio' && mediaType !== 'video') {
            throw new Error('نوع التسجيل غير صالح.');
        }

        const duration = Number(durationSeconds);
        if (!(duration > 0)) {
            throw new Error('مدة التسجيل غير صالحة.');
        }

        const { data: sessionRow, error: sessionError } = await client
            .from('reading_sessions')
            .select('session_id, child_id')
            .eq('session_id', session)
            .maybeSingle();

        if (sessionError) throw sessionError;
        if (!sessionRow) {
            throw new Error('لم يتم العثور على جلسة القراءة في قاعدة البيانات.');
        }

        const { data: child, error: childError } = await client
            .from('children')
            .select('child_id')
            .eq('child_id', sessionRow.child_id)
            .eq('parent_id', userId)
            .maybeSingle();

        if (childError) throw childError;
        if (!child) {
            throw new Error('لا يمكن حفظ التسجيل لأن جلسة القراءة لا تتبع حسابك.');
        }

        if (!window.crypto || !window.crypto.randomUUID) {
            throw new Error('تعذّر إنشاء اسم آمن لملف التسجيل. افتحي الموقع عبر HTTPS أو localhost.');
        }

        const path = userId + '/' + session + '/' + window.crypto.randomUUID() + '.webm';

        const { error: uploadError } = await client.storage
            .from(bucket)
            .upload(path, blob, {
                contentType: blob.type || mediaType + '/webm',
                upsert: false
            });

        if (uploadError) throw uploadError;

        const table = mediaType === 'video' ? 'video_recordings' : 'audio_recordings';

        const { data: savedRecording, error: rowError } = await client
            .from(table)
            .insert({
                session_id: Number(session),
                file_path: path,
                duration: Math.max(1, Math.round(duration))
            })
            .select('recording_id, session_id, file_path, duration')
            .single();

        if (rowError) {
            await client.storage.from(bucket).remove([path]);
            throw rowError;
        }

        return savedRecording;
    }

    window.RUWY_DB = {
        config,
        isConfigured,
        getClient,
        getCurrentContext,
        signOut,
        uploadRecording
    };

})();
