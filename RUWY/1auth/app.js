function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(function (button) {
        button.classList.toggle('active', button.id === (tab === 'login' ? 'tab-login' : 'tab-signup'));
    });

    document.querySelectorAll('.auth-form').forEach(function (form) {
        form.classList.toggle('active', form.id === (tab === 'login' ? 'login-form' : 'signup-form'));
    });

    showAuthMessage('');
}

function showAuthMessage(message, isSuccess) {
    const element = document.getElementById('auth-message');
    element.textContent = message;
    element.className = isSuccess ? 'success-message' : 'error-message';
}

function showUserHome(role) {
    if (role === 'parent') {
        window.location.replace(
            '../2parentdashboard/parent_dashboard.html'
        );
        return;
    }

    if (role === 'specialist') {
        window.location.replace(
            '../5specialist-dashboard/specialist-dashboard.html'
        );
        return;
    }

    throw new Error(
        'نوع الحساب غير معروف. تواصلي مع مسؤول النظام.'
    );
}

function getSupabaseClient() {
    if (!window.RUWY_DB) {
        throw new Error('ملف اتصال قاعدة البيانات غير محمّل.');
    }

    return window.RUWY_DB.getClient();
}

document.getElementById('login-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const submitButton = this.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    try {
        const client = getSupabaseClient();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const context = await window.RUWY_DB.getCurrentContext({ createParentProfile: true });
        if (!context || !context.profile) {
            throw new Error('لم يتم العثور على ملف المستخدم في جدول users.');
        }

        showUserHome(context.profile.role);
    } catch (error) {
        console.error('Login failed:', error);
        showAuthMessage(error.message || 'تعذّر تسجيل الدخول. تحققي من بيانات الحساب وإعدادات الاتصال.');
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById('signup-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    const submitButton = this.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;

    try {
        if (!name) throw new Error('اكتبي الاسم الكامل.');
        if (password.length < 8) throw new Error('كلمة المرور يجب أن تكون 8 خانات على الأقل.');
        if (!/(?=.*[A-Za-z])(?=.*\d)/.test(password)) {
            throw new Error('كلمة المرور يجب أن تحتوي على أحرف إنجليزية وأرقام معاً.');
        }
        if (password !== confirmPassword) throw new Error('كلمتا المرور غير متطابقتين.');

        const client = getSupabaseClient();
        const { data, error } = await client.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } }
        });

        if (error) throw error;

        if (data.session) {
            const context = await window.RUWY_DB.getCurrentContext({ createParentProfile: true });
            if (!context || !context.profile) {
                throw new Error('تم إنشاء حساب الدخول، لكن لم يُنشأ ملف المستخدم في قاعدة البيانات. راجعي سياسات RLS وجدول users.');
            }
            showUserHome(context.profile.role);
            return;
        }

        this.reset();
        switchTab('login');
        showAuthMessage(
            'تم إرسال طلب إنشاء الحساب. أكّدي البريد الإلكتروني ثم سجّلي الدخول لإكمال ملفك.',
            true
        );
    } catch (error) {
        console.error('Signup failed:', error);
        showAuthMessage(error.message || 'تعذّر إنشاء الحساب.');
    } finally {
        submitButton.disabled = false;
    }
});

switchTab('login');
