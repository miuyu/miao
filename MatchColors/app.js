/**
 * CMYK MatchColors - 核心邏輯腳本
 * 純 JavaScript 實現，完全不依賴 Node.js 或 Python，本機瀏覽器雙擊即可運行
 * 包含：
 * 1. CMYK 與 HEX / RGB / HSL 雙向精準換算與防迴圈連動
 * 2. 2D Canvas 高性能全色階色彩選擇器 (HiDPI、雙層架構、滑鼠/觸控流暢拖曳)
 * 3. 專業五色和諧配色計算引擎與印刷效果即時模擬
 * 4. 剪貼簿一鍵複製與 Toast 提示
 */

(function () {
  'use strict';

  // =========================================================================
  // 狀態管理 (Reactive Application State)
  // =========================================================================
  const state = {
    // 模式: 'cmyk' (印刷模式) | 'rgb' (螢幕模式)
    inputMode: 'cmyk',

    // CMYK (0 ~ 100)
    c: 100,
    m: 27,
    y: 0,
    k: 12,

    // RGB (0 ~ 255)
    r: 0,
    g: 163,
    b: 224,

    // HEX
    hex: '00A3E0',

    // HSL
    h: 196,
    s: 100,
    l: 44,

    // 拾色器模式: 'full' (全頻光譜) | 'hsv' (飽和度/明度矩陣)
    pickerMode: 'full',

    // 配色規則: 'designer' | 'analogous' | 'complementary' | 'monochromatic' | 'triadic'
    harmonyRule: 'designer',

    // 五色調色盤數據快取
    paletteColors: [],

    // 同步鎖 (避免雙向綁定循環更新)
    isSyncing: false
  };

  // =========================================================================
  // DOM 元素引用快取
  // =========================================================================
  const dom = {
    // Mode Switch & Headers
    controlsTitle: document.getElementById('controlsTitle'),
    controlsBadge: document.getElementById('controlsBadge'),
    controlsHint: document.getElementById('controlsHint'),
    colorModeTabs: document.getElementById('colorModeTabs'),
    tabModeCmyk: document.getElementById('tabModeCmyk'),
    tabModeRgb: document.getElementById('tabModeRgb'),
    cmykSlidersContainer: document.getElementById('cmykSlidersContainer'),
    rgbSlidersContainer: document.getElementById('rgbSlidersContainer'),
    ticMeterContainer: document.getElementById('ticMeterContainer'),
    lumMeterContainer: document.getElementById('lumMeterContainer'),

    // CMYK Controls
    sliderC: document.getElementById('sliderC'),
    sliderM: document.getElementById('sliderM'),
    sliderY: document.getElementById('sliderY'),
    sliderK: document.getElementById('sliderK'),
    inputC: document.getElementById('inputC'),
    inputM: document.getElementById('inputM'),
    inputY: document.getElementById('inputY'),
    inputK: document.getElementById('inputK'),

    // RGB Controls
    sliderR: document.getElementById('sliderR'),
    sliderG: document.getElementById('sliderG'),
    sliderB: document.getElementById('sliderB'),
    inputR: document.getElementById('inputR'),
    inputG: document.getElementById('inputG'),
    inputB: document.getElementById('inputB'),
    lumValueText: document.getElementById('lumValueText'),
    lumProgressBar: document.getElementById('lumProgressBar'),

    // Codes & Previews
    hexInput: document.getElementById('hexInput'),
    rgbDisplay: document.getElementById('rgbDisplay'),
    cmykStringDisplay: document.getElementById('cmykStringDisplay'),
    mainColorPreview: document.getElementById('mainColorPreview'),
    contrastBadge: document.getElementById('contrastBadge'),
    ticValueText: document.getElementById('ticValueText'),
    ticProgressBar: document.getElementById('ticProgressBar'),

    // Canvas Picker
    spectrumContainer: document.getElementById('spectrumContainer'),
    spectrumCanvas: document.getElementById('spectrumCanvas'),
    crosshairCanvas: document.getElementById('crosshairCanvas'),
    modeTags: document.querySelectorAll('.mode-tag'),
    hueSlider: document.getElementById('hueSlider'),
    hueValueText: document.getElementById('hueValueText'),
    lightnessSlider: document.getElementById('lightnessSlider'),
    lightnessValueText: document.getElementById('lightnessValueText'),
    presetSwatchesGrid: document.getElementById('presetSwatchesGrid'),

    // Five-Color Harmony
    harmonyBtns: document.querySelectorAll('.harmony-btn'),
    fiveColorsGrid: document.getElementById('fiveColorsGrid'),

    // Mockup Previews
    mockupCard1: document.getElementById('mockupCard1'),
    mockupAccent: document.getElementById('mockupAccent'),
    mockupBrand: document.getElementById('mockupBrand'),
    mockupTagline: document.getElementById('mockupTagline'),
    mDot1: document.getElementById('mDot1'),
    mDot2: document.getElementById('mDot2'),
    mDot3: document.getElementById('mDot3'),
    mDot4: document.getElementById('mDot4'),
    mDot5: document.getElementById('mDot5'),
    posterHero: document.getElementById('posterHero'),
    posterBadge: document.getElementById('posterBadge'),
    posterTitle: document.getElementById('posterTitle'),
    posterStrip: document.getElementById('posterStrip'),
    posterFooter: document.getElementById('posterFooter'),

    // Actions & Toast
    btnRandomColor: document.getElementById('btnRandomColor'),
    btnCopyPalette: document.getElementById('btnCopyPalette'),
    toastNotification: document.getElementById('toastNotification'),
    toastMessage: document.getElementById('toastMessage')
  };

  // Canvas 上下文 (遵循 canvas-development skill 規範)
  const spectrumCtx = dom.spectrumCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
  const crosshairCtx = dom.crosshairCanvas.getContext('2d', { alpha: true });

  // 跨螢幕 HiDPI 縮放比
  let dpr = Math.min(window.devicePixelRatio || 1, 2.0);
  let canvasCssWidth = 460;
  let canvasCssHeight = 240;
  let isPointerDownOnCanvas = false;

  // =========================================================================
  // 色彩轉換精算模組 (Color Conversion Engine)
  // =========================================================================

  /**
   * CMYK (0-100) 轉 RGB (0-255)
   */
  function cmykToRgb(c, m, y, k) {
    const cNorm = Math.min(100, Math.max(0, c)) / 100;
    const mNorm = Math.min(100, Math.max(0, m)) / 100;
    const yNorm = Math.min(100, Math.max(0, y)) / 100;
    const kNorm = Math.min(100, Math.max(0, k)) / 100;

    const r = Math.round(255 * (1 - cNorm) * (1 - kNorm));
    const g = Math.round(255 * (1 - mNorm) * (1 - kNorm));
    const b = Math.round(255 * (1 - yNorm) * (1 - kNorm));

    return { r, g, b };
  }

  /**
   * RGB (0-255) 轉 CMYK (0-100)
   */
  function rgbToCmyk(r, g, b) {
    const rNorm = Math.min(255, Math.max(0, r)) / 255;
    const gNorm = Math.min(255, Math.max(0, g)) / 255;
    const bNorm = Math.min(255, Math.max(0, b)) / 255;

    const kNorm = 1 - Math.max(rNorm, gNorm, bNorm);

    if (kNorm >= 0.9999) {
      return { c: 0, m: 0, y: 0, k: 100 };
    }

    const cNorm = (1 - rNorm - kNorm) / (1 - kNorm);
    const mNorm = (1 - gNorm - kNorm) / (1 - kNorm);
    const yNorm = (1 - bNorm - kNorm) / (1 - kNorm);

    return {
      c: Math.round(cNorm * 100),
      m: Math.round(mNorm * 100),
      y: Math.round(yNorm * 100),
      k: Math.round(kNorm * 100)
    };
  }

  /**
   * RGB (0-255) 轉 16 進位 HEX 字串 (如 "00A3E0")
   */
  function rgbToHex(r, g, b) {
    const toHexPart = (n) => {
      const hex = Math.min(255, Math.max(0, Math.round(n))).toString(16).toUpperCase();
      return hex.length === 1 ? '0' + hex : hex;
    };
    return `${toHexPart(r)}${toHexPart(g)}${toHexPart(b)}`;
  }

  /**
   * HEX 字串 (帶或不帶 #) 轉 RGB (0-255)
   */
  function hexToRgb(hexStr) {
    if (!hexStr) return null;
    let cleanHex = hexStr.replace(/^#/, '').trim();

    // 支援 3 碼縮寫，例如 "0AF" -> "00AAFF"
    if (cleanHex.length === 3) {
      cleanHex = cleanHex.split('').map(ch => ch + ch).join('');
    }

    if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
      return null;
    }

    const num = parseInt(cleanHex, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  /**
   * RGB (0-255) 轉 HSL (H: 0-360, S: 0-100, L: 0-100)
   */
  function rgbToHsl(r, g, b) {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case rNorm:
          h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
          break;
        case gNorm:
          h = (bNorm - rNorm) / d + 2;
          break;
        case bNorm:
          h = (rNorm - gNorm) / d + 4;
          break;
      }
      h = Math.round(h * 60);
    }

    return {
      h: Math.round(h),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  }

  /**
   * HSL (H: 0-360, S: 0-100, L: 0-100) 轉 RGB (0-255)
   */
  function hslToRgb(h, s, l) {
    const hNorm = ((h % 360) + 360) % 360 / 360;
    const sNorm = Math.min(100, Math.max(0, s)) / 100;
    const lNorm = Math.min(100, Math.max(0, l)) / 100;

    let r, g, b;

    if (sNorm === 0) {
      r = g = b = lNorm;
    } else {
      const hue2rgb = (p, q, t) => {
        let tAdj = t;
        if (tAdj < 0) tAdj += 1;
        if (tAdj > 1) tAdj -= 1;
        if (tAdj < 1 / 6) return p + (q - p) * 6 * tAdj;
        if (tAdj < 1 / 2) return q;
        if (tAdj < 2 / 3) return p + (q - p) * (2 / 3 - tAdj) * 6;
        return p;
      };

      const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
      const p = 2 * lNorm - q;

      r = hue2rgb(p, q, hNorm + 1 / 3);
      g = hue2rgb(p, q, hNorm);
      b = hue2rgb(p, q, hNorm - 1 / 3);
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }

  /**
   * 計算亮度與適合文字的黑白對比色
   */
  function getContrastYIQ(hexcolor) {
    const rgb = hexToRgb(hexcolor);
    if (!rgb) return '#ffffff';
    const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return yiq >= 128 ? '#0b0f19' : '#ffffff';
  }

  // =========================================================================
  // Canvas 色彩光譜渲染器 (高效能 HiDPI 雙層 Canvas)
  // =========================================================================

  /**
   * 初始化與更新 Canvas DPR 尺寸
   */
  function setupHiDPICanvases() {
    const rect = dom.spectrumContainer.getBoundingClientRect();
    canvasCssWidth = Math.max(280, Math.floor(rect.width || 460));
    canvasCssHeight = Math.max(160, Math.floor(rect.height || 240));

    dpr = Math.min(window.devicePixelRatio || 1, 2.0);

    // 設定底層光譜 Canvas
    dom.spectrumCanvas.width = Math.round(canvasCssWidth * dpr);
    dom.spectrumCanvas.height = Math.round(canvasCssHeight * dpr);
    dom.spectrumCanvas.style.width = `${canvasCssWidth}px`;
    dom.spectrumCanvas.style.height = `${canvasCssHeight}px`;
    spectrumCtx.resetTransform();
    spectrumCtx.scale(dpr, dpr);

    // 設定頂層準心 Canvas
    dom.crosshairCanvas.width = Math.round(canvasCssWidth * dpr);
    dom.crosshairCanvas.height = Math.round(canvasCssHeight * dpr);
    dom.crosshairCanvas.style.width = `${canvasCssWidth}px`;
    dom.crosshairCanvas.style.height = `${canvasCssHeight}px`;
    crosshairCtx.resetTransform();
    crosshairCtx.scale(dpr, dpr);

    drawSpectrum();
    drawCrosshair();
  }

  /**
   * 繪製底層色彩光譜
   */
  function drawSpectrum() {
    const w = canvasCssWidth;
    const h = canvasCssHeight;

    if (state.pickerMode === 'full') {
      // 模式 1: 0~360° 全頻彩虹光譜與明暗色階
      // 水平方向：色相 (0 ~ 360°)
      const rainbowGrad = spectrumCtx.createLinearGradient(0, 0, w, 0);
      rainbowGrad.addColorStop(0.00, '#ff0000');
      rainbowGrad.addColorStop(0.17, '#ffff00');
      rainbowGrad.addColorStop(0.33, '#00ff00');
      rainbowGrad.addColorStop(0.50, '#00ffff');
      rainbowGrad.addColorStop(0.67, '#0000ff');
      rainbowGrad.addColorStop(0.83, '#ff00ff');
      rainbowGrad.addColorStop(1.00, '#ff0000');

      spectrumCtx.fillStyle = rainbowGrad;
      spectrumCtx.fillRect(0, 0, w, h);

      // 垂直方向：頂部純白漸變到中間透明
      const whiteGrad = spectrumCtx.createLinearGradient(0, 0, 0, h * 0.5);
      whiteGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      whiteGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      spectrumCtx.fillStyle = whiteGrad;
      spectrumCtx.fillRect(0, 0, w, h * 0.5);

      // 垂直方向：底部純黑漸變到中間透明
      const blackGrad = spectrumCtx.createLinearGradient(0, h * 0.5, 0, h);
      blackGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      blackGrad.addColorStop(1, 'rgba(0, 0, 0, 1)');
      spectrumCtx.fillStyle = blackGrad;
      spectrumCtx.fillRect(0, h * 0.5, w, h * 0.5);

    } else {
      // 模式 2: HSV 專業矩陣 (基於當前色相)
      const currentHue = state.h;
      const pureHueColor = `hsl(${currentHue}, 100%, 50%)`;

      spectrumCtx.fillStyle = pureHueColor;
      spectrumCtx.fillRect(0, 0, w, h);

      // 水平由左至右：白色至透明
      const horizGrad = spectrumCtx.createLinearGradient(0, 0, w, 0);
      horizGrad.addColorStop(0, '#ffffff');
      horizGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      spectrumCtx.fillStyle = horizGrad;
      spectrumCtx.fillRect(0, 0, w, h);

      // 垂直由上至下：透明至純黑
      const vertGrad = spectrumCtx.createLinearGradient(0, 0, 0, h);
      vertGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vertGrad.addColorStop(1, '#000000');
      spectrumCtx.fillStyle = vertGrad;
      spectrumCtx.fillRect(0, 0, w, h);
    }
  }

  /**
   * 繪製頂層準心指針 (Crosshair)
   */
  function drawCrosshair() {
    const w = canvasCssWidth;
    const h = canvasCssHeight;

    // 清空頂層 Canvas
    crosshairCtx.clearRect(0, 0, w, h);

    // 根據當前色彩計算十字指針坐標
    let cx = 0;
    let cy = 0;

    if (state.pickerMode === 'full') {
      // X 由色相決定 (0 ~ 360°)
      cx = (state.h / 360) * w;

      // Y 由明度決定 (Lightness 0 ~ 100: 頂部100%白, 中間50%, 底部0%黑)
      cy = (1 - (state.l / 100)) * h;
    } else {
      // X 為 Saturation
      cx = (state.s / 100) * w;
      // Y 為 100 - Lightness
      cy = (1 - (state.l / 100)) * h;
    }

    cx = Math.min(w - 2, Math.max(2, cx));
    cy = Math.min(h - 2, Math.max(2, cy));

    // 雙圈反光準心 (確保在黑白背景下均清晰可見)
    crosshairCtx.save();
    crosshairCtx.lineWidth = 2.5;

    // 外外圈黑色光暈
    crosshairCtx.beginPath();
    crosshairCtx.arc(cx, cy, 9, 0, Math.PI * 2);
    crosshairCtx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    crosshairCtx.stroke();

    // 內圈純白色環
    crosshairCtx.beginPath();
    crosshairCtx.arc(cx, cy, 7, 0, Math.PI * 2);
    crosshairCtx.strokeStyle = '#ffffff';
    crosshairCtx.stroke();

    // 中心微小實心指示點
    crosshairCtx.beginPath();
    crosshairCtx.arc(cx, cy, 2, 0, Math.PI * 2);
    crosshairCtx.fillStyle = `#${state.hex}`;
    crosshairCtx.fill();

    crosshairCtx.restore();
  }

  /**
   * 根據滑鼠/手指在 Canvas 上的位置計算色彩並更新狀態
   */
  function pickColorFromPosition(clientX, clientY) {
    const rect = dom.spectrumContainer.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const y = Math.min(rect.height, Math.max(0, clientY - rect.top));

    const normX = x / rect.width;
    const normY = y / rect.height;

    if (state.pickerMode === 'full') {
      // X 軸對應色相 0° ~ 360°
      const h = Math.round(normX * 360) % 360;

      // Y 軸對應明度：頂部 100% (白)，底部 0% (黑)
      const l = Math.round((1 - normY) * 100);

      // 飽和度由中心向兩端保持高飽和
      const s = 100;

      const rgb = hslToRgb(h, s, l);
      setColorFromRgb(rgb.r, rgb.g, rgb.b, 'canvas');

    } else {
      // HSV 模式：保持當前 Hue，X 為 Saturation，Y 為明暗
      const s = Math.round(normX * 100);
      const l = Math.round((1 - normY) * 100);

      const rgb = hslToRgb(state.h, s, l);
      setColorFromRgb(rgb.r, rgb.g, rgb.b, 'canvas');
    }
  }

  // =========================================================================
  // 狀態同步與連動處理 (Bidirectional Sync Engine)
  // =========================================================================

  /**
   * 從 CMYK 數值更新全站色彩
   * @param {number} c 0-100
   * @param {number} m 0-100
   * @param {number} y 0-100
   * @param {number} k 0-100
   * @param {string} source 觸發來源 ('slider' | 'input' | 'hex' | 'canvas' | 'preset' | 'palette')
   */
  function setColorFromCmyk(c, m, y, k, source = 'cmyk') {
    if (state.isSyncing) return;
    state.isSyncing = true;

    state.c = Math.min(100, Math.max(0, Math.round(c)));
    state.m = Math.min(100, Math.max(0, Math.round(m)));
    state.y = Math.min(100, Math.max(0, Math.round(y)));
    state.k = Math.min(100, Math.max(0, Math.round(k)));

    // 換算 RGB
    const rgb = cmykToRgb(state.c, state.m, state.y, state.k);
    state.r = rgb.r;
    state.g = rgb.g;
    state.b = rgb.b;

    // 換算 HEX
    state.hex = rgbToHex(rgb.r, rgb.g, rgb.b);

    // 換算 HSL
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    state.h = hsl.h;
    state.s = hsl.s;
    state.l = hsl.l;

    updateUI(source);
    state.isSyncing = false;
  }

  /**
   * 從 RGB 數值更新全站色彩
   */
  function setColorFromRgb(r, g, b, source = 'rgb') {
    if (state.isSyncing) return;
    state.isSyncing = true;

    state.r = Math.min(255, Math.max(0, Math.round(r)));
    state.g = Math.min(255, Math.max(0, Math.round(g)));
    state.b = Math.min(255, Math.max(0, Math.round(b)));

    // 換算 CMYK
    const cmyk = rgbToCmyk(state.r, state.g, state.b);
    state.c = cmyk.c;
    state.m = cmyk.m;
    state.y = cmyk.y;
    state.k = cmyk.k;

    // 換算 HEX
    state.hex = rgbToHex(state.r, state.g, state.b);

    // 換算 HSL
    const hsl = rgbToHsl(state.r, state.g, state.b);
    state.h = hsl.h;
    state.s = hsl.s;
    state.l = hsl.l;

    updateUI(source);
    state.isSyncing = false;
  }

  /**
   * 從 HEX 字串更新全站色彩
   */
  function setColorFromHex(hexStr, source = 'hex') {
    const rgb = hexToRgb(hexStr);
    if (!rgb) return false;
    setColorFromRgb(rgb.r, rgb.g, rgb.b, source);
    return true;
  }

  /**
   * 更新所有介面控制項與展示區
   */
  function updateUI(source) {
    const hexFull = `#${state.hex}`;

    // 1. CMYK 滑動條與數字輸入框
    if (source !== 'cmyk-slider-c' && source !== 'cmyk-input-c') {
      dom.sliderC.value = state.c;
      dom.inputC.value = state.c;
    } else {
      dom.sliderC.value = state.c;
      dom.inputC.value = state.c;
    }

    if (source !== 'cmyk-slider-m' && source !== 'cmyk-input-m') {
      dom.sliderM.value = state.m;
      dom.inputM.value = state.m;
    } else {
      dom.sliderM.value = state.m;
      dom.inputM.value = state.m;
    }

    if (source !== 'cmyk-slider-y' && source !== 'cmyk-input-y') {
      dom.sliderY.value = state.y;
      dom.inputY.value = state.y;
    } else {
      dom.sliderY.value = state.y;
      dom.inputY.value = state.y;
    }

    if (source !== 'cmyk-slider-k' && source !== 'cmyk-input-k') {
      dom.sliderK.value = state.k;
      dom.inputK.value = state.k;
    } else {
      dom.sliderK.value = state.k;
      dom.inputK.value = state.k;
    }

    // 1.1 RGB 滑動條與數字輸入框
    if (source !== 'rgb-slider-r' && source !== 'rgb-input-r') {
      dom.sliderR.value = state.r;
      dom.inputR.value = state.r;
    } else {
      dom.sliderR.value = state.r;
      dom.inputR.value = state.r;
    }

    if (source !== 'rgb-slider-g' && source !== 'rgb-input-g') {
      dom.sliderG.value = state.g;
      dom.inputG.value = state.g;
    } else {
      dom.sliderG.value = state.g;
      dom.inputG.value = state.g;
    }

    if (source !== 'rgb-slider-b' && source !== 'rgb-input-b') {
      dom.sliderB.value = state.b;
      dom.inputB.value = state.b;
    } else {
      dom.sliderB.value = state.b;
      dom.inputB.value = state.b;
    }

    // 2. HEX 輸入框 (若非用戶正在輸入 HEX 則直接同步)
    if (source !== 'hex-input') {
      dom.hexInput.value = state.hex;
    }

    // 3. RGB 與 CMYK 字串顯示
    dom.rgbDisplay.value = `rgb(${state.r}, ${state.g}, ${state.b})`;
    dom.cmykStringDisplay.value = `C:${state.c}% M:${state.m}% Y:${state.y}% K:${state.k}%`;

    // 4. 大色彩預覽方塊
    dom.mainColorPreview.style.backgroundColor = hexFull;
    const contrastText = getContrastYIQ(state.hex);
    dom.contrastBadge.style.color = contrastText;
    dom.contrastBadge.style.borderColor = contrastText === '#ffffff' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
    dom.contrastBadge.textContent = contrastText === '#ffffff' ? '深底高對比 (白字)' : '淺底高對比 (深字)';

    // 5. CMYK 模式：總墨量 TIC (Total Ink Coverage) 計算
    const totalInk = state.c + state.m + state.y + state.k;
    let ticStatus = '正常安全';
    if (totalInk > 320) {
      ticStatus = '嚴重超標 (易背印/黏頁)';
    } else if (totalInk > 280) {
      ticStatus = '輕微偏高 (注意乾燥)';
    }
    dom.ticValueText.textContent = `${totalInk}% (${ticStatus})`;
    dom.ticProgressBar.style.width = `${Math.min(100, (totalInk / 400) * 100)}%`;

    // 5.1 RGB 模式：感知亮度計算 (Relative Luminance / sRGB)
    const relLuminance = Math.round(((0.299 * state.r + 0.587 * state.g + 0.114 * state.b) / 255) * 1000) / 10;
    let lumStatus = '中等明度';
    if (relLuminance >= 75) {
      lumStatus = '高亮高光階';
    } else if (relLuminance <= 25) {
      lumStatus = '深沉暗影階';
    }
    dom.lumValueText.textContent = `${relLuminance}% (${lumStatus})`;
    dom.lumProgressBar.style.width = `${Math.min(100, relLuminance)}%`;

    // 6. 色相與明度拉桿連動
    if (source !== 'hue-slider') {
      dom.hueSlider.value = state.h;
      dom.hueValueText.textContent = `${state.h}°`;
    }
    if (source !== 'lightness-slider') {
      dom.lightnessSlider.value = state.l;
      dom.lightnessValueText.textContent = `${state.l}%`;
    }
    document.documentElement.style.setProperty('--current-hue-color', `hsl(${state.h}, 100%, 50%)`);

    // 7. 更新 Canvas 準心指針
    if (state.pickerMode === 'hsv') {
      drawSpectrum();
    }
    drawCrosshair();

    // 8. 重新計算並渲染五色和諧配色方案
    generateAndRenderHarmony();
  }

  // =========================================================================
  // 五色和諧配色引擎 (5-Color Harmony Engine)
  // =========================================================================

  /**
   * 根據當前色彩與所選規則計算出 5 個極致和諧的色彩
   */
  function calculateFiveColorHarmony() {
    const baseH = state.h;
    const baseS = state.s;
    const baseL = state.l;
    const rule = state.harmonyRule;

    let colorsHsl = [];

    switch (rule) {
      case 'analogous':
        // 類似相鄰色：-40°, -20°, 0° (主色), +20°, +40°
        colorsHsl = [
          { h: (baseH - 40 + 360) % 360, s: baseS, l: Math.min(90, baseL + 10), role: '相鄰冷調' },
          { h: (baseH - 20 + 360) % 360, s: baseS, l: Math.min(85, baseL + 5), role: '鄰近輔色' },
          { h: baseH, s: baseS, l: baseL, role: '主色彩 (KEY)', isMain: true },
          { h: (baseH + 20) % 360, s: baseS, l: Math.max(15, baseL - 5), role: '鄰近暖調' },
          { h: (baseH + 40) % 360, s: baseS, l: Math.max(10, baseL - 10), role: '相鄰延伸' }
        ];
        break;

      case 'complementary':
        // 互補分裂色：主色、互補 (180°)、分裂補色 1 (150°)、分裂補色 2 (210°)、柔和互補調
        colorsHsl = [
          { h: baseH, s: baseS, l: baseL, role: '主色彩 (KEY)', isMain: true },
          { h: (baseH + 180) % 360, s: baseS, l: baseL, role: '180° 完全互補' },
          { h: (baseH + 150) % 360, s: Math.max(40, baseS - 15), l: Math.min(85, baseL + 8), role: '分裂補色 A' },
          { h: (baseH + 210) % 360, s: Math.max(40, baseS - 15), l: Math.max(20, baseL - 8), role: '分裂補色 B' },
          { h: (baseH + 180) % 360, s: Math.max(25, baseS - 35), l: 92, role: '柔和底色' }
        ];
        break;

      case 'monochromatic':
        // 單色印刷色階梯級：5 階深淺層次
        colorsHsl = [
          { h: baseH, s: Math.max(15, baseS - 25), l: 93, role: '超淡水洗色' },
          { h: baseH, s: Math.max(25, baseS - 10), l: 72, role: '柔和高光' },
          { h: baseH, s: baseS, l: baseL, role: '基準主色', isMain: true },
          { h: baseH, s: Math.min(100, baseS + 10), l: Math.max(18, Math.round(baseL * 0.65)), role: '濃郁暗調' },
          { h: baseH, s: Math.min(100, baseS + 20), l: Math.max(8, Math.round(baseL * 0.35)), role: '深黑底墨' }
        ];
        break;

      case 'triadic':
        // 三等角和諧 (0°, 120°, 240°) 加上中間過渡色
        colorsHsl = [
          { h: baseH, s: baseS, l: baseL, role: '主色彩 (KEY)', isMain: true },
          { h: (baseH + 120) % 360, s: baseS, l: baseL, role: '三角色 A' },
          { h: (baseH + 240) % 360, s: baseS, l: baseL, role: '三角色 B' },
          { h: (baseH + 60) % 360, s: Math.max(30, baseS - 20), l: Math.min(88, baseL + 15), role: '明亮過渡' },
          { h: (baseH + 300) % 360, s: Math.max(30, baseS - 20), l: Math.max(15, baseL - 15), role: '深穩伴色' }
        ];
        break;

      case 'designer':
      default:
        // 專業品牌設計五色（主色、輔色、點綴提亮色、淺色印刷底面、濃深文字色）
        colorsHsl = [
          { h: baseH, s: baseS, l: baseL, role: '主品牌色 (PRIMARY)', isMain: true },
          { h: (baseH + 35) % 360, s: Math.min(100, baseS + 5), l: Math.min(80, baseL + 5), role: '次要輔色 (SECONDARY)' },
          { h: (baseH + 175) % 360, s: 95, l: 55, role: '強烈焦點 (ACCENT)' },
          { h: (baseH + 15) % 360, s: Math.max(12, Math.round(baseS * 0.2)), l: 94, role: '紙張底色 (SURFACE)' },
          { h: (baseH - 10 + 360) % 360, s: Math.max(30, Math.round(baseS * 0.45)), l: 12, role: '印刷標題 (TEXT/DEEP)' }
        ];
        break;
    }

    // 將 5 組 HSL 精算轉換成 CMYK, RGB, HEX 完整資料體
    return colorsHsl.map(item => {
      const rgb = hslToRgb(item.h, item.s, item.l);
      const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      return {
        ...item,
        rgb,
        cmyk,
        hex,
        cmykText: `C:${cmyk.c} M:${cmyk.m} Y:${cmyk.y} K:${cmyk.k}`
      };
    });
  }

  /**
   * 渲染五色卡片與更新實體印刷模擬
   */
  function generateAndRenderHarmony() {
    const colors = calculateFiveColorHarmony();
    state.paletteColors = colors;

    // 清空現有卡片
    dom.fiveColorsGrid.innerHTML = '';

    colors.forEach((col, index) => {
      const card = document.createElement('div');
      card.className = `color-card-item ${col.isMain ? 'is-main' : ''}`;

      const contrastColor = getContrastYIQ(col.hex);

      card.innerHTML = `
        <div class="card-color-block" style="background-color: #${col.hex};" title="點擊直接套用為主色">
          <span class="card-color-role" style="color: ${contrastColor}; border-color: ${contrastColor === '#ffffff' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'}">${col.role}</span>
          <button type="button" class="apply-color-btn" data-hex="${col.hex}">設為主色</button>
        </div>
        <div class="card-color-meta">
          <div class="swatch-hex-row">
            <span class="swatch-hex">#${col.hex}</span>
            <button type="button" class="swatch-copy-btn" data-copy="#${col.hex}" title="複製 HEX">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>
          <div class="swatch-cmyk" title="${state.inputMode === 'rgb' ? '螢幕 RGB 色值' : '印刷 CMYK 色階'}">
            ${state.inputMode === 'rgb' ? `RGB: ${col.rgb.r}, ${col.rgb.g}, ${col.rgb.b}` : col.cmykText}
          </div>
        </div>
      `;

      // 點擊色塊本身或「設為主色」按鈕
      card.querySelector('.card-color-block').addEventListener('click', (e) => {
        setColorFromHex(col.hex, 'palette');
        showToast(`已套用配色 #${col.hex} 為主色`);
      });

      card.querySelector('.apply-color-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        setColorFromHex(col.hex, 'palette');
        showToast(`已套用 #${col.hex} 為主色`);
      });

      // 點擊複製按鈕
      card.querySelector('.swatch-copy-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(`#${col.hex}`, `已複製 HEX: #${col.hex}`);
      });

      dom.fiveColorsGrid.appendChild(card);
    });

    // 即時更新實體印刷預覽模擬 (Print Mockup Preview)
    updateMockupPreview(colors);
  }

  /**
   * 套用五色至印刷名片與海報
   */
  function updateMockupPreview(colors) {
    if (colors.length < 5) return;

    const [c1, c2, c3, c4, c5] = colors;

    // 名片視覺更新
    dom.mockupCard1.style.backgroundColor = `#${c4.hex}`;
    const cardTextCol = getContrastYIQ(c4.hex);
    dom.mockupCard1.style.color = cardTextCol;
    dom.mockupAccent.style.backgroundColor = `#${c1.hex}`;
    dom.mockupBrand.style.color = `#${c1.hex}`;

    dom.mDot1.style.backgroundColor = `#${c1.hex}`;
    dom.mDot2.style.backgroundColor = `#${c2.hex}`;
    dom.mDot3.style.backgroundColor = `#${c3.hex}`;
    dom.mDot4.style.backgroundColor = `#${c4.hex}`;
    dom.mDot5.style.backgroundColor = `#${c5.hex}`;

    // 海報視覺更新
    dom.posterHero.style.backgroundColor = `#${c5.hex}`;
    dom.posterTitle.style.color = `#${c1.hex}`;
    dom.posterBadge.style.backgroundColor = `#${c3.hex}`;
    dom.posterBadge.style.color = getContrastYIQ(c3.hex);
    dom.posterStrip.style.background = `linear-gradient(to right, #${c1.hex}, #${c2.hex}, #${c3.hex}, #${c4.hex}, #${c5.hex})`;
  }

  // =========================================================================
  // 經典印刷基準色階色票生成 (CMYK Classic Swatches)
  // =========================================================================
  const classicSwatches = [
    { label: 'C 100%', cmyk: [100, 0, 0, 0] },
    { label: 'M 100%', cmyk: [0, 100, 0, 0] },
    { label: 'Y 100%', cmyk: [0, 0, 100, 0] },
    { label: 'K 100%', cmyk: [0, 0, 0, 100] },
    { label: '經典印刷紅', cmyk: [0, 100, 100, 0] },
    { label: '經典印刷綠', cmyk: [100, 0, 100, 0] },
    { label: '經典印刷藍', cmyk: [100, 100, 0, 0] },
    { label: '富麗深黑', cmyk: [60, 40, 40, 100] },
    { label: '海軍深藍', cmyk: [100, 80, 10, 40] },
    { label: '薄荷粉綠', cmyk: [50, 0, 40, 0] },
    { label: '暖陽杏橙', cmyk: [0, 50, 100, 0] },
    { label: '珊瑚朱紅', cmyk: [0, 75, 60, 0] },
    { label: '皇家紫羅蘭', cmyk: [70, 90, 0, 10] },
    { label: '橄欖墨綠', cmyk: [50, 20, 90, 40] },
    { label: '金黃鵝黃', cmyk: [0, 15, 80, 0] },
    { label: '炭灰 50%', cmyk: [0, 0, 0, 50] }
  ];

  function renderPresetSwatches() {
    dom.presetSwatchesGrid.innerHTML = '';
    classicSwatches.forEach(swatch => {
      const [c, m, y, k] = swatch.cmyk;
      const rgb = cmykToRgb(c, m, y, k);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);

      const item = document.createElement('div');
      item.className = 'swatch-item';
      item.style.backgroundColor = `#${hex}`;
      item.title = `${swatch.label} (C:${c} M:${m} Y:${y} K:${k} | #${hex})`;

      item.addEventListener('click', () => {
        setColorFromCmyk(c, m, y, k, 'preset');
        showToast(`已載入：${swatch.label}`);
      });

      dom.presetSwatchesGrid.appendChild(item);
    });
  }

  // =========================================================================
  // 剪貼簿與提示通知 (Clipboard & Toast)
  // =========================================================================
  let toastTimer = null;

  function showToast(message) {
    if (toastTimer) clearTimeout(toastTimer);
    dom.toastMessage.textContent = message;
    dom.toastNotification.classList.add('show');
    toastTimer = setTimeout(() => {
      dom.toastNotification.classList.remove('show');
    }, 2400);
  }

  function copyToClipboard(text, successMsg = '已複製到剪貼簿！') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg);
      }).catch(() => {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    const tempInput = document.createElement('textarea');
    tempInput.value = text;
    tempInput.style.position = 'fixed';
    tempInput.style.opacity = '0';
    document.body.appendChild(tempInput);
    tempInput.select();
    try {
      document.execCommand('copy');
      showToast(successMsg);
    } catch (err) {
      showToast('複製失敗，請手動選取');
    }
    document.body.removeChild(tempInput);
  }

  // =========================================================================
  // 事件監聽與綁定
  // =========================================================================
  function bindEvents() {
    // 0. CMYK 與 RGB 模式切換
    function switchMode(newMode) {
      state.inputMode = newMode;
      if (newMode === 'cmyk') {
        dom.tabModeCmyk.classList.add('active');
        dom.tabModeRgb.classList.remove('active');
        dom.cmykSlidersContainer.style.display = 'flex';
        dom.rgbSlidersContainer.style.display = 'none';
        dom.ticMeterContainer.style.display = 'flex';
        dom.lumMeterContainer.style.display = 'none';
        dom.controlsTitle.textContent = 'CMYK 印刷比例調節';
        dom.controlsHint.textContent = '拖曳拉條或手動輸入 0-100% 數值';
        dom.controlsBadge.textContent = 'HEX 雙向即時連動';
        dom.controlsBadge.className = 'badge badge-accent';
        showToast('已切換至 CMYK 印刷調色模式');
      } else {
        dom.tabModeRgb.classList.add('active');
        dom.tabModeCmyk.classList.remove('active');
        dom.cmykSlidersContainer.style.display = 'none';
        dom.rgbSlidersContainer.style.display = 'flex';
        dom.ticMeterContainer.style.display = 'none';
        dom.lumMeterContainer.style.display = 'flex';
        dom.controlsTitle.textContent = 'RGB 螢幕色值調節';
        dom.controlsHint.textContent = '拖曳拉條或手動輸入 0-255 數值';
        dom.controlsBadge.textContent = 'sRGB 廣色域連動';
        dom.controlsBadge.className = 'badge';
        showToast('已切換至 RGB 螢幕調色模式');
      }
      generateAndRenderHarmony();
    }

    dom.tabModeCmyk.addEventListener('click', () => switchMode('cmyk'));
    dom.tabModeRgb.addEventListener('click', () => switchMode('rgb'));

    // 1. CMYK 四個滑桿輸入連動
    dom.sliderC.addEventListener('input', (e) => {
      setColorFromCmyk(parseFloat(e.target.value), state.m, state.y, state.k, 'cmyk-slider-c');
    });
    dom.sliderM.addEventListener('input', (e) => {
      setColorFromCmyk(state.c, parseFloat(e.target.value), state.y, state.k, 'cmyk-slider-m');
    });
    dom.sliderY.addEventListener('input', (e) => {
      setColorFromCmyk(state.c, state.m, parseFloat(e.target.value), state.k, 'cmyk-slider-y');
    });
    dom.sliderK.addEventListener('input', (e) => {
      setColorFromCmyk(state.c, state.m, state.y, parseFloat(e.target.value), 'cmyk-slider-k');
    });

    // 1.1 RGB 三個滑桿輸入連動
    dom.sliderR.addEventListener('input', (e) => {
      setColorFromRgb(parseInt(e.target.value, 10), state.g, state.b, 'rgb-slider-r');
    });
    dom.sliderG.addEventListener('input', (e) => {
      setColorFromRgb(state.r, parseInt(e.target.value, 10), state.b, 'rgb-slider-g');
    });
    dom.sliderB.addEventListener('input', (e) => {
      setColorFromRgb(state.r, state.g, parseInt(e.target.value, 10), 'rgb-slider-b');
    });

    // 1.2 RGB 三個數字輸入框
    const handleRgbNumInput = (inputElem, channel) => {
      let val = parseInt(inputElem.value, 10);
      if (isNaN(val)) val = 0;
      val = Math.min(255, Math.max(0, val));
      inputElem.value = val;

      const newR = channel === 'r' ? val : state.r;
      const newG = channel === 'g' ? val : state.g;
      const newB = channel === 'b' ? val : state.b;
      setColorFromRgb(newR, newG, newB, `rgb-input-${channel}`);
    };

    dom.inputR.addEventListener('change', () => handleRgbNumInput(dom.inputR, 'r'));
    dom.inputG.addEventListener('change', () => handleRgbNumInput(dom.inputG, 'g'));
    dom.inputB.addEventListener('change', () => handleRgbNumInput(dom.inputB, 'b'));

    // 2. CMYK 四個數字輸入框
    const handleNumInput = (inputElem, channel) => {
      let val = parseFloat(inputElem.value);
      if (isNaN(val)) val = 0;
      val = Math.min(100, Math.max(0, val));
      inputElem.value = val;

      const newC = channel === 'c' ? val : state.c;
      const newM = channel === 'm' ? val : state.m;
      const newY = channel === 'y' ? val : state.y;
      const newK = channel === 'k' ? val : state.k;
      setColorFromCmyk(newC, newM, newY, newK, `cmyk-input-${channel}`);
    };

    dom.inputC.addEventListener('change', () => handleNumInput(dom.inputC, 'c'));
    dom.inputM.addEventListener('change', () => handleNumInput(dom.inputM, 'm'));
    dom.inputY.addEventListener('change', () => handleNumInput(dom.inputY, 'y'));
    dom.inputK.addEventListener('change', () => handleNumInput(dom.inputK, 'k'));

    // 3. HEX 雙向輸入監聽
    dom.hexInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
      e.target.value = val;
      if (val.length === 6) {
        setColorFromHex(val, 'hex-input');
      }
    });

    dom.hexInput.addEventListener('blur', (e) => {
      let val = e.target.value.trim();
      if (!setColorFromHex(val, 'hex-input')) {
        // 若輸入無效格式，自動復原為目前正確 HEX
        dom.hexInput.value = state.hex;
      }
    });

    // 4. Canvas 色彩拾色器指針互動 (Pointer Events)
    const handlePointerStart = (e) => {
      isPointerDownOnCanvas = true;
      dom.spectrumContainer.setPointerCapture(e.pointerId);
      pickColorFromPosition(e.clientX, e.clientY);
    };

    const handlePointerMove = (e) => {
      if (!isPointerDownOnCanvas) return;
      pickColorFromPosition(e.clientX, e.clientY);
    };

    const handlePointerEnd = (e) => {
      if (!isPointerDownOnCanvas) return;
      isPointerDownOnCanvas = false;
      try {
        dom.spectrumContainer.releasePointerCapture(e.pointerId);
      } catch (err) {}
    };

    dom.spectrumContainer.addEventListener('pointerdown', handlePointerStart);
    dom.spectrumContainer.addEventListener('pointermove', handlePointerMove);
    dom.spectrumContainer.addEventListener('pointerup', handlePointerEnd);
    dom.spectrumContainer.addEventListener('pointercancel', handlePointerEnd);

    // 5. 拾色器模式切換 (全頻譜 vs HSV 矩陣)
    dom.modeTags.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.modeTags.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.pickerMode = btn.dataset.mode;
        drawSpectrum();
        drawCrosshair();
      });
    });

    // 6. 色相 (Hue) 滑桿與明度 (Lightness) 滑桿
    dom.hueSlider.addEventListener('input', (e) => {
      const h = parseInt(e.target.value, 10);
      dom.hueValueText.textContent = `${h}°`;
      state.h = h;
      document.documentElement.style.setProperty('--current-hue-color', `hsl(${h}, 100%, 50%)`);

      const rgb = hslToRgb(h, state.s, state.l);
      setColorFromRgb(rgb.r, rgb.g, rgb.b, 'hue-slider');
    });

    dom.lightnessSlider.addEventListener('input', (e) => {
      const l = parseInt(e.target.value, 10);
      dom.lightnessValueText.textContent = `${l}%`;
      state.l = l;

      const rgb = hslToRgb(state.h, state.s, l);
      setColorFromRgb(rgb.r, rgb.g, rgb.b, 'lightness-slider');
    });

    // 7. 五色配色規則切換按鈕
    dom.harmonyBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.harmonyBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.harmonyRule = btn.dataset.rule;
        generateAndRenderHarmony();
      });
    });

    // 8. 複製按鈕群
    document.querySelectorAll('.copy-field-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        if (target === 'hex') {
          copyToClipboard(`#${state.hex}`, `已複製 HEX: #${state.hex}`);
        } else if (target === 'rgb') {
          copyToClipboard(`rgb(${state.r}, ${state.g}, ${state.b})`, `已複製 RGB 代碼`);
        } else if (target === 'cmyk') {
          copyToClipboard(`cmyk(${state.c}%, ${state.m}%, ${state.y}%, ${state.k}%)`, `已複製 CMYK 印刷格式`);
        }
      });
    });

    // 9. 一鍵複製整組五色盤代碼
    dom.btnCopyPalette.addEventListener('click', () => {
      const isRgb = state.inputMode === 'rgb';
      const lines = state.paletteColors.map((col, idx) => {
        if (isRgb) {
          return `顏色 ${idx + 1} (${col.role}): #${col.hex} | RGB: rgb(${col.rgb.r}, ${col.rgb.g}, ${col.rgb.b}) | ${col.cmykText}`;
        }
        return `顏色 ${idx + 1} (${col.role}): #${col.hex} | ${col.cmykText} | RGB: rgb(${col.rgb.r}, ${col.rgb.g}, ${col.rgb.b})`;
      }).join('\n');
      copyToClipboard(lines, '已複製完整五色搭配方案！');
    });

    // 10. 隨機生成靈感色彩
    dom.btnRandomColor.addEventListener('click', () => {
      const randomC = Math.floor(Math.random() * 101);
      const randomM = Math.floor(Math.random() * 101);
      const randomY = Math.floor(Math.random() * 101);
      const randomK = Math.floor(Math.random() * 40); // 隨機 K 限制在 40 以內避免過黑
      setColorFromCmyk(randomC, randomM, randomY, randomK, 'random');
      showToast('已產生隨機靈感色彩！');
    });

    // 11. 視窗縮放自動重新調整 Canvas 尺寸 (ResizeObserver)
    window.addEventListener('resize', () => {
      setupHiDPICanvases();
    });
  }

  // =========================================================================
  // 應用程式初始化
  // =========================================================================
  function init() {
    renderPresetSwatches();
    setupHiDPICanvases();
    bindEvents();
    // 預設色彩: Cyan Blue (C:100, M:27, Y:0, K:12 -> #00A3E0)
    setColorFromCmyk(100, 27, 0, 12, 'init');
  }

  // DOM 載入後立即啟動
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
