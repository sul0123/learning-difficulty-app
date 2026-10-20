
const params = new URLSearchParams(window.location.search);
const childId = params.get('child');

const levelNames = {
    easy: 'سهل',
    medium: 'متوسط',
    hard: 'صعب'
};

let stories = [];

function showMessage(text) {
    const message = document.getElementById('message');

    if (message) {
        message.textContent = text;
        message.style.display = 'block';
    }

    console.log(text);
}

function ageMatches(ageGroup, selectedAge) {
    if (!selectedAge) return true;

    const range = String(ageGroup ?? '').match(/(\d+)\s*[-–—]\s*(\d+)/);

    if (range) {
        return Number(selectedAge) >= Number(range[1]) &&
            Number(selectedAge) <= Number(range[2]);
    }

    return Number(ageGroup) === Number(selectedAge);
}

function showStory(story, storiesList) {
    const card = document.createElement('article');
    card.className = 'story-card';

    const title = document.createElement('h2');
    title.textContent = story.title || 'قصة بدون عنوان';

    const age = document.createElement('p');
    age.textContent = 'العمر المناسب: ' + (story.age_group || '—');

    const level = document.createElement('p');
    level.textContent =
        'مستوى الصعوبة: ' + (levelNames[story.difficulty_level] || '—');

    let pages = story.pages;

    if (typeof pages === 'string') {
        try {
            pages = JSON.parse(pages);
        } catch {
            pages = [];
        }
    }

    if (!Array.isArray(pages) && Array.isArray(pages?.pages)) {
        pages = pages.pages;
    }

    if (!Array.isArray(pages)) {
        pages = [];
    }

    const pageCount = document.createElement('p');
    pageCount.textContent = 'عدد الصفحات: ' + pages.length;

    const link = document.createElement('a');
    link.className = 'story-link';
    link.textContent = 'ابدأ القصة';

    const readerUrl = new URL('reader.html', window.location.href);
    readerUrl.searchParams.set('story', story.story_id);
    readerUrl.searchParams.set('child', childId);

    link.href = readerUrl.href;

    card.append(title, age, level, pageCount, link);
    storiesList.appendChild(card);
}

function renderStories() {
    const storiesList = document.getElementById('stories-list');
    const ageFilter = document.getElementById('age-filter');
    const levelFilter = document.getElementById('level-filter');

    if (!storiesList) {
        showMessage('خطأ: لم يتم العثور على عنصر stories-list في ملف HTML.');
        return;
    }

    storiesList.replaceChildren();

    const selectedAge = ageFilter?.value || '';
    const selectedLevel = levelFilter?.value || '';

    const filteredStories = stories.filter(function (story) {
        return ageMatches(story.age_group, selectedAge) &&
            (!selectedLevel || story.difficulty_level === selectedLevel);
    });

    if (filteredStories.length === 0) {
        showMessage(
            stories.length === 0
                ? 'لا توجد قصص متاحة حاليًا.'
                : 'لا توجد قصص مطابقة للفلاتر المحددة.'
        );
        return;
    }

    showMessage('عدد القصص المتاحة: ' + filteredStories.length);

    filteredStories.forEach(function (story) {
        showStory(story, storiesList);
    });
}

async function initStories() {
    showMessage('جاري تحميل القصص...');

    try {
        if (!document.getElementById('stories-list')) {
            throw new Error(
                'لم يتم العثور على عنصر stories-list. تأكدي من مطابقته في ملف HTML.'
            );
        }

        if (!window.RUWY_DB ||
            typeof window.RUWY_DB.getCurrentContext !== 'function') {
            throw new Error(
                'لم يتم تحميل database.js بشكل صحيح. تأكدي من مسار الملف وترتيب script.'
            );
        }

        const context = await window.RUWY_DB.getCurrentContext();

        if (!context) {
            window.location.replace('../1auth/index.html');
            return;
        }

        if (!context.profile || context.profile.role !== 'parent') {
            if (context.profile?.role === 'specialist') {
                window.location.replace('../5specialist-dashboard/specialist-dashboard.html');
                return;
            }

            throw new Error(
                'لم يتم العثور على ملف ولي الأمر في جدول users.'
            );
        }

        if (!childId) {
            showMessage('اختاري الطفل من لوحة ولي الأمر أولًا.');
            return;
        }

        const client = context.client;

        const { data: child, error: childError } = await client
            .from('children')
            .select('child_id')
            .eq('child_id', childId)
            .eq('parent_id', context.profile.user_id)
            .maybeSingle();

        if (childError) throw childError;

        if (!child) {
            throw new Error(
                'لم يتم العثور على الطفل أو أنه غير مرتبط بحساب ولي الأمر الحالي.'
            );
        }

        const { data, error } = await client
            .from('stories')
            .select('story_id, title, age_group, difficulty_level, pages')
            .order('story_id', { ascending: true });

        if (error) throw error;

        stories = data || [];
        renderStories();

    } catch (error) {
        console.error('Loading stories failed:', error);
        showMessage(
            'تعذّر تحميل القصص: ' + (error.message || 'خطأ غير معروف')
        );
    }
}

function startStoriesPage() {
    const ageFilter = document.getElementById('age-filter');
    const levelFilter = document.getElementById('level-filter');

    if (ageFilter) {
        ageFilter.addEventListener('change', renderStories);
    }

    if (levelFilter) {
        levelFilter.addEventListener('change', renderStories);
    }

    initStories();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startStoriesPage);
} else {
    startStoriesPage();
}
