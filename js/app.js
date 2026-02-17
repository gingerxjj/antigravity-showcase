/**
 * Antigravity 应用展示 - 前端逻辑
 * 加载 JSON 数据，支持按分类/来源/搜索/排序筛选
 */

(function () {
    'use strict';

    let allItems = [];
    let filteredItems = [];
    let currentCategory = 'all';
    let currentSource = 'all';
    let currentSort = 'stars';
    let searchQuery = '';

    const $grid = document.getElementById('cardGrid');
    const $loading = document.getElementById('loading');
    const $empty = document.getElementById('emptyState');
    const $categoryFilters = document.getElementById('categoryFilters');
    const $sourceFilters = document.getElementById('sourceFilters');
    const $sortFilters = document.getElementById('sortFilters');
    const $searchInput = document.getElementById('searchInput');
    const $updateTime = document.getElementById('updateTime');
    const $totalCount = document.getElementById('totalCount');
    const $resultCount = document.getElementById('resultCount');
    const $resetBtn = document.getElementById('resetBtn');

    const SOURCE_ICONS = {
        'GitHub': '📦', 'Reddit': '💬', 'Dev.to': '📝',
        'Hacker News': '🔶', 'Product Hunt': '🚀', 'V2EX': '🇨🇳', 'Gitee': '🇨🇳',
    };

    const SOURCE_URLS = {
        'GitHub': 'https://github.com',
        'Reddit': 'https://reddit.com/r/google_antigravity',
        'Dev.to': 'https://dev.to/t/antigravity',
        'Hacker News': 'https://news.ycombinator.com',
        'V2EX': 'https://v2ex.com',
        'Gitee': 'https://gitee.com',
    };

    // ============ 加载数据 ============
    async function loadData() {
        try {
            const resp = await window.fetch('data/apps.json');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            allItems = data.items || [];

            if (data.lastUpdated) {
                const d = new Date(data.lastUpdated);
                $updateTime.textContent = `最后更新: ${d.toLocaleDateString('zh-CN')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
            }
            $totalCount.textContent = `共 ${allItems.length} 个应用`;

            buildCategoryFilters(data.categories || []);
            buildSourceFilters(data.sources || []);
            applyFilters();
            $loading.style.display = 'none';
        } catch (e) {
            console.error('加载数据失败:', e);
            $loading.innerHTML = `
        <span style="font-size:2rem">⚠️</span>
        <p style="margin-top:16px">数据加载失败</p>
        <p style="font-size:0.8rem;color:var(--text-muted);margin-top:8px">
          请先运行 <code>node scripts/fetch-data.js</code> 采集数据
        </p>
      `;
        }
    }

    // ============ 构建筛选按钮 ============
    function buildCategoryFilters(categories) {
        const counts = {};
        allItems.forEach(item => {
            const c = item.categoryLabel || '其他';
            counts[c] = (counts[c] || 0) + 1;
        });
        const allBtn = $categoryFilters.querySelector('[data-category="all"]');
        allBtn.textContent = `全部 (${allItems.length})`;

        categories.forEach(cat => {
            const count = counts[cat] || 0;
            if (count === 0) return;
            const btn = document.createElement('button');
            btn.className = 'pill';
            btn.dataset.category = cat;
            btn.textContent = `${cat} (${count})`;
            $categoryFilters.appendChild(btn);
        });
    }

    function buildSourceFilters(sources) {
        const counts = {};
        allItems.forEach(item => { counts[item.source] = (counts[item.source] || 0) + 1; });
        const allBtn = $sourceFilters.querySelector('[data-source="all"]');
        allBtn.textContent = `全部`;

        sources.forEach(source => {
            const count = counts[source] || 0;
            if (count === 0) return;
            const btn = document.createElement('button');
            btn.className = 'pill';
            btn.dataset.source = source;
            btn.textContent = `${SOURCE_ICONS[source] || '📌'} ${source} (${count})`;
            $sourceFilters.appendChild(btn);
        });
    }

    // ============ 筛选 ============
    function applyFilters() {
        filteredItems = allItems.filter(item => {
            if (currentCategory !== 'all' && item.categoryLabel !== currentCategory) return false;
            if (currentSource !== 'all' && item.source !== currentSource) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const match = [item.name, item.nameZh, item.description, item.summary, item.summaryZh, ...(item.tags || []), item.categoryLabel]
                    .filter(Boolean).some(s => s.toLowerCase().includes(q));
                if (!match) return false;
            }
            return true;
        });

        filteredItems.sort((a, b) => {
            if (currentSort === 'stars') return (b.stars || 0) - (a.stars || 0);
            if (currentSort === 'date') return (b.date || '').localeCompare(a.date || '');
            if (currentSort === 'beginner') return (b.beginnerScore || 0) - (a.beginnerScore || 0);
            return 0;
        });

        renderCards();
        $resultCount.textContent = `显示 ${filteredItems.length} / ${allItems.length}`;
        $empty.classList.toggle('hidden', filteredItems.length > 0);
    }

    // ============ 渲染卡片 ============
    function renderCards() {
        const existingCards = $grid.querySelectorAll('.card');
        existingCards.forEach(c => c.remove());
        const fragment = document.createDocumentFragment();

        filteredItems.forEach((item, index) => {
            const card = document.createElement('a');
            card.className = 'card';
            card.href = item.url || '#';
            card.target = '_blank';
            card.rel = 'noopener noreferrer';
            card.dataset.source = item.source;
            card.style.animationDelay = `${Math.min(index * 0.025, 0.5)}s`;

            // 分类标签
            const categoryTag = item.categoryLabel
                ? `<span class="category-tag" data-cat="${item.categoryId || ''}">${item.categoryLabel}</span>`
                : '';

            // 技术标签
            const techTags = (item.tags || []).slice(0, 3).map(tag => {
                return `<span class="tag">${escapeHtml(tag)}</span>`;
            }).join('');

            // 热度等级
            const starsVal = item.stars || 0;
            let heatLevel = 'cold';
            if (starsVal > 5000) heatLevel = 'fire';
            else if (starsVal > 1000) heatLevel = 'hot';
            else if (starsVal > 100) heatLevel = 'warm';

            const starsDisplay = starsVal > 0
                ? `<span class="stat heat-${heatLevel}">⭐ ${formatNumber(starsVal)}</span>`
                : '';

            const commentsDisplay = item.comments > 0
                ? `<span class="stat">💬 ${item.comments}</span>`
                : '';

            // 标题：使用精短中文标题（5-15字核心概括）
            const displayTitle = item.titleZh || item.name || '未命名';
            // 原始仓库名作为灰色副标题
            const repoName = item.name || '';
            // 描述：中文翻译的完整摘要（展示应用成果）
            const desc = item.summaryZh || item.summary || item.description || '';

            // 来源信息（突出显示）
            const sourceUrl = SOURCE_URLS[item.source] || '#';
            const sourceSection = `
              <div class="card-source-info">
                <span class="source-icon-big">${SOURCE_ICONS[item.source] || '📌'}</span>
                <span class="source-text">来自 <strong>${item.source}</strong></span>
                ${item.author ? `<span class="source-author">by ${escapeHtml(item.author)}</span>` : ''}
              </div>`;

            // 热门评论
            let commentsSection = '';
            if (item.topComments && item.topComments.length > 0) {
                const commentHtml = item.topComments.map(c => {
                    const text = c.textZh || c.text;
                    return `<div class="comment-item">
                      <span class="comment-author">${escapeHtml(c.author)}</span>
                      <span class="comment-text">${escapeHtml(text.slice(0, 120))}${text.length > 120 ? '…' : ''}</span>
                    </div>`;
                }).join('');
                commentsSection = `
                  <div class="card-comments">
                    <div class="comments-header">💬 热门评论</div>
                    ${commentHtml}
                  </div>`;
            }

            // 新手参考推荐
            let beginnerSection = '';
            if (item.beginnerLevel) {
                const scoreColor = item.beginnerScore >= 80 ? 'score-high'
                    : item.beginnerScore >= 60 ? 'score-mid'
                        : item.beginnerScore >= 40 ? 'score-low'
                            : 'score-muted';
                beginnerSection = `
                  <div class="card-beginner ${scoreColor}">
                    <span class="beginner-emoji">${item.beginnerEmoji}</span>
                    <span class="beginner-level">${item.beginnerLevel}</span>
                    <span class="beginner-reason">${escapeHtml(item.beginnerReason)}</span>
                  </div>`;
            }

            // 热门标记——放在分类标签旁边而非绝对定位
            const hotBadge = item.hot ? '<span class="hot-badge">🔥 热门</span>' : '';

            card.innerHTML = `
        <div class="card-top">
          ${categoryTag}
          ${hotBadge}
        </div>
        <h3 class="card-title">${escapeHtml(displayTitle || '未命名')}</h3>
        <span class="card-original-name">${escapeHtml(repoName)}</span>
        <p class="card-desc">${escapeHtml(desc)}</p>
        ${sourceSection}
        ${commentsSection}
        <div class="card-tags">${techTags}</div>
        ${beginnerSection}
        <div class="card-footer">
          <div class="card-stats">
            ${starsDisplay}
            ${commentsDisplay}
          </div>
          <span class="card-date">${item.date || ''}</span>
        </div>
      `;

            fragment.appendChild(card);
        });

        $grid.appendChild(fragment);
    }

    // ============ 工具 ============
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatNumber(n) {
        if (n >= 10000) return (n / 1000).toFixed(0) + 'k';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return n.toString();
    }

    // ============ 事件 ============
    $categoryFilters.addEventListener('click', (e) => {
        const pill = e.target.closest('.pill');
        if (!pill) return;
        currentCategory = pill.dataset.category;
        $categoryFilters.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        applyFilters();
    });

    $sourceFilters.addEventListener('click', (e) => {
        const pill = e.target.closest('.pill');
        if (!pill) return;
        currentSource = pill.dataset.source;
        $sourceFilters.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        applyFilters();
    });

    $sortFilters.addEventListener('click', (e) => {
        const pill = e.target.closest('.pill');
        if (!pill) return;
        currentSort = pill.dataset.sort;
        $sortFilters.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        applyFilters();
    });

    let searchTimeout;
    $searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchQuery = $searchInput.value.trim();
            applyFilters();
        }, 250);
    });

    $resetBtn.addEventListener('click', () => {
        currentCategory = 'all';
        currentSource = 'all';
        currentSort = 'stars';
        searchQuery = '';
        $searchInput.value = '';
        $categoryFilters.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        $categoryFilters.querySelector('[data-category="all"]').classList.add('active');
        $sourceFilters.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        $sourceFilters.querySelector('[data-source="all"]').classList.add('active');
        $sortFilters.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        $sortFilters.querySelector('[data-sort="stars"]').classList.add('active');
        applyFilters();
    });

    loadData();
})();
