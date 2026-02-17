#!/usr/bin/env node

/**
 * Antigravity 应用案例数据采集脚本
 * 从 7 个来源采集数据，自动分类 + 去重后写入 data/apps.json
 * 
 * 用法: node scripts/fetch-data.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============ 配置 ============
const SEARCH_KEYWORDS = ['antigravity', 'google antigravity', 'antigravity IDE', 'antigravity agent'];
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'apps.json');
const USER_AGENT = 'AntigravityShowcase/1.0';

// ============ 自动分类规则 ============
const CATEGORY_RULES = [
  {
    id: 'proxy-api',
    label: '🔌 API 代理/转换',
    keywords: ['2api', 'proxy', 'api', 'gateway', 'openai compatible', '转换', '中转', '反代', 'wrap'],
    description: '将 Antigravity 转为标准 API 接口',
  },
  {
    id: 'account-manager',
    label: '👤 账号/配额管理',
    keywords: ['account', 'manager', 'switcher', 'quota', 'monitor', '账号', '切换', '配额', 'cockpit', 'panel', 'watcher', 'bar'],
    description: '多账号管理与配额监控工具',
  },
  {
    id: 'skills',
    label: '🧠 Skills/技能包',
    keywords: ['skill', 'awesome', 'curated', 'collection', '技能', 'agent-skills'],
    description: 'Agent 技能包与最佳实践集合',
  },
  {
    id: 'framework',
    label: '🏗️ 框架/模板',
    keywords: ['framework', 'template', 'boilerplate', 'starter', 'kit', 'scaffold', '框架', '模板'],
    description: '开发框架与项目模板',
  },
  {
    id: 'devtool',
    label: '🛠️ 开发工具',
    keywords: ['tool', 'cli', 'extension', 'plugin', 'devkit', 'mcp', '插件', '工具', '扩展'],
    description: '辅助开发的工具与插件',
  },
  {
    id: 'app',
    label: '📱 应用项目',
    keywords: ['app', 'application', 'web', 'desktop', 'mobile', '应用', '项目'],
    description: '使用 Antigravity 构建的实际应用',
  },
  {
    id: 'security',
    label: '🔒 安全/研究',
    keywords: ['security', 'vulnerability', 'attack', 'injection', 'exfiltrate', '安全', '漏洞'],
    description: '安全研究与漏洞报告',
  },
  {
    id: 'tutorial',
    label: '📖 教程/文章',
    keywords: ['tutorial', 'guide', 'learn', 'how to', 'getting started', 'beginner', 'introduction', '教程', '入门', '指南'],
    description: '教程、指南与技术文章',
  },
  {
    id: 'discussion',
    label: '💡 讨论/新闻',
    keywords: ['discussion', 'news', 'launch', 'announce', 'review', 'opinion', '讨论', '发布', '评测'],
    description: '社区讨论与新闻资讯',
  },
];

function categorizeItem(item) {
  const text = `${item.name} ${item.description} ${(item.tags || []).join(' ')}`.toLowerCase();

  let bestMatch = null;
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (text.includes(kw.toLowerCase())) {
        score += kw.length; // 更长的关键词权重更大
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule;
    }
  }

  // Hacker News 和 Dev.to 来源的没有分类的默认为讨论/文章
  if (!bestMatch || bestScore < 3) {
    if (item.source === 'Hacker News') {
      bestMatch = CATEGORY_RULES.find(r => r.id === 'discussion');
    } else if (item.source === 'Dev.to') {
      bestMatch = CATEGORY_RULES.find(r => r.id === 'tutorial');
    } else {
      bestMatch = CATEGORY_RULES.find(r => r.id === 'app');
    }
  }

  return {
    categoryId: bestMatch.id,
    categoryLabel: bestMatch.label,
    categoryDesc: bestMatch.description,
  };
}

// ============ 生成一句话摘要 ============
function generateSummary(item) {
  let desc = item.description || item.name || '';
  // 去除 emoji
  desc = desc.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();

  // 如果描述太长，截断到第一个句号或 150 字
  if (desc.length > 150) {
    const sentenceEnd = desc.indexOf('。', 30);
    const periodEnd = desc.indexOf('. ', 30);
    const cutoff = Math.min(
      sentenceEnd > 0 ? sentenceEnd + 1 : 999,
      periodEnd > 0 ? periodEnd + 1 : 999,
      150
    );
    desc = desc.slice(0, cutoff).trim();
    if (!desc.endsWith('.') && !desc.endsWith('。')) desc += '…';
  }

  return desc;
}

// ============ 生成精短中文标题（5-15字） ============
function generateShortTitle(item) {
  const name = item.name || '';
  const desc = (item.description || '').toLowerCase();
  const cat = item.categoryId || 'app';

  // 1. 从项目名提取有意义的关键词
  //    去掉 GitHub 用户名前缀（如 ComposioHQ/awesome-claude-skills → awesome-claude-skills）
  let cleanName = name.includes('/') ? name.split('/').pop() : name;
  //    分割 kebab-case / snake_case / camelCase
  const tokens = cleanName
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .map(t => t.toLowerCase())
    .filter(t => t.length > 1 && !['the', 'a', 'an', 'for', 'and', 'with', 'in', 'to', 'of', 'is', 'my', 'your'].includes(t));

  // 2. 识别核心技术词（保留英文原样）
  const techTerms = ['Claude', 'AI', 'MCP', 'API', 'CLI', 'UI', 'UX', 'SDK', 'LLM', 'GPT', 'RAG', 'VSCode', 'Neovim', 'Docker', 'React', 'Next.js', 'Rust', 'Python', 'TypeScript'];
  const foundTech = [];
  const allText = `${name} ${item.description || ''}`;
  for (const t of techTerms) {
    if (allText.toLowerCase().includes(t.toLowerCase()) && !foundTech.includes(t)) {
      foundTech.push(t);
      if (foundTech.length >= 2) break;
    }
  }
  const techPrefix = foundTech.length > 0 ? foundTech.join('/') + ' ' : '';

  // 3. 分类 → 中文核心动词/名词
  const catTitles = {
    'proxy-api': '代理转换工具',
    'account-manager': '账号管理工具',
    'skills': '技能包',
    'framework': '开发模板',
    'devtool': '开发工具',
    'app': '应用项目',
    'security': '安全分析',
    'tutorial': '使用教程',
    'discussion': '社区讨论',
  };
  const catTitle = catTitles[cat] || '应用项目';

  // 4. 从 tokens 提取形容词/功能词
  const meaningfulWords = {
    'awesome': '精选', 'curated': '精选', 'collection': '合集', 'list': '清单',
    'manager': '管理', 'monitor': '监控', 'switcher': '切换', 'watcher': '监控',
    'proxy': '代理', 'gateway': '网关', 'bridge': '桥接',
    'starter': '入门', 'template': '模板', 'boilerplate': '脚手架',
    'guide': '指南', 'tutorial': '教程', 'intro': '入门',
    'pro': '专业', 'max': '增强', 'plus': '增强', 'advanced': '进阶',
    'simple': '简洁', 'fast': '快速', 'auto': '自动',
    'skill': '技能', 'agent': '智能体', 'chat': '对话', 'voice': '语音',
    'file': '文件', 'code': '代码', 'test': '测试', 'deploy': '部署',
    'design': '设计', 'search': '搜索', 'data': '数据',
  };

  let descriptors = [];
  for (const token of tokens) {
    if (meaningfulWords[token]) {
      descriptors.push(meaningfulWords[token]);
      if (descriptors.length >= 2) break;
    }
  }

  // 5. 组合标题
  let title;
  if (descriptors.length > 0) {
    // 去重：如果描述词和分类名重复就不加
    const uniqueDesc = descriptors.filter(d => !catTitle.includes(d));
    title = techPrefix + (uniqueDesc.length > 0 ? uniqueDesc.join('') : '') + catTitle;
  } else {
    // 兜底策略：如果没有提取到描述词，不要只显示“使用教程”这种泛词
    // 而是显示 清洗后的项目名 (如 "Peon Ping")
    title = techPrefix + cleanName;
  }

  // 3.5 特殊逻辑：如果是文章类（有 titleZh），优先用翻译后的原标题
  // 因为文章标题通常本身就是最好的概括（如 "15 Tips for..." -> "15个技巧..."）
  if (item.titleZh && item.titleZh !== item.name) {
    return item.titleZh;
  }

  // 6. 长度限制
  if (title.length > 30) title = title.slice(0, 28) + '…';

  return title;
}

// ============ HTTP 请求工具 ============
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
        ...options.headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON 解析失败: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('请求超时'));
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ 翻译功能 ============
function isChinese(text) {
  if (!text) return true;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const totalChars = text.replace(/[\s\d\p{P}]/gu, '').length;
  return totalChars > 0 && (chineseChars / totalChars) > 0.3;
}

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('超时')); });
  });
}

// 专有名词保护（翻译前替换为占位符，翻译后恢复）
const PROTECTED_TERMS = [
  'Antigravity', 'antigravity',
  'Claude Code', 'Claude',
  'Gemini CLI', 'Gemini',
  'OpenAI', 'ChatGPT', 'Codex',
  'Cursor', 'Windsurf', 'Copilot',
  'MCP', 'VSCode', 'Neovim',
];

async function translateText(text) {
  if (!text || isChinese(text)) return text;
  try {
    // 保护专有名词
    let processed = text;
    const placeholders = [];
    for (const term of PROTECTED_TERMS) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      processed = processed.replace(regex, (match) => {
        const ph = `§${placeholders.length}§`;
        placeholders.push(match);
        return ph;
      });
    }

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(processed.slice(0, 500))}`;
    const raw = await fetchRaw(url);
    const data = JSON.parse(raw);
    let result = text;
    if (data && data[0]) {
      result = data[0].map(s => s[0]).filter(Boolean).join('');
    }

    // 恢复被保护的专有名词
    for (let i = 0; i < placeholders.length; i++) {
      result = result.replace(new RegExp(`§\\s*${i}\\s*§`, 'g'), placeholders[i]);
    }

    return result;
  } catch (e) {
    return text;
  }
}

async function translateItems(items) {
  console.log('\n🌐 翻译非中文内容...');
  let translated = 0;
  let skipped = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // 策略：文章类内容（Dev.to, HN, 或 教程/讨论分类）必须翻译标题
    // 技术项目（GitHub）通常保持原名或用关键词生成，不翻译标题
    const isArticle = ['Dev.to', 'Hacker News', 'Reddit'].includes(item.source) ||
      ['tutorial', 'discussion'].includes(item.categoryId);

    const nameNeedsTrans = !isChinese(item.name) && isArticle;
    const descNeedsTrans = !isChinese(item.summary || item.description);

    if (!nameNeedsTrans && !descNeedsTrans) {
      skipped++;
      continue;
    }

    try {
      if (nameNeedsTrans) {
        // 翻译文章标题，作为 titleZh 备用
        const transName = await translateText(item.name);
        // 如果翻译结果太长，截断一下
        item.titleZh = transName;
        await sleep(200);
      }
      const textToTranslate = item.summary || item.description;
      item.summaryZh = await translateText(textToTranslate);
      await sleep(200);
    } catch (e) {
      // 翻译失败
    }

    translated++;

    if (translated % 20 === 0) {
      console.log(`  📝 已翻译 ${translated} 条...`);
      await sleep(1000);
    }
  }


  console.log(`  ✅ 翻译完成: ${translated} 条翻译, ${skipped} 条已是中文`);
  return items;
}

// ============ 热门评论抓取 ============
async function fetchTopComments(items) {
  console.log('\n💬 抓取热门评论...');
  let fetched = 0;

  for (const item of items) {
    // 只为 HN 条目抓取评论（有免费 API）
    if (item.source === 'Hacker News' && item.url) {
      const hnMatch = item.url.match(/id=(\d+)/);
      const objectId = hnMatch ? hnMatch[1] : null;
      if (objectId && (item.comments || 0) > 5) {
        try {
          const data = await fetch(
            `https://hn.algolia.com/api/v1/items/${objectId}`
          );
          if (data.children && data.children.length > 0) {
            // 取点赞最多的前 2 条评论
            const topComments = data.children
              .filter(c => c.text && c.text.length > 20)
              .sort((a, b) => (b.points || 0) - (a.points || 0))
              .slice(0, 2)
              .map(c => ({
                author: c.author || '匿名',
                text: c.text.replace(/<[^>]*>/g, '').slice(0, 200),
                points: c.points || 0,
              }));
            if (topComments.length > 0) {
              item.topComments = topComments;
              fetched++;
            }
          }
          await sleep(300);
        } catch (e) { /* 忽略 */ }
      }
    }
    // Dev.to: 用 comments_count 字段（无法获取正文，仅标注数量）
    // GitHub: 用 stars 作为社区互动指标
  }

  console.log(`  ✅ 抓取了 ${fetched} 条 HN 热门评论`);
  return items;
}

// ============ 新手参考评分 ============
function generateBeginnerScore(item) {
  const text = `${item.name} ${item.description} ${item.summary || ''} ${item.summaryZh || ''}`.toLowerCase();
  let score = 50; // 基础分
  let reasons = [];

  // 1. 分类权重——对新手有多大直接帮助
  const categoryWeights = {
    'skills': { bonus: 20, reason: '技能包可直接提升使用效率' },
    'tutorial': { bonus: 25, reason: '教程对入门帮助最大' },
    'framework': { bonus: 15, reason: '模板可快速上手' },
    'devtool': { bonus: 10, reason: '工具可提升开发体验' },
    'app': { bonus: 5, reason: '可作为项目参考' },
    'account-manager': { bonus: -5, reason: '账号管理是进阶需求' },
    'proxy-api': { bonus: -10, reason: 'API 代理偏高级用法' },
    'security': { bonus: -15, reason: '安全研究需要较深基础' },
    'discussion': { bonus: 0, reason: '社区讨论可了解趋势' },
  };
  const catWeight = categoryWeights[item.categoryId] || { bonus: 0, reason: '' };
  score += catWeight.bonus;
  if (catWeight.reason) reasons.push(catWeight.reason);

  // 2. 热度加分——高星项目经过社区验证
  const stars = item.stars || 0;
  if (stars > 10000) { score += 15; reasons.push('超高人气，社区验证'); }
  else if (stars > 1000) { score += 10; reasons.push('社区认可度高'); }
  else if (stars > 100) { score += 5; }

  // 3. 内容关键词
  const beginnerKeywords = ['beginner', 'getting started', 'tutorial', 'guide', 'learn', 'intro', '入门', '教程', '指南', '新手', '快速开始', 'starter', 'template'];
  const advancedKeywords = ['advanced', 'enterprise', 'production', 'optimization', 'benchmark', 'hack', 'exploit', 'reverse'];

  for (const kw of beginnerKeywords) {
    if (text.includes(kw)) { score += 8; reasons.push('内容适合初学者'); break; }
  }
  for (const kw of advancedKeywords) {
    if (text.includes(kw)) { score -= 8; reasons.push('内容偏进阶'); break; }
  }

  // 4. 有中文内容加分
  if (item.nameZh || item.isChineseSource) {
    score += 3;
  }

  // 限制范围
  score = Math.max(10, Math.min(100, score));

  // 映射为等级
  let level, emoji;
  if (score >= 80) { level = '强烈推荐'; emoji = '⭐⭐⭐'; }
  else if (score >= 60) { level = '值得一看'; emoji = '⭐⭐'; }
  else if (score >= 40) { level = '可以了解'; emoji = '⭐'; }
  else { level = '进阶参考'; emoji = '📌'; }

  return {
    beginnerScore: score,
    beginnerLevel: level,
    beginnerEmoji: emoji,
    beginnerReason: reasons.slice(0, 2).join('，') || '通用参考',
  };
}

// ============ 数据源采集器 ============

// 1. GitHub
async function fetchGitHub() {
  console.log('📦 采集 GitHub...');
  const items = [];
  for (const keyword of SEARCH_KEYWORDS) {
    try {
      const data = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(keyword)}&sort=stars&order=desc&per_page=30`
      );
      if (data.items) {
        for (const repo of data.items) {
          items.push({
            name: repo.full_name,
            description: repo.description || '',
            url: repo.html_url,
            source: 'GitHub',
            sourceIcon: '📦',
            stars: repo.stargazers_count,
            language: repo.language,
            tags: [repo.language, ...(repo.topics || [])].filter(Boolean).slice(0, 5),
            date: repo.updated_at?.split('T')[0] || repo.created_at?.split('T')[0],
            hot: repo.stargazers_count > 100,
          });
        }
      }
      await sleep(1500);
    } catch (e) {
      console.warn(`  ⚠️ GitHub "${keyword}" 失败: ${e.message}`);
    }
  }
  console.log(`  ✅ GitHub: ${items.length} 条`);
  return items;
}

// 2. Reddit
async function fetchReddit() {
  console.log('💬 采集 Reddit...');
  const items = [];
  const endpoints = [
    'https://www.reddit.com/r/google_antigravity/hot.json?limit=50',
    'https://www.reddit.com/r/google_antigravity/new.json?limit=50',
    'https://www.reddit.com/r/google_antigravity/top.json?t=month&limit=50',
  ];
  for (const url of endpoints) {
    try {
      const data = await fetch(url);
      if (data.data?.children) {
        for (const post of data.data.children) {
          const d = post.data;
          if (d.stickied) continue;
          items.push({
            name: d.title,
            description: d.selftext?.slice(0, 300) || d.title,
            url: `https://reddit.com${d.permalink}`,
            source: 'Reddit',
            sourceIcon: '💬',
            stars: d.score,
            tags: [d.link_flair_text].filter(Boolean),
            date: new Date(d.created_utc * 1000).toISOString().split('T')[0],
            hot: d.score > 50,
          });
        }
      }
      await sleep(2000);
    } catch (e) {
      console.warn(`  ⚠️ Reddit 失败: ${e.message}`);
    }
  }
  console.log(`  ✅ Reddit: ${items.length} 条`);
  return items;
}

// 3. Dev.to
async function fetchDevTo() {
  console.log('📝 采集 Dev.to...');
  const items = [];
  for (let page = 1; page <= 3; page++) {
    try {
      const data = await fetch(
        `https://dev.to/api/articles?tag=antigravity&per_page=30&page=${page}`
      );
      if (!Array.isArray(data) || data.length === 0) break;
      for (const article of data) {
        items.push({
          name: article.title,
          description: article.description || '',
          url: article.url,
          source: 'Dev.to',
          sourceIcon: '📝',
          stars: article.positive_reactions_count || 0,
          tags: article.tag_list || [],
          date: article.published_at?.split('T')[0],
          hot: (article.positive_reactions_count || 0) > 20,
          author: article.user?.name,
        });
      }
      await sleep(500);
    } catch (e) {
      console.warn(`  ⚠️ Dev.to 第${page}页失败: ${e.message}`);
    }
  }
  console.log(`  ✅ Dev.to: ${items.length} 条`);
  return items;
}

// 4. Hacker News
async function fetchHackerNews() {
  console.log('🔶 采集 Hacker News...');
  const items = [];
  for (const keyword of ['antigravity', 'google antigravity IDE']) {
    try {
      const data = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=30`
      );
      if (data.hits) {
        for (const hit of data.hits) {
          items.push({
            name: hit.title,
            description: hit.title,
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            source: 'Hacker News',
            sourceIcon: '🔶',
            stars: hit.points || 0,
            tags: [],
            date: hit.created_at?.split('T')[0],
            hot: (hit.points || 0) > 50,
            comments: hit.num_comments,
          });
        }
      }
      const recent = await fetch(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=30`
      );
      if (recent.hits) {
        for (const hit of recent.hits) {
          items.push({
            name: hit.title,
            description: hit.title,
            url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            source: 'Hacker News',
            sourceIcon: '🔶',
            stars: hit.points || 0,
            tags: [],
            date: hit.created_at?.split('T')[0],
            hot: (hit.points || 0) > 50,
            comments: hit.num_comments,
          });
        }
      }
      await sleep(500);
    } catch (e) {
      console.warn(`  ⚠️ HN "${keyword}" 失败: ${e.message}`);
    }
  }
  console.log(`  ✅ Hacker News: ${items.length} 条`);
  return items;
}

// 5. Product Hunt
async function fetchProductHunt() {
  console.log('🚀 采集 Product Hunt...');
  const token = process.env.PH_TOKEN;
  if (!token) {
    console.log('  ⏭️  未设置 PH_TOKEN，跳过');
    return [];
  }
  return [];
}

// 6. V2EX (SOV2EX)
async function fetchV2EX() {
  console.log('🇨🇳 采集 V2EX...');
  const items = [];
  for (const keyword of ['antigravity', 'Google Antigravity']) {
    try {
      const data = await fetch(
        `https://www.sov2ex.com/api/hit?q=${encodeURIComponent(keyword)}&size=50&sort=created&order=0`
      );
      if (data.hits) {
        for (const hit of data.hits) {
          const d = hit._source;
          items.push({
            name: d.title,
            description: (d.content || '').replace(/<[^>]*>/g, '').slice(0, 300),
            url: `https://www.v2ex.com/t/${d.id}`,
            source: 'V2EX',
            sourceIcon: '🇨🇳',
            stars: d.replies || 0,
            tags: [d.node ? `节点:${d.node}` : null].filter(Boolean),
            date: d.created ? new Date(d.created * 1000).toISOString().split('T')[0] : null,
            hot: (d.replies || 0) > 10,
            author: d.member,
            isChineseSource: true,
          });
        }
      }
      await sleep(1000);
    } catch (e) {
      console.warn(`  ⚠️ V2EX "${keyword}" 失败: ${e.message}`);
    }
  }
  console.log(`  ✅ V2EX: ${items.length} 条`);
  return items;
}

// 7. Gitee
async function fetchGitee() {
  console.log('🇨🇳 采集 Gitee...');
  const items = [];
  for (const keyword of ['antigravity', 'google-antigravity']) {
    try {
      const data = await fetch(
        `https://gitee.com/api/v5/search/repositories?q=${encodeURIComponent(keyword)}&per_page=50&order=desc&sort=stars_count`
      );
      if (Array.isArray(data)) {
        for (const repo of data) {
          items.push({
            name: repo.full_name || repo.human_name,
            description: repo.description || '',
            url: repo.html_url,
            source: 'Gitee',
            sourceIcon: '🇨🇳',
            stars: repo.stargazers_count || 0,
            language: repo.language,
            tags: [repo.language].filter(Boolean),
            date: repo.updated_at?.split('T')[0],
            hot: (repo.stargazers_count || 0) > 10,
            isChineseSource: true,
          });
        }
      }
      await sleep(1000);
    } catch (e) {
      console.warn(`  ⚠️ Gitee "${keyword}" 失败: ${e.message}`);
    }
  }
  console.log(`  ✅ Gitee: ${items.length} 条`);
  return items;
}

// ============ 去重 ============
function deduplicateItems(items) {
  const seen = new Map();
  const titleSeen = new Map();

  for (const item of items) {
    const normalizedUrl = item.url?.replace(/\/$/, '').toLowerCase();
    if (normalizedUrl && seen.has(normalizedUrl)) {
      const existing = seen.get(normalizedUrl);
      if ((item.stars || 0) > (existing.stars || 0)) {
        seen.set(normalizedUrl, item);
      }
      continue;
    }

    const normalizedTitle = (item.name || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
      .slice(0, 50);

    if (normalizedTitle.length > 10 && titleSeen.has(normalizedTitle)) {
      const existing = titleSeen.get(normalizedTitle);
      if ((item.stars || 0) > (existing.stars || 0)) {
        seen.delete(existing.url?.replace(/\/$/, '').toLowerCase());
        seen.set(normalizedUrl, item);
        titleSeen.set(normalizedTitle, item);
      }
      continue;
    }

    if (normalizedUrl) seen.set(normalizedUrl, item);
    if (normalizedTitle.length > 5) titleSeen.set(normalizedTitle, item);
  }

  return Array.from(seen.values());
}

// ============ 过滤无关内容 ============
function filterRelevant(items) {
  // 排除明显和 Google Antigravity IDE 无关的（如物理反重力）
  const irrelevantPatterns = [
    /military.*anti.gravity/i,
    /anti.gravity.*research/i,
    /physics.*antigravity/i,
    /antigravity.*ufo/i,
    /antigravity.*propulsion/i,
    /python.*import antigravity/i,  // Python 彩蛋
    /xkcd.*antigravity/i,
  ];

  return items.filter(item => {
    const text = `${item.name} ${item.description}`;
    return !irrelevantPatterns.some(p => p.test(text));
  });
}

// ============ 主逻辑 ============
async function main() {
  console.log('🚀 Antigravity 应用案例采集器');
  console.log(`📅 ${new Date().toISOString()}`);
  console.log('='.repeat(50));

  const results = await Promise.allSettled([
    fetchGitHub(),
    fetchReddit(),
    fetchDevTo(),
    fetchHackerNews(),
    fetchProductHunt(),
    fetchV2EX(),
    fetchGitee(),
  ]);

  let allItems = [];
  const sourceNames = ['GitHub', 'Reddit', 'Dev.to', 'Hacker News', 'Product Hunt', 'V2EX', 'Gitee'];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      allItems = allItems.concat(result.value);
    } else {
      console.warn(`❌ ${sourceNames[i]} 失败: ${result.reason?.message}`);
    }
  });

  console.log('='.repeat(50));
  console.log(`📊 采集总计: ${allItems.length} 条`);

  // 去重
  let deduped = deduplicateItems(allItems);
  console.log(`🔄 去重后: ${deduped.length} 条`);

  // 过滤无关内容
  deduped = filterRelevant(deduped);
  console.log(`🎯 过滤无关后: ${deduped.length} 条`);

  // 自动分类 + 摘要 + 精短标题
  deduped = deduped.map(item => {
    const cat = categorizeItem(item);
    const withCat = { ...item, ...cat, summary: generateSummary(item) };
    withCat.titleZh = generateShortTitle(withCat);
    return withCat;
  });

  // 翻译非中文内容
  deduped = await translateItems(deduped);

  // 抓取热门评论
  deduped = await fetchTopComments(deduped);

  // 翻译评论
  console.log('\n🌐 翻译评论...');
  for (const item of deduped) {
    if (item.topComments) {
      for (const c of item.topComments) {
        if (!isChinese(c.text)) {
          c.textZh = await translateText(c.text);
          await sleep(200);
        }
      }
    }
  }

  // 生成新手参考评分
  console.log('\n🎓 生成新手参考评分...');
  deduped = deduped.map(item => ({
    ...item,
    ...generateBeginnerScore(item),
  }));
  const scoreStats = { '强烈推荐': 0, '值得一看': 0, '可以了解': 0, '进阶参考': 0 };
  deduped.forEach(item => { scoreStats[item.beginnerLevel] = (scoreStats[item.beginnerLevel] || 0) + 1; });
  console.log('  🎓 新手评分分布:');
  Object.entries(scoreStats).forEach(([l, n]) => console.log(`     ${l}: ${n}`));

  // 按热度排序
  deduped.sort((a, b) => (b.stars || 0) - (a.stars || 0));

  // 统计分类
  const catStats = {};
  deduped.forEach(item => {
    catStats[item.categoryLabel] = (catStats[item.categoryLabel] || 0) + 1;
  });

  const output = {
    lastUpdated: new Date().toISOString(),
    total: deduped.length,
    sources: [...new Set(deduped.map(i => i.source))],
    categories: [...new Set(deduped.map(i => i.categoryLabel))],
    items: deduped,
  };

  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`\n✅ 已写入 ${OUTPUT_FILE}`);
  console.log(`📊 共 ${deduped.length} 条`);

  // 来源统计
  const stats = {};
  deduped.forEach(item => { stats[item.source] = (stats[item.source] || 0) + 1; });
  console.log('\n📈 来源统计:');
  Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => console.log(`   ${s}: ${c}`));

  // 分类统计
  console.log('\n📂 分类统计:');
  Object.entries(catStats).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`   ${c}: ${n}`));
}

main().catch(e => {
  console.error('💥 采集失败:', e);
  process.exit(1);
});
