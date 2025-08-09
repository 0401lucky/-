// 全局变量
let novels = [];
let currentNovel = null;
let currentChapter = 0;
let currentPage = 0;
let totalPages = 0;
let currentEditingNovel = null;
let currentEditingChapter = 0;
let readingSettings = {
    fontSize: 16,
    theme: 'light',
    lineHeight: 1.6,
    margin: 40,
    readingMode: 'scroll' // 'scroll' 或 'page'
};

// 页面元素
const pages = {
    bookshelf: document.getElementById('bookshelf-page'),
    addNovel: document.getElementById('add-novel-page'),
    reading: document.getElementById('reading-page'),
    edit: document.getElementById('edit-page')
};

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    loadData();
    initEventListeners();
    showPage('bookshelf');
    renderBookshelf();
    applyReadingSettings();
});

// 数据管理
function loadData() {
    const savedNovels = localStorage.getItem('novels');
    const savedSettings = localStorage.getItem('readingSettings');
    
    if (savedNovels) {
        novels = JSON.parse(savedNovels);
    }
    
    if (savedSettings) {
        readingSettings = { ...readingSettings, ...JSON.parse(savedSettings) };
    }
}

function saveData() {
    localStorage.setItem('novels', JSON.stringify(novels));
    localStorage.setItem('readingSettings', JSON.stringify(readingSettings));
}

// 页面切换
function showPage(pageName) {
    Object.values(pages).forEach(page => page.classList.remove('active'));
    pages[pageName].classList.add('active');
}

// 章节解析
function parseChapters(content) {
    const lines = content.split('\n');
    const chapters = [];
    let currentChapter = null;
    let hasChapterMarkers = false;
    
    // 先检查是否包含章节标识符
    for (const line of lines) {
        if (line.trim().match(/^(第.+章|章节.+|Chapter\s+\d+)/)) {
            hasChapterMarkers = true;
            break;
        }
    }
    
    // 如果没有章节标识符，将整个内容作为单一章节
    if (!hasChapterMarkers) {
        const trimmedContent = content.trim();
        if (trimmedContent) {
            chapters.push({
                title: '全文',
                content: trimmedContent
            });
        }
        return chapters;
    }
    
    // 有章节标识符时的正常解析流程
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // 章节标题识别：更宽松的格式，支持多种章节标题格式
        // 1. 第X章 章节名 (原格式)
        // 2. 第X章章节名 (无空格)
        // 3. 第X章 (无章节名)
        // 4. 章节X 章节名
        // 5. Chapter X 章节名
        const chapterMatch = line.match(/^(第.+章|章节.+|Chapter\s+\d+)(.*)$/);
        
        if (chapterMatch) {
            // 保存上一章内容
            if (currentChapter) {
                currentChapter.content = currentChapter.content.trim();
                chapters.push(currentChapter);
            }
            
            // 开始新章节
            currentChapter = {
                title: line,
                content: ''
            };
        } else if (currentChapter && line) {
            // 添加到当前章节内容
            currentChapter.content += line + '\n';
        }
    }
    
    // 添加最后一章
    if (currentChapter) {
        currentChapter.content = currentChapter.content.trim();
        chapters.push(currentChapter);
    }
    
    return chapters;
}

// 验证章节格式
function validateChapters(chapters) {
    // 只要有章节内容就通过验证
    if (chapters.length === 0) {
        return false;
    }
    
    // 检查是否有有效内容
    for (const chapter of chapters) {
        if (chapter.content && chapter.content.trim()) {
            return true;
        }
    }
    
    return false;
}

// 书架渲染
function renderBookshelf() {
    const grid = document.getElementById('novels-grid');
    const emptyState = document.getElementById('empty-state');
    
    if (novels.length === 0) {
        grid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    grid.style.display = 'grid';
    emptyState.style.display = 'none';
    
    grid.innerHTML = novels.map((novel, index) => {
        const progress = calculateProgress(novel);
        const stats = calculateNovelStats(novel);
        const lastUpdate = new Date(novel.lastUpdate).toLocaleDateString('zh-CN');
        
        return `
            <div class="novel-card" data-index="${index}">
                <button class="novel-options-btn" data-index="${index}">⋯</button>
                <h3>${novel.title}</h3>
                <div class="novel-progress">
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${progress.percentage}%"></div>
                    </div>
                    <div class="progress-text">${progress.text}</div>
                </div>
                <div class="novel-stats">
                    <span class="stats-text">总计 ${stats.formattedWords} 字，共 ${stats.totalChapters} 章</span>
                </div>
                <div class="novel-meta">
                    最后更新：${lastUpdate}
                </div>
            </div>
        `;
    }).join('');
    
    // 添加点击事件
    grid.querySelectorAll('.novel-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('novel-options-btn')) {
                e.stopPropagation();
                showNovelOptions(e.target, parseInt(e.target.dataset.index));
            } else {
                const index = parseInt(card.dataset.index);
                openNovel(index);
            }
        });
    });
}

// 计算小说统计信息
function calculateNovelStats(novel) {
    let totalWords = 0;
    const totalChapters = novel.chapters.length;
    
    novel.chapters.forEach(chapter => {
        const content = chapter.title + '\n' + chapter.content;
        totalWords += countWords(content);
    });
    
    return {
        totalWords: totalWords,
        totalChapters: totalChapters,
        formattedWords: totalWords.toLocaleString('zh-CN')
    };
}

// 计算阅读进度
function calculateProgress(novel) {
    if (!novel.readingProgress) {
        return { percentage: 0, text: '未开始阅读' };
    }
    
    const { chapter, position } = novel.readingProgress;
    const totalChapters = novel.chapters.length;
    const currentChapterProgress = position || 0;
    
    // 简化计算：基于章节进度
    const percentage = Math.round(((chapter + currentChapterProgress) / totalChapters) * 100);
    const text = `已读至 第${chapter + 1}章 ${percentage}%`;
    
    return { percentage, text };
}

// 显示小说选项菜单
function showNovelOptions(button, novelIndex) {
    const menu = document.getElementById('novel-options');
    const rect = button.getBoundingClientRect();
    
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 5) + 'px';
    menu.classList.add('show');
    
    // 设置当前操作的小说
    menu.dataset.novelIndex = novelIndex;
    
    // 点击其他地方关闭菜单
    setTimeout(() => {
        document.addEventListener('click', closeNovelOptions);
    }, 0);
}

function closeNovelOptions() {
    const menu = document.getElementById('novel-options');
    menu.classList.remove('show');
    document.removeEventListener('click', closeNovelOptions);
}

// 打开小说阅读
function openNovel(index) {
    currentNovel = novels[index];
    currentChapter = currentNovel.readingProgress?.chapter || 0;
    
    showPage('reading');
    renderReading();
    
    // 恢复阅读位置
    if (currentNovel.readingProgress?.scrollPosition) {
        setTimeout(() => {
            window.scrollTo(0, currentNovel.readingProgress.scrollPosition);
        }, 100);
    }
}

// 渲染滚动模式
function renderScrollMode() {
    const content = document.getElementById('reading-content');
    const pageNav = document.getElementById('page-nav');
    
    // 隐藏翻页导航
    pageNav.style.display = 'none';
    
    // 移除翻页模式样式
    content.classList.remove('page-mode');
    
    // 显示当前章节内容
    const chapter = currentNovel.chapters[currentChapter];
    content.innerHTML = `
        <h2>${chapter.title}</h2>
        ${chapter.content.split('\n').map(p => p.trim() ? `<p>${p}</p>` : '').join('')}
    `;
}

// 渲染翻页模式
function renderPageMode() {
    const content = document.getElementById('reading-content');
    const pageNav = document.getElementById('page-nav');
    
    // 显示翻页导航
    pageNav.style.display = 'flex';
    
    // 添加翻页模式样式
    content.classList.add('page-mode');
    
    // 分页处理
    const chapter = currentNovel.chapters[currentChapter];
    const pages = paginateContent(chapter);
    totalPages = pages.length;
    
    // 确保当前页码有效
    if (currentPage > totalPages) currentPage = 1;
    if (currentPage < 1) currentPage = 1;
    
    // 显示当前页内容
    content.innerHTML = `
        <div class="page-content">
            <h2>${chapter.title}</h2>
            ${pages[currentPage - 1] || ''}
        </div>
    `;
    
    // 更新页面信息
    updatePageInfo();
}

// 内容分页处理
function paginateContent(chapter) {
    const content = document.getElementById('reading-content');
    const tempDiv = document.createElement('div');
    tempDiv.className = 'reading-content page-mode';
    tempDiv.style.position = 'absolute';
    tempDiv.style.top = '-9999px';
    tempDiv.style.visibility = 'hidden';
    document.body.appendChild(tempDiv);
    
    const pageContent = document.createElement('div');
    pageContent.className = 'page-content';
    tempDiv.appendChild(pageContent);
    
    const paragraphs = chapter.content.split('\n').filter(p => p.trim());
    const pages = [];
    let currentPageContent = '';
    
    // 计算每页可容纳的内容高度
    const maxHeight = window.innerHeight - 200; // 减去头部和导航的高度
    
    for (let i = 0; i < paragraphs.length; i++) {
        const testContent = currentPageContent + (currentPageContent ? '' : '') + `<p>${paragraphs[i]}</p>`;
        pageContent.innerHTML = testContent;
        
        if (pageContent.scrollHeight > maxHeight && currentPageContent) {
            // 当前页已满，保存并开始新页
            pages.push(currentPageContent);
            currentPageContent = `<p>${paragraphs[i]}</p>`;
        } else {
            currentPageContent = testContent;
        }
    }
    
    // 添加最后一页
    if (currentPageContent) {
        pages.push(currentPageContent);
    }
    
    // 清理临时元素
    document.body.removeChild(tempDiv);
    
    return pages.length > 0 ? pages : ['<p>暂无内容</p>'];
}

// 更新页面信息
function updatePageInfo() {
    const pageInfo = document.getElementById('page-info');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    
    pageInfo.textContent = `第 ${currentPage} 页 / 共 ${totalPages} 页`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
}

// 更新阅读模式按钮状态
function updateReadingModeButtons() {
    const scrollBtn = document.getElementById('scroll-mode');
    const pageBtn = document.getElementById('page-mode');
    
    if (readingSettings.readingMode === 'page') {
        scrollBtn.classList.remove('active');
        pageBtn.classList.add('active');
    } else {
        scrollBtn.classList.add('active');
        pageBtn.classList.remove('active');
    }
}

// 渲染阅读页面
function renderReading() {
    const chapterSelect = document.getElementById('chapter-select');
    const content = document.getElementById('reading-content');
    const prevBtn = document.getElementById('prev-chapter');
    const nextBtn = document.getElementById('next-chapter');
    
    // 更新章节选择器
    chapterSelect.innerHTML = currentNovel.chapters.map((chapter, index) => {
        const chapterContent = chapter.title + '\n' + chapter.content;
        const wordCount = countWords(chapterContent);
        return `<option value="${index}" ${index === currentChapter ? 'selected' : ''}>
            ${chapter.title} (${wordCount.toLocaleString('zh-CN')}字)
        </option>`;
    }).join('');
    
    // 根据阅读模式渲染内容
    if (readingSettings.readingMode === 'page') {
        renderPageMode();
    } else {
        renderScrollMode();
    }
    
    // 更新导航按钮状态
    prevBtn.disabled = currentChapter === 0;
    nextBtn.disabled = currentChapter === currentNovel.chapters.length - 1;
    
    // 更新阅读模式按钮状态
    updateReadingModeButtons();
    
    // 监听滚动以保存阅读进度（仅滚动模式）
    if (readingSettings.readingMode === 'scroll') {
        window.addEventListener('scroll', saveReadingProgress);
    } else {
        window.removeEventListener('scroll', saveReadingProgress);
    }
}

// 保存阅读进度
function saveReadingProgress() {
    if (!currentNovel) return;
    
    const scrollPosition = window.pageYOffset;
    const novelIndex = novels.findIndex(n => n.id === currentNovel.id);
    
    if (novelIndex !== -1) {
        novels[novelIndex].readingProgress = {
            chapter: currentChapter,
            scrollPosition: scrollPosition,
            position: scrollPosition / document.body.scrollHeight
        };
        saveData();
    }
}

// 章节导航
function goToChapter(chapterIndex) {
    currentChapter = chapterIndex;
    currentPage = 1; // 切换章节时重置页码
    renderReading();
    window.scrollTo(0, 0);
}

function goToPrevChapter() {
    if (currentChapter > 0) {
        currentPage = 1; // 重置页码
        goToChapter(currentChapter - 1);
    }
}

function goToNextChapter() {
    if (currentChapter < currentNovel.chapters.length - 1) {
        currentPage = 1; // 重置页码
        goToChapter(currentChapter + 1);
    }
}

// 阅读设置
function applyReadingSettings() {
    const content = document.getElementById('reading-content');
    if (content) {
        content.style.fontSize = readingSettings.fontSize + 'px';
        content.style.lineHeight = readingSettings.lineHeight;
        content.style.paddingLeft = readingSettings.margin + 'px';
        content.style.paddingRight = readingSettings.margin + 'px';
    }
    
    // 应用主题
    document.body.className = readingSettings.theme + '-theme';
    
    // 更新设置面板显示
    updateSettingsDisplay();
}

function updateSettingsDisplay() {
    document.getElementById('font-size-display').textContent = readingSettings.fontSize + 'px';
    document.getElementById('line-height-display').textContent = readingSettings.lineHeight;
    document.getElementById('margin-display').textContent = readingSettings.margin + 'px';
    document.getElementById('line-height-slider').value = readingSettings.lineHeight;
    document.getElementById('margin-slider').value = readingSettings.margin;
    
    // 更新主题按钮状态
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === readingSettings.theme);
    });
}

// 小说编辑
function editNovel(index) {
    currentEditingNovel = novels[index];
    currentEditingChapter = 0;
    
    showPage('edit');
    renderEditPage();
}

function renderEditPage() {
    const titleInput = document.getElementById('edit-title');
    const chaptersList = document.getElementById('edit-chapters-list');
    const contentTextarea = document.getElementById('edit-chapter-content');
    
    titleInput.value = currentEditingNovel.title;
    
    // 渲染章节列表
    chaptersList.innerHTML = currentEditingNovel.chapters.map((chapter, index) => 
        `<li data-index="${index}" ${index === currentEditingChapter ? 'class="active"' : ''}>
            ${chapter.title}
        </li>`
    ).join('');
    
    // 显示当前章节内容
    const chapter = currentEditingNovel.chapters[currentEditingChapter];
    contentTextarea.value = chapter.title + '\n' + chapter.content;
    
    // 更新字数统计
    updateWordCount();
    
    // 添加章节点击事件
    chaptersList.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
            const index = parseInt(li.dataset.index);
            selectEditChapter(index);
        });
    });
    
    // 为textarea添加输入事件监听器（移除之前的监听器避免重复）
    contentTextarea.removeEventListener('input', updateWordCount);
    contentTextarea.addEventListener('input', updateWordCount);
}

function selectEditChapter(index) {
    // 保存当前章节的修改
    saveCurrentChapterEdit();
    
    currentEditingChapter = index;
    renderEditPage();
}

function saveCurrentChapterEdit() {
    const contentTextarea = document.getElementById('edit-chapter-content');
    const content = contentTextarea.value;
    
    if (content.trim()) {
        const lines = content.split('\n');
        const title = lines[0].trim();
        const chapterContent = lines.slice(1).join('\n').trim();
        
        currentEditingNovel.chapters[currentEditingChapter] = {
            title: title,
            content: chapterContent
        };
    }
}

// 计算字数
function countWords(text) {
    if (!text || text.trim() === '') {
        return 0;
    }
    // 移除章节标题行，只统计内容字数
    const lines = text.split('\n');
    const contentLines = lines.slice(1); // 跳过第一行标题
    const content = contentLines.join('\n').trim();
    
    // 统计中文字符、英文单词和数字
    const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (content.match(/[a-zA-Z]+/g) || []).length;
    const numbers = (content.match(/\d+/g) || []).length;
    
    return chineseChars + englishWords + numbers;
}

// 更新字数显示
function updateWordCount() {
    const textarea = document.getElementById('edit-chapter-content');
    const wordCountDisplay = document.getElementById('word-count-display');
    
    if (textarea && wordCountDisplay) {
        const wordCount = countWords(textarea.value);
        wordCountDisplay.textContent = wordCount;
    }
}

// 添加新章节
function addNewChapter() {
    // 保存当前章节的修改
    saveCurrentChapterEdit();
    
    // 计算新章节编号
    const chapterCount = currentEditingNovel.chapters.length;
    const newChapterNumber = chapterCount + 1;
    
    // 创建新章节
    const newChapter = {
        title: `第${newChapterNumber}章 新章节`,
        content: '请在此输入章节内容...'
    };
    
    // 添加到章节列表
    currentEditingNovel.chapters.push(newChapter);
    
    // 切换到新章节进行编辑
    currentEditingChapter = currentEditingNovel.chapters.length - 1;
    
    // 重新渲染编辑页面
    renderEditPage();
}

function saveNovelEdit() {
    // 保存当前章节
    saveCurrentChapterEdit();
    
    // 更新小说标题
    const titleInput = document.getElementById('edit-title');
    currentEditingNovel.title = titleInput.value.trim();
    
    // 验证章节格式
    if (!validateChapters(currentEditingNovel.chapters)) {
        showAlert('保存失败', '请确保小说包含有效内容。');
        return;
    }
    
    // 更新最后修改时间
    currentEditingNovel.lastUpdate = Date.now();
    
    // 保存到本地存储
    saveData();
    
    // 返回书架
    showPage('bookshelf');
    renderBookshelf();
    
    showAlert('保存成功', '小说已成功保存。');
}

// 小说删除
function deleteNovel(index) {
    const novel = novels[index];
    showConfirm(
        '确认删除',
        `您确定要永久删除《${novel.title}》吗？此操作无法撤销。`,
        () => {
            novels.splice(index, 1);
            saveData();
            renderBookshelf();
        }
    );
}

// 小说导出
function exportNovel(index) {
    const novel = novels[index];
    let content = '';
    
    novel.chapters.forEach(chapter => {
        content += chapter.title + '\n\n';
        content += chapter.content + '\n\n';
    });
    
    // 创建下载链接
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = novel.title + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 创建新小说
function createNovel() {
    const title = document.getElementById('novel-title').value.trim();
    const content = document.getElementById('novel-content').value.trim();
    
    if (!title) {
        showAlert('错误', '请输入小说标题。');
        return;
    }
    
    if (!content) {
        showAlert('错误', '请输入小说内容。');
        return;
    }
    
    // 解析章节
    const chapters = parseChapters(content);
    
    if (!validateChapters(chapters)) {
        showAlert('导入失败', '请确保导入的内容不为空。');
        return;
    }
    
    // 创建新小说对象
    const novel = {
        id: Date.now(),
        title: title,
        chapters: chapters,
        createdAt: Date.now(),
        lastUpdate: Date.now(),
        readingProgress: null
    };
    
    novels.push(novel);
    saveData();
    
    // 清空表单
    document.getElementById('novel-title').value = '';
    document.getElementById('novel-content').value = '';
    
    // 返回书架
    showPage('bookshelf');
    renderBookshelf();
    
    showAlert('创建成功', `小说《${title}》已成功创建，共${chapters.length}章。`);
}

// 文件上传处理
function handleFileUpload(file) {
    if (!file) return;
    
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.docx')) {
        // 处理docx文件
        const reader = new FileReader();
        reader.onload = function(e) {
            mammoth.extractRawText({arrayBuffer: e.target.result})
                .then(function(result) {
                    document.getElementById('novel-content').value = result.value;
                    if (result.messages.length > 0) {
                        console.warn('DOCX解析警告:', result.messages);
                    }
                })
                .catch(function(error) {
                    showAlert('文件解析失败', '无法解析DOCX文件，请检查文件是否损坏或格式是否正确。');
                    console.error('DOCX解析错误:', error);
                });
        };
        reader.readAsArrayBuffer(file);
    } else if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
        // 处理文本文件
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('novel-content').value = e.target.result;
        };
        reader.readAsText(file, 'UTF-8');
    } else {
        showAlert('文件格式不支持', '请选择 .txt、.md 或 .docx 格式的文件。');
    }
}

// 工具函数
function showAlert(title, message) {
    alert(title + '\n\n' + message);
}

function showConfirm(title, message, callback) {
    const modal = document.getElementById('confirm-dialog');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add('show');
    
    const closeModal = () => {
        modal.classList.remove('show');
        okBtn.removeEventListener('click', handleOk);
        cancelBtn.removeEventListener('click', closeModal);
    };
    
    const handleOk = () => {
        callback();
        closeModal();
    };
    
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', closeModal);
}

// 事件监听器初始化
function initEventListeners() {
    // 书架页面
    document.getElementById('add-novel-btn').addEventListener('click', () => {
        showPage('addNovel');
    });
    
    // 添加小说页面
    document.getElementById('back-to-shelf').addEventListener('click', () => {
        showPage('bookshelf');
    });
    
    // 阅读模式切换
    document.getElementById('scroll-mode').addEventListener('click', () => {
        readingSettings.readingMode = 'scroll';
        currentPage = 1; // 重置页码
        saveData();
        renderReading();
    });
    
    document.getElementById('page-mode').addEventListener('click', () => {
        readingSettings.readingMode = 'page';
        currentPage = 1; // 重置页码
        saveData();
        renderReading();
    });
    
    // 翻页操作
    document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderPageMode();
        }
    });
    
    document.getElementById('next-page').addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderPageMode();
        }
     });
     
     // 键盘快捷键支持
     document.addEventListener('keydown', (e) => {
         // 只在阅读页面生效
         if (document.getElementById('reading-page').style.display !== 'block') return;
         
         if (readingSettings.readingMode === 'page') {
             switch(e.key) {
                 case 'ArrowLeft':
                 case 'PageUp':
                     e.preventDefault();
                     if (currentPage > 1) {
                         currentPage--;
                         renderPageMode();
                     }
                     break;
                 case 'ArrowRight':
                 case 'PageDown':
                 case ' ': // 空格键
                     e.preventDefault();
                     if (currentPage < totalPages) {
                         currentPage++;
                         renderPageMode();
                     }
                     break;
                 case 'Home':
                     e.preventDefault();
                     currentPage = 1;
                     renderPageMode();
                     break;
                 case 'End':
                     e.preventDefault();
                     currentPage = totalPages;
                     renderPageMode();
                     break;
             }
         }
     });
     
     document.getElementById('text-tab').addEventListener('click', () => {
        document.getElementById('text-tab').classList.add('active');
        document.getElementById('file-tab').classList.remove('active');
        document.getElementById('text-import').style.display = 'block';
        document.getElementById('file-import').style.display = 'none';
    });
    
    document.getElementById('file-tab').addEventListener('click', () => {
        document.getElementById('file-tab').classList.add('active');
        document.getElementById('text-tab').classList.remove('active');
        document.getElementById('file-import').style.display = 'block';
        document.getElementById('text-import').style.display = 'none';
    });
    
    document.getElementById('create-novel-btn').addEventListener('click', createNovel);
    
    // 文件上传
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('file-drop-zone');
    
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
            // 切换到文本标签页显示内容
            document.getElementById('text-tab').click();
        }
    });
    
    // 拖拽上传
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) {
            const fileName = file.name.toLowerCase();
            if (file.type === 'text/plain' || fileName.endsWith('.md') || fileName.endsWith('.docx')) {
                handleFileUpload(file);
                document.getElementById('text-tab').click();
            } else {
                showAlert('文件格式不支持', '请选择 .txt、.md 或 .docx 格式的文件。');
            }
        }
    });
    
    // 阅读页面
    document.getElementById('back-to-shelf-reading').addEventListener('click', () => {
        window.removeEventListener('scroll', saveReadingProgress);
        showPage('bookshelf');
    });
    
    document.getElementById('chapter-select').addEventListener('change', (e) => {
        goToChapter(parseInt(e.target.value));
    });
    
    document.getElementById('prev-chapter').addEventListener('click', goToPrevChapter);
    document.getElementById('next-chapter').addEventListener('click', goToNextChapter);
    
    document.getElementById('settings-btn').addEventListener('click', () => {
        document.getElementById('settings-panel').classList.add('open');
    });
    
    // 编辑页面
    document.getElementById('back-to-shelf-edit').addEventListener('click', () => {
        showPage('bookshelf');
    });
    
    document.getElementById('save-edit-btn').addEventListener('click', saveNovelEdit);
    
    document.getElementById('add-chapter-btn').addEventListener('click', addNewChapter);
    
    // 设置面板
    document.getElementById('close-settings').addEventListener('click', () => {
        document.getElementById('settings-panel').classList.remove('open');
    });
    
    document.getElementById('font-smaller').addEventListener('click', () => {
        if (readingSettings.fontSize > 12) {
            readingSettings.fontSize--;
            applyReadingSettings();
            saveData();
        }
    });
    
    document.getElementById('font-larger').addEventListener('click', () => {
        if (readingSettings.fontSize < 24) {
            readingSettings.fontSize++;
            applyReadingSettings();
            saveData();
        }
    });
    
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            readingSettings.theme = btn.dataset.theme;
            applyReadingSettings();
            saveData();
        });
    });
    
    document.getElementById('line-height-slider').addEventListener('input', (e) => {
        readingSettings.lineHeight = parseFloat(e.target.value);
        applyReadingSettings();
        saveData();
    });
    
    document.getElementById('margin-slider').addEventListener('input', (e) => {
        readingSettings.margin = parseInt(e.target.value);
        applyReadingSettings();
        saveData();
    });
    
    // 小说选项菜单
    document.getElementById('edit-novel').addEventListener('click', () => {
        const index = parseInt(document.getElementById('novel-options').dataset.novelIndex);
        editNovel(index);
        closeNovelOptions();
    });
    
    document.getElementById('export-novel').addEventListener('click', () => {
        const index = parseInt(document.getElementById('novel-options').dataset.novelIndex);
        exportNovel(index);
        closeNovelOptions();
    });
    
    document.getElementById('delete-novel').addEventListener('click', () => {
        const index = parseInt(document.getElementById('novel-options').dataset.novelIndex);
        deleteNovel(index);
        closeNovelOptions();
    });
}