/**
 * 互動白板 Whiteboard 主程式
 * - 採用三層 Canvas 架構（底圖層 bgCanvas / 筆跡層 drawCanvas / 單筆暫存層 tempCanvas）
 * - 匯入底圖僅於瀏覽器本機記憶體暫存（Blob URL + HTMLImageElement），不上傳任何伺服器
 * - 遵循行動裝置 Canvas 記憶體上限保護與 High-DPI 清晰縮放規範
 */
(() => {
  'use strict';

  // --- DOM 元素參照 ---
  const canvasStage = document.getElementById('canvasStage');
  const bgCanvas = document.getElementById('bgCanvas');
  const drawCanvas = document.getElementById('drawCanvas');
  const tempCanvas = document.getElementById('tempCanvas');

  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  const fadeAllBtn = document.getElementById('fadeAllBtn');
  const clearInkBtn = document.getElementById('clearInkBtn');

  const paperSelect = document.getElementById('paperSelect');
  const bgFileInput = document.getElementById('bgFileInput');
  const importBgBtn = document.getElementById('importBgBtn');
  const bgSettingsBtn = document.getElementById('bgSettingsBtn');
  const bgPanel = document.getElementById('bgPanel');
  const closeBgPanelBtn = document.getElementById('closeBgPanelBtn');
  const bgFitSelect = document.getElementById('bgFitSelect');
  const bgOpacityRange = document.getElementById('bgOpacityRange');
  const bgOpacityVal = document.getElementById('bgOpacityVal');
  const replaceBgBtn = document.getElementById('replaceBgBtn');
  const removeBgBtn = document.getElementById('removeBgBtn');

  const exportToggleBtn = document.getElementById('exportToggleBtn');
  const exportPanel = document.getElementById('exportPanel');
  const exportNameInput = document.getElementById('exportNameInput');
  const exportFormatSelect = document.getElementById('exportFormatSelect');
  const confirmExportBtn = document.getElementById('confirmExportBtn');

  const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));
  const colorSection = document.getElementById('colorSection');
  const customColorInput = document.getElementById('customColorInput');
  const swatchButtons = Array.from(document.querySelectorAll('.swatch'));

  const sizeRange = document.getElementById('sizeRange');
  const sizeValueLabel = document.getElementById('sizeValueLabel');
  const sizePills = Array.from(document.querySelectorAll('.size-pill'));

  const strengthBlock = document.getElementById('strengthBlock');
  const strengthLabel = document.getElementById('strengthLabel');
  const strengthRange = document.getElementById('strengthRange');
  const strengthValueLabel = document.getElementById('strengthValueLabel');

  const brushPreviewDot = document.getElementById('brushPreviewDot');
  const cursorRing = document.getElementById('cursorRing');
  const dropOverlay = document.getElementById('dropOverlay');
  const toastMsg = document.getElementById('toastMsg');

  const inAppModal = document.getElementById('inAppModal');
  const inAppDesc = document.getElementById('inAppDesc');
  const inAppSteps = document.getElementById('inAppSteps');
  const openExtBrowserBtn = document.getElementById('openExtBrowserBtn');
  const copyPageUrlBtn = document.getElementById('copyPageUrlBtn');
  const dismissInAppBtn = document.getElementById('dismissInAppBtn');

  // --- 離屏輔助 Canvas（供「局部淡化」即時遮罩合成與尺寸變更轉存共用，嚴格控制數量以節省記憶體） ---
  const snapshotCanvas = document.createElement('canvas');
  const maskCanvas = document.createElement('canvas');

  const bgCtx = bgCanvas.getContext('2d');
  const drawCtx = drawCanvas.getContext('2d', { willReadFrequently: true });
  const tempCtx = tempCanvas.getContext('2d');
  const snapshotCtx = snapshotCanvas.getContext('2d');
  const maskCtx = maskCanvas.getContext('2d');

  // Canvas 單邊像素上限（防止行動版 Safari 超過 ~224MB RGBA 記憶體上限）
  const MAX_CANVAS_SIDE = 2400;
  const MAX_HISTORY = 25;

  // --- 應用程式狀態 ---
  const state = {
    tool: 'pen',          // 'pen' | 'highlighter' | 'soft' | 'spray' | 'fade' | 'eraser'
    color: '#1e293b',
    size: 6,
    brushOpacity: 100,    // 一般筆刷不透明度 (10~100%)
    fadeStrength: 35,     // 局部淡化筆單筆減淡比例 (10~90%)
    paper: 'plain',       // 'plain' | 'grid' | 'dots' | 'warm'

    // 底圖狀態（僅暫存於瀏覽器記憶體）
    bgImage: null,
    bgObjectUrl: null,
    bgFit: 'contain',     // 'contain' | 'cover' | 'center'
    bgOpacity: 100,       // 10~100%

    // 畫布座標與縮放比
    cssWidth: 1,
    cssHeight: 1,
    pixelScale: 1,

    // 繪圖互動狀態
    isDrawing: false,
    activePointerId: null,
    points: [],
    lastSprayPoint: null,

    // 復原／重做堆疊（儲存 ImageData 與當時尺寸，不佔用額外 GPU Canvas 實例）
    history: [],
    historyIndex: -1
  };

  let toastTimer = null;

  // --- 顯示輕量提示訊息 ---
  function showToast(text, duration = 2400) {
    toastMsg.textContent = text;
    toastMsg.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastMsg.hidden = true;
    }, duration);
  }

  // --- 計算並同步所有圖層 Canvas 尺寸（保留既有筆跡） ---
  function resizeCanvases(isInitial = false) {
    const rect = canvasStage.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxRawSide = Math.max(cssW * dpr, cssH * dpr);
    const scale = maxRawSide > MAX_CANVAS_SIDE
      ? (MAX_CANVAS_SIDE / Math.max(cssW, cssH))
      : dpr;

    const backingW = Math.max(1, Math.round(cssW * scale));
    const backingH = Math.max(1, Math.round(cssH * scale));

    if (!isInitial && drawCanvas.width === backingW && drawCanvas.height === backingH) {
      return;
    }

    // 變更尺寸前先備份既有筆跡
    let prevW = drawCanvas.width;
    let prevH = drawCanvas.height;
    const hasPrevDrawing = !isInitial && prevW > 0 && prevH > 0;

    if (hasPrevDrawing) {
      snapshotCanvas.width = prevW;
      snapshotCanvas.height = prevH;
      snapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
      snapshotCtx.clearRect(0, 0, prevW, prevH);
      snapshotCtx.drawImage(drawCanvas, 0, 0);
    }

    state.cssWidth = cssW;
    state.cssHeight = cssH;
    state.pixelScale = scale;

    [bgCanvas, drawCanvas, tempCanvas, maskCanvas].forEach((cvs) => {
      cvs.width = backingW;
      cvs.height = backingH;
    });

    [bgCtx, drawCtx, tempCtx, maskCtx].forEach((ctx) => {
      if (!ctx) return;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    });

    // 還原尺寸調整前的筆跡
    if (hasPrevDrawing) {
      drawCtx.save();
      drawCtx.setTransform(1, 0, 0, 1, 0, 0);
      drawCtx.imageSmoothingEnabled = true;
      drawCtx.imageSmoothingQuality = 'high';
      drawCtx.drawImage(snapshotCanvas, 0, 0, prevW, prevH, 0, 0, backingW, backingH);
      drawCtx.restore();
    }

    // 同步 snapshotCanvas 尺寸供後續筆畫使用
    snapshotCanvas.width = backingW;
    snapshotCanvas.height = backingH;

    renderBackgroundLayer();

    if (isInitial) {
      saveHistorySnapshot();
    }
  }

  // --- 歷史紀錄（復原 / 重做） ---
  function saveHistorySnapshot() {
    if (!drawCtx || drawCanvas.width === 0 || drawCanvas.height === 0) return;

    // 若曾經復原過，截斷後方的重做紀錄
    if (state.historyIndex < state.history.length - 1) {
      state.history.splice(state.historyIndex + 1);
    }

    const imgData = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
    state.history.push({
      imageData: imgData,
      width: drawCanvas.width,
      height: drawCanvas.height
    });

    if (state.history.length > MAX_HISTORY) {
      state.history.shift();
    }
    state.historyIndex = state.history.length - 1;
    updateHistoryButtons();
  }

  function restoreHistoryAt(index) {
    if (index < 0 || index >= state.history.length) return;
    const entry = state.history[index];
    state.historyIndex = index;

    drawCtx.save();
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    if (entry.width === drawCanvas.width && entry.height === drawCanvas.height) {
      drawCtx.putImageData(entry.imageData, 0, 0);
    } else {
      // 若視窗尺寸曾改變，透過離屏畫布等比繪回
      const tmp = document.createElement('canvas');
      tmp.width = entry.width;
      tmp.height = entry.height;
      const tCtx = tmp.getContext('2d');
      if (tCtx) {
        tCtx.putImageData(entry.imageData, 0, 0);
        drawCtx.imageSmoothingEnabled = true;
        drawCtx.imageSmoothingQuality = 'high';
        drawCtx.drawImage(tmp, 0, 0, drawCanvas.width, drawCanvas.height);
      }
      tmp.width = 0;
      tmp.height = 0;
    }
    drawCtx.restore();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = state.historyIndex <= 0;
    redoBtn.disabled = state.historyIndex >= state.history.length - 1;
  }

  // --- 底圖渲染（不影響手繪筆跡層） ---
  function computeBgRect(imgW, imgH, targetW, targetH, fitMode) {
    if (fitMode === 'cover') {
      const ratio = Math.max(targetW / imgW, targetH / imgH);
      const w = imgW * ratio;
      const h = imgH * ratio;
      return { x: (targetW - w) / 2, y: (targetH - h) / 2, w, h };
    }
    if (fitMode === 'center') {
      const ratio = Math.min(1, targetW / imgW, targetH / imgH);
      const w = imgW * ratio;
      const h = imgH * ratio;
      return { x: (targetW - w) / 2, y: (targetH - h) / 2, w, h };
    }
    // 預設 contain：完整等比顯示
    const ratio = Math.min(targetW / imgW, targetH / imgH);
    const w = imgW * ratio;
    const h = imgH * ratio;
    return { x: (targetW - w) / 2, y: (targetH - h) / 2, w, h };
  }

  function renderBackgroundLayer() {
    if (!bgCtx) return;
    bgCtx.clearRect(0, 0, state.cssWidth, state.cssHeight);

    if (!state.bgImage) return;
    const natW = state.bgImage.naturalWidth || state.bgImage.width;
    const natH = state.bgImage.naturalHeight || state.bgImage.height;
    if (!natW || !natH) return;

    const box = computeBgRect(natW, natH, state.cssWidth, state.cssHeight, state.bgFit);

    bgCtx.save();
    bgCtx.globalAlpha = state.bgOpacity / 100;
    bgCtx.imageSmoothingEnabled = true;
    bgCtx.imageSmoothingQuality = 'high';
    bgCtx.drawImage(state.bgImage, box.x, box.y, box.w, box.h);
    bgCtx.restore();
  }

  // --- 匯入底圖（純本機記憶體暫存） ---
  async function loadBackgroundFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('請選擇有效的圖片檔案（PNG、JPG、WebP、GIF 等）');
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    const img = new Image();

    try {
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('圖片載入失敗'));
        img.src = nextUrl;
      });

      if (typeof img.decode === 'function') {
        await img.decode().catch(() => {});
      }

      // 釋放前一張底圖的暫存 Blob URL，避免記憶體洩漏
      if (state.bgObjectUrl) {
        URL.revokeObjectURL(state.bgObjectUrl);
      }

      state.bgImage = img;
      state.bgObjectUrl = nextUrl;
      bgSettingsBtn.hidden = false;

      renderBackgroundLayer();
      showToast('已載入底圖（本機記憶體暫存，不會上傳伺服器）');
    } catch (err) {
      URL.revokeObjectURL(nextUrl);
      showToast('無法讀取此圖片檔案，請換一張圖片再試');
    }
  }

  function removeBackground() {
    if (state.bgObjectUrl) {
      URL.revokeObjectURL(state.bgObjectUrl);
    }
    state.bgImage = null;
    state.bgObjectUrl = null;
    bgSettingsBtn.hidden = true;
    bgPanel.hidden = true;
    renderBackgroundLayer();
    showToast('已移除底圖');
  }

  // --- 筆刷預覽與工具 UI 更新 ---
  function getEffectivePreviewAlpha() {
    const base = state.brushOpacity / 100;
    if (state.tool === 'highlighter') return Math.max(0.15, 0.38 * base);
    if (state.tool === 'soft') return Math.max(0.15, 0.68 * base);
    if (state.tool === 'fade') return 0.45;
    if (state.tool === 'eraser') return 1;
    return base;
  }

  function updateToolUI() {
    toolButtons.forEach((btn) => {
      const isSelected = btn.dataset.tool === state.tool;
      btn.classList.toggle('active', isSelected);
      btn.setAttribute('aria-checked', String(isSelected));
    });

    // 橡皮擦與局部淡化不需要選顏色
    const disableColor = state.tool === 'eraser' || state.tool === 'fade';
    colorSection.classList.toggle('dimmed', disableColor);

    // 橡皮擦固定 100% 擦除；局部淡化顯示「淡化強度」；其餘筆刷顯示「筆刷濃度」
    if (state.tool === 'eraser') {
      strengthBlock.style.opacity = '0.42';
      strengthBlock.style.pointerEvents = 'none';
      strengthLabel.textContent = '擦除強度';
      strengthValueLabel.textContent = '100%';
    } else if (state.tool === 'fade') {
      strengthBlock.style.opacity = '';
      strengthBlock.style.pointerEvents = '';
      strengthLabel.textContent = '淡化強度';
      strengthRange.min = '10';
      strengthRange.max = '90';
      strengthRange.value = String(state.fadeStrength);
      strengthValueLabel.textContent = `${state.fadeStrength}%`;
    } else {
      strengthBlock.style.opacity = '';
      strengthBlock.style.pointerEvents = '';
      strengthLabel.textContent = '筆刷濃度';
      strengthRange.min = '10';
      strengthRange.max = '100';
      strengthRange.value = String(state.brushOpacity);
      strengthValueLabel.textContent = `${state.brushOpacity}%`;
    }

    sizeValueLabel.textContent = `${state.size} px`;
    sizeRange.value = String(state.size);
    sizePills.forEach((pill) => {
      pill.classList.toggle('active', Number(pill.dataset.size) === state.size);
    });

    updateBrushPreview();
  }

  function updateBrushPreview() {
    const clampedSize = Math.max(4, Math.min(54, state.size));
    brushPreviewDot.style.width = `${clampedSize}px`;
    brushPreviewDot.style.height = `${clampedSize}px`;

    if (state.tool === 'eraser') {
      brushPreviewDot.style.backgroundColor = '#ffffff';
      brushPreviewDot.style.border = '1.5px solid #64748b';
      brushPreviewDot.style.opacity = '1';
      brushPreviewDot.style.filter = 'none';
    } else if (state.tool === 'fade') {
      brushPreviewDot.style.backgroundColor = '#94a3b8';
      brushPreviewDot.style.border = '1.5px dashed #334155';
      brushPreviewDot.style.opacity = String(0.25 + (state.fadeStrength / 100) * 0.55);
      brushPreviewDot.style.filter = 'blur(1px)';
    } else {
      brushPreviewDot.style.backgroundColor = state.color;
      brushPreviewDot.style.border = state.color.toLowerCase() === '#ffffff' ? '1px solid #cbd5e1' : 'none';
      brushPreviewDot.style.opacity = String(getEffectivePreviewAlpha());
      brushPreviewDot.style.filter = state.tool === 'soft' ? 'blur(2px)' : 'none';
    }

    cursorRing.style.width = `${Math.max(6, state.size)}px`;
    cursorRing.style.height = `${Math.max(6, state.size)}px`;
  }

  function setActiveColor(hexColor, fromCustomPicker = false) {
    state.color = hexColor;
    customColorInput.value = hexColor;

    let matchedSwatch = false;
    swatchButtons.forEach((sw) => {
      const isMatch = sw.dataset.color.toLowerCase() === hexColor.toLowerCase();
      sw.classList.toggle('active', isMatch);
      if (isMatch) matchedSwatch = true;
    });

    if (fromCustomPicker && !matchedSwatch) {
      swatchButtons.forEach((sw) => sw.classList.remove('active'));
    }

    // 若原本停留在橡皮擦或淡化工具，點選顏色時自動切回簽字筆方便直接作畫
    if (state.tool === 'eraser' || state.tool === 'fade') {
      state.tool = 'pen';
      updateToolUI();
    } else {
      updateBrushPreview();
    }
  }

  // --- 繪圖演算法（平滑貝茲曲線、噴槍粒子、局部淡化遮罩） ---
  function getStagePoint(evt) {
    const rect = canvasStage.getBoundingClientRect();
    return {
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top
    };
  }

  function traceSmoothPath(ctx, pts) {
    if (pts.length === 0) return;
    ctx.beginPath();
    if (pts.length === 1) {
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[0].x + 0.01, pts[0].y + 0.01);
      return;
    }
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i].x + pts[i + 1].x) / 2;
      const midY = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  function stampSpraySegment(ctx, fromPt, toPt) {
    const radius = Math.max(4, state.size * 0.85);
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(1.5, radius * 0.22);
    const steps = Math.max(1, Math.ceil(dist / step));
    const dotsPerStep = Math.max(8, Math.round(radius * 1.35));

    ctx.fillStyle = state.color;

    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const cx = fromPt.x + dx * t;
      const cy = fromPt.y + dy * t;

      for (let i = 0; i < dotsPerStep; i++) {
        const angle = Math.random() * Math.PI * 2;
        // 中心較密、外圍漸疏的自然噴霧分佈
        const r = Math.random() * Math.random() * radius;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        const dotSize = Math.random() < 0.3 ? 1.6 : 1.1;
        ctx.fillRect(px, py, dotSize, dotSize);
      }
    }
  }

  function renderActiveStroke(latestPoint) {
    const tool = state.tool;

    // 1. 橡皮擦：直接在筆跡層 destination-out 擦除，完整保留下方 bgCanvas 底圖
    if (tool === 'eraser') {
      const len = state.points.length;
      drawCtx.save();
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.globalAlpha = 1;
      drawCtx.lineCap = 'round';
      drawCtx.lineJoin = 'round';
      drawCtx.lineWidth = state.size;
      drawCtx.beginPath();
      if (len < 2) {
        drawCtx.moveTo(latestPoint.x, latestPoint.y);
        drawCtx.lineTo(latestPoint.x + 0.01, latestPoint.y + 0.01);
      } else if (len === 2) {
        drawCtx.moveTo(state.points[0].x, state.points[0].y);
        drawCtx.lineTo(state.points[1].x, state.points[1].y);
      } else {
        const p0 = state.points[len - 3];
        const p1 = state.points[len - 2];
        const p2 = state.points[len - 1];
        const m1x = (p0.x + p1.x) / 2;
        const m1y = (p0.y + p1.y) / 2;
        const m2x = (p1.x + p2.x) / 2;
        const m2y = (p1.y + p2.y) / 2;
        drawCtx.moveTo(m1x, m1y);
        drawCtx.quadraticCurveTo(p1.x, p1.y, m2x, m2y);
      }
      drawCtx.stroke();
      drawCtx.restore();
      return;
    }

    // 2. 局部淡化筆：先將軌跡畫在 maskCanvas，再依「淡化強度」合成回 snapshot -> drawCanvas
    //    單筆來回塗抹只會均勻減淡設定比例，絕不會瞬間擦破或傷及底圖
    if (tool === 'fade') {
      maskCtx.clearRect(0, 0, state.cssWidth, state.cssHeight);
      maskCtx.save();
      maskCtx.lineCap = 'round';
      maskCtx.lineJoin = 'round';
      maskCtx.lineWidth = state.size;
      maskCtx.strokeStyle = '#000000';
      maskCtx.shadowColor = '#000000';
      maskCtx.shadowBlur = Math.max(3, state.size * 0.35);
      traceSmoothPath(maskCtx, state.points);
      maskCtx.stroke();
      maskCtx.restore();

      drawCtx.save();
      drawCtx.setTransform(1, 0, 0, 1, 0, 0);
      drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.globalAlpha = 1;
      drawCtx.drawImage(snapshotCanvas, 0, 0);

      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.globalAlpha = state.fadeStrength / 100;
      drawCtx.drawImage(maskCanvas, 0, 0);
      drawCtx.restore();
      return;
    }

    // 3. 噴槍粉彩：增量噴灑粒子至 tempCanvas
    if (tool === 'spray') {
      const from = state.lastSprayPoint || latestPoint;
      stampSpraySegment(tempCtx, from, latestPoint);
      state.lastSprayPoint = latestPoint;
      return;
    }

    // 4. 簽字筆 / 螢光筆 / 水彩柔邊筆：重繪平滑路徑於 tempCanvas，避免半透明單筆自疊加變深
    tempCtx.clearRect(0, 0, state.cssWidth, state.cssHeight);
    tempCtx.save();
    tempCtx.lineCap = tool === 'highlighter' ? 'butt' : 'round';
    if (tool === 'highlighter' && state.points.length < 3) {
      tempCtx.lineCap = 'round';
    }
    tempCtx.lineJoin = 'round';
    tempCtx.lineWidth = tool === 'highlighter' ? Math.max(10, state.size * 1.4) : state.size;
    tempCtx.strokeStyle = state.color;

    if (tool === 'soft') {
      tempCtx.shadowColor = state.color;
      tempCtx.shadowBlur = Math.max(4, state.size * 0.65);
    }

    traceSmoothPath(tempCtx, state.points);
    tempCtx.stroke();
    tempCtx.restore();
  }

  function getStrokeCommitAlpha() {
    const base = state.brushOpacity / 100;
    if (state.tool === 'highlighter') return 0.38 * base;
    if (state.tool === 'soft') return 0.68 * base;
    return base;
  }

  function handlePointerDown(evt) {
    if (evt.button !== undefined && evt.button !== 0) return;

    // 收合已開啟的浮動彈窗
    exportPanel.hidden = true;
    exportToggleBtn.setAttribute('aria-expanded', 'false');
    bgPanel.hidden = true;

    state.isDrawing = true;
    state.activePointerId = evt.pointerId;
    state.points = [];
    state.lastSprayPoint = null;

    try {
      canvasStage.setPointerCapture(evt.pointerId);
    } catch (_) {}

    const pt = getStagePoint(evt);
    state.points.push(pt);

    if (state.tool === 'fade') {
      // 備份下筆前的筆跡層以供即時比例淡化
      snapshotCtx.setTransform(1, 0, 0, 1, 0, 0);
      snapshotCtx.clearRect(0, 0, snapshotCanvas.width, snapshotCanvas.height);
      snapshotCtx.drawImage(drawCanvas, 0, 0);
      maskCtx.clearRect(0, 0, state.cssWidth, state.cssHeight);
    } else if (state.tool !== 'eraser') {
      tempCtx.clearRect(0, 0, state.cssWidth, state.cssHeight);
      tempCanvas.style.opacity = String(getStrokeCommitAlpha());
    }

    renderActiveStroke(pt);
  }

  function handlePointerMove(evt) {
    const pos = getStagePoint(evt);

    // 更新游標筆刷指示環位置
    if (evt.pointerType !== 'touch') {
      cursorRing.style.display = 'block';
      cursorRing.style.left = `${pos.x}px`;
      cursorRing.style.top = `${pos.y}px`;
    }

    if (!state.isDrawing || evt.pointerId !== state.activePointerId) return;

    const events = typeof evt.getCoalescedEvents === 'function'
      ? evt.getCoalescedEvents()
      : [evt];

    for (const item of events) {
      const p = getStagePoint(item);
      const prev = state.points[state.points.length - 1];
      if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 0.8) {
        state.points.push(p);
        renderActiveStroke(p);
      }
    }
  }

  function finishStroke(evt) {
    if (!state.isDrawing || (evt && evt.pointerId !== state.activePointerId)) return;

    state.isDrawing = false;
    state.activePointerId = null;

    if (evt) {
      try {
        canvasStage.releasePointerCapture(evt.pointerId);
      } catch (_) {}
    }

    // 將單筆暫存層合成至主筆跡層
    if (state.tool !== 'eraser' && state.tool !== 'fade') {
      drawCtx.save();
      drawCtx.setTransform(1, 0, 0, 1, 0, 0);
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.globalAlpha = getStrokeCommitAlpha();
      drawCtx.drawImage(tempCanvas, 0, 0);
      drawCtx.restore();

      tempCtx.clearRect(0, 0, state.cssWidth, state.cssHeight);
      tempCanvas.style.opacity = '1';
    }

    state.points = [];
    state.lastSprayPoint = null;
    saveHistorySnapshot();
  }

  // --- 全局筆跡一鍵淡化（保留底圖） ---
  function fadeAllStrokes() {
    drawCtx.save();
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.restore();

    saveHistorySnapshot();
    showToast('已將全部筆跡整體淡化 25%');
  }

  // --- 清除所有筆跡（保留底圖，支援復原） ---
  function clearAllStrokes() {
    drawCtx.save();
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.restore();

    saveHistorySnapshot();
    showToast('已清除所有筆跡（可按復原還原）');
  }

  // --- 匯出與儲存圖片（合併紙張底紋 + 底圖 + 筆跡） ---
  function drawPaperPattern(ctx, width, height, scale, paperType) {
    const baseColor = paperType === 'warm' ? '#fdfaf3' : '#ffffff';
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, width, height);

    if (paperType === 'grid') {
      const step = 28 * scale;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = Math.max(1, scale);
      ctx.beginPath();
      for (let x = 0; x <= width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y <= height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();
    } else if (paperType === 'dots') {
      const step = 24 * scale;
      const r = 1.3 * scale;
      ctx.fillStyle = '#cbd5e1';
      for (let y = step / 2; y < height; y += step) {
        for (let x = step / 2; x < width; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function exportImageFile() {
    const formatOption = exportFormatSelect.value; // 'png' | 'jpeg' | 'png-transparent'
    const isJpeg = formatOption === 'jpeg';
    const isTransparent = formatOption === 'png-transparent';
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const ext = isJpeg ? 'jpg' : 'png';

    const rawName = (exportNameInput.value || 'whiteboard').trim().replace(/[\\/:*?"<>|]+/g, '-');
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const filename = `${rawName || 'whiteboard'}-${stamp}.${ext}`;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = drawCanvas.width;
    outCanvas.height = drawCanvas.height;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      showToast('瀏覽器記憶體不足，無法建立匯出畫布');
      return;
    }

    // 1. 繪製白板底色／底紋（透明 PNG 除外）
    if (!isTransparent) {
      drawPaperPattern(outCtx, outCanvas.width, outCanvas.height, state.pixelScale, state.paper);
    }

    // 2. 繪製底圖層
    if (state.bgImage) {
      outCtx.drawImage(bgCanvas, 0, 0);
    }

    // 3. 繪製手繪筆跡層
    outCtx.drawImage(drawCanvas, 0, 0);

    const triggerDownload = (url, revokeAfter = false) => {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      if (revokeAfter) {
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      }
    };

    if (typeof outCanvas.toBlob === 'function') {
      outCanvas.toBlob((blob) => {
        // 立即釋放臨時匯出 Canvas 記憶體
        outCanvas.width = 0;
        outCanvas.height = 0;

        if (!blob) {
          showToast('圖片匯出失敗，請稍後再試');
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        triggerDownload(blobUrl, true);
        exportPanel.hidden = true;
        exportToggleBtn.setAttribute('aria-expanded', 'false');
        showToast(`已儲存圖片：${filename}`);
      }, mimeType, isJpeg ? 0.92 : undefined);
    } else {
      const dataUrl = outCanvas.toDataURL(mimeType, isJpeg ? 0.92 : undefined);
      outCanvas.width = 0;
      outCanvas.height = 0;
      triggerDownload(dataUrl, false);
      exportPanel.hidden = true;
      exportToggleBtn.setAttribute('aria-expanded', 'false');
      showToast(`已儲存圖片：${filename}`);
    }
  }

  // --- 事件綁定 ---
  function bindEvents() {
    // 畫布 Pointer 事件（相容滑鼠、觸控螢幕、Apple Pencil / 觸控筆）
    canvasStage.addEventListener('pointerdown', handlePointerDown);
    canvasStage.addEventListener('pointermove', handlePointerMove);
    canvasStage.addEventListener('pointerup', finishStroke);
    canvasStage.addEventListener('pointercancel', finishStroke);
    canvasStage.addEventListener('pointerleave', () => {
      cursorRing.style.display = 'none';
    });

    // 工具切換
    toolButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tool = btn.dataset.tool;
        updateToolUI();
      });
    });

    // 色票與自訂選色器
    swatchButtons.forEach((sw) => {
      sw.addEventListener('click', () => {
        setActiveColor(sw.dataset.color, false);
      });
    });

    customColorInput.addEventListener('input', (e) => {
      setActiveColor(e.target.value, true);
    });

    // 粗細滑桿與預設按鈕
    sizeRange.addEventListener('input', (e) => {
      state.size = Number(e.target.value);
      sizeValueLabel.textContent = `${state.size} px`;
      sizePills.forEach((pill) => {
        pill.classList.toggle('active', Number(pill.dataset.size) === state.size);
      });
      updateBrushPreview();
    });

    sizePills.forEach((pill) => {
      pill.addEventListener('click', () => {
        state.size = Number(pill.dataset.size);
        updateToolUI();
      });
    });

    // 濃度／淡化強度滑桿
    strengthRange.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (state.tool === 'fade') {
        state.fadeStrength = val;
      } else {
        state.brushOpacity = val;
      }
      strengthValueLabel.textContent = `${val}%`;
      updateBrushPreview();
    });

    // 復原 / 重做 / 整體淡化 / 清除
    undoBtn.addEventListener('click', () => restoreHistoryAt(state.historyIndex - 1));
    redoBtn.addEventListener('click', () => restoreHistoryAt(state.historyIndex + 1));
    fadeAllBtn.addEventListener('click', fadeAllStrokes);
    clearInkBtn.addEventListener('click', clearAllStrokes);

    // 紙張底紋切換
    paperSelect.addEventListener('change', (e) => {
      state.paper = e.target.value;
      canvasStage.classList.remove('paper-plain', 'paper-grid', 'paper-dots', 'paper-warm');
      canvasStage.classList.add(`paper-${state.paper}`);
    });

    // 底圖匯入與設定
    importBgBtn.addEventListener('click', () => bgFileInput.click());
    replaceBgBtn.addEventListener('click', () => bgFileInput.click());

    bgFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) loadBackgroundFile(file);
      bgFileInput.value = '';
    });

    bgSettingsBtn.addEventListener('click', () => {
      exportPanel.hidden = true;
      bgPanel.hidden = !bgPanel.hidden;
    });

    closeBgPanelBtn.addEventListener('click', () => {
      bgPanel.hidden = true;
    });

    bgFitSelect.addEventListener('change', (e) => {
      state.bgFit = e.target.value;
      renderBackgroundLayer();
    });

    bgOpacityRange.addEventListener('input', (e) => {
      state.bgOpacity = Number(e.target.value);
      bgOpacityVal.textContent = `${state.bgOpacity}%`;
      renderBackgroundLayer();
    });

    removeBgBtn.addEventListener('click', removeBackground);

    // 拖曳圖片至白板直接設為底圖
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        dragDepth++;
        dropOverlay.hidden = false;
      }
    });

    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
      }
    });

    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropOverlay.hidden = true;
    });

    window.addEventListener('drop', (e) => {
      dragDepth = 0;
      dropOverlay.hidden = true;
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        loadBackgroundFile(e.dataTransfer.files[0]);
      }
    });

    // 支援 Ctrl+V 直接貼上剪貼簿圖片作為底圖
    window.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            loadBackgroundFile(file);
            break;
          }
        }
      }
    });

    // 匯出儲存選單
    exportToggleBtn.addEventListener('click', () => {
      bgPanel.hidden = true;
      const willOpen = exportPanel.hidden;
      exportPanel.hidden = !willOpen;
      exportToggleBtn.setAttribute('aria-expanded', String(willOpen));
    });

    confirmExportBtn.addEventListener('click', exportImageFile);

    // 鍵盤快捷鍵（Ctrl+Z 復原、Ctrl+Y / Ctrl+Shift+Z 重做、數字鍵 1~6 切換工具）
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;

      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          restoreHistoryAt(state.historyIndex + 1);
        } else {
          restoreHistoryAt(state.historyIndex - 1);
        }
        return;
      }
      if (isMod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        restoreHistoryAt(state.historyIndex + 1);
        return;
      }

      const keyMap = {
        '1': 'pen',
        '2': 'highlighter',
        '3': 'soft',
        '4': 'spray',
        '5': 'fade',
        '6': 'eraser'
      };
      if (!isMod && keyMap[e.key]) {
        state.tool = keyMap[e.key];
        updateToolUI();
      }
    });

    // 監聽容器尺寸變化（自動適應視窗縮放與平板旋轉）
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => resizeCanvases(false));
      ro.observe(canvasStage);
    } else {
      window.addEventListener('resize', () => resizeCanvases(false), { passive: true });
    }
  }

  // --- 偵測 LINE / FB / IG 等 App 內建瀏覽器並引導跳往預設瀏覽器 ---
  function detectInAppBrowser(ua) {
    if (/\bLine\//i.test(ua)) return { id: 'line', name: 'LINE' };
    if (/\b(FBAN|FBAV|FB_IAB)\b/i.test(ua)) {
      if (/\bMessenger\b|FB_IAB\/Orca/i.test(ua)) return { id: 'messenger', name: 'Messenger' };
      return { id: 'facebook', name: 'Facebook' };
    }
    if (/\bInstagram\b/i.test(ua)) return { id: 'instagram', name: 'Instagram' };
    if (/\bBarcelona\b/i.test(ua)) return { id: 'threads', name: 'Threads' };
    if (/\bMicroMessenger\b/i.test(ua)) return { id: 'wechat', name: 'WeChat（微信）' };
    if (/\b(BytedanceWebview|musical_ly|TikTok)\b/i.test(ua)) return { id: 'tiktok', name: 'TikTok' };

    if (/\bAndroid\b/i.test(ua) && /;\s*wv\b/i.test(ua)) {
      return { id: 'android-webview', name: 'App 內建瀏覽器' };
    }

    const isIOS = /\b(iPhone|iPad|iPod)\b/i.test(ua);
    const isStandalone = window.navigator.standalone === true ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
    if (isIOS && !isStandalone && !/\b(Safari|CriOS|FxiOS|EdgiOS|OPiOS)\b/i.test(ua)) {
      return { id: 'ios-webview', name: 'App 內建瀏覽器' };
    }

    return null;
  }

  function buildExternalBrowserUrl(appInfo, ua) {
    const isHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
    if (!isHttp) return null;

    if (appInfo.id === 'line') {
      const target = new URL(window.location.href);
      target.searchParams.set('openExternalBrowser', '1');
      return target.toString();
    }

    const scheme = window.location.protocol.replace(':', '');
    const cleanUrl = window.location.href.replace(/^https?:\/\//i, '');

    if (/\bAndroid\b/i.test(ua)) {
      return `intent://${cleanUrl}#Intent;scheme=${scheme};S.browser_fallback_url=${encodeURIComponent(window.location.href)};end`;
    }

    if (/\b(iPhone|iPad|iPod)\b/i.test(ua)) {
      return `x-safari-${scheme}://${cleanUrl}`;
    }

    return window.location.href;
  }

  function copyTextFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {}
    ta.remove();
    return ok;
  }

  function setupInAppBrowserGuard() {
    if (!inAppModal) return;
    const ua = navigator.userAgent || '';
    const appInfo = detectInAppBrowser(ua);
    if (!appInfo) return;

    const extUrl = buildExternalBrowserUrl(appInfo, ua);
    const isIOS = /\b(iPhone|iPad|iPod)\b/i.test(ua);

    inAppDesc.textContent = `偵測到您目前在「${appInfo.name}」內建瀏覽器開啟，可能會導致無法正常下載與儲存白板圖片。`;

    if (!extUrl) {
      // 本機檔案附件模式（非 http/https 網址）
      openExtBrowserBtn.hidden = true;
      copyPageUrlBtn.hidden = true;
      inAppSteps.innerHTML = '您目前是以本機檔案附件方式開啟，建議點選右上或右下角 <strong>「分享 / ⋯」</strong> 圖示，選擇以 <strong>Safari / Chrome</strong> 開啟。';
    } else {
      openExtBrowserBtn.href = extUrl;
      if (isIOS && appInfo.id !== 'line') {
        inAppSteps.innerHTML = `若點擊下方按鈕遭 ${appInfo.name} 阻擋，請點選畫面右上角或右下角 <strong>「⋯」</strong> 選單，選擇 <strong>「在外部瀏覽器 / Safari 開啟」</strong>。`;
      }
    }

    openExtBrowserBtn.addEventListener('click', (e) => {
      if (!extUrl) {
        e.preventDefault();
        return;
      }
      setTimeout(() => {
        if (!document.hidden) {
          showToast('若未自動跳轉，請點右上／右下「⋯」選在預設瀏覽器開啟', 3200);
        }
      }, 900);
    });

    copyPageUrlBtn.addEventListener('click', async () => {
      const cleanShareUrl = (() => {
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete('openExternalBrowser');
          return u.toString();
        } catch (_) {
          return window.location.href;
        }
      })();

      let copied = false;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(cleanShareUrl);
          copied = true;
        } catch (_) {}
      }
      if (!copied) {
        copied = copyTextFallback(cleanShareUrl);
      }
      showToast(copied ? '已複製網址！請開啟 Safari 或 Chrome 貼上前往' : '複製失敗，請手動長按網址列複製');
    });

    dismissInAppBtn.addEventListener('click', () => {
      inAppModal.hidden = true;
    });

    inAppModal.hidden = false;
  }

  // --- 初始化啟動 ---
  function init() {
    updateToolUI();
    bindEvents();
    setupInAppBrowserGuard();
    requestAnimationFrame(() => {
      resizeCanvases(true);
    });
  }

  init();
})();
